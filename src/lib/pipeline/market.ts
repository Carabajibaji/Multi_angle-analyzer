/**
 * Market-data ingestion: universe, daily candles, Market Snapshot, indicators, sector pulse.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { BENCHMARK_ETFS, SECTOR_ETFS, SNAPSHOT_INSTRUMENTS, trackedStockTickers } from "../../config/universe";
import { analysisReports, marketSnapshots, priceCandles, securities, technicalIndicators } from "../db/schema";
import { fingerprint } from "../hash";
import { computeIndicatorSnapshots } from "../indicators";
import { ProviderError } from "../providers/errors";
import type { Candle } from "../providers/types";
import type { JobContext } from "../jobs/runner";
import { addDays, isTradingDay, toEt } from "../time/marketCalendar";
import { markAttempt, markFailure, markSuccess, recordSource, STALE_AFTER } from "./store";

type Security = typeof securities.$inferSelect;

/** Ensure every configured ETF and tracked stock has a securities row (idempotent). */
export async function ensureUniverse(ctx: JobContext): Promise<Security[]> {
  const isDemo = ctx.providers.market.isDemo;
  const rows = [
    ...BENCHMARK_ETFS.map((e) => ({ ticker: e.ticker, name: e.name, assetType: "etf" })),
    ...SECTOR_ETFS.map((e) => ({ ticker: e.ticker, name: e.name, assetType: "etf" })),
    ...trackedStockTickers().map((t) => ({ ticker: t, name: t, assetType: "stock" })),
  ];
  for (const r of rows) {
    await ctx.db
      .insert(securities)
      .values({ ...r, tracked: true, isDemo })
      .onConflictDoUpdate({ target: securities.ticker, set: { tracked: true } });
  }
  return ctx.db.select().from(securities).where(eq(securities.tracked, true));
}

/** Reject candles that are internally inconsistent instead of storing them. */
export function validateCandle(c: Candle): string | null {
  const vals = [c.open, c.high, c.low, c.close];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return "bad date";
  if (vals.some((v) => !Number.isFinite(v) || v <= 0)) return "non-positive or non-finite price";
  if (c.high < Math.max(c.open, c.close) - 1e-9 || c.low > Math.min(c.open, c.close) + 1e-9 || c.low > c.high) return "high/low inconsistent with open/close";
  if (c.volume !== null && (!Number.isFinite(c.volume) || c.volume < 0)) return "negative volume";
  return null;
}

export function historyYears(): number {
  return Math.max(1, Math.min(20, Number(process.env.CANDLE_HISTORY_YEARS ?? 5)));
}

/**
 * Incrementally refresh daily candles for one security up to `to` (inclusive).
 * Overlaps the last 7 stored days so provider corrections are picked up.
 */
export async function refreshCandles(
  ctx: JobContext,
  sec: Security,
  to: string,
  opts: { from?: string } = {},
): Promise<{ added: number; latest: string | null }> {
  const key = `candles:${sec.ticker}`;
  const market = ctx.providers.market;
  await markAttempt(ctx.db, { key, kind: "candles", provider: market.id, dataNature: market.candleNature, staleAfterSeconds: STALE_AFTER.candles }, ctx.now);
  try {
    const [lastRow] = await ctx.db
      .select({ date: priceCandles.date })
      .from(priceCandles)
      .where(and(eq(priceCandles.securityId, sec.id), eq(priceCandles.interval, "1d")))
      .orderBy(desc(priceCandles.date))
      .limit(1);
    const lastDate = lastRow?.date ?? null;
    const from = opts.from ?? (lastDate ? addDays(lastDate, -7) : addDays(to, -Math.round(historyYears() * 365.25)));
    if (!opts.from && lastDate && lastDate >= to) {
      ctx.skip();
      await markSuccess(ctx.db, key, ctx.now, { changed: false, dataAsOf: lastDate });
      return { added: 0, latest: lastDate };
    }

    const res = await market.getDailyCandles(sec.ticker, from, to);
    const valid: Candle[] = [];
    for (const c of res.data) {
      const problem = validateCandle(c);
      if (problem) ctx.log(`Dropped invalid candle ${sec.ticker} ${c.date}: ${problem}`);
      else if (c.date <= to) valid.push(c);
    }
    const expectsNew = opts.from ? false : hasTradingDayBetween(lastDate ? addDays(lastDate, 1) : from, to);
    if (valid.length === 0 && expectsNew) {
      throw new ProviderError(market.id, "empty", `No valid candles returned for ${sec.ticker} ${from}..${to}; keeping existing data.`);
    }

    const sourceId = await recordSource(ctx.db, res.source);
    let added = 0;
    await ctx.db.transaction(async (tx) => {
      for (let i = 0; i < valid.length; i += 500) {
        const chunk = valid.slice(i, i + 500).map((c) => ({
          securityId: sec.id,
          interval: "1d",
          date: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          vwap: c.vwap ?? null,
          adjusted: market.adjusted,
          dataNature: market.candleNature,
          isDemo: market.isDemo,
          sourceId,
          retrievedAt: res.source.retrievedAt,
        }));
        await tx
          .insert(priceCandles)
          .values(chunk)
          .onConflictDoUpdate({
            target: [priceCandles.securityId, priceCandles.interval, priceCandles.date],
            set: {
              open: sql`excluded.open`,
              high: sql`excluded.high`,
              low: sql`excluded.low`,
              close: sql`excluded.close`,
              volume: sql`excluded.volume`,
              vwap: sql`excluded.vwap`,
              adjusted: sql`excluded.adjusted`,
              dataNature: sql`excluded.data_nature`,
              isDemo: sql`excluded.is_demo`,
              sourceId: sql`excluded.source_id`,
              retrievedAt: sql`excluded.retrieved_at`,
            },
          });
      }
    });
    added = valid.filter((c) => !lastDate || c.date > lastDate).length;
    const latest = valid.at(-1)?.date ?? lastDate;
    await markSuccess(ctx.db, key, ctx.now, { changed: added > 0, dataAsOf: latest, recordCount: valid.length, sourceId });
    ctx.log(`candles ${sec.ticker}: ${valid.length} received, ${added} new, latest ${latest ?? "none"} (${market.candleNature})`);
    ctx.ok();
    return { added, latest };
  } catch (err) {
    await markFailure(ctx.db, key, err);
    throw err;
  }
}

