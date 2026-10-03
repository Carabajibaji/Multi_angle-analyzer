/**
 * Read models for the Today dashboard. Everything is read from the database populated by the jobs;
 * no daily content is hard-coded.
 */
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { SNAPSHOT_INSTRUMENTS } from "../../config/universe";
import type { Db } from "../db/client";
import { analysisReports, datasets, marketEvents, marketSnapshots, newsArticles, securities, sources, watchlistItems, watchlists } from "../db/schema";
import { evaluateFreshness, type Freshness } from "../pipeline/freshness";
import type { SectorPulseRow } from "../pipeline/market";
import { WATCH_LABEL_TEXT, type RuleHit, type WatchLabel } from "../pipeline/watchlist";
import { addDays, toEt } from "../time/marketCalendar";

export interface SourceRef {
  name: string;
  url: string | null;
  retrievedAt: string;
}

export interface SnapshotCard {
  key: string;
  label: string;
  measureNote: string | null;
  unit: string | null;
  value: number | null;
  changeAbs: number | null;
  changePct: number | null;
  asOfDate: string | null;
  sessionLabel: string | null;
  dataNature: string | null;
  isDemo: boolean;
  source: SourceRef | null;
  freshness: Freshness;
}

async function sourceMap(db: Db, ids: Array<number | null>): Promise<Map<number, SourceRef>> {
  const clean = [...new Set(ids.filter((x): x is number => typeof x === "number"))];
  if (!clean.length) return new Map();
  const rows = await db.select({ id: sources.id, name: sources.name, url: sources.url, at: sources.lastRetrievedAt }).from(sources).where(inArray(sources.id, clean));
  return new Map(rows.map((r) => [r.id, { name: r.name, url: r.url, retrievedAt: r.at.toISOString() }]));
}

