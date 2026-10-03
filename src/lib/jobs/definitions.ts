/**
 * The four scheduled jobs. All time logic is evaluated in America/New_York.
 *
 * GitHub Actions cron is UTC-only, so each job is scheduled at two UTC times (covering EST and EDT)
 * and `shouldRun` + the idempotent run key make sure exactly one of them does the work.
 */
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { BENCHMARK_ETFS, SECTOR_ETFS } from "../../config/universe";
import { analysisReports, companies, datasets, jobFailures, jobRuns, priceCandles, securities } from "../db/schema";
import { fingerprint } from "../hash";
import { evaluateFreshness } from "../pipeline/freshness";
import { linkTrackedCompanies, refreshCompany, syncCompanyTracking, syncTickerDirectory } from "../pipeline/company";
import { pruneNews, refreshCompanyNews, refreshEarningsCalendar, refreshMacroCalendar, refreshMarketNews } from "../pipeline/events";
import { computeSectorPulse, ensureUniverse, refreshCandles, refreshIndicators, refreshSnapshots } from "../pipeline/market";
import { buildStocksToWatch } from "../pipeline/watchlist";
import { getDataset, recordSource } from "../pipeline/store";
import { addDays, closeMinutes, isTradingDay, isoWeekKey, lastCompletedSession, previousTradingDay, toEt } from "../time/marketCalendar";
import type { JobContext, JobDefinition, JobName } from "./runner";

const HOUR = 3_600_000;

export const preMarketJob: JobDefinition = {
  name: "pre-market",
  description: "Before the U.S. open: previous-session prices, market snapshot, upcoming earnings & macro releases, news.",
  lockTtlMs: 2 * HOUR,
  runKey: (now) => `pre-market:${toEt(now).date}`,
  shouldRun(now) {
    const et = toEt(now);
    if (!isTradingDay(et.date)) return { run: false, reason: `${et.date} is not a U.S. trading day` };
    if (et.minutes < 5 * 60 || et.minutes >= 9 * 60 + 30) return { run: false, reason: `outside pre-market window (05:00–09:30 ET); now ${et.hour}:${String(et.minute).padStart(2, "0")} ET` };
    return { run: true, reason: "trading day, pre-market window" };
  },
  async execute(ctx) {
    const today = toEt(ctx.now).date;
    const prevSession = isTradingDay(today) && toEt(ctx.now).minutes < 16 * 60 ? previousTradingDay(today) : lastCompletedSession(ctx.now);
    const all = await ensureUniverse(ctx);
    const etfTickers = new Set([...BENCHMARK_ETFS, ...SECTOR_ETFS].map((e) => e.ticker));
    for (const sec of all.filter((s) => etfTickers.has(s.ticker))) {
      await ctx.item(`candles:${sec.ticker}`, () => refreshCandles(ctx, sec, prevSession));
    }
    await refreshSnapshots(ctx);
    const tracked = all.filter((s) => s.assetType === "stock").map((s) => s.ticker);
    await ctx.item("events:earnings", () => refreshEarningsCalendar(ctx, tracked));
    await refreshMacroCalendar(ctx);
    await ctx.item("news:market", () => refreshMarketNews(ctx));
    for (const t of tracked) await ctx.item(`news:${t}`, () => refreshCompanyNews(ctx, t));
    return { previousSession: prevSession, etfs: etfTickers.size, trackedCompanies: tracked.length };
  },
};

