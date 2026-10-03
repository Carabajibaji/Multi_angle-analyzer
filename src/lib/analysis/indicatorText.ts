/** Formula, parameters, plain-English reading and limitation for each displayed indicator. */
import type { TechnicalView } from "../queries/company";

export interface IndicatorRow {
  key: string;
  name: string;
  glossary?: string;
  params: string;
  formula: string;
  value: string;
  reading: string;
  limitation: string;
}

const lastVal = (s: Array<{ value: number }>) => s.at(-1)?.value ?? null;
const f = (v: number | null, d = 2) => (v == null ? "n/a" : v.toFixed(d));

export function indicatorRows(v: TechnicalView): IndicatorRow[] {
  const close = v.bars.at(-1)?.close ?? null;
  const s20 = lastVal(v.overlays.sma20);
  const s50 = lastVal(v.overlays.sma50);
  const s200 = lastVal(v.overlays.sma200);
  const e12 = lastVal(v.overlays.ema12);
  const e26 = lastVal(v.overlays.ema26);
  const r = lastVal(v.rsi);
  const m = lastVal(v.macd.line);
  const sig = lastVal(v.macd.signal);
  const hist = lastVal(v.macd.histogram);
  const up = lastVal(v.overlays.bbUpper);
  const lo = lastVal(v.overlays.bbLower);
  const vols = v.bars.slice(-20).map((b) => b.volume);
  const volAvg = vols.length === 20 && vols.every((x) => x != null) ? (vols as number[]).reduce((a, b) => a + b, 0) / 20 : null;
  const rel = (a: number | null, b: number | null, name: string) => (a == null || b == null ? `Not enough history for the ${name}.` : `The latest close is ${a > b ? "above" : "below"} the ${name} (${f(b)}).`);
  return [
    { key: "sma", name: "Simple moving averages", params: "20, 50 and 200 daily closes", formula: "Average of the last N closing prices", value: `SMA20 ${f(s20)} · SMA50 ${f(s50)} · SMA200 ${f(s200)}`, reading: `${rel(close, s50, "50-day average")} ${rel(close, s200, "200-day average")}`, limitation: "Averages lag price; crossovers often come after much of a move has happened." },
    { key: "ema", name: "Exponential moving averages", params: "12 and 26 days; α = 2/(N+1), seeded with the SMA", formula: "EMAₜ = α·Closeₜ + (1−α)·EMAₜ₋₁", value: `EMA12 ${f(e12)} · EMA26 ${f(e26)}`, reading: e12 != null && e26 != null ? `The faster EMA is ${e12 > e26 ? "above" : "below"} the slower one, meaning recent prices are ${e12 > e26 ? "higher" : "lower"} than the longer-run average.` : "Not enough history.", limitation: "More responsive than SMAs, so more prone to whipsaws." },
    { key: "rsi", name: "RSI", glossary: "rsi", params: "14 sessions, Wilder smoothing", formula: "100 − 100 ÷ (1 + average gain ÷ average loss)", value: f(r, 1), reading: r == null ? "Not enough history." : r >= 70 ? "Above 70: recent gains have been strong relative to losses (often called overbought)." : r <= 30 ? "Below 30: recent losses have dominated (often called oversold)." : `Between 30 and 70 (${r >= 50 ? "gains slightly outweigh losses" : "losses slightly outweigh gains"}).`, limitation: "Can stay above 70 or below 30 for long periods in strong trends." },
    { key: "macd", name: "MACD", glossary: "macd", params: "12, 26, 9", formula: "MACD = EMA12 − EMA26; signal = EMA9 of MACD; histogram = MACD − signal", value: `MACD ${f(m)} · signal ${f(sig)} · histogram ${f(hist)}`, reading: m == null || sig == null ? "Not enough history." : `MACD is ${m > sig ? "above" : "below"} its signal line (momentum ${m > sig ? "improving" : "fading"} by this measure).`, limitation: "Lags price and produces frequent false crossovers in sideways markets." },
    { key: "bb", name: "Bollinger Bands", glossary: "bollinger-bands", params: "20 sessions, 2 standard deviations", formula: "SMA20 ± 2 × population standard deviation of the last 20 closes", value: `Upper ${f(up)} · Lower ${f(lo)}`, reading: close == null || up == null || lo == null ? "Not enough history." : close > up ? "Close is above the upper band — an unusually large move vs the last 20 days." : close < lo ? "Close is below the lower band — an unusually large drop vs the last 20 days." : "Close is inside the bands.", limitation: "Touching a band is not a signal on its own; bands simply describe recent volatility." },
    { key: "vol", name: "Volume average", params: "20 sessions", formula: "Average of the last 20 daily volumes", value: volAvg == null ? "n/a" : `${Math.round(volAvg).toLocaleString("en-US")} (latest ${v.bars.at(-1)?.volume?.toLocaleString("en-US") ?? "n/a"})`, reading: volAvg && v.bars.at(-1)?.volume ? `Latest volume is ${(v.bars.at(-1)!.volume! / volAvg).toFixed(1)}× the 20-day average.` : "Volume data unavailable.", limitation: "Volume spikes can come from index rebalancing or options expiry, not news." },
  ];
}

export function chartSummary(ticker: string, v: TechnicalView): string {
  const first = v.bars[0];
  const last = v.bars.at(-1);
  if (!first || !last) return `${ticker}: no price data.`;
  const yr = v.bars.slice(-252);
  const chg = ((last.close / (yr[0]?.close ?? last.close)) - 1) * 100;
  const hi = Math.max(...yr.map((b) => b.high));
  const lo = Math.min(...yr.map((b) => b.low));
  return `Daily candlestick chart of ${ticker} from ${first.time} to ${last.time}. Latest close ${last.close.toFixed(2)} on ${last.time}. Over the last ${yr.length} sessions the price changed ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%, ranging from ${lo.toFixed(2)} to ${hi.toFixed(2)}. ${v.patterns.length ? `${v.patterns.length} possible W/M pattern(s) marked.` : "No W/M patterns detected."}`;
}
