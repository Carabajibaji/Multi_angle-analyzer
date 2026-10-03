/**
 * Deterministic technical indicators. Every function returns an array aligned with its input,
 * with `null` during the warm-up window (never 0, never extrapolated).
 *
 * References:
 *  - SMA/EMA: standard definitions; EMA seeded with the SMA of the first `period` values, alpha = 2/(period+1).
 *  - RSI: J. Welles Wilder, "New Concepts in Technical Trading Systems" (1978), Wilder smoothing.
 *  - MACD: Gerald Appel; MACD = EMA(fast) − EMA(slow); signal = EMA(signal) of MACD; histogram = MACD − signal.
 *  - Bollinger Bands: John Bollinger; middle = SMA(n), bands = middle ± k × population standard deviation.
 */

export type Series = Array<number | null>;

function assertPeriod(period: number) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError(`period must be a positive integer, got ${period}`);
}

export function sma(values: Series, period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      sum = 0;
      valid = 0; // a gap resets the window: we do not average across missing data
      continue;
    }
    sum += v;
    valid++;
    if (valid > period) sum -= values[i - period] as number;
    if (valid >= period) out[i] = sum / period;
  }
  return out;
}

export function ema(values: Series, period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev: number | null = null;
  let seed: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      prev = null;
      seed = [];
      continue;
    }
    if (prev === null) {
      seed.push(v);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: Series, period = 14): Series {
  assertPeriod(period);
  const out: Series = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  let count = 0;
  for (let i = 1; i < closes.length; i++) {
    const cur = closes[i];
    const prev = closes[i - 1];
    if (cur == null || prev == null) {
      count = 0;
      avgGain = 0;
      avgLoss = 0;
      continue;
    }
    const change = cur - prev;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    count++;
    if (count <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (count < period) continue;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) out[i] = avgGain === 0 ? 50 : 100;
    else out[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(closes: Series, fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  if (fast >= slow) throw new RangeError("fast period must be shorter than slow period");
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line: Series = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null));
  const signal = ema(line, signalPeriod);
  const histogram = line.map((m, i) => (m != null && signal[i] != null ? m - (signal[i] as number) : null));
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  middle: Series;
  upper: Series;
  lower: Series;
  /** (upper − lower) / middle */
  bandwidth: Series;
}

export function bollinger(closes: Series, period = 20, k = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  const bandwidth: Series = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const m = middle[i];
    if (m == null) continue;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += ((closes[j] as number) - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
    bandwidth[i] = m !== 0 ? (2 * k * sd) / m : null;
  }
  return { middle, upper, lower, bandwidth };
}

export function volumeAverage(volumes: Series, period = 20): Series {
  return sma(volumes, period);
}

export function last<T>(arr: Array<T | null>): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as T;
  return null;
}

export interface IndicatorSnapshot {
  key: string;
  params: Record<string, number>;
  values: Record<string, number | null>;
}

/** The standard indicator set computed nightly for every tracked security. */
export function computeIndicatorSnapshots(candles: Array<{ close: number; volume: number | null }>): IndicatorSnapshot[] {
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const m = macd(closes);
  const bb = bollinger(closes);
  const lastClose = closes.at(-1) ?? null;
  const vAvg = last(volumeAverage(vols, 20));
  const lastVol = vols.at(-1) ?? null;
  return [
    { key: "sma_20", params: { period: 20 }, values: { value: last(sma(closes, 20)) } },
    { key: "sma_50", params: { period: 50 }, values: { value: last(sma(closes, 50)) } },
    { key: "sma_200", params: { period: 200 }, values: { value: last(sma(closes, 200)) } },
    { key: "ema_12", params: { period: 12 }, values: { value: last(ema(closes, 12)) } },
    { key: "ema_26", params: { period: 26 }, values: { value: last(ema(closes, 26)) } },
    { key: "rsi_14", params: { period: 14 }, values: { value: last(rsi(closes, 14)) } },
    {
      key: "macd_12_26_9",
      params: { fast: 12, slow: 26, signal: 9 },
      values: { macd: last(m.macd), signal: last(m.signal), histogram: last(m.histogram) },
    },
    {
      key: "bollinger_20_2",
      params: { period: 20, k: 2 },
      values: { middle: last(bb.middle), upper: last(bb.upper), lower: last(bb.lower), bandwidth: last(bb.bandwidth), close: lastClose },
    },
    {
      key: "volume_avg_20",
      params: { period: 20 },
      values: { value: vAvg, latest: lastVol, ratio: vAvg && lastVol != null ? lastVol / vAvg : null },
    },
  ];
}