export const postMarketJob: JobDefinition = {
  name: "post-market",
  description: "After the U.S. close: daily OHLCV for every tracked security, indicators, sector pulse, Stocks to Watch.",
  lockTtlMs: 3 * HOUR,
  runKey: (now) => `post-market:${lastCompletedSession(now)}`,
  shouldRun(now) {
    const et = toEt(now);
    const close = closeMinutes(et.date);
    if (close === null) return { run: false, reason: `${et.date} is not a U.S. trading day` };
    if (et.minutes < close + 15) return { run: false, reason: `session not closed yet (+15 min settle); now ${et.hour}:${String(et.minute).padStart(2, "0")} ET` };
    return { run: true, reason: "after today's close" };
  },
  async execute(ctx) {
    const session = lastCompletedSession(ctx.now);
    const all = await ensureUniverse(ctx);
    let added = 0;
    for (const sec of all) {
      const r = await ctx.item(`candles:${sec.ticker}`, () => refreshCandles(ctx, sec, session));
      added += r?.added ?? 0;
    }
    await refreshSnapshots(ctx);
    let recalculated = 0;
    for (const sec of all) {
      const changed = await ctx.item(`indicators:${sec.ticker}`, () => refreshIndicators(ctx, sec));
      if (changed) recalculated++;
    }
    const pulse = await ctx.item("sector-pulse", () => computeSectorPulse(ctx));
    const watch = await ctx.item("stocks-to-watch", () => buildStocksToWatch(ctx, session));
    return { session, securities: all.length, newCandles: added, indicatorsRecalculated: recalculated, sectors: pulse?.length ?? 0, stocksToWatch: watch ?? 0 };
  },
};

export const nightlyCompanyJob: JobDefinition = {
  name: "nightly-company",
  description: "Nightly: new SEC filings, 8-K governance events, and fundamentals when a new periodic filing exists.",
  lockTtlMs: 3 * HOUR,
  runKey: (now) => `nightly-company:${toEt(now).date}`,
  shouldRun(now) {
    const et = toEt(now);
    if (et.hour >= 6 && et.hour < 21) return { run: false, reason: "nightly job runs between 21:00 and 06:00 ET (after the SEC filing day ends)" };
    return { run: true, reason: "nightly window" };
  },
  async execute(ctx) {
    await ensureUniverse(ctx);
    const directory = await getDataset(ctx.db, "reference:sec-tickers");
    if (!directory?.lastSuccessAt) {
      await ctx.item("sec:ticker-directory", async () => {
        const res = await ctx.providers.sec.getTickerMap();
        await recordSource(ctx.db, res.source);
        await syncTickerDirectory(ctx, res.data);
        ctx.ok();
      });
    }
    const linked = await ctx.item("sec:link-companies", () => linkTrackedCompanies(ctx));
    await syncCompanyTracking(ctx);
    const list = await ctx.db.select().from(companies).where(and(eq(companies.tracked, true), isNotNull(companies.cik)));
    let newFilings = 0;
    let refreshed = 0;
    for (const c of list) {
      const r = await ctx.item(`company:${c.cik}`, async () => {
        const res = await refreshCompany(ctx, c);
        ctx.ok();
        return res;
      });
      newFilings += r?.newFilings ?? 0;
      if (r?.fundamentalsRefreshed) refreshed++;
    }
    return { companies: list.length, newlyLinked: linked ?? 0, newFilings, fundamentalsRefreshed: refreshed };
  },
};

/** Trading days in [from, to] that have no stored candle. */
export function missingTradingDays(stored: Set<string>, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d) && !stored.has(d)) out.push(d);
  return out;
}

