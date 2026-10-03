/**
 * Request on-demand analysis of a company (public, rate-limited, capped).
 * Marks the company as tracked and loads its filings, fundamentals, prices and indicators now.
 */
import { and, count, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { securities } from "@/lib/db/schema";
import { clientKey, rateLimit, sameOrigin } from "@/lib/http/rateLimit";
import { runOnDemand } from "@/lib/jobs/service";
import { redactSecrets } from "@/lib/providers/errors";
import { normalizeTicker } from "@/lib/queries/company";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ticker = normalizeTicker((await params).ticker);
  if (!ticker) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  if (!rateLimit(`analyze:${clientKey(req.headers)}`, Number(process.env.ANALYZE_PER_HOUR ?? 5), 3_600_000)) {
    return NextResponse.json({ error: "Too many analysis requests from this address. Try again later." }, { status: 429 });
  }
  const { db } = await getDb();
  const [sec] = await db.select().from(securities).where(eq(securities.ticker, ticker));
  if (!sec) return NextResponse.json({ error: "Unknown ticker. Only SEC-registered companies in the directory can be analyzed." }, { status: 404 });
  if (!sec.tracked) {
    const [{ n }] = (await db.select({ n: count() }).from(securities).where(and(eq(securities.tracked, true), eq(securities.assetType, "stock")))) as [{ n: number }];
    const cap = Number(process.env.MAX_TRACKED_COMPANIES ?? 150);
    if (n >= cap) return NextResponse.json({ error: `The tracked-company limit (${cap}) has been reached. An administrator can raise MAX_TRACKED_COMPANIES.` }, { status: 409 });
  }
  try {
    const r = await runOnDemand(ticker, { db, trigger: "manual" });
    return NextResponse.json({ status: r.status, reason: r.reason, itemsOk: r.itemsOk, itemsFailed: r.itemsFailed });
  } catch (err) {
    console.error("on-demand analysis failed", redactSecrets(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ error: "Analysis failed. Check Data Status for provider errors." }, { status: 500 });
  }
}
