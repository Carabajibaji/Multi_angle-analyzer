/**
 * Freshness evaluation shown next to every important number.
 * Market datasets are judged against the trading calendar, so a Monday morning view of Friday's
 * close is "fresh", while a Wednesday view of Friday's close is "stale".
 */
import { lastCompletedSession, previousTradingDay } from "../time/marketCalendar";

export type FreshnessStatus = "fresh" | "stale" | "failed" | "never";

export interface DatasetLike {
  kind: string;
  status: string;
  dataAsOf: string | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  staleAfterSeconds: number;
  lastError: string | null;
}

export interface Freshness {
  status: FreshnessStatus;
  reason: string;
}

const MARKET_KINDS = new Set(["candles", "snapshot", "indicators"]);

export function evaluateFreshness(ds: DatasetLike | undefined, now: Date): Freshness {
  if (!ds || !ds.lastSuccessAt) {
    return ds?.lastError
      ? { status: "failed", reason: `No successful update yet. Last error: ${ds.lastError}` }
      : { status: "never", reason: "Not loaded yet." };
  }
  const ageSec = (now.getTime() - ds.lastSuccessAt.getTime()) / 1000;
  if (ageSec > ds.staleAfterSeconds) {
    return { status: "stale", reason: `Last successful update was ${Math.round(ageSec / 3600)} hours ago.` };
  }
  if (MARKET_KINDS.has(ds.kind) && ds.dataAsOf) {
    // Allow one session of lag (post-market job may not have run yet today).
    const minimum = previousTradingDay(lastCompletedSession(now));
    if (ds.dataAsOf < minimum) return { status: "stale", reason: `Latest data is from ${ds.dataAsOf}; expected ${minimum} or later.` };
  }
  if (ds.status === "stale" && ds.lastError) return { status: "stale", reason: `Latest refresh failed (${ds.lastError}); showing last verified data.` };
  return { status: "fresh", reason: "Up to date for its update schedule." };
}
