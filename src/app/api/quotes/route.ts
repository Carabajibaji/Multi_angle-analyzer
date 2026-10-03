/** Latest stored close for up to 25 tickers (read-only, from the database; never a live quote). */
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { clientKey, rateLimit } from "@/lib/http/rateLimit";
import { getSecurity, normalizeTicker, priceSummary } from "@/lib/queries/company";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!rateLimit(`quotes:${clientKey(req.headers)}`, 120, 60_000)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const tickers = [...new Set((req.nextUrl.searchParams.get("tickers") ?? "").split(",").map((t) => normalizeTicker(t)).filter((t): t is string => !!t))].slice(0, 25);
  const { db } = await getDb();
  const out = await Promise.all(
    tickers.map(async (t) => {
      const s = await getSecurity(db, t);
      if (!s) return { ticker: t, found: false };
      const p = await priceSummary(db, s.security.id);
      return { ticker: t, found: true, name: s.company?.name ?? s.security.name, tracked: s.security.tracked, price: p ? { date: p.date, close: p.close, changePct: p.changePct, dataNature: p.dataNature, isDemo: p.isDemo } : null };
    }),
  );
  return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=60" } });
}
