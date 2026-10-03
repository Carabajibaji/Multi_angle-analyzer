/**
 * Read models for company search and the unified company page.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  companies,
  filings,
  financialFacts,
  financialStatements,
  governanceEvents,
  marketEvents,
  patternDetections,
  priceCandles,
  securities,
  sources,
  technicalIndicators,
} from "../db/schema";
import { computeHealthMetrics, type HealthMetrics } from "../fundamentals/metrics";
import type { LineItem, StatementPeriod } from "../fundamentals/statements";
import { bollinger, ema, macd, rsi, sma } from "../indicators";
import { datasetFreshness } from "./dashboard";
import { nearestLevels, supportResistance } from "../technical/levels";
import { detectDoublePatterns } from "../technical/patterns";
import { tripleVerification } from "../technical/verification";
import { toEt } from "../time/marketCalendar";

export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function normalizeTicker(raw: string): string | null {
  const t = decodeURIComponent(raw).trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export async function searchCompanies(db: Db, q: string, limit = 20) {
  const query = q.trim().slice(0, 60);
  if (!query) return [];
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const upper = query.toUpperCase();
  return db
    .select({ ticker: securities.ticker, name: securities.name, assetType: securities.assetType, tracked: securities.tracked, companyName: companies.name })
    .from(securities)
    .leftJoin(companies, eq(companies.id, securities.companyId))
    .where(or(eq(securities.ticker, upper), ilike(securities.ticker, `${escaped}%`), ilike(securities.name, `%${escaped}%`), ilike(companies.name, `%${escaped}%`)))
    .orderBy(sql`CASE WHEN ${securities.ticker} = ${upper} THEN 0 WHEN ${securities.ticker} ILIKE ${`${escaped}%`} THEN 1 ELSE 2 END`, desc(securities.tracked), asc(securities.ticker))
    .limit(Math.min(limit, 50));
}

export async function getSecurity(db: Db, ticker: string) {
  const [row] = await db
    .select({ security: securities, company: companies })
    .from(securities)
    .leftJoin(companies, eq(companies.id, securities.companyId))
    .where(eq(securities.ticker, ticker));
  return row ?? null;
}

export async function loadBars(db: Db, securityId: number, limit = 1300) {
  const rows = await db
    .select()
    .from(priceCandles)
    .where(and(eq(priceCandles.securityId, securityId), eq(priceCandles.interval, "1d")))
    .orderBy(desc(priceCandles.date))
    .limit(limit);
  return rows.reverse();
}

export async function priceSummary(db: Db, securityId: number) {
  const bars = await loadBars(db, securityId, 260);
  const last = bars.at(-1);
  if (!last) return null;
  const prev = bars.at(-2) ?? null;
  const yr = bars.slice(-252);
  const [src] = last.sourceId ? await db.select().from(sources).where(eq(sources.id, last.sourceId)) : [];
  return {
    date: last.date,
    close: last.close,
    change: prev ? last.close - prev.close : null,
    changePct: prev ? (last.close / prev.close - 1) * 100 : null,
    high52: Math.max(...yr.map((b) => b.high)),
    low52: Math.min(...yr.map((b) => b.low)),
    rangeSessions: yr.length,
    dataNature: last.dataNature,
    isDemo: last.isDemo,
    adjusted: last.adjusted,
    source: src ? { name: src.name, url: src.url, retrievedAt: src.lastRetrievedAt.toISOString() } : null,
  };
}

/** Merge the three stored statements per period back into StatementPeriods (newest first). */
export async function loadStatements(db: Db, companyId: number): Promise<StatementPeriod[]> {
  const rows = await db.select().from(financialStatements).where(eq(financialStatements.companyId, companyId)).orderBy(desc(financialStatements.periodEnd));
  const byKey = new Map<string, StatementPeriod>();
  for (const r of rows) {
    const key = `${r.periodType}:${r.periodEnd}`;
    const p = byKey.get(key) ?? { periodType: r.periodType as StatementPeriod["periodType"], periodStart: r.periodStart ?? "", periodEnd: r.periodEnd, currency: r.currency, items: {} };
    Object.assign(p.items, r.lineItems as Record<string, LineItem>);
    byKey.set(key, p);
  }
  return [...byKey.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export interface FinancialView {
  periods: StatementPeriod[];
  annual: StatementPeriod[];
  quarterly: StatementPeriod[];
  annualMetrics: HealthMetrics[];
  quarterlyMetrics: HealthMetrics[];
}

export async function financialView(db: Db, companyId: number): Promise<FinancialView> {
  const periods = await loadStatements(db, companyId);
  const annual = periods.filter((p) => p.periodType === "annual");
  const quarterly = periods.filter((p) => p.periodType === "quarterly");
  return {
    periods,
    annual,
    quarterly,
    annualMetrics: annual.map((p) => computeHealthMetrics(p, periods)),
    quarterlyMetrics: quarterly.map((p) => computeHealthMetrics(p, periods)),
  };
}

export async function latestSharesOutstanding(db: Db, companyId: number) {
  const [row] = await db
    .select()
    .from(financialFacts)
    .where(and(eq(financialFacts.companyId, companyId), eq(financialFacts.metric, "sharesOutstanding")))
    .orderBy(desc(financialFacts.periodEnd), desc(financialFacts.filedAt))
    .limit(1);
  return row ?? null;
}

export async function companyFilings(db: Db, companyId: number, opts: { forms?: string[]; limit?: number; offset?: number } = {}) {
  const where = opts.forms?.length ? and(eq(filings.companyId, companyId), inArray(filings.form, opts.forms)) : eq(filings.companyId, companyId);
  return db
    .select()
    .from(filings)
    .where(where)
    .orderBy(desc(filings.filedAt), desc(filings.accessionNo))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(opts.offset ?? 0);
}

export async function companyGovernanceEvents(db: Db, companyId: number) {
  return db.select().from(governanceEvents).where(eq(governanceEvents.companyId, companyId)).orderBy(desc(governanceEvents.eventDate)).limit(100);
}

export async function nextEarnings(db: Db, securityId: number, now: Date) {
  const [row] = await db
    .select()
    .from(marketEvents)
    .where(and(eq(marketEvents.securityId, securityId), eq(marketEvents.eventType, "earnings"), gte(marketEvents.eventDate, toEt(now).date)))
    .orderBy(asc(marketEvents.eventDate))
    .limit(1);
  return row ?? null;
}

/** Peer suggestions: same SIC code, with stored financials; ranked by revenue proximity. */
export async function suggestPeers(db: Db, company: typeof companies.$inferSelect, ownRevenue: number | null, limit = 6) {
  if (!company.sicCode) return [];
  const candidates = await db
    .select({ id: companies.id, name: companies.name, cik: companies.cik, sicCode: companies.sicCode, ticker: securities.ticker })
    .from(companies)
    .innerJoin(securities, eq(securities.companyId, companies.id))
    .where(and(eq(companies.sicCode, company.sicCode), ne(companies.id, company.id), isNotNull(companies.cik)));
  const withRevenue = await Promise.all(
    dedupeByCompany(candidates).map(async (c) => {
      const fv = await loadStatements(db, c.id);
      const rev = fv.find((p) => p.periodType === "annual")?.items.revenue?.value ?? null;
      return { ...c, revenue: rev, hasFinancials: fv.length > 0 };
    }),
  );
  return withRevenue
    .filter((c) => c.hasFinancials)
    .sort((a, b) => scaleDistance(a.revenue, ownRevenue) - scaleDistance(b.revenue, ownRevenue))
    .slice(0, limit)
    .map((c) => ({ ...c, rationale: `Same SEC industry code (SIC ${c.sicCode})${ownRevenue && c.revenue ? `; revenue ${(c.revenue / ownRevenue).toFixed(2)}× this company's` : ""}` }));
}

function dedupeByCompany<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function scaleDistance(a: number | null, b: number | null): number {
  if (!a || !b || a <= 0 || b <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log(a / b));
}

/** Snapshot of one company's latest annual metrics for comparison tables. */
export async function comparisonRow(db: Db, ticker: string) {
  const s = await getSecurity(db, ticker);
  if (!s) return { ticker, found: false as const };
  const fv = s.company ? await financialView(db, s.company.id) : null;
  const latest = fv?.annual[0];
  const m = fv?.annualMetrics[0];
  const price = await priceSummary(db, s.security.id);
  const shares = s.company ? await latestSharesOutstanding(db, s.company.id) : null;
  const marketCap = price && shares ? price.close * shares.value : null;
  const ttmNetIncome = latest?.items.netIncome?.value ?? null;
  const revenue = latest?.items.revenue?.value ?? null;
  const equity = latest?.items.equity?.value ?? null;
  return {
    ticker,
    found: true as const,
    name: s.company?.name ?? s.security.name,
    tracked: s.security.tracked,
    periodEnd: latest?.periodEnd ?? null,
    currency: latest?.currency ?? null,
    revenue,
    revenueGrowth: m?.revenueGrowthYoY.value ?? null,
    grossMargin: m?.grossMargin.value ?? null,
    operatingMargin: m?.operatingMargin.value ?? null,
    netMargin: m?.netMargin.value ?? null,
    fcfMargin: m?.freeCashFlowMargin.value ?? null,
    roe: ttmNetIncome != null && equity && equity > 0 ? ttmNetIncome / equity : null,
    debtToEquity: m?.debtToEquity.value ?? null,
    rdIntensity: latest?.items.researchAndDevelopment && revenue ? latest.items.researchAndDevelopment.value / revenue : null,
    marketCap,
    pe: marketCap && ttmNetIncome && ttmNetIncome > 0 ? marketCap / ttmNetIncome : null,
    ps: marketCap && revenue && revenue > 0 ? marketCap / revenue : null,
    priceDate: price?.date ?? null,
    isDemoPrice: price?.isDemo ?? false,
  };
}

export type ComparisonRow = Awaited<ReturnType<typeof comparisonRow>>;

/** Everything the chart and Technical tab need, computed server-side from stored candles. */
export async function technicalView(db: Db, securityId: number) {
  const rows = await loadBars(db, securityId, 1300);
  if (!rows.length) return null;
  const bars = rows.map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const closes = bars.map((b) => b.close);
  const series = (vals: Array<number | null>) => vals.map((v, i) => (v == null ? null : { time: bars[i]!.date, value: round(v) })).filter((x): x is { time: string; value: number } => x !== null);
  const bb = bollinger(closes, 20, 2);
  const m = macd(closes);
  const patterns = detectDoublePatterns(bars);
  const levels = supportResistance(bars);
  const lastClose = closes.at(-1)!;
  const stored = await db
    .select()
    .from(patternDetections)
    .where(eq(patternDetections.securityId, securityId))
    .orderBy(desc(patternDetections.detectedOn))
    .limit(10);
  const [ind] = await db
    .select({ calculatedAt: technicalIndicators.calculatedAt, asOf: technicalIndicators.asOfDate })
    .from(technicalIndicators)
    .where(eq(technicalIndicators.securityId, securityId))
    .orderBy(desc(technicalIndicators.asOfDate))
    .limit(1);
  return {
    bars: bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
    overlays: {
      sma20: series(sma(closes, 20)),
      sma50: series(sma(closes, 50)),
      sma200: series(sma(closes, 200)),
      ema12: series(ema(closes, 12)),
      ema26: series(ema(closes, 26)),
      bbUpper: series(bb.upper),
      bbLower: series(bb.lower),
      bbMiddle: series(bb.middle),
    },
    rsi: series(rsi(closes, 14)),
    macd: { line: series(m.macd), signal: series(m.signal), histogram: series(m.histogram) },
    patterns,
    storedPatterns: stored,
    levels: nearestLevels(levels, lastClose),
    verification: { bullish: tripleVerification(bars, "bullish"), bearish: tripleVerification(bars, "bearish") },
    dataNature: rows.at(-1)!.dataNature,
    isDemo: rows.at(-1)!.isDemo,
    adjusted: rows.at(-1)!.adjusted,
    firstDate: bars[0]!.date,
    lastDate: bars.at(-1)!.date,
    indicatorsCalculatedAt: ind?.calculatedAt.toISOString() ?? null,
  };
}

export type TechnicalView = NonNullable<Awaited<ReturnType<typeof technicalView>>>;

const round = (v: number) => Math.round(v * 10000) / 10000;

export async function companyFreshness(db: Db, ticker: string, cik: string | null, now: Date) {
  return datasetFreshness(db, [`candles:${ticker}`, `indicators:${ticker}`, ...(cik ? [`filings:${cik}`, `fundamentals:${cik}`] : [])], now);
}

export async function sourcesByIds(db: Db, ids: number[]) {
  const clean = [...new Set(ids)].filter((n) => Number.isInteger(n));
  if (!clean.length) return [];
  return db.select({ id: sources.id, name: sources.name, url: sources.url, provider: sources.provider, lastRetrievedAt: sources.lastRetrievedAt }).from(sources).where(inArray(sources.id, clean));
}