function hasTradingDayBetween(from: string, to: string): boolean {
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d)) return true;
  return false;
}

export async function loadCandles(ctx: Pick<JobContext, "db">, securityId: number, limit = 400) {
  const rows = await ctx.db
    .select()
    .from(priceCandles)
    .where(and(eq(priceCandles.securityId, securityId), eq(priceCandles.interval, "1d")))
    .orderBy(desc(priceCandles.date))
    .limit(limit);
  return rows.reverse();
}

/** Build/refresh the Market Snapshot cards. Candle-based cards read from stored candles (already refreshed). */
export async function refreshSnapshots(ctx: JobContext): Promise<void> {
  for (const inst of SNAPSHOT_INSTRUMENTS) {
    const key = `snapshot:${inst.key}`;
    await ctx.item(key, async () => {
      if (inst.source.kind === "candles") {
        const ticker = inst.source.ticker;
        const [sec] = await ctx.db.select().from(securities).where(eq(securities.ticker, ticker));
        await markAttempt(ctx.db, { key, kind: "snapshot", provider: ctx.providers.market.id, dataNature: ctx.providers.market.candleNature, staleAfterSeconds: STALE_AFTER.snapshot }, ctx.now);
        if (!sec) throw new ProviderError("internal", "not_found", `Security ${ticker} is not in the universe`);
        const candles = await loadCandles(ctx, sec.id, 2);
        const last = candles.at(-1);
        if (!last) {
          const err = new ProviderError(ctx.providers.market.id, "empty", `No stored candles for ${ticker} yet`);
          await markFailure(ctx.db, key, err);
          throw err;
        }
        const prev = candles.length > 1 ? candles[0]! : null;
        await upsertSnapshot(ctx, {
          instrumentKey: inst.key,
          label: inst.label,
          measureNote: inst.measureNote,
          unit: inst.unit,
          value: last.close,
          previousValue: prev?.close ?? null,
          asOfDate: last.date,
          sessionLabel: `Official close, ${formatSession(last.date)}`,
          dataNature: last.dataNature,
          isDemo: last.isDemo,
          sourceId: last.sourceId,
          retrievedAt: last.retrievedAt,
        });
        await markSuccess(ctx.db, key, ctx.now, { changed: true, dataAsOf: last.date, sourceId: last.sourceId });
      } else {
        const macro = ctx.providers.macro;
        await markAttempt(ctx.db, { key, kind: "snapshot", provider: macro.id, dataNature: macro.isDemo ? "demo" : "end_of_day", staleAfterSeconds: STALE_AFTER.snapshot }, ctx.now);
        try {
          const res = await macro.getSeries(inst.source.seriesId, addDays(toEt(ctx.now).date, -21));
          const pts = res.data;
          const last = pts.at(-1);
          if (!last) throw new ProviderError(macro.id, "empty", `FRED returned no observations for ${inst.source.seriesId}`);
          const prev = pts.length > 1 ? pts.at(-2)! : null;
          const sourceId = await recordSource(ctx.db, res.source);
          await upsertSnapshot(ctx, {
            instrumentKey: inst.key,
            label: inst.label,
            measureNote: inst.measureNote,
            unit: inst.unit,
            value: last.value,
            previousValue: prev?.value ?? null,
            asOfDate: last.date,
            sessionLabel: `Daily value for ${formatSession(last.date)} (published by FRED, typically 1 business day later)`,
            dataNature: macro.isDemo ? "demo" : "end_of_day",
            isDemo: macro.isDemo,
            sourceId,
            retrievedAt: res.source.retrievedAt,
          });
          await markSuccess(ctx.db, key, ctx.now, { changed: true, dataAsOf: last.date, sourceId });
        } catch (err) {
          await markFailure(ctx.db, key, err);
          throw err;
        }
      }
      ctx.ok();
    });
  }
}

