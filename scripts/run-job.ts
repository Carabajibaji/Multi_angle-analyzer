/**
 * CLI for the data pipeline.
 *
 *   npm run job -- scheduled            # what the scheduler runs: every job checks its own ET window
 *   npm run job -- post-market --force  # run one job now regardless of window (manual refresh)
 *   npm run job -- all --force --demo   # seed every dataset with clearly labelled DEMO data
 *
 * Exit code is 1 when any job FAILED (so the scheduler shows a red run and notifies), 0 otherwise.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../src/lib/db/client";
import { isJobName, JOB_ORDER, runOne, runScheduled } from "../src/lib/jobs/service";
import type { JobResult, Trigger } from "../src/lib/jobs/runner";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? "scheduled";
const force = args.includes("--force");
const demo = args.includes("--demo");
const trigger = (args.find((a) => a.startsWith("--trigger="))?.split("=")[1] ?? (process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "cli")) as Trigger;
if (demo) process.env.DATA_MODE = "demo";

const handle = await createDb();
await handle.migrate();
let results: JobResult[] = [];
try {
  if (target === "scheduled") {
    results = await runScheduled({ db: handle.db, trigger, echo: true });
  } else if (target === "all") {
    for (const name of JOB_ORDER) results.push(await runOne(name, { db: handle.db, trigger, force, echo: true }));
  } else if (isJobName(target)) {
    results.push(await runOne(target, { db: handle.db, trigger, force, echo: true }));
  } else {
    console.error(`Unknown job "${target}". Use: scheduled | all | ${JOB_ORDER.join(" | ")}`);
    process.exitCode = 2;
  }
} finally {
  await handle.close();
}

const summary = results.map(({ log: _log, ...r }) => r);
console.log("\n=== Summary ===");
console.log(JSON.stringify(summary, null, 2));

const dir = process.env.JOB_LOG_DIR ?? "job-logs";
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(path.join(dir, `run-${stamp}.log`), results.flatMap((r) => r.log).join("\n") + "\n");
writeFileSync(path.join(dir, `run-${stamp}.json`), JSON.stringify(summary, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = summary.map((r) => `| ${r.job} | ${r.status} | ${r.reason ?? ""} | ${r.itemsOk} | ${r.itemsFailed} | ${r.itemsSkipped} |`);
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, ["| Job | Status | Reason | OK | Failed | Unchanged |", "|---|---|---|---|---|---|", ...rows].join("\n") + "\n", { flag: "a" });
}
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