export const weeklyReconcileJob: JobDefinition = {
  name: "weekly-reconcile",
  description: "Weekly: relink tickers, backfill candle gaps, check consistency, list stale/failed data, apply retention.",
  lockTtlMs: 4 * HOUR,
  runKey: (now) => `weekly-reconcile:${isoWeekKey(toEt(now).date)}`,
  shouldRun(now) {
    const et = toEt(now);
    if (et.weekday !== 6 && et.weekday !== 0) return { run: false, reason: "weekly reconciliation runs on weekends (ET)" };
    return { run: true, reason: "weekend" };
  },
  async execute(ctx) {
    const session = lastCompletedSession(ctx.now);
    const all = await ensureUniverse(ctx);

    // 1. Refresh SEC ticker map and link any unlinked tracked companies.
    const tickerMap = await ctx.item("sec:ticker-map", async () => {
      const res = await ctx.providers.sec.getTickerMap();
      await recordSource(ctx.db, res.source);
      ctx.ok();
      return res.data;
    });
    if (tickerMap) {
      await ctx.item("sec:ticker-directory", () => syncTickerDirectory(ctx, tickerMap));
      await ctx.item("sec:link-companies", () => linkTrackedCompanies(ctx, tickerMap));
      await syncCompanyTracking(ctx);
    }

    // 2. Candle gaps over the last year → backfill.
    const gaps: Array<{ ticker: string; missing: number; sample: string[] }> = [];
    const windowStart = addDays(session, -365);
    for (const sec of all) {
      const rows = await ctx.db
        .select({ date: priceCandles.date })
        .from(priceCandles)
        .where(and(eq(priceCandles.securityId, sec.id), gte(priceCandles.date, windowStart)));
      if (rows.length === 0) {
        gaps.push({ ticker: sec.ticker, missing: -1, sample: [] });
        await ctx.item(`backfill:${sec.ticker}`, () => refreshCandles(ctx, sec, session));
        continue;
      }
      const dates = new Set(rows.map((r) => r.date));
      const first = [...dates].sort()[0]!;
      const missing = missingTradingDays(dates, first, session);
      if (missing.length) {
        gaps.push({ ticker: sec.ticker, missing: missing.length, sample: missing.slice(0, 5) });
        await ctx.item(`backfill:${sec.ticker}`, () => refreshCandles(ctx, sec, session, { from: missing[0]! }));
      }
    }

    // 3. Internal consistency of stored candles.
    const inconsistent = await ctx.db
      .select({ ticker: securities.ticker, date: priceCandles.date })
      .from(priceCandles)
      .innerJoin(securities, eq(securities.id, priceCandles.securityId))
      .where(sql`${priceCandles.low} > ${priceCandles.high} OR ${priceCandles.close} > ${priceCandles.high} OR ${priceCandles.close} < ${priceCandles.low} OR ${priceCandles.close} <= 0`)
      .limit(100);

    // 4. Stale / failed datasets and recent failures.
    const ds = await ctx.db.select().from(datasets);
    const stale = ds
      .map((d) => ({ key: d.key, ...evaluateFreshness(d, ctx.now), lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null }))
      .filter((d) => d.status !== "fresh");
    const weekAgo = new Date(ctx.now.getTime() - 7 * 86_400_000);
    const failures = await ctx.db
      .select({ itemKey: jobFailures.itemKey, errorClass: jobFailures.errorClass, count: sql<number>`count(*)::int` })
      .from(jobFailures)
      .where(gte(jobFailures.createdAt, weekAgo))
      .groupBy(jobFailures.itemKey, jobFailures.errorClass)
      .orderBy(desc(sql`count(*)`))
      .limit(50);
    const runs = await ctx.db
      .select({ job: jobRuns.jobName, status: jobRuns.status, count: sql<number>`count(*)::int` })
      .from(jobRuns)
      .where(gte(jobRuns.startedAt, weekAgo))
      .groupBy(jobRuns.jobName, jobRuns.status);

    // 5. Retention.
    const prunedNews = await pruneNews(ctx);
    const oldRuns = await ctx.db
      .delete(jobRuns)
      .where(lt(jobRuns.startedAt, new Date(ctx.now.getTime() - Number(process.env.JOB_RUN_RETENTION_DAYS ?? 180) * 86_400_000)))
      .returning({ id: jobRuns.id });

    const report = {
      week: isoWeekKey(toEt(ctx.now).date),
      generatedAt: ctx.now.toISOString(),
      latestSession: session,
      securitiesChecked: all.length,
      candleGaps: gaps,
      inconsistentCandles: inconsistent,
      staleOrFailedDatasets: stale,
      failuresLast7Days: failures,
      runsLast7Days: runs,
      retention: { newsDeleted: prunedNews, jobRunsDeleted: oldRuns.length },
    };
    await ctx.db
      .insert(analysisReports)
      .values({ reportType: "reconciliation", subjectKey: report.week, asOf: toEt(ctx.now).date, content: report, inputHash: fingerprint(report) })
      .onConflictDoNothing();
    ctx.log(`Reconciliation: ${gaps.length} securities with gaps, ${inconsistent.length} inconsistent candles, ${stale.length} stale/failed datasets.`);
    ctx.ok();
    return { gaps: gaps.length, inconsistent: inconsistent.length, staleDatasets: stale.length, prunedNews };
  },
};

