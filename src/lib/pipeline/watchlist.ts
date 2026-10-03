/**
 * "Stocks to Watch": a transparent, rules-based list. Every inclusion stores the exact rule hits and the
 * measured values. Labels are neutral research prompts, never buy/sell calls.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { filings, marketEvents, patternDetections, securities, technicalIndicators, watchlistItems, watchlists } from "../db/schema";
import type { JobContext } from "../jobs/runner";
import { addDays } from "../time/marketCalendar";
import { loadCandles } from "./market";

export type WatchLabel = "worth_researching" | "elevated_volatility" | "positive_unconfirmed" | "mixed_evidence" | "risk_flag" | "upcoming_catalyst";

export const WATCH_LABEL_TEXT: Record<WatchLabel, string> = {
  worth_researching: "Worth researching",
  elevated_volatility: "Elevated volatility",
  positive_unconfirmed: "Positive signal, unconfirmed",
  mixed_evidence: "Mixed evidence",
  risk_flag: "Risk flag",
  upcoming_catalyst: "Upcoming catalyst",
};

export interface RuleHit {
  rule: string;
  detail: string;
  value?: number;
  threshold?: number;
}

export const RULES = {
  largeMovePct: 5,
  unusualVolumeRatio: 2,
  rsiOverbought: 70,
  rsiOversold: 30,
  earningsWithinDays: 5,
  filingWithinDays: 2,
};

export interface WatchInputs {
  change1dPct: number | null;
  volumeRatio: number | null;
  rsi: number | null;
  close: number | null;
  sma50: number | null;
  sma200: number | null;
  upcomingEarnings: string | null;
  recentFilings: string[];
  /** Possible W/M patterns completed in the latest session: "double_bottom" | "double_top" with detail. */
  completedPatterns?: Array<{ pattern: string; detail: string }>;
}

export function evaluateWatchRules(i: WatchInputs): { hits: RuleHit[]; label: WatchLabel | null } {
  const hits: RuleHit[] = [];
  if (i.change1dPct != null && Math.abs(i.change1dPct) >= RULES.largeMovePct)
    hits.push({ rule: "large_price_move", detail: `Moved ${i.change1dPct.toFixed(1)}% in one session`, value: i.change1dPct, threshold: RULES.largeMovePct });
  if (i.volumeRatio != null && i.volumeRatio >= RULES.unusualVolumeRatio)
    hits.push({ rule: "unusual_volume", detail: `Volume ${i.volumeRatio.toFixed(1)}× its 20-day average`, value: i.volumeRatio, threshold: RULES.unusualVolumeRatio });
  if (i.rsi != null && i.rsi >= RULES.rsiOverbought) hits.push({ rule: "rsi_high", detail: `RSI(14) at ${i.rsi.toFixed(0)} (≥ ${RULES.rsiOverbought})`, value: i.rsi, threshold: RULES.rsiOverbought });
  if (i.rsi != null && i.rsi <= RULES.rsiOversold) hits.push({ rule: "rsi_low", detail: `RSI(14) at ${i.rsi.toFixed(0)} (≤ ${RULES.rsiOversold})`, value: i.rsi, threshold: RULES.rsiOversold });
  if (i.close != null && i.sma200 != null && i.sma50 != null) {
    if (i.close > i.sma200 && i.sma50 > i.sma200 && i.change1dPct != null && i.change1dPct > 0 && i.volumeRatio != null && i.volumeRatio >= 1.5)
      hits.push({ rule: "trend_strength", detail: "Closed above its 50- and 200-day averages on above-average volume" });
    if (i.close < i.sma200 && i.change1dPct != null && i.change1dPct < 0 && i.volumeRatio != null && i.volumeRatio >= 1.5)
      hits.push({ rule: "trend_weakness", detail: "Closed below its 200-day average on above-average volume" });
  }
  if (i.upcomingEarnings) hits.push({ rule: "upcoming_earnings", detail: `Earnings expected ${i.upcomingEarnings}` });
  for (const f of i.recentFilings) hits.push({ rule: "new_filing", detail: `New SEC filing: ${f}` });
  for (const p of i.completedPatterns ?? []) hits.push({ rule: p.pattern === "double_bottom" ? "w_breakout" : "m_breakdown", detail: p.detail });

  if (hits.length === 0) return { hits, label: null };
  const has = (r: string) => hits.some((h) => h.rule === r);
  let label: WatchLabel = "worth_researching";
  if (has("trend_weakness") || has("rsi_low") || has("m_breakdown")) label = "risk_flag";
  else if (has("w_breakout") && !has("rsi_high")) label = "positive_unconfirmed";
  else if (has("trend_strength") && !has("rsi_high")) label = "positive_unconfirmed";
  else if (has("trend_strength") && has("rsi_high")) label = "mixed_evidence";
  else if (has("large_price_move") || has("unusual_volume")) label = "elevated_volatility";
  else if (has("upcoming_earnings")) label = "upcoming_catalyst";
  return { hits, label };
}

