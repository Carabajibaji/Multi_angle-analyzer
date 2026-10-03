/**
 * News and catalyst ingestion. Headlines, publishers, links and dates come only from providers;
 * nothing is generated. Earnings dates are labelled by their real status.
 */
import { inArray, lt, sql } from "drizzle-orm";
import { MACRO_RELEASES } from "../../config/universe";
import { marketEvents, newsArticles, securities } from "../db/schema";
import type { JobContext } from "../jobs/runner";
import type { NewsItem } from "../providers/types";
import { addDays, toEt } from "../time/marketCalendar";
import { markAttempt, markFailure, markSuccess, recordSource, STALE_AFTER } from "./store";

async function storeNews(ctx: JobContext, items: NewsItem[], sourceId: number, retrievedAt: Date, provider: string): Promise<number> {
  let inserted = 0;
  for (const n of items) {
    const rows = await ctx.db
      .insert(newsArticles)
      .values({
        provider,
        providerArticleId: n.providerArticleId,
        url: n.url,
        headline: n.headline,
        publisher: n.publisher,
        publishedAt: n.publishedAt,
        providerSummary: n.summary,
        category: n.category,
        relatedTickers: n.relatedTickers,
        sourceId,
        retrievedAt,
      })
      .onConflictDoUpdate({
        target: newsArticles.url,
        // Merge related tickers; keep everything else as first reported.
        set: { relatedTickers: sql`(SELECT array_agg(DISTINCT t) FROM unnest(${newsArticles.relatedTickers} || excluded.related_tickers) AS t)` },
      })
      .returning({ id: newsArticles.id, retrievedAt: newsArticles.retrievedAt });
    if (rows[0] && rows[0].retrievedAt.getTime() === retrievedAt.getTime()) inserted++;
  }
  return inserted;
}

export async function refreshMarketNews(ctx: JobContext): Promise<void> {
  const key = "news:market";
  const p = ctx.providers.news;
  await markAttempt(ctx.db, { key, kind: "news", provider: p.id, staleAfterSeconds: STALE_AFTER.news }, ctx.now);
  try {
    const res = await p.getMarketNews();
    const sourceId = await recordSource(ctx.db, res.source);
    const added = await storeNews(ctx, res.data, sourceId, res.source.retrievedAt, p.id);
    const newest = res.data.reduce<Date | null>((m, n) => (!m || n.publishedAt > m ? n.publishedAt : m), null);
    await markSuccess(ctx.db, key, ctx.now, { changed: added > 0, dataAsOf: newest?.toISOString() ?? null, recordCount: res.data.length, sourceId });
    ctx.log(`Market news: ${res.data.length} items, ${added} new.`);
    ctx.ok();
  } catch (err) {
    await markFailure(ctx.db, key, err);
    throw err;
  }
}

export async function refreshCompanyNews(ctx: JobContext, ticker: string): Promise<void> {
  const key = `news:${ticker}`;
  const p = ctx.providers.news;
  await markAttempt(ctx.db, { key, kind: "news", provider: p.id, staleAfterSeconds: STALE_AFTER.news }, ctx.now);
  try {
    const today = toEt(ctx.now).date;
    const res = await p.getCompanyNews(ticker, addDays(today, -3), today);
    const sourceId = await recordSource(ctx.db, res.source);
    const added = await storeNews(ctx, res.data, sourceId, res.source.retrievedAt, p.id);
    await markSuccess(ctx.db, key, ctx.now, { changed: added > 0, recordCount: res.data.length, sourceId });
    ctx.ok();
  } catch (err) {
    await markFailure(ctx.db, key, err);
    throw err;
  }
}

