import { and, count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import {
  datasets,
  filings,
  financialStatements,
  governanceEvents,
  jobFailures,
  jobLocks,
  jobRuns,
  marketSnapshots,
  newsArticles,
  priceCandles,
  securities,
  technicalIndicators,
  watchlistItems,
} from "@/lib/db/schema";
import { JOBS, missingTradingDays, nextCronFire } from "@/lib/jobs/definitions";
import { acquireLock, runJob } from "@/lib/jobs/runner";
import { evaluateFreshness } from "@/lib/pipeline/freshness";
import { ProviderError } from "@/lib/providers/errors";
import { fakeProviders, filing, memoryDb } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  process.env.TRACKED_TICKERS = "AAPL,MSFT";
  h = await memoryDb();
});
afterAll(async () => {
  delete process.env.TRACKED_TICKERS;
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(
    `TRUNCATE watchlist_items, watchlists, technical_indicators, price_candles, market_snapshots, market_events, news_articles,
     governance_events, financial_statements, financial_facts, filings, analysis_reports, job_failures, job_runs, job_locks,
     datasets, provider_health, securities, companies, sources RESTART IDENTITY CASCADE` as never,
  );
});

// Friday 2026-10-02, 5:35 pm EDT (21:35 UTC): post-market window.
const FRIDAY_AFTER_CLOSE = new Date("2026-10-02T21:35:00Z");