export async function buildStocksToWatch(ctx: JobContext, sessionDate: string): Promise<number> {
  const stocks = await ctx.db.select().from(securities).where(and(eq(securities.tracked, true), eq(securities.assetType, "stock")));
  const [wl] = await ctx.db
    .insert(watchlists)
    .values({ ownerKey: "system:stocks-to-watch", name: "Stocks to Watch", asOfDate: sessionDate })
    .onConflictDoUpdate({ target: [watchlists.ownerKey, watchlists.name, watchlists.asOfDate], set: { createdAt: new Date() } })
    .returning({ id: watchlists.id });
  await ctx.db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, wl!.id));

  let count = 0;
  for (const s of stocks) {
    const candles = await loadCandles(ctx, s.id, 2);
    const last = candles.at(-1);
    if (!last || last.date !== sessionDate) continue;
    const prev = candles.length > 1 ? candles[0]! : null;
    const ind = await ctx.db
      .select()
      .from(technicalIndicators)
      .where(and(eq(technicalIndicators.securityId, s.id), eq(technicalIndicators.asOfDate, sessionDate)));
    const get = (k: string, f = "value") => ((ind.find((r) => r.indicatorKey === k)?.values as Record<string, number | null> | undefined)?.[f] ?? null);
    const [earn] = await ctx.db
      .select()
      .from(marketEvents)
      .where(and(eq(marketEvents.securityId, s.id), eq(marketEvents.eventType, "earnings"), gte(marketEvents.eventDate, sessionDate), lte(marketEvents.eventDate, addDays(sessionDate, RULES.earningsWithinDays))));
    const recent = s.companyId
      ? await ctx.db
          .select({ form: filings.form, filedAt: filings.filedAt })
          .from(filings)
          .where(and(eq(filings.companyId, s.companyId), gte(filings.filedAt, addDays(sessionDate, -RULES.filingWithinDays)), inArray(filings.form, ["10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A"])))
      : [];
    const pats = await ctx.db
      .select()
      .from(patternDetections)
      .where(and(eq(patternDetections.securityId, s.id), eq(patternDetections.status, "completed"), eq(patternDetections.detectedOn, sessionDate)));
    const completedPatterns = pats
      .filter((p) => (p.points as { resolvedAt?: { date: string } }).resolvedAt?.date === sessionDate)
      .map((p) => ({ pattern: p.pattern, detail: `Possible ${p.pattern === "double_bottom" ? "W (double bottom)" : "M (double top)"} completed this session${p.volumeConfirmed ? " on above-average volume" : ""}; confidence ${Math.round((p.confidence ?? 0) * 100)}%` }));
    const { hits, label } = evaluateWatchRules({
      completedPatterns,
      change1dPct: prev ? (last.close / prev.close - 1) * 100 : null,
      volumeRatio: get("volume_avg_20", "ratio"),
      rsi: get("rsi_14"),
      close: last.close,
      sma50: get("sma_50"),
      sma200: get("sma_200"),
      upcomingEarnings: earn ? `${earn.eventDate} (${earn.dateStatus})` : null,
      recentFilings: recent.map((f) => `${f.form} filed ${f.filedAt}`),
    });
    if (!label) continue;
    await ctx.db.insert(watchlistItems).values({ watchlistId: wl!.id, securityId: s.id, label, reasons: { hits, rulesVersion: 1, thresholds: RULES } });
    count++;
  }
  ctx.log(`Stocks to Watch for ${sessionDate}: ${count} companies matched at least one rule.`);
  return count;
}
