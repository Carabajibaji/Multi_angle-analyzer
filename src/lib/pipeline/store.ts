/**
 * Persistence helpers shared by all jobs: source provenance, the freshness ledger and provider health.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { datasets, providerHealth, sources } from "../db/schema";
import { describeError, ProviderError, redactSecrets } from "../providers/errors";
import type { ProviderObserver } from "../providers/http";
import type { DataNature, SourceMeta } from "../providers/types";

/** Upsert a source record (deduplicated by provider + url + content hash) and return its id. */
export async function recordSource(db: Db, meta: SourceMeta): Promise<number> {
  const [row] = await db
    .insert(sources)
    .values({
      provider: meta.provider,
      name: meta.name,
      url: meta.url ? redactSecrets(meta.url) : null,
      contentHash: meta.contentHash,
      httpStatus: meta.httpStatus ?? null,
      firstRetrievedAt: meta.retrievedAt,
      lastRetrievedAt: meta.retrievedAt,
      raw: meta.raw ?? null,
    })
    .onConflictDoUpdate({
      target: [sources.provider, sources.url, sources.contentHash],
      set: { lastRetrievedAt: meta.retrievedAt, httpStatus: meta.httpStatus ?? null },
    })
    .returning({ id: sources.id });
  return row!.id;
}

export interface DatasetSpec {
  key: string;
  kind: string;
  provider?: string;
  dataNature?: DataNature;
  staleAfterSeconds: number;
}

export const STALE_AFTER = {
  candles: 4 * 86_400,
  snapshot: 4 * 86_400,
  filings: 3 * 86_400,
  fundamentals: 3 * 86_400,
  news: 2 * 86_400,
  events: 3 * 86_400,
  indicators: 4 * 86_400,
  reference: 10 * 86_400,
} as const;

export async function markAttempt(db: Db, spec: DatasetSpec, at: Date): Promise<void> {
  await db
    .insert(datasets)
    .values({ ...spec, status: "never", lastAttemptAt: at })
    .onConflictDoUpdate({
      target: datasets.key,
      set: { lastAttemptAt: at, staleAfterSeconds: spec.staleAfterSeconds, provider: spec.provider, dataNature: spec.dataNature },
    });
}

export async function markSuccess(
  db: Db,
  key: string,
  at: Date,
  info: { dataAsOf?: string | null; recordCount?: number; sourceId?: number | null; changed: boolean },
): Promise<void> {
  await db
    .update(datasets)
    .set({
      status: "fresh",
      lastSuccessAt: at,
      lastError: null,
      ...(info.dataAsOf !== undefined ? { dataAsOf: info.dataAsOf } : {}),
      ...(info.recordCount !== undefined ? { recordCount: info.recordCount } : {}),
      ...(info.sourceId ? { lastSourceId: info.sourceId } : {}),
      ...(info.changed ? { lastChangedAt: at } : {}),
    })
    .where(eq(datasets.key, key));
}

/**
 * Record a failure WITHOUT touching the stored data: the last valid values stay visible and are
 * labelled stale by `evaluateFreshness` once they age out.
 */
export async function markFailure(db: Db, key: string, error: unknown): Promise<void> {
  const message = redactSecrets(describeError(error)).slice(0, 1000);
  await db
    .update(datasets)
    .set({
      status: sql`CASE WHEN ${datasets.lastSuccessAt} IS NULL THEN 'failed'::dataset_status ELSE 'stale'::dataset_status END`,
      lastError: message,
    })
    .where(eq(datasets.key, key));
}

/** Collects provider health signals in memory during a job and flushes them once at the end. */
export class HealthTracker implements ProviderObserver {
  private readonly stats = new Map<
    string,
    { requests: number; ok: number; errors: number; lastError?: ProviderError; lastOkAt?: Date; lastErrorAt?: Date; rateLimitedUntil?: Date }
  >();

  private s(provider: string) {
    let st = this.stats.get(provider);
    if (!st) this.stats.set(provider, (st = { requests: 0, ok: 0, errors: 0 }));
    return st;
  }
  onRequest(provider: string) {
    this.s(provider).requests++;
  }
  onSuccess(provider: string) {
    const st = this.s(provider);
    st.ok++;
    st.lastOkAt = new Date();
  }
  onError(provider: string, error: ProviderError) {
    const st = this.s(provider);
    st.errors++;
    st.lastError = error;
    st.lastErrorAt = new Date();
  }
  onRateLimited(provider: string, untilMs: number) {
    this.s(provider).rateLimitedUntil = new Date(untilMs);
  }

  /** Mark providers that could not even be attempted. */
  notConfigured(provider: string, message: string) {
    const st = this.s(provider);
    st.lastError = new ProviderError(provider, "not_configured", message);
    st.lastErrorAt = new Date();
  }

  async flush(db: Db): Promise<void> {
    for (const [provider, st] of this.stats) {
      const notConfigured = st.lastError?.errorClass === "not_configured" && st.requests === 0;
      const status = notConfigured ? "not_configured" : st.errors === 0 ? "ok" : st.ok > 0 ? "degraded" : "down";
      const [existing] = await db.select().from(providerHealth).where(eq(providerHealth.provider, provider));
      const consecutive = status === "ok" ? 0 : (existing?.consecutiveFailures ?? 0) + (st.errors > 0 ? 1 : 0);
      const row = {
        provider,
        status,
        lastOkAt: st.lastOkAt ?? existing?.lastOkAt ?? null,
        lastErrorAt: st.lastErrorAt ?? existing?.lastErrorAt ?? null,
        lastError: st.lastError ? redactSecrets(`${st.lastError.errorClass}: ${st.lastError.message}`).slice(0, 500) : (existing?.lastError ?? null),
        consecutiveFailures: consecutive,
        rateLimitedUntil: st.rateLimitedUntil ?? existing?.rateLimitedUntil ?? null,
        requestCount: (existing?.requestCount ?? 0) + st.requests,
        updatedAt: new Date(),
      };
      await db.insert(providerHealth).values(row).onConflictDoUpdate({ target: providerHealth.provider, set: row });
    }
    this.stats.clear();
  }
}

export async function getDataset(db: Db, key: string) {
  const [row] = await db.select().from(datasets).where(and(eq(datasets.key, key)));
  return row;
}