/**
 * On-demand analysis of one company (user request): mark tracked, then load filings, fundamentals,
 * candles and indicators immediately instead of waiting for the next scheduled run.
 */
export function onDemandJob(ticker: string): JobDefinition {
  return {
    name: "on-demand",
    description: `On-demand analysis for ${ticker}`,
    lockTtlMs: 15 * 60_000,
    lockKey: `on-demand:${ticker}`,
    runKey: (now) => `on-demand:${ticker}:${toEt(now).date}`,
    shouldRun: () => ({ run: true, reason: "user request" }),
    async execute(ctx) {
      const [sec] = await ctx.db.update(securities).set({ tracked: true }).where(eq(securities.ticker, ticker)).returning();
      if (!sec) throw new Error(`Unknown ticker ${ticker}`);
      await syncCompanyTracking(ctx);
      await ctx.item("sec:link-companies", () => linkTrackedCompanies(ctx));
      const [fresh] = await ctx.db.select().from(securities).where(eq(securities.id, sec.id));
      if (fresh?.companyId) {
        const [company] = await ctx.db.select().from(companies).where(eq(companies.id, fresh.companyId));
        if (company?.cik) await ctx.item(`company:${company.cik}`, async () => { await refreshCompany(ctx, company); ctx.ok(); });
      }
      const session = lastCompletedSession(ctx.now);
      await ctx.item(`candles:${ticker}`, () => refreshCandles(ctx, fresh ?? sec, session));
      await ctx.item(`indicators:${ticker}`, () => refreshIndicators(ctx, fresh ?? sec));
      return { ticker, session };
    },
  };
}

export type ScheduledJobName = Exclude<JobName, "on-demand">;

export const JOBS: Record<ScheduledJobName, JobDefinition> = {
  "pre-market": preMarketJob,
  "post-market": postMarketJob,
  "nightly-company": nightlyCompanyJob,
  "weekly-reconcile": weeklyReconcileJob,
};

export const JOB_SCHEDULE_DESCRIPTION: Record<ScheduledJobName, string> = {
  "pre-market": "U.S. trading days, ~7:00–8:00 ET (cron 11:05 & 12:05 UTC, Mon–Fri)",
  "post-market": "U.S. trading days, ~5:30–6:30 pm ET (cron 21:35 & 22:35 UTC, Mon–Fri)",
  "nightly-company": "Every night, ~10–11 pm ET (cron 02:15 & 03:15 UTC)",
  "weekly-reconcile": "Saturdays ~10–11 am ET (cron 14:25 & 15:25 UTC, Sat)",
};

/** Next time a cron pattern in the workflow will fire (for the status page). Matches .github/workflows/scheduled-refresh.yml. */
export const CRON_UTC: Record<ScheduledJobName, Array<{ minute: number; hour: number; days: number[] }>> = {
  "pre-market": [11, 12].map((hour) => ({ minute: 5, hour, days: [1, 2, 3, 4, 5] })),
  "post-market": [21, 22].map((hour) => ({ minute: 35, hour, days: [1, 2, 3, 4, 5] })),
  "nightly-company": [2, 3].map((hour) => ({ minute: 15, hour, days: [0, 1, 2, 3, 4, 5, 6] })),
  "weekly-reconcile": [14, 15].map((hour) => ({ minute: 25, hour, days: [6] })),
};

export function nextCronFire(job: ScheduledJobName, now: Date): Date {
  let best: Date | null = null;
  for (const c of CRON_UTC[job]) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, c.hour, c.minute));
      if (d > now && c.days.includes(d.getUTCDay())) {
        if (!best || d < best) best = d;
        break;
      }
    }
  }
  return best!;
}

export type { JobContext };