type SnapshotInput = Omit<typeof marketSnapshots.$inferInsert, "id" | "changeAbs" | "changePct">;

async function upsertSnapshot(ctx: JobContext, s: SnapshotInput) {
  const changeAbs = s.previousValue != null ? s.value - s.previousValue : null;
  const changePct = s.previousValue ? (s.value / s.previousValue - 1) * 100 : null;
  const row = { ...s, changeAbs, changePct };
  await ctx.db.insert(marketSnapshots).values(row).onConflictDoUpdate({ target: [marketSnapshots.instrumentKey, marketSnapshots.asOfDate], set: row });
}

export function formatSession(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Recompute indicator snapshots for a security; skipped when the candle inputs are unchanged. */
export async function refreshIndicators(ctx: JobContext, sec: Security): Promise<boolean> {
  const key = `indicators:${sec.ticker}`;
  await markAttempt(ctx.db, { key, kind: "indicators", provider: "calculated", dataNature: "calculated", staleAfterSeconds: STALE_AFTER.indicators }, ctx.now);
  const candles = await loadCandles(ctx, sec.id, 400);
  const last = candles.at(-1);
  if (!last) {
    await markFailure(ctx.db, key, new Error("No candles stored; indicators cannot be calculated."));
    return false;
  }
  const inputHash = fingerprint(candles.map((c) => [c.date, c.close, c.volume]));
  const [existing] = await ctx.db
    .select({ inputHash: technicalIndicators.inputHash })
    .from(technicalIndicators)
    .where(and(eq(technicalIndicators.securityId, sec.id), eq(technicalIndicators.asOfDate, last.date), eq(technicalIndicators.indicatorKey, "rsi_14")));
  if (existing?.inputHash === inputHash) {
    ctx.skip();
    await markSuccess(ctx.db, key, ctx.now, { changed: false, dataAsOf: last.date });
    return false;
  }
  const snaps = computeIndicatorSnapshots(candles);
  await ctx.db.transaction(async (tx) => {
    for (const s of snaps) {
      const row = { securityId: sec.id, interval: "1d", indicatorKey: s.key, asOfDate: last.date, params: s.params, values: s.values, inputHash, calculatedAt: new Date() };
      await tx
        .insert(technicalIndicators)
        .values(row)
        .onConflictDoUpdate({ target: [technicalIndicators.securityId, technicalIndicators.interval, technicalIndicators.indicatorKey, technicalIndicators.asOfDate], set: row });
    }
  });
  await markSuccess(ctx.db, key, ctx.now, { changed: true, dataAsOf: last.date, recordCount: snaps.length });
  ctx.ok();
  return true;
}

export interface SectorPulseRow {
  sector: string;
  ticker: string;
  date: string;
  change1d: number | null;
  change5d: number | null;
  relative1d: number | null;
  relative5d: number | null;
}

function pctChange(candles: Array<{ close: number }>, sessionsBack: number): number | null {
  const n = candles.length;
  if (n <= sessionsBack) return null;
  return (candles[n - 1]!.close / candles[n - 1 - sessionsBack]!.close - 1) * 100;
}

/** Sector performance vs. SPY from stored candles, saved as an analysis report keyed by input hash. */
export async function computeSectorPulse(ctx: JobContext): Promise<SectorPulseRow[]> {
  const tickers = ["SPY", ...SECTOR_ETFS.map((s) => s.ticker)];
  const secs = await ctx.db.select().from(securities).where(inArray(securities.ticker, tickers));
  const byTicker = new Map(secs.map((s) => [s.ticker, s]));
  const spy = byTicker.get("SPY");
  const spyCandles = spy ? await loadCandles(ctx, spy.id, 6) : [];
  const spy1 = pctChange(spyCandles, 1);
  const spy5 = pctChange(spyCandles, 5);
  const rows: SectorPulseRow[] = [];
  for (const s of SECTOR_ETFS) {
    const sec = byTicker.get(s.ticker);
    const c = sec ? await loadCandles(ctx, sec.id, 6) : [];
    const d1 = pctChange(c, 1);
    const d5 = pctChange(c, 5);
    rows.push({
      sector: s.sector!,
      ticker: s.ticker,
      date: c.at(-1)?.date ?? "",
      change1d: d1,
      change5d: d5,
      relative1d: d1 != null && spy1 != null ? d1 - spy1 : null,
      relative5d: d5 != null && spy5 != null ? d5 - spy5 : null,
    });
  }
  const asOf = spyCandles.at(-1)?.date ?? toEt(ctx.now).date;
  const content = { asOf, benchmark: { ticker: "SPY", change1d: spy1, change5d: spy5 }, sectors: rows, method: "Percentage change of SPDR sector ETF closes vs. SPY over 1 and 5 sessions, calculated from stored daily candles." };
  await ctx.db
    .insert(analysisReports)
    .values({ reportType: "sector_pulse", subjectKey: asOf, asOf, content, inputHash: fingerprint(content) })
    .onConflictDoNothing();
  return rows;
}
