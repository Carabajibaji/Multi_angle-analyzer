/**
 * Alternative trigger for hosts with built-in cron (e.g. Vercel Cron) or an external scheduler.
 * Authorization: Bearer CRON_SECRET. Jobs still gate themselves on the ET calendar and run keys,
 * so calling this more often than needed is harmless.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { checkAdminToken } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/client";
import { runScheduled } from "@/lib/jobs/service";

export const maxDuration = 300;
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  const cron = process.env.CRON_SECRET;
  if (cron && cron.length >= 16 && token.length === cron.length) {
    if (timingSafeEqual(Buffer.from(token), Buffer.from(cron))) return true;
  }
  return checkAdminToken(token);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = await getDb();
  const results = await runScheduled({ db, trigger: "schedule" });
  return NextResponse.json(results.map(({ log: _log, summary: _s, ...r }) => r));
}

export const GET = handle;
export const POST = handle;
