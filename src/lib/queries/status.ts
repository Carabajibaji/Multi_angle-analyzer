import { desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { datasets, jobFailures, jobRuns, providerHealth, analysisReports } from "../db/schema";
import { JOBS, JOB_SCHEDULE_DESCRIPTION, nextCronFire, type ScheduledJobName } from "../jobs/definitions";
import { evaluateFreshness } from "../pipeline/freshness";
import { DEFAULT_AI_MODEL } from "../ai/explainer";
import { dailyTokenBudget, tokensUsedToday } from "../ai/service";

export async function getStatus(db: Db, now: Date) {
  const jobNames = Object.keys(JOBS) as ScheduledJobName[];
  const jobs = await Promise.all(
    jobNames.map(async (name) => {
      const [lastAttempt] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, name)).orderBy(desc(jobRuns.startedAt)).limit(1);
      const [lastSuccess] = await db
        .select()
        .from(jobRuns)
        .where(sql`${jobRuns.jobName} = ${name} AND ${jobRuns.status} = 'succeeded'`)
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      return {
        name,
        description: JOBS[name].description,
        schedule: JOB_SCHEDULE_DESCRIPTION[name],
        nextScheduled: nextCronFire(name, now).toISOString(),
        running: lastAttempt?.status === "running",
        lastAttempt: lastAttempt ? { id: lastAttempt.id, status: lastAttempt.status, startedAt: lastAttempt.startedAt.toISOString(), finishedAt: lastAttempt.finishedAt?.toISOString() ?? null, itemsOk: lastAttempt.itemsOk, itemsFailed: lastAttempt.itemsFailed, trigger: lastAttempt.trigger } : null,
        lastSuccess: lastSuccess ? { id: lastSuccess.id, startedAt: lastSuccess.startedAt.toISOString(), itemsOk: lastSuccess.itemsOk } : null,
      };
    }),
  );
  const providers = await db.select().from(providerHealth).orderBy(providerHealth.provider);
  const ds = await db.select().from(datasets).orderBy(datasets.key);
  const evaluated = ds.map((d) => ({ key: d.key, kind: d.kind, provider: d.provider, dataAsOf: d.dataAsOf, lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null, lastError: d.lastError, ...evaluateFreshness(d, now) }));
  const dayAgo = new Date(now.getTime() - 86_400_000 * 7);
  const recentErrors = await db
    .select({ id: jobFailures.id, runId: jobFailures.jobRunId, itemKey: jobFailures.itemKey, provider: jobFailures.provider, errorClass: jobFailures.errorClass, message: jobFailures.message, at: jobFailures.createdAt })
    .from(jobFailures)
    .where(gte(jobFailures.createdAt, dayAgo))
    .orderBy(desc(jobFailures.createdAt))
    .limit(50);
  const recentRuns = await db
    .select({ id: jobRuns.id, job: jobRuns.jobName, status: jobRuns.status, trigger: jobRuns.trigger, runKey: jobRuns.runKey, startedAt: jobRuns.startedAt, finishedAt: jobRuns.finishedAt, itemsOk: jobRuns.itemsOk, itemsFailed: jobRuns.itemsFailed, itemsSkipped: jobRuns.itemsSkipped })
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(25);
  const [reconciliation] = await db.select().from(analysisReports).where(eq(analysisReports.reportType, "reconciliation")).orderBy(desc(analysisReports.createdAt)).limit(1);
  const ai = {
    enabled: !!process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    tokensToday: await tokensUsedToday(db, now),
    dailyBudget: dailyTokenBudget(),
  };
  return {
    ai,
    generatedAt: now.toISOString(),
    jobs,
    providers,
    datasets: evaluated,
    counts: {
      datasets: evaluated.length,
      fresh: evaluated.filter((d) => d.status === "fresh").length,
      stale: evaluated.filter((d) => d.status === "stale").length,
      failed: evaluated.filter((d) => d.status === "failed" || d.status === "never").length,
      failedRecords7d: recentErrors.length,
    },
    recentErrors,
    recentRuns,
    reconciliation: reconciliation ? { asOf: reconciliation.asOf, content: reconciliation.content } : null,
  };
}

export async function getRunLog(db: Db, id: number) {
  const [run] = await db.select().from(jobRuns).where(eq(jobRuns.id, id));
  return run ?? null;
}
