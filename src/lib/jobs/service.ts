/**
 * Entry points used by the CLI, the scheduled workflow and the admin API.
 */
import type { Db } from "../db/client";
import { HealthTracker } from "../pipeline/store";
import { createProviders, type DataMode } from "../providers/registry";
import { JOBS } from "./definitions";
import { reapAbandonedRuns, runJob, type JobName, type JobResult, type Trigger } from "./runner";

export const JOB_ORDER: JobName[] = ["nightly-company", "weekly-reconcile", "pre-market", "post-market"];

export function isJobName(x: string): x is JobName {
  return x in JOBS;
}

export interface ServiceOptions {
  db: Db;
  trigger: Trigger;
  force?: boolean;
  mode?: DataMode;
  now?: Date;
  echo?: boolean;
}

function providersFor(opts: ServiceOptions, health: HealthTracker) {
  const providers = createProviders({ mode: opts.mode, observer: health });
  for (const p of [providers.market, providers.macro, providers.sec, providers.news]) {
    if (!p.configured) health.notConfigured(p.id, `${p.displayName} is not configured (missing environment variable).`);
  }
  return providers;
}

export async function runOne(name: JobName, opts: ServiceOptions): Promise<JobResult> {
  const health = new HealthTracker();
  return runJob(JOBS[name], { db: opts.db, providers: providersFor(opts, health), health, trigger: opts.trigger, force: opts.force, now: opts.now, echo: opts.echo });
}

/** Evaluate every job against the clock; each runs only inside its window and only once per run key. */
export async function runScheduled(opts: ServiceOptions): Promise<JobResult[]> {
  const now = opts.now ?? new Date();
  const reaped = await reapAbandonedRuns(opts.db, new Date(now.getTime() - 6 * 3_600_000));
  if (reaped && opts.echo) console.log(`Marked ${reaped} abandoned run(s) as failed.`);
  const results: JobResult[] = [];
  for (const name of JOB_ORDER) results.push(await runOne(name, { ...opts, now, force: false }));
  return results;
}
