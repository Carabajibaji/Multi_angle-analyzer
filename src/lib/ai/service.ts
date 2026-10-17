/**
 * Grounded generation: cache by input fingerprint, enforce a daily token budget, check every citation
 * against the reference ids that were actually provided, and store the result with full provenance.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { aiSummaries, promptVersions } from "../db/schema";
import { fingerprint, sha256 } from "../hash";
import { ProviderError } from "../providers/errors";
import { etWallTimeToUtc, toEt } from "../time/marketCalendar";
import type { Explainer } from "./explainer";
import type { Claim, PromptDef } from "./prompts";

export interface Ref {
  id: string;
  label: string;
  url: string | null;
  sourceId?: number | null;
}

export interface GroundedInput {
  subjectType: string;
  subjectKey: string;
  /** Rendered data block shown to the model (built only from stored rows). */
  data: string;
  refs: Ref[];
  /** Identifiers of the stored rows used (for provenance). */
  inputIds: Record<string, unknown>;
}

export interface StoredSummary<T> {
  id: number;
  output: T;
  model: string;
  promptName: string;
  promptVersion: number;
  generatedAt: Date;
  evidenceStatus: string | null;
  refs: Ref[];
  cached: boolean;
}

export function dailyTokenBudget(): number {
  return Math.max(0, Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 400_000));
}

export async function ensurePromptVersion<T>(db: Db, p: PromptDef<T>): Promise<number> {
  const template = p.system;
  const [row] = await db
    .insert(promptVersions)
    .values({ name: p.name, version: p.version, template, templateHash: sha256(template), outputSchemaVersion: p.version })
    .onConflictDoUpdate({ target: [promptVersions.name, promptVersions.version], set: { template, templateHash: sha256(template) } })
    .returning({ id: promptVersions.id });
  return row!.id;
}

export async function tokensUsedToday(db: Db, now: Date): Promise<number> {
  const start = etWallTimeToUtc(toEt(now).date, 0, 0);
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(coalesce(${aiSummaries.inputTokens},0) + coalesce(${aiSummaries.outputTokens},0)),0)::int` })
    .from(aiSummaries)
    .where(gte(aiSummaries.generatedAt, start));
  return r?.n ?? 0;
}

/** Drop citations to ids that were not provided; drop "fact" claims left without any valid citation. */
export function enforceCitations<T>(output: T, allowed: Set<string>): { output: T; removed: number } {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) {
        const w = walk(item);
        if (w !== DROP) out.push(w);
      }
      return out;
    }
    if (v && typeof v === "object") {
      const o = { ...(v as Record<string, unknown>) };
      if (Array.isArray(o.refs)) {
        const before = (o.refs as unknown[]).length;
        o.refs = (o.refs as string[]).filter((r) => allowed.has(r));
        removed += before - (o.refs as string[]).length;
        if (o.kind === "fact" && (o.refs as string[]).length === 0) {
          removed++;
          return DROP;
        }
      }
      if (typeof o.ref === "string" && !allowed.has(o.ref)) {
        removed++;
        return DROP;
      }
      for (const k of Object.keys(o)) if (k !== "refs") o[k] = walk(o[k]);
      return o;
    }
    return v;
  };
  return { output: walk(output) as T, removed };
}
const DROP = Symbol("drop");

export async function latestSummary<T>(db: Db, subjectType: string, subjectKey: string): Promise<StoredSummary<T> | null> {
  const [row] = await db
    .select({ s: aiSummaries, p: promptVersions })
    .from(aiSummaries)
    .innerJoin(promptVersions, eq(promptVersions.id, aiSummaries.promptVersionId))
    .where(and(eq(aiSummaries.subjectType, subjectType), eq(aiSummaries.subjectKey, subjectKey)))
    .orderBy(desc(aiSummaries.generatedAt))
    .limit(1);
  if (!row) return null;
  return toStored<T>(row.s, row.p, true);
}

function toStored<T>(s: typeof aiSummaries.$inferSelect, p: typeof promptVersions.$inferSelect, cached: boolean): StoredSummary<T> {
  return {
    id: s.id,
    output: s.output as T,
    model: s.model,
    promptName: p.name,
    promptVersion: p.version,
    generatedAt: s.generatedAt,
    evidenceStatus: s.evidenceStatus,
    refs: s.sourceRefs as Ref[],
    cached,
  };
}

/**
 * Return the stored summary for identical inputs, or generate a new one.
 * Throws ProviderError("not_configured" | "rate_limited" | ...) when generation is not possible;
 * callers keep showing factual data and the last stored summary.
 */
export async function generateGrounded<T>(db: Db, explainer: Explainer, prompt: PromptDef<T>, input: GroundedInput, now = new Date()): Promise<StoredSummary<T>> {
  const promptVersionId = await ensurePromptVersion(db, prompt);
  const inputHash = fingerprint({ data: input.data, model: explainer.model, prompt: `${prompt.name}@${prompt.version}` });
  const [existing] = await db
    .select({ s: aiSummaries, p: promptVersions })
    .from(aiSummaries)
    .innerJoin(promptVersions, eq(promptVersions.id, aiSummaries.promptVersionId))
    .where(and(eq(aiSummaries.subjectType, input.subjectType), eq(aiSummaries.subjectKey, input.subjectKey), eq(aiSummaries.promptVersionId, promptVersionId), eq(aiSummaries.inputHash, inputHash)));
  if (existing) return toStored<T>(existing.s, existing.p, true);

  if (!explainer.configured) throw new ProviderError(explainer.id, "not_configured", "ANTHROPIC_API_KEY is not set; AI explanations are disabled.");
  const budget = dailyTokenBudget();
  const used = await tokensUsedToday(db, now);
  if (used >= budget) throw new ProviderError(explainer.id, "rate_limited", `Daily AI token budget reached (${used.toLocaleString("en-US")} of ${budget.toLocaleString("en-US")}).`);

  const user = `<data>\n${input.data}\n</data>\n\nReference ids you may cite: ${input.refs.map((r) => r.id).join(", ") || "(none)"}`;
  const res = await explainer.explain({ system: prompt.system, user, schema: prompt.schema, maxTokens: prompt.maxTokens });
  const { output, removed } = enforceCitations(res.output, new Set(input.refs.map((r) => r.id)));
  const usedIds = new Set<string>();
  JSON.stringify(output, (k, v) => {
    if (k === "refs" && Array.isArray(v)) v.forEach((x: string) => usedIds.add(x));
    if (k === "ref" && typeof v === "string") usedIds.add(v);
    return v;
  });
  const sourceRefs = input.refs.filter((r) => usedIds.has(r.id));
  const [row] = await db
    .insert(aiSummaries)
    .values({
      subjectType: input.subjectType,
      subjectKey: input.subjectKey,
      model: res.model,
      promptVersionId,
      inputHash,
      inputRefs: input.inputIds,
      sourceRefs,
      output: output as object,
      outputVersion: prompt.version,
      evidenceStatus: removed ? `grounded (${removed} unsupported item(s) removed)` : "grounded",
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      generatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return (await latestSummary<T>(db, input.subjectType, input.subjectKey))!;
  return { id: row.id, output, model: res.model, promptName: prompt.name, promptVersion: prompt.version, generatedAt: row.generatedAt, evidenceStatus: row.evidenceStatus, refs: sourceRefs, cached: false };
}

export type { Claim };
