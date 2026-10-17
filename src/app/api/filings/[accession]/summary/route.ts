/** Generate (or return the cached) plain-English AI summary of a stored SEC filing. Rate-limited. */
import { NextResponse, type NextRequest } from "next/server";
import { generateFilingSummary } from "@/lib/ai/filingSummary";
import { getDb } from "@/lib/db/client";
import { analyzeStoredFiling } from "@/lib/filings/service";
import { clientKey, rateLimit, sameOrigin } from "@/lib/http/rateLimit";
import { ProviderError, redactSecrets } from "@/lib/providers/errors";
import { createProviders } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ accession: string }> }) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const accession = (await params).accession;
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) return NextResponse.json({ error: "Invalid accession number" }, { status: 400 });
  if (!rateLimit(`ai-filing:${clientKey(req.headers)}`, Number(process.env.AI_SUMMARIES_PER_HOUR ?? 10), 3_600_000)) {
    return NextResponse.json({ error: "Too many summary requests from this address; try again later." }, { status: 429 });
  }
  const providers = createProviders();
  if (!providers.ai.configured) return NextResponse.json({ error: "AI explanations are not enabled on this site." }, { status: 503 });
  const { db } = await getDb();
  try {
    const analysis = await analyzeStoredFiling(db, providers.sec, accession);
    if (!analysis) return NextResponse.json({ error: "That filing is not stored." }, { status: 404 });
    const s = await generateFilingSummary(db, providers.ai, analysis);
    return NextResponse.json({ ok: true, cached: s.cached });
  } catch (err) {
    const msg = redactSecrets(err instanceof Error ? err.message : String(err));
    const status = err instanceof ProviderError && err.errorClass === "rate_limited" ? 429 : 502;
    return NextResponse.json({ error: status === 429 ? msg : "The AI summary could not be generated right now." }, { status });
  }
}
