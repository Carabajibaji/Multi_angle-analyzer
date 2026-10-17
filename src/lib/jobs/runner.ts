/**
 * Job runner: idempotency, concurrency locking, per-item failure isolation, logging and status.
 *
 * Guarantees:
 *  - A scheduled job runs at most once successfully per run key (unique partial index on job_runs).
 *  - Two copies of the same job never run concurrently (lease lock in job_locks; expired leases are taken over).
 *  - One failing item (ticker, filing...) never aborts the others; it is recorded in job_failures.
 *  - Failures never delete or overwrite previously stored valid data.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { jobFailures, jobLocks, jobRuns } from "../db/schema";
import { describeError, ProviderError, redactSecrets, toProviderError } from "../providers/errors";
import type { Providers } from "../providers/registry";
import { HealthTracker } from "../pipeline/store";

export type JobName = "pre-market" | "post-market" | "nightly-company" | "weekly-reconcile" | "on-demand";
export type Trigger = "schedule" | "manual" | "cli";

export interface JobContext {
  db: Db;
  providers: Providers;
  health: HealthTracker;
  now: Date;
  runKey: string;
  trigger: Trigger;
  log(message: string): void;
  ok(n?: number): void;
  skip(n?: number): void;
  fail(itemKey: string, error: unknown): Promise<void>;
  /** Run `fn` for one item; errors are recorded and swallowed so the job continues. */
  item<T>(itemKey: string, fn: () => Promise<T>): Promise<T | undefined>;
}

export interface JobDefinition {
  name: JobName;
  description: string;
  /** Idempotency key for a scheduled run at `now`. */
  runKey(now: Date): string;
  /** Whether a scheduled trigger at `now` should do work (trading day, time window...). */
  shouldRun(now: Date): { run: boolean; reason: string };
  lockTtlMs: number;
  /** Lock name; defaults to the job name. On-demand jobs lock per ticker. */
  lockKey?: string;
  execute(ctx: JobContext): Promise<Record<string, unknown>>;
}

export interface RunOptions {
  db: Db;
  providers: Providers;
  health?: HealthTracker;
  now?: Date;
  trigger?: Trigger;
  /** Bypass the schedule window and the already-succeeded check (manual refresh). */
  force?: boolean;
  holder?: string;
  echo?: boolean;
}

export interface JobResult {
  job: JobName;
  runKey: string;
  status: "succeeded" | "partial" | "failed" | "skipped";
  reason?: string;
  runId?: number;
  itemsOk: number;
  itemsFailed: number;
  itemsSkipped: number;
  summary?: Record<string, unknown>;
  log: string[];
}

const MAX_LOG_CHARS = 200_000;

export async function acquireLock(db: Db, jobName: string, holder: string, ttlMs: number, now: Date): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const rows = await db
    .insert(jobLocks)
    .values({ jobName, holder, acquiredAt: now, expiresAt })
    .onConflictDoUpdate({
      target: jobLocks.jobName,
      set: { holder, acquiredAt: now, expiresAt },
      setWhere: lt(jobLocks.expiresAt, now),
    })
    .returning({ holder: jobLocks.holder });
  return rows.length === 1 && rows[0]!.holder === holder;
}

export async function releaseLock(db: Db, jobName: string, holder: string): Promise<void> {
  await db.delete(jobLocks).where(and(eq(jobLocks.jobName, jobName), eq(jobLocks.holder, holder)));
}

