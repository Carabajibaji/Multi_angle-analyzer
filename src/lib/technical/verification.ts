/**
 * Triple Verification Filter. A signal is never "verified" by one indicator: trend, momentum and
 * price/volume must each pass explicit rules. 3/3 means "technically confirmed under these rules",
 * which is NOT a forecast or a guarantee.
 */
import { last, macd, rsi, sma } from "../indicators";
import { detectDoublePatterns } from "./patterns";
import type { Bar } from "./pivots";

export type Direction = "bullish" | "bearish";

export interface Check {
  key: "trend" | "momentum" | "price_volume";
  name: string;
  rule: string;
  /** null = insufficient data to evaluate */
  passed: boolean | null;
  detail: string;
}

export interface VerificationResult {
  direction: Direction;
  asOf: string;
  checks: Check[];
  passedCount: number;
  label: "Insufficient evidence" | "Weak signal" | "Developing signal" | "Technically confirmed under the selected rules";
  disclaimer: string;
}

const LABELS = ["Insufficient evidence", "Weak signal", "Developing signal", "Technically confirmed under the selected rules"] as const;

const f2 = (n: number | null | undefined) => (n == null ? "n/a" : n.toFixed(2));

export function tripleVerification(bars: Bar[], direction: Direction): VerificationResult {
  const closes = bars.map((b) => b.close);
  const close = closes.at(-1) ?? null;
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const sma50 = last(s50);
  const sma200 = last(s200);
  const sma50Prior = s50.length > 10 ? s50[s50.length - 11] ?? null : null;
  const r = last(rsi(closes, 14));
  const m = macd(closes);
  const macdLine = last(m.macd);
  const signal = last(m.signal);
  const bull = direction === "bullish";

  // 1. Trend
  let trend: Check;
  if (close == null || sma50 == null) {
    trend = { key: "trend", name: "Trend", rule: "Needs at least 50 daily candles", passed: null, detail: "Not enough history for a 50-day average." };
  } else if (sma200 != null) {
    const passed = bull ? close > sma50 && sma50 > sma200 : close < sma50 && sma50 < sma200;
    trend = {
      key: "trend",
      name: "Trend",
      rule: bull ? "Close above the 50-day SMA, and 50-day SMA above the 200-day SMA" : "Close below the 50-day SMA, and 50-day SMA below the 200-day SMA",
      passed,
      detail: `Close ${f2(close)}, SMA50 ${f2(sma50)}, SMA200 ${f2(sma200)}.`,
    };
  } else {
    const rising = sma50Prior != null && sma50 > sma50Prior;
    const passed = bull ? close > sma50 && rising : close < sma50 && !rising && sma50Prior != null;
    trend = {
      key: "trend",
      name: "Trend",
      rule: bull ? "Close above a rising 50-day SMA (200-day unavailable)" : "Close below a falling 50-day SMA (200-day unavailable)",
      passed,
      detail: `Close ${f2(close)}, SMA50 ${f2(sma50)} vs ${f2(sma50Prior)} ten sessions ago.`,
    };
  }

  // 2. Momentum
  let momentum: Check;
  if (r == null || macdLine == null || signal == null) {
    momentum = { key: "momentum", name: "Momentum", rule: "Needs ~35 daily candles for RSI and MACD", passed: null, detail: "Not enough history." };
  } else {
    const passed = bull ? macdLine > signal && r > 50 : macdLine < signal && r < 50;
    momentum = {
      key: "momentum",
      name: "Momentum",
      rule: bull ? "MACD(12,26,9) above its signal line AND RSI(14) above 50" : "MACD(12,26,9) below its signal line AND RSI(14) below 50",
      passed,
      detail: `MACD ${f2(macdLine)} vs signal ${f2(signal)}; RSI ${f2(r)}.${bull && r > 70 ? " RSI above 70 is often called overbought." : !bull && r < 30 ? " RSI below 30 is often called oversold." : ""}`,
    };
  }

  // 3. Price / volume
  let pv: Check;
  if (bars.length < 21) {
    pv = { key: "price_volume", name: "Price & volume", rule: "Needs at least 21 daily candles", passed: null, detail: "Not enough history." };
  } else {
    const prior = bars.slice(-21, -1);
    const lastBar = bars.at(-1)!;
    const vols = prior.map((b) => b.volume).filter((v): v is number => v != null);
    const avgVol = vols.length === prior.length ? vols.reduce((s, v) => s + v, 0) / vols.length : null;
    const extreme = bull ? Math.max(...prior.map((b) => b.close)) : Math.min(...prior.map((b) => b.close));
    const breakout = bull ? lastBar.close > extreme : lastBar.close < extreme;
    const volOk = avgVol != null && lastBar.volume != null && lastBar.volume >= 1.5 * avgVol;
    const recentPattern = detectDoublePatterns(bars).find(
      (p) => p.pattern === (bull ? "double_bottom" : "double_top") && p.status === "completed" && p.volumeConfirmed && p.resolvedAt && bars.length - 1 - p.resolvedAt.index <= 10,
    );
    const passed = (breakout && volOk) || !!recentPattern;
    pv = {
      key: "price_volume",
      name: "Price & volume",
      rule: bull
        ? "Close above the highest close of the prior 20 sessions on volume ≥ 1.5× its 20-day average, OR a volume-confirmed W breakout in the last 10 sessions"
        : "Close below the lowest close of the prior 20 sessions on volume ≥ 1.5× its 20-day average, OR a volume-confirmed M breakdown in the last 10 sessions",
      passed,
      detail:
        `Close ${f2(lastBar.close)} vs 20-session ${bull ? "high" : "low"} ${f2(extreme)}; volume ${lastBar.volume?.toLocaleString("en-US") ?? "n/a"} vs average ${avgVol ? Math.round(avgVol).toLocaleString("en-US") : "n/a"}.` +
        (recentPattern ? ` ${recentPattern.explanation}` : ""),
    };
  }

  const checks = [trend, momentum, pv];
  const passedCount = checks.filter((c) => c.passed === true).length;
  return {
    direction,
    asOf: bars.at(-1)?.date ?? "",
    checks,
    passedCount,
    label: LABELS[passedCount]!,
    disclaimer: "Technical rules describe past price behaviour. Even a 3-of-3 result does not predict future performance, and signals often fail.",
  };
}