export async function datasetFreshness(db: Db, keys: string[], now: Date): Promise<Map<string, Freshness & { lastSuccessAt: string | null; dataAsOf: string | null }>> {
  const rows = keys.length ? await db.select().from(datasets).where(inArray(datasets.key, keys)) : [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return new Map(
    keys.map((k) => {
      const r = byKey.get(k);
      return [k, { ...evaluateFreshness(r, now), lastSuccessAt: r?.lastSuccessAt?.toISOString() ?? null, dataAsOf: r?.dataAsOf ?? null }];
    }),
  );
}

export async function getSnapshotCards(db: Db, now: Date): Promise<SnapshotCard[]> {
  const fresh = await datasetFreshness(db, SNAPSHOT_INSTRUMENTS.map((i) => `snapshot:${i.key}`), now);
  const cards: SnapshotCard[] = [];
  const latest = await Promise.all(
    SNAPSHOT_INSTRUMENTS.map(async (i) => (await db.select().from(marketSnapshots).where(eq(marketSnapshots.instrumentKey, i.key)).orderBy(desc(marketSnapshots.asOfDate)).limit(1))[0]),
  );
  const srcs = await sourceMap(db, latest.map((r) => r?.sourceId ?? null));
  SNAPSHOT_INSTRUMENTS.forEach((i, idx) => {
    const r = latest[idx];
    cards.push({
      key: i.key,
      label: i.label,
      measureNote: r?.measureNote ?? i.measureNote,
      unit: r?.unit ?? i.unit,
      value: r?.value ?? null,
      changeAbs: r?.changeAbs ?? null,
      changePct: r?.changePct ?? null,
      asOfDate: r?.asOfDate ?? null,
      sessionLabel: r?.sessionLabel ?? null,
      dataNature: r?.dataNature ?? null,
      isDemo: r?.isDemo ?? false,
      source: r?.sourceId ? (srcs.get(r.sourceId) ?? null) : null,
      freshness: fresh.get(`snapshot:${i.key}`)!,
    });
  });
  return cards;
}

export async function getSectorPulse(db: Db) {
  const [r] = await db.select().from(analysisReports).where(eq(analysisReports.reportType, "sector_pulse")).orderBy(desc(analysisReports.asOf), desc(analysisReports.createdAt)).limit(1);
  if (!r) return null;
  const content = r.content as { asOf: string; benchmark: { ticker: string; change1d: number | null; change5d: number | null }; sectors: SectorPulseRow[]; method: string };
  return { ...content, calculatedAt: r.createdAt.toISOString() };
}

export async function getStocksToWatch(db: Db) {
  const [wl] = await db.select().from(watchlists).where(eq(watchlists.ownerKey, "system:stocks-to-watch")).orderBy(desc(watchlists.asOfDate)).limit(1);
  if (!wl) return null;
  const items = await db
    .select({ ticker: securities.ticker, name: securities.name, label: watchlistItems.label, reasons: watchlistItems.reasons })
    .from(watchlistItems)
    .innerJoin(securities, eq(securities.id, watchlistItems.securityId))
    .where(eq(watchlistItems.watchlistId, wl.id))
    .orderBy(asc(securities.ticker));
  return {
    asOfDate: wl.asOfDate,
    builtAt: wl.createdAt.toISOString(),
    items: items.map((i) => ({ ...i, labelText: WATCH_LABEL_TEXT[i.label as WatchLabel] ?? i.label, hits: ((i.reasons as { hits?: RuleHit[] } | null)?.hits ?? []) })),
  };
}

export async function getUpcomingEvents(db: Db, now: Date, days = 21) {
  const today = toEt(now).date;
  const rows = await db
    .select()
    .from(marketEvents)
    .where(and(gte(marketEvents.eventDate, today), lte(marketEvents.eventDate, addDays(today, days))))
    .orderBy(asc(marketEvents.eventDate))
    .limit(40);
  const srcs = await sourceMap(db, rows.map((r) => r.sourceId));
  return rows.map((r) => ({ ...r, source: r.sourceId ? (srcs.get(r.sourceId) ?? null) : null }));
}

export async function getLatestNews(db: Db, limit = 20) {
  return db.select().from(newsArticles).orderBy(desc(newsArticles.publishedAt)).limit(Math.min(limit, 100));
}

/**
 * "Today in 60 seconds": a deterministic, rule-based summary assembled from stored data.
 * It makes no causal claims; each line names the measurement it comes from.
 */
export function sixtySecondSummary(input: {
  cards: SnapshotCard[];
  pulse: Awaited<ReturnType<typeof getSectorPulse>>;
  events: Awaited<ReturnType<typeof getUpcomingEvents>>;
}): string[] {
  const lines: string[] = [];
  const idx = input.cards.filter((c) => ["SP500", "NDX", "DJIA", "RUT"].includes(c.key) && c.changePct != null);
  if (idx.length) {
    const up = idx.filter((c) => (c.changePct as number) > 0).length;
    const dir = up === idx.length ? "All four major index funds rose" : up === 0 ? "All four major index funds fell" : `${up} of ${idx.length} major index funds rose`;
    lines.push(`${dir} in the latest session (${idx.map((c) => `${c.label} ${fmtPct(c.changePct)}`).join(", ")}; measured with tracking ETFs).`);
  }
  const sectors = input.pulse?.sectors.filter((s) => s.change1d != null) ?? [];
  if (sectors.length) {
    const sorted = [...sectors].sort((a, b) => (b.change1d as number) - (a.change1d as number));
    lines.push(`Strongest sector: ${sorted[0]!.sector} (${fmtPct(sorted[0]!.change1d)}). Weakest: ${sorted.at(-1)!.sector} (${fmtPct(sorted.at(-1)!.change1d)}).`);
  }
  const vix = input.cards.find((c) => c.key === "VIX" && c.value != null);
  if (vix) lines.push(`Volatility gauge (VIX) at ${vix.value!.toFixed(2)} as of ${vix.asOfDate}${vix.changeAbs != null ? `, ${vix.changeAbs >= 0 ? "up" : "down"} ${Math.abs(vix.changeAbs).toFixed(2)} points` : ""}.`);
  const next = input.events[0];
  if (next) lines.push(`Next scheduled catalyst: ${next.title} on ${next.eventDate} (${next.dateStatus}).`);
  return lines;
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
