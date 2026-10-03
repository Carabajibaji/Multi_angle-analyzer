/**
 * Provider selection. Swap vendors by adding an adapter that implements the interface in `types.ts`
 * and selecting it here via environment variables.
 */
import { DemoMacroProvider, DemoMarketDataProvider } from "./demo";
import { FinnhubProvider } from "./finnhub";
import { FredProvider } from "./fred";
import type { HttpClientOptions, ProviderObserver } from "./http";
import { PolygonMarketDataProvider } from "./polygon";
import { SecEdgarProvider } from "./sec";
import type {
  EarningsCalendarProvider,
  FundamentalsProvider,
  MacroDataProvider,
  MarketDataProvider,
  NewsProvider,
  SecFilingsProvider,
} from "./types";

export interface Providers {
  market: MarketDataProvider;
  macro: MacroDataProvider;
  sec: SecFilingsProvider;
  fundamentals: FundamentalsProvider;
  news: NewsProvider;
  earnings: EarningsCalendarProvider;
}

export type DataMode = "live" | "demo";

export function dataMode(): DataMode {
  return process.env.DATA_MODE === "demo" ? "demo" : "live";
}

export function createProviders(opts: { mode?: DataMode; observer?: ProviderObserver; http?: Partial<HttpClientOptions> } = {}): Providers {
  const mode = opts.mode ?? dataMode();
  const http = { observer: opts.observer, ...opts.http };
  const sec = new SecEdgarProvider(http);
  const finnhub = new FinnhubProvider(http);
  return {
    market: mode === "demo" ? new DemoMarketDataProvider() : new PolygonMarketDataProvider(http),
    macro: mode === "demo" ? new DemoMacroProvider() : new FredProvider(http),
    sec,
    fundamentals: sec,
    news: finnhub,
    earnings: finnhub,
  };
}