export async function runJob(def: JobDefinition, opts: RunOptions): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const trigger = opts.trigger ?? "cli";
  const holder = opts.holder ?? `${process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}` : "local"}-${randomUUID()}`;
  const baseKey = def.runKey(now);
  // Forced/manual runs get a unique key so they never collide with (or block) the scheduled run.
  const runKey = opts.force ? `${baseKey}#${trigger}-${now.toISOString()}` : baseKey;
  const lines: string[] = [];
  const log = (msg: string) => {
    const line = `${new Date().toISOString()} [${def.name}] ${redactSecrets(msg)}`;
    lines.push(line);
    if (opts.echo) console.log(line);
  };
  const result = (r: Omit<JobResult, "job" | "runKey" | "log">): JobResult => ({ job: def.name, runKey, log: lines, ...r });

  if (!opts.force) {
    const gate = def.shouldRun(now);
    if (!gate.run) {
      log(`Skipped: ${gate.reason}`);
      return result({ status: "skipped", reason: gate.reason, itemsOk: 0, itemsFailed: 0, itemsSkipped: 0 });
    }
    const [done] = await opts.db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(and(eq(jobRuns.runKey, runKey), eq(jobRuns.status, "succeeded")));
    if (done) {
      log(`Skipped: run key ${runKey} already succeeded (run #${done.id}).`);
      return result({ status: "skipped", reason: "already succeeded", runId: done.id, itemsOk: 0, itemsFailed: 0, itemsSkipped: 0 });
    }
  }

  if (!(await acquireLock(opts.db, def.lockKey ?? def.name, holder, def.lockTtlMs, now))) {
    log("Skipped: another instance of this job holds the lock.");
    return result({ status: "skipped", reason: "locked", itemsOk: 0, itemsFailed: 0, itemsSkipped: 0 });
  }

  const health = opts.health ?? new HealthTracker();
  const [run] = await opts.db
    .insert(jobRuns)
    .values({ jobName: def.name, runKey, trigger, status: "running", startedAt: now })
    .returning({ id: jobRuns.id });
  const runId = run!.id;
  let itemsOk = 0;
  let itemsFailed = 0;
  let itemsSkipped = 0;

  const fail = async (itemKey: string, error: unknown) => {
    itemsFailed++;
    const pe = error instanceof ProviderError ? error : toProviderError("internal", error);
    log(`FAILED ${itemKey}: ${pe.errorClass}: ${pe.message}`);
    await opts.db.insert(jobFailures).values({
      jobRunId: runId,
      itemKey,
      provider: pe.provider,
      errorClass: pe.errorClass,
      message: redactSecrets(pe.message).slice(0, 1000),
      attempts: pe.attempts,
    });
  };

  const ctx: JobContext = {
    db: opts.db,
    providers: opts.providers,
    health,
    now,
    runKey,
    trigger,
    log,
    ok: (n = 1) => void (itemsOk += n),
    skip: (n = 1) => void (itemsSkipped += n),
    fail,
    item: async (itemKey, fn) => {
      try {
        return await fn();
      } catch (err) {
        await fail(itemKey, err);
        return undefined;
      }
    },
  };

  log(`Started run #${runId} (key ${runKey}, trigger ${trigger}).`);
  let summary: Record<string, unknown> | undefined;
  let status: JobResult["status"];
  let error: string | null = null;
  try {
    summary = await def.execute(ctx);
    status = itemsFailed === 0 ? "succeeded" : itemsOk > 0 ? "partial" : "failed";
  } catch (err) {
    status = "failed";
    error = redactSecrets(err instanceof Error ? `${err.name}: ${describeError(err)}` : String(err));
    log(`Job aborted: ${error}`);
  }
  log(`Finished with status ${status}: ${itemsOk} ok, ${itemsFailed} failed, ${itemsSkipped} unchanged/skipped.`);

  try {
    await health.flush(opts.db);
  } catch (err) {
    log(`Could not record provider health: ${(err as Error).message}`);
  }
  let logText = lines.join("\n");
  if (logText.length > MAX_LOG_CHARS) logText = `${logText.slice(0, MAX_LOG_CHARS)}\n…(truncated)`;
  await opts.db
    .update(jobRuns)
    .set({ status, finishedAt: new Date(), itemsOk, itemsFailed, itemsSkipped, summary: summary ?? null, log: logText, error })
    .where(eq(jobRuns.id, runId));
  await releaseLock(opts.db, def.lockKey ?? def.name, holder);

  return result({ status, runId, itemsOk, itemsFailed, itemsSkipped, summary });
}

/** Mark runs left in "running" by a crashed process (older than their lock TTL) as failed. */
export async function reapAbandonedRuns(db: Db, olderThan: Date): Promise<number> {
  const rows = await db
    .update(jobRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Abandoned: process exited before completion." })
    .where(and(eq(jobRuns.status, "running"), lt(jobRuns.startedAt, olderThan)))
    .returning({ id: jobRuns.id });
  return rows.length;
}

