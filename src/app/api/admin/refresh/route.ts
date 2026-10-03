/**
 * Manual refresh (admin only).
 * - If GITHUB_DISPATCH_TOKEN + GITHUB_REPOSITORY are set, triggers the scheduled-refresh workflow
 *   (recommended on serverless hosts with short request time limits).
 * - Otherwise runs the job inline in this request.
 */
import { and, eq, gte } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, isAdminRequest } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { rateLimit, sameOrigin } from "@/lib/http/rateLimit";
import { isJobName, runOne } from "@/lib/jobs/service";
import { redactSecrets } from "@/lib/providers/errors";

export const maxDuration = 300;
export const runtime = "nodejs";

const body = z.object({ job: z.string().refine(isJobName, "unknown job") });

export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.toLowerCase().startsWith("bearer ");
  if (!isAdminRequest(req.headers, req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!bearer && !sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be {\"job\": <job name>}" }, { status: 400 });
  const job = parsed.data.job as Parameters<typeof runOne>[0];
  if (!rateLimit(`refresh:${job}`, 1, 60_000)) return NextResponse.json({ error: "This job was refreshed less than a minute ago." }, { status: 429 });

  const { db } = await getDb();
  const [recent] = await db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, job), eq(jobRuns.status, "running"), gte(jobRuns.startedAt, new Date(Date.now() - 3 * 3_600_000))));
  if (recent) return NextResponse.json({ error: `Job already running (run #${recent.id}).` }, { status: 409 });

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (repo && token && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scheduled-refresh.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: process.env.GITHUB_DISPATCH_REF ?? "main", inputs: { job, force: "true" } }),
    });
    if (!res.ok) return NextResponse.json({ error: `Workflow dispatch failed (HTTP ${res.status}).` }, { status: 502 });
    return NextResponse.json({ status: "dispatched", message: "GitHub Actions run requested; results appear here when it finishes." });
  }

  try {
    const r = await runOne(job, { db, trigger: "manual", force: true });
    return NextResponse.json({ status: r.status, runId: r.runId, itemsOk: r.itemsOk, itemsFailed: r.itemsFailed });
  } catch (err) {
    console.error("manual refresh failed", redactSecrets(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ error: "Refresh failed; see Data Status for details." }, { status: 500 });
  }
}
