/**
 * DEMO provider: deterministic synthetic prices for offline development and UI work.
 *
 * Everything returned here is fake by construction. Rows are stored with data_nature = 'demo' and
 * is_demo = true, and the UI shows a "DEMO DATA" banner. It never produces news, filings, events or
 * company facts, because inventing those would read as real-world claims.
 */
import { sha256 } from "../hash";
import { addDays, isTradingDay } from "../time/marketCalendar";
import type { Candle, DataNature, Fetched, MacroDataProvider, MarketDataProvider, ReleaseDate, SeriesPoint, SourceMeta } from "./types";

function rng(seed: string) {
  let s = parseInt(sha256(seed).slice(0, 8), 16) || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function demoSource(name: string): SourceMeta {
  return {
    provider: "demo",
    name: `DEMO DATA — synthetic ${name} (not real market data)`,
    url: null,
    retrievedAt: new Date(),
    contentHash: sha256(`demo:${name}`),
  };
}

const ORIGIN = "2019-01-02";

/** Deterministic walk from a fixed origin so overlapping requests return identical candles. */
function synthCandles(ticker: string, to: string): Candle[] {
  const rand = rng(`demo-candles:${ticker}`);
  let price = 20 + rand() * 280;
  const out: Candle[] = [];
  for (let d = ORIGIN; d <= to; d = addDays(d, 1)) {
    if (!isTradingDay(d)) continue;
    const drift = (rand() - 0.48) * 0.03;
    const open = price * (1 + (rand() - 0.5) * 0.01);
    const close = Math.max(1, open * (1 + drift));
    const high = Math.max(open, close) * (1 + rand() * 0.012);
    const low = Math.min(open, close) * (1 - rand() * 0.012);
    const volume = Math.round(1_000_000 + rand() * 9_000_000 * (1 + Math.abs(drift) * 20));
    out.push({ date: d, open: r2(open), high: r2(high), low: r2(low), close: r2(close), volume, vwap: null });
    price = close;
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = "demo";
  readonly displayName = "Demo data (synthetic)";
  readonly configured = true;
  readonly isDemo = true;
  readonly adjusted = false;
  readonly candleNature: DataNature = "demo";

  async getDailyCandles(ticker: string, from: string, to: string): Promise<Fetched<Candle[]>> {
    return { data: synthCandles(ticker, to).filter((c) => c.date >= from), source: demoSource(`daily candles for ${ticker}`) };
  }
}

const SERIES_BASE: Record<string, [number, number]> = {
  DGS10: [4.2, 0.03],
  VIXCLS: [17, 0.6],
  DCOILWTICO: [72, 1.2],
  DTWEXBGS: [121, 0.3],
  CBBTCUSD: [60000, 1500],
};

export class DemoMacroProvider implements MacroDataProvider {
  readonly id = "demo";
  readonly displayName = "Demo data (synthetic)";
  readonly configured = true;
  readonly isDemo = true;

  async getSeries(seriesId: string, from: string): Promise<Fetched<SeriesPoint[]>> {
    const [base, step] = SERIES_BASE[seriesId] ?? [100, 1];
    const rand = rng(`demo-series:${seriesId}`);
    let v = base;
    const out: SeriesPoint[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (let d = ORIGIN; d <= today; d = addDays(d, 1)) {
      if (!isTradingDay(d)) continue;
      v = Math.max(step, v + (rand() - 0.5) * 2 * step);
      if (d >= from) out.push({ date: d, value: Math.round(v * 100) / 100 });
    }
    return { data: out, source: demoSource(`series ${seriesId}`) };
  }

  async getReleaseDates(): Promise<Fetched<ReleaseDate[]>> {
    // Economic calendars are factual claims; demo mode returns none rather than inventing dates.
    return { data: [], source: demoSource("release calendar (empty)") };
  }
}
