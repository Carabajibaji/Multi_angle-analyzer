/**
 * Tracked universe and Market Snapshot definitions.
 *
 * Index levels themselves usually require a paid index-data licence. Where we use an ETF or a
 * different official series instead, `measureNote` says so explicitly and the UI shows it.
 */

export interface UniverseEntry {
  ticker: string;
  name: string;
  assetType: "stock" | "etf";
  /** GICS sector for sector ETFs. */
  sector?: string;
}

/** SPDR Select Sector ETFs: one per GICS sector (used for Sector Pulse). */
export const SECTOR_ETFS: UniverseEntry[] = [
  { ticker: "XLC", name: "Communication Services Select Sector SPDR Fund", assetType: "etf", sector: "Communication Services" },
  { ticker: "XLY", name: "Consumer Discretionary Select Sector SPDR Fund", assetType: "etf", sector: "Consumer Discretionary" },
  { ticker: "XLP", name: "Consumer Staples Select Sector SPDR Fund", assetType: "etf", sector: "Consumer Staples" },
  { ticker: "XLE", name: "Energy Select Sector SPDR Fund", assetType: "etf", sector: "Energy" },
  { ticker: "XLF", name: "Financial Select Sector SPDR Fund", assetType: "etf", sector: "Financials" },
  { ticker: "XLV", name: "Health Care Select Sector SPDR Fund", assetType: "etf", sector: "Health Care" },
  { ticker: "XLI", name: "Industrial Select Sector SPDR Fund", assetType: "etf", sector: "Industrials" },
  { ticker: "XLK", name: "Technology Select Sector SPDR Fund", assetType: "etf", sector: "Information Technology" },
  { ticker: "XLB", name: "Materials Select Sector SPDR Fund", assetType: "etf", sector: "Materials" },
  { ticker: "XLRE", name: "Real Estate Select Sector SPDR Fund", assetType: "etf", sector: "Real Estate" },
  { ticker: "XLU", name: "Utilities Select Sector SPDR Fund", assetType: "etf", sector: "Utilities" },
];

export const BENCHMARK_ETFS: UniverseEntry[] = [
  { ticker: "SPY", name: "SPDR S&P 500 ETF Trust", assetType: "etf" },
  { ticker: "QQQ", name: "Invesco QQQ Trust (Nasdaq-100)", assetType: "etf" },
  { ticker: "DIA", name: "SPDR Dow Jones Industrial Average ETF Trust", assetType: "etf" },
  { ticker: "IWM", name: "iShares Russell 2000 ETF", assetType: "etf" },
  { ticker: "GLD", name: "SPDR Gold Shares", assetType: "etf" },
];

/**
 * Starter company list. Override with TRACKED_TICKERS (comma-separated). Companies users add through
 * the app are tracked in the database in addition to these.
 */
export const DEFAULT_TRACKED_STOCKS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "UNH",
  "XOM", "JNJ", "PG", "HD", "KO", "COST", "WMT", "NFLX", "AMD", "CRM",
];

export function trackedStockTickers(): string[] {
  const env = process.env.TRACKED_TICKERS?.trim();
  const list = env ? env.split(",") : DEFAULT_TRACKED_STOCKS;
  return [...new Set(list.map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)))];
}

export type SnapshotSource = { kind: "candles"; ticker: string } | { kind: "fred"; seriesId: string };

export interface SnapshotInstrument {
  key: string;
  label: string;
  measureNote: string;
  unit: string;
  source: SnapshotSource;
}

export const SNAPSHOT_INSTRUMENTS: SnapshotInstrument[] = [
  { key: "SP500", label: "S&P 500", measureNote: "Measured with the SPY ETF (a fund tracking the S&P 500), not the index level.", unit: "USD", source: { kind: "candles", ticker: "SPY" } },
  { key: "NDX", label: "Nasdaq-100", measureNote: "Measured with the QQQ ETF (a fund tracking the Nasdaq-100), not the index level.", unit: "USD", source: { kind: "candles", ticker: "QQQ" } },
  { key: "DJIA", label: "Dow Jones Industrial Average", measureNote: "Measured with the DIA ETF (a fund tracking the Dow), not the index level.", unit: "USD", source: { kind: "candles", ticker: "DIA" } },
  { key: "RUT", label: "Russell 2000", measureNote: "Measured with the IWM ETF (a fund tracking the Russell 2000), not the index level.", unit: "USD", source: { kind: "candles", ticker: "IWM" } },
  { key: "VIX", label: "VIX (volatility index)", measureNote: "CBOE VIX daily close via FRED series VIXCLS.", unit: "index", source: { kind: "fred", seriesId: "VIXCLS" } },
  { key: "UST10Y", label: "U.S. 10-year Treasury yield", measureNote: "Market yield on 10-year Treasuries (constant maturity), FRED series DGS10.", unit: "%", source: { kind: "fred", seriesId: "DGS10" } },
  { key: "USD", label: "U.S. dollar index (broad)", measureNote: "Federal Reserve nominal broad dollar index (FRED DTWEXBGS). This is NOT the ICE DXY index.", unit: "index", source: { kind: "fred", seriesId: "DTWEXBGS" } },
  { key: "GOLD", label: "Gold", measureNote: "Measured with the GLD ETF (backed by physical gold), not the spot price.", unit: "USD", source: { kind: "candles", ticker: "GLD" } },
  { key: "WTI", label: "Crude oil (WTI)", measureNote: "WTI spot price, Cushing OK, via FRED series DCOILWTICO.", unit: "USD/bbl", source: { kind: "fred", seriesId: "DCOILWTICO" } },
  { key: "BTC", label: "Bitcoin", measureNote: "Coinbase Bitcoin daily price via FRED series CBBTCUSD.", unit: "USD", source: { kind: "fred", seriesId: "CBBTCUSD" } },
];

/** FRED release ids for the catalyst calendar. Titles shown to users come from FRED's response. */
export const MACRO_RELEASES = [
  { releaseId: 10, short: "CPI" },
  { releaseId: 50, short: "Employment Situation (jobs report)" },
  { releaseId: 53, short: "GDP" },
  { releaseId: 46, short: "PPI" },
];
