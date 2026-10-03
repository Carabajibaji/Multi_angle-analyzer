import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Public liveness probe: no secrets, no error details. */
export async function GET() {
  try {
    const { db } = await getDb();
    await db.execute(sql`select 1`);
    const [last] = await db.select({ at: jobRuns.finishedAt }).from(jobRuns).where(eq(jobRuns.status, "succeeded")).orderBy(desc(jobRuns.finishedAt)).limit(1);
    return NextResponse.json({ ok: true, database: "ok", lastSuccessfulJobAt: last?.at?.toISOString() ?? null });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503 });
  }
}