describe("post-market job", () => {
  it("stores candles, snapshots, indicators and marks datasets fresh", async () => {
    const { providers } = fakeProviders();
    const r = await runJob(JOBS["post-market"], { db: h.db, providers, now: FRIDAY_AFTER_CLOSE, trigger: "schedule" });
    expect(r.status).toBe("succeeded");
    expect(r.runKey).toBe("post-market:2026-10-02");
    const [{ n }] = (await h.db.select({ n: count() }).from(priceCandles)) as [{ n: number }];
    expect(n).toBeGreaterThan(1000);
    const spy = await h.db.select().from(marketSnapshots).where(eq(marketSnapshots.instrumentKey, "SP500"));
    expect(spy[0]).toMatchObject({ asOfDate: "2026-10-02", dataNature: "end_of_day" });
    expect(spy[0]!.measureNote).toMatch(/SPY ETF/);
    const ind = await h.db.select().from(technicalIndicators).where(eq(technicalIndicators.indicatorKey, "rsi_14"));
    expect(ind.length).toBeGreaterThan(0);
    const [ds] = await h.db.select().from(datasets).where(eq(datasets.key, "candles:AAPL"));
    expect(ds).toMatchObject({ status: "fresh", dataAsOf: "2026-10-02" });
    expect(evaluateFreshness(ds, new Date("2026-10-05T13:00:00Z")).status).toBe("fresh"); // Monday morning
    expect(evaluateFreshness(ds, new Date("2026-10-07T22:00:00Z")).status).toBe("stale"); // Wednesday evening
  });

  it("is idempotent: a second scheduled run is skipped and no duplicates are created", async () => {
    const { providers, market } = fakeProviders();
    await runJob(JOBS["post-market"], { db: h.db, providers, now: FRIDAY_AFTER_CLOSE, trigger: "schedule" });
    const before = (await h.db.select({ n: count() }).from(priceCandles))[0]!.n;
    const calls = market.calls.length;
    const again = await runJob(JOBS["post-market"], { db: h.db, providers, now: new Date("2026-10-02T22:35:00Z"), trigger: "schedule" });
    expect(again).toMatchObject({ status: "skipped", reason: "already succeeded" });
    expect(market.calls.length).toBe(calls);
    // A forced manual run re-fetches but upserts: still no duplicates.
    const forced = await runJob(JOBS["post-market"], { db: h.db, providers, now: FRIDAY_AFTER_CLOSE, trigger: "manual", force: true });
    expect(forced.status).toBe("succeeded");
    expect((await h.db.select({ n: count() }).from(priceCandles))[0]!.n).toBe(before);
  });

  it("isolates a failing ticker (partial) and keeps the last valid data, marked stale", async () => {
    const { providers, market } = fakeProviders();
    await runJob(JOBS["post-market"], { db: h.db, providers, now: new Date("2026-10-01T21:35:00Z"), trigger: "schedule" });
    const [aapl] = await h.db.select().from(securities).where(eq(securities.ticker, "AAPL"));
    const countAapl = async () => (await h.db.select({ n: count() }).from(priceCandles).where(eq(priceCandles.securityId, aapl!.id)))[0]!.n;
    const before = await countAapl();

    market.fail.set("AAPL", new ProviderError("fake_market", "server", "HTTP 500"));
    market.empty.add("MSFT");
    const r = await runJob(JOBS["post-market"], { db: h.db, providers, now: FRIDAY_AFTER_CLOSE, trigger: "schedule" });
    expect(r.status).toBe("partial");
    expect(r.itemsFailed).toBeGreaterThanOrEqual(2);
    const failures = await h.db.select().from(jobFailures).where(eq(jobFailures.jobRunId, r.runId!));
    expect(failures.map((f) => f.itemKey)).toEqual(expect.arrayContaining(["candles:AAPL", "candles:MSFT"]));
    expect(failures.find((f) => f.itemKey === "candles:MSFT")!.errorClass).toBe("empty");

    expect(await countAapl()).toBe(before); // nothing deleted or overwritten
    const [ds] = await h.db.select().from(datasets).where(eq(datasets.key, "candles:AAPL"));
    expect(ds!.status).toBe("stale");
    expect(ds!.dataAsOf).toBe("2026-10-01");
    expect(ds!.lastError).toMatch(/HTTP 500/);
    expect(evaluateFreshness(ds, FRIDAY_AFTER_CLOSE).status).toBe("stale");

    // A partial run does not consume the run key: the next scheduled attempt retries.
    market.fail.clear();
    market.empty.clear();
    const retry = await runJob(JOBS["post-market"], { db: h.db, providers, now: new Date("2026-10-02T22:35:00Z"), trigger: "schedule" });
    expect(retry.status).toBe("succeeded");
    const [ds2] = await h.db.select().from(datasets).where(eq(datasets.key, "candles:AAPL"));
    expect(ds2).toMatchObject({ status: "fresh", dataAsOf: "2026-10-02", lastError: null });
  });

  it("builds a rules-based watchlist with explicit reasons", async () => {
    const { providers } = fakeProviders();
    await runJob(JOBS["post-market"], { db: h.db, providers, now: FRIDAY_AFTER_CLOSE, trigger: "schedule" });
    const items = await h.db.select().from(watchlistItems);
    for (const i of items) {
      expect((i.reasons as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
      expect(i.label).not.toMatch(/buy|sell/i);
    }
  });
});

describe("schedule gating (America/New_York)", () => {
  it("skips weekends and holidays", async () => {
    const { providers } = fakeProviders();
    const sat = await runJob(JOBS["post-market"], { db: h.db, providers, now: new Date("2026-10-03T21:35:00Z") });
    expect(sat).toMatchObject({ status: "skipped" });
    expect(sat.reason).toMatch(/not a U.S. trading day/);
    const thanksgiving = JOBS["pre-market"].shouldRun(new Date("2026-11-26T12:05:00Z"));
    expect(thanksgiving.run).toBe(false);
  });

  it("both UTC cron slots land inside the ET window in summer and winter", () => {
    const pre = JOBS["pre-market"];
    const post = JOBS["post-market"];
    const nightly = JOBS["nightly-company"];
    for (const day of ["2026-07-07", "2026-12-08"]) {
      expect(pre.shouldRun(new Date(`${day}T11:05:00Z`)).run).toBe(true);
      expect(pre.shouldRun(new Date(`${day}T12:05:00Z`)).run).toBe(true);
      expect(post.shouldRun(new Date(`${day}T21:35:00Z`)).run).toBe(true);
      expect(post.shouldRun(new Date(`${day}T22:35:00Z`)).run).toBe(true);
      expect(pre.runKey(new Date(`${day}T11:05:00Z`))).toBe(pre.runKey(new Date(`${day}T12:05:00Z`)));
    }
    expect(nightly.shouldRun(new Date("2026-07-08T02:15:00Z")).run).toBe(true); // 22:15 EDT
    expect(nightly.shouldRun(new Date("2026-12-09T02:15:00Z")).run).toBe(true); // 21:15 EST
    expect(nightly.runKey(new Date("2026-12-09T02:15:00Z"))).toBe(nightly.runKey(new Date("2026-12-09T03:15:00Z")));
  });

  it("respects the early close on the day after Thanksgiving", () => {
    expect(JOBS["post-market"].shouldRun(new Date("2026-11-27T18:20:00Z")).run).toBe(true); // 1:20 pm ET
  });

  it("computes the next cron fire time", () => {
    expect(nextCronFire("post-market", new Date("2026-10-02T21:40:00Z")).toISOString()).toBe("2026-10-02T22:35:00.000Z");
    expect(nextCronFire("post-market", new Date("2026-10-02T23:00:00Z")).toISOString()).toBe("2026-10-05T21:35:00.000Z");
  });
});

describe("concurrency lock", () => {
  it("prevents a second holder until the lease expires", async () => {
    const t0 = new Date("2026-10-02T21:35:00Z");
    expect(await acquireLock(h.db, "post-market", "A", 60_000, t0)).toBe(true);
    expect(await acquireLock(h.db, "post-market", "B", 60_000, new Date(t0.getTime() + 1000))).toBe(false);
    expect(await acquireLock(h.db, "post-market", "B", 60_000, new Date(t0.getTime() + 120_000))).toBe(true);
  });

  it("skips a job whose lock is held", async () => {
    const { providers } = fakeProviders();
    await h.db.insert(jobLocks).values({ jobName: "post-market", holder: "other", acquiredAt: FRIDAY_AFTER_CLOSE, expiresAt: new Date(FRIDAY_AFTER_CLOSE.getTime() + 3_600_000) });
    const r = await runJob(JOBS["post-market"], { db: h.db, providers, now: FRIDAY_AFTER_CLOSE });
    expect(r).toMatchObject({ status: "skipped", reason: "locked" });
    expect(await h.db.select().from(jobRuns)).toHaveLength(0);
  });
});

describe("nightly company job", () => {
  const NIGHT1 = new Date("2026-10-02T02:15:00Z");
  const NIGHT2 = new Date("2026-10-03T02:15:00Z");
  const NIGHT3 = new Date("2026-10-04T02:15:00Z");

  it("detects new filings and only refetches fundamentals when a periodic filing arrives", async () => {
    const { providers, sec } = fakeProviders();
    sec.tickerMap = [{ cik: "0000320193", ticker: "AAPL", title: "Apple Inc." }]; // MSFT has no CIK in this fixture
    sec.facts = [
      { taxonomy: "us-gaap", tag: "Revenues", unit: "USD", value: 100, periodStart: "2025-01-01", periodEnd: "2025-12-31", fiscalYear: 2025, fiscalPeriod: "FY", form: "10-K", accessionNo: "0000320193-26-000001", filedAt: "2026-02-01", frame: null },
    ];
    sec.filingsByCik.set("0000320193", [filing("0000320193-26-000001", "10-K", "2026-02-01")]);

    const r1 = await runJob(JOBS["nightly-company"], { db: h.db, providers, now: NIGHT1, trigger: "schedule" });
    expect(r1.status).toBe("succeeded");
    expect(sec.factCalls).toBe(1); // first load
    expect(await h.db.select().from(financialStatements)).toHaveLength(1);

    // Night 2: only an 8-K Item 5.02 (leadership change) -> governance event, no fundamentals refetch.
    sec.filingsByCik.set("0000320193", [filing("0000320193-26-000002", "8-K", "2026-10-02", ["5.02", "9.01"]), filing("0000320193-26-000001", "10-K", "2026-02-01")]);
    const r2 = await runJob(JOBS["nightly-company"], { db: h.db, providers, now: NIGHT2, trigger: "schedule" });
    expect(r2.summary).toMatchObject({ newFilings: 1, fundamentalsRefreshed: 0 });
    expect(sec.factCalls).toBe(1);
    const gov = await h.db.select().from(governanceEvents);
    expect(gov).toHaveLength(1);
    expect(gov[0]!.description).toBe(
      "Form 8-K Item 5.02: Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers",
    );

    // Night 3: a new 10-Q -> fundamentals refetched; no duplicate filings.
    sec.filingsByCik.set("0000320193", [filing("0000320193-26-000003", "10-Q", "2026-10-03"), filing("0000320193-26-000002", "8-K", "2026-10-02", ["5.02"]), filing("0000320193-26-000001", "10-K", "2026-02-01")]);
    const r3 = await runJob(JOBS["nightly-company"], { db: h.db, providers, now: NIGHT3, trigger: "schedule" });
    expect(r3.summary).toMatchObject({ newFilings: 1, fundamentalsRefreshed: 1 });
    expect(sec.factCalls).toBe(2);
    expect(await h.db.select().from(filings)).toHaveLength(3);
    const [ds] = await h.db.select().from(datasets).where(eq(datasets.key, "filings:0000320193"));
    expect(ds!.dataAsOf).toBe("2026-10-03");
  });
});

describe("pre-market job", () => {
  it("stores provider news verbatim and dedupes by URL", async () => {
    const { providers, news } = fakeProviders();
    news.items = [
      { providerArticleId: "1", url: "https://news.example/a", headline: "Headline A", publisher: "Wire", publishedAt: new Date("2026-10-05T10:00:00Z"), summary: "s", category: "general", relatedTickers: ["AAPL"] },
    ];
    news.earnings = [{ ticker: "AAPL", date: "2026-10-29", hour: "amc", fiscalYear: 2026, fiscalQuarter: 4, epsEstimate: 1.5, epsActual: null, revenueEstimate: null, revenueActual: null }];
    const monday = new Date("2026-10-05T11:05:00Z");
    const r = await runJob(JOBS["pre-market"], { db: h.db, providers, now: monday, trigger: "schedule" });
    expect(r.status).toBe("succeeded");
    await runJob(JOBS["pre-market"], { db: h.db, providers, now: monday, trigger: "manual", force: true });
    const stored = await h.db.select().from(newsArticles);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ headline: "Headline A", publisher: "Wire", url: "https://news.example/a" });
    const ev = await h.db.query.marketEvents.findMany({ where: (e, { eq }) => eq(e.eventType, "earnings") });
    expect(ev[0]).toMatchObject({ eventDate: "2026-10-29", dateStatus: "estimated", eventTime: "After market close" });
    // Candles for the previous session (Friday) were refreshed for benchmark ETFs.
    const [ds] = await h.db.select().from(datasets).where(and(eq(datasets.key, "candles:SPY")));
    expect(ds!.dataAsOf).toBe("2026-10-02");
  });
});

describe("weekly reconciliation helpers", () => {
  it("finds missing trading days only", () => {
    expect(missingTradingDays(new Set(["2026-09-28", "2026-09-30"]), "2026-09-28", "2026-10-05")).toEqual(["2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05"]);
  });
});
