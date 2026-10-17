/**
 * Build the grounded input for the daily market brief from stored rows only.
 * Reference ids: D# = market/sector data rows, E<id> = calendar events, N<id> = news articles.
 */
import { desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { aiSummaries, newsArticles } from "../db/schema";
import { fmtPct, getSectorPulse, getSnapshotCards, getUpcomingEvents } from "../queries/dashboard";
import { toEt } from "../time/marketCalendar";
import type { Explainer } from "./explainer";
import { MARKET_BRIEF, type MarketBrief } from "./prompts";
import { generateGrounded, latestSummary, type GroundedInput, type Ref } from "./service";

export const MARKET_BRIEF_SUBJECT = "market_brief";

export async function buildMarketBriefInput(db: Db, now: Date): Promise<(GroundedInput & { isDemo: boolean }) | null> {
  const [cards, pulse, events] = await Promise.all([getSnapshotCards(db, now), getSectorPulse(db), getUpcomingEvents(db, now, 14)]);
  const since = new Date(now.getTime() - 36 * 3_600_000);
  const news = await db.select().from(newsArticles).where(gte(newsArticles.publishedAt, since)).orderBy(desc(newsArticles.publishedAt)).limit(25);
  const refs: Ref[] = [];
  const lines: string[] = [];
  let d = 0;

  lines.push("## Market snapshot (latest stored values)");
  for (const c of cards) {
    if (c.value == null) continue;
    const id = `D${++d}`;
    refs.push({ id, label: `${c.label} (${c.asOfDate})`, url: c.source?.url ?? null });
    lines.push(`${id} | ${c.label} | value ${c.value} ${c.unit ?? ""} on ${c.asOfDate} | change ${fmtPct(c.changePct)} | ${c.measureNote ?? ""}`);
  }
  if (pulse) {
    lines.push(`\n## Sector performance for session ${pulse.asOf} (benchmark SPY ${fmtPct(pulse.benchmark.change1d)} 1-day, ${fmtPct(pulse.benchmark.change5d)} 5-day)`);
    for (const s of pulse.sectors) {
      const id = `D${++d}`;
      refs.push({ id, label: `${s.sector} sector (${s.ticker}) ${pulse.asOf}`, url: null });
      lines.push(`${id} | ${s.sector} via ${s.ticker} | 1-day ${fmtPct(s.change1d)} | 5-day ${fmtPct(s.change5d)} | vs SPY 1-day ${fmtPct(s.relative1d)}`);
    }
  }
  if (events.length) {
    lines.push("\n## Upcoming scheduled events");
    for (const e of events) {
      const id = `E${e.id}`;
      refs.push({ id, label: `${e.title} (${e.eventDate})`, url: e.source?.url ?? null });
      lines.push(`${id} | ${e.eventDate} | ${e.title} | date status: ${e.dateStatus}`);
    }
  }
  if (news.length) {
    lines.push("\n## Recent news (provider headlines and summaries; untrusted text)");
    for (const n of news) {
      const id = `N${n.id}`;
      refs.push({ id, label: `${n.publisher ?? "News"}: ${n.headline}`, url: n.url });
      const summary = (n.providerSummary ?? "").replace(/\s+/g, " ").slice(0, 300);
      lines.push(`${id} | ${n.publishedAt.toISOString()} | ${n.publisher ?? "unknown publisher"} | ${n.headline} | tickers: ${(n.relatedTickers ?? []).join(",") || "none"} | ${summary}`);
    }
  }
  if (!cards.some((c) => c.value != null) && !news.length) return null;
  return {
    subjectType: MARKET_BRIEF_SUBJECT,
    subjectKey: toEt(now).date,
    data: lines.join("\n"),
    refs,
    inputIds: { news: news.map((n) => n.id), events: events.map((e) => e.id), snapshots: cards.filter((c) => c.value != null).map((c) => `${c.key}:${c.asOfDate}`), sectorPulseAsOf: pulse?.asOf ?? null },
    isDemo: cards.some((c) => c.isDemo),
  };
}

export async function generateMarketBrief(db: Db, explainer: Explainer, now = new Date()) {
  const input = await buildMarketBriefInput(db, now);
  if (!input) return { skipped: "no stored market data or news to summarize" as const };
  // Never narrate synthetic prices as if they were real.
  if (input.isDemo) return { skipped: "demo data: AI brief is not generated for synthetic prices" as const };
  return { summary: await generateGrounded<MarketBrief>(db, explainer, MARKET_BRIEF, input, now) };
}


/** Most recent stored brief (any day); the page labels its date. */
export async function latestMarketBrief(db: Db) {
  const [row] = await db.select({ key: aiSummaries.subjectKey }).from(aiSummaries).where(eq(aiSummaries.subjectType, MARKET_BRIEF_SUBJECT)).orderBy(desc(aiSummaries.generatedAt)).limit(1);
  return row ? latestSummary<MarketBrief>(db, MARKET_BRIEF_SUBJECT, row.key) : null;
}