/** Earnings for tracked tickers (next 21 days) from the earnings-calendar provider. */
export async function refreshEarningsCalendar(ctx: JobContext, trackedTickers: string[]): Promise<void> {
  const key = "events:earnings";
  const p = ctx.providers.earnings;
  await markAttempt(ctx.db, { key, kind: "events", provider: p.id, staleAfterSeconds: STALE_AFTER.events }, ctx.now);
  try {
    const today = toEt(ctx.now).date;
    const to = addDays(today, 21);
    const res = await p.getEarningsCalendar(addDays(today, -3), to);
    const sourceId = await recordSource(ctx.db, res.source);
    const tracked = new Set(trackedTickers);
    const secs = trackedTickers.length ? await ctx.db.select().from(securities).where(inArray(securities.ticker, trackedTickers)) : [];
    const secId = new Map(secs.map((s) => [s.ticker, s.id]));
    let n = 0;
    for (const e of res.data) {
      if (!tracked.has(e.ticker)) continue;
      const reported = e.epsActual != null || e.revenueActual != null;
      const row = {
        eventKey: `earnings:${e.ticker}:${e.fiscalYear ?? "?"}Q${e.fiscalQuarter ?? "?"}`,
        eventType: "earnings",
        title: `${e.ticker} quarterly earnings${e.fiscalQuarter ? ` (fiscal Q${e.fiscalQuarter} ${e.fiscalYear ?? ""})`.trimEnd() : ""}`,
        eventDate: e.date,
        eventTime: e.hour === "bmo" ? "Before market open" : e.hour === "amc" ? "After market close" : e.hour === "dmh" ? "During market hours" : null,
        // Finnhub does not state whether the company confirmed the date; only a reported result is treated as confirmed.
        dateStatus: reported ? "confirmed" : "estimated",
        securityId: secId.get(e.ticker) ?? null,
        details: { epsEstimate: e.epsEstimate, epsActual: e.epsActual, revenueEstimate: e.revenueEstimate, revenueActual: e.revenueActual, estimateSource: "Finnhub consensus" },
        sourceId,
        retrievedAt: res.source.retrievedAt,
      };
      await ctx.db.insert(marketEvents).values(row).onConflictDoUpdate({ target: marketEvents.eventKey, set: row });
      n++;
    }
    await markSuccess(ctx.db, key, ctx.now, { changed: n > 0, dataAsOf: to, recordCount: n, sourceId });
    ctx.log(`Earnings calendar: ${n} events for tracked companies.`);
    ctx.ok();
  } catch (err) {
    await markFailure(ctx.db, key, err);
    throw err;
  }
}

/** Official scheduled macro releases (CPI, jobs, GDP, PPI) from FRED's release calendar, next 45 days. */
export async function refreshMacroCalendar(ctx: JobContext): Promise<void> {
  const key = "events:macro";
  const p = ctx.providers.macro;
  await markAttempt(ctx.db, { key, kind: "events", provider: p.id, staleAfterSeconds: STALE_AFTER.events }, ctx.now);
  const today = toEt(ctx.now).date;
  const to = addDays(today, 45);
  let n = 0;
  let anyOk = false;
  let lastSource: number | null = null;
  for (const r of MACRO_RELEASES) {
    await ctx.item(`events:macro:${r.releaseId}`, async () => {
      const res = await p.getReleaseDates(r.releaseId, today, to);
      const sourceId = await recordSource(ctx.db, res.source);
      lastSource = sourceId;
      for (const d of res.data) {
        const row = {
          eventKey: `fred-release:${d.releaseId}:${d.date}`,
          eventType: "macro_release",
          title: d.releaseName,
          eventDate: d.date,
          eventTime: null,
          dateStatus: "scheduled",
          details: { fredReleaseId: d.releaseId, shortName: r.short },
          isDemo: p.isDemo,
          sourceId,
          retrievedAt: res.source.retrievedAt,
        };
        await ctx.db.insert(marketEvents).values(row).onConflictDoUpdate({ target: marketEvents.eventKey, set: row });
        n++;
      }
      anyOk = true;
      ctx.ok();
    });
  }
  if (anyOk) await markSuccess(ctx.db, key, ctx.now, { changed: n > 0, dataAsOf: to, recordCount: n, sourceId: lastSource });
  else await markFailure(ctx.db, key, new Error("All macro release-calendar requests failed"));
}

/** Retention: news older than NEWS_RETENTION_DAYS (default 120) is deleted. */
export async function pruneNews(ctx: JobContext): Promise<number> {
  const days = Number(process.env.NEWS_RETENTION_DAYS ?? 120);
  const cutoff = new Date(ctx.now.getTime() - days * 86_400_000);
  const rows = await ctx.db.delete(newsArticles).where(lt(newsArticles.publishedAt, cutoff)).returning({ id: newsArticles.id });
  return rows.length;
}

