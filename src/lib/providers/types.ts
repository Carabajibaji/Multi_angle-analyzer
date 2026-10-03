/**
 * Provider contracts. The application depends only on these interfaces, so any vendor can be swapped
 * by writing a new adapter and selecting it in `registry.ts`.
 */
import type { IsoDate } from "../time/marketCalendar";

export type DataNature =
  | "real_time"
  | "delayed_15m"
  | "end_of_day"
  | "previous_close"
  | "filing"
  | "calculated"
  | "ai_generated"
  | "demo";

/** Human-facing label for each data nature. The UI must use these, never an ad-hoc "live". */
export const DATA_NATURE_LABEL: Record<DataNature, string> = {
  real_time: "Real time",
  delayed_15m: "15-minute delayed",
  end_of_day: "End-of-day (official daily candle)",
  previous_close: "Previous market close",
  filing: "Latest available filing",
  calculated: "Calculated from stored source data",
  ai_generated: "AI explanation",
  demo: "DEMO DATA — synthetic, not real market data",
};

export interface SourceMeta {
  provider: string;
  /** Human readable, e.g. "SEC EDGAR companyfacts API". */
  name: string;
  /** Public URL with all credentials removed (null if the endpoint must not be shown). */
  url: string | null;
  retrievedAt: Date;
  contentHash: string;
  httpStatus?: number;
  /** Raw payload, only when small; never includes credentials. */
  raw?: unknown;
}

export interface Fetched<T> {
  data: T;
  source: SourceMeta;
}

export interface ProviderInfo {
  readonly id: string;
  readonly displayName: string;
  /** False when the required environment variables are absent; callers must then show "Data unavailable". */
  readonly configured: boolean;
  readonly isDemo: boolean;
}

export interface Candle {
  date: IsoDate;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  vwap?: number | null;
}

export interface MarketDataProvider extends ProviderInfo {
  /** What the daily candles represent under the configured plan. */
  readonly candleNature: DataNature;
  readonly adjusted: boolean;
  getDailyCandles(ticker: string, from: IsoDate, to: IsoDate): Promise<Fetched<Candle[]>>;
}

export interface SeriesPoint {
  date: IsoDate;
  value: number;
}

export interface ReleaseDate {
  releaseId: number;
  releaseName: string;
  date: IsoDate;
}

export interface MacroDataProvider extends ProviderInfo {
  getSeries(seriesId: string, from: IsoDate): Promise<Fetched<SeriesPoint[]>>;
  getReleaseDates(releaseId: number, from: IsoDate, to: IsoDate): Promise<Fetched<ReleaseDate[]>>;
}

export interface TickerMapEntry {
  cik: string; // 10-digit, zero padded
  ticker: string;
  title: string;
}

export interface CompanySubmissions {
  cik: string;
  name: string;
  sic: string | null;
  sicDescription: string | null;
  tickers: string[];
  exchanges: string[];
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  filings: FilingRecord[];
}

export interface FilingRecord {
  accessionNo: string;
  form: string;
  filedAt: IsoDate;
  reportDate: IsoDate | null;
  acceptedAt: Date | null;
  primaryDocument: string | null;
  primaryDocDescription: string | null;
  primaryDocUrl: string | null;
  items: string[];
  isXbrl: boolean | null;
}

export interface SecFilingsProvider extends ProviderInfo {
  getTickerMap(): Promise<Fetched<TickerMapEntry[]>>;
  getSubmissions(cik: string): Promise<Fetched<CompanySubmissions>>;
  /** Fetch an SEC EDGAR archive document (HTML/text). */
  getDocument(url: string): Promise<Fetched<string>>;
}

export interface XbrlFact {
  taxonomy: string;
  tag: string;
  unit: string;
  value: number;
  periodStart: IsoDate | null;
  periodEnd: IsoDate;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  form: string;
  accessionNo: string;
  filedAt: IsoDate;
  frame: string | null;
}

export interface FundamentalsProvider extends ProviderInfo {
  /** Reported XBRL facts. Implementations may restrict to a set of tags to bound storage. */
  getCompanyFacts(cik: string, tags?: ReadonlySet<string>): Promise<Fetched<XbrlFact[]>>;
}

export interface NewsItem {
  providerArticleId: string | null;
  url: string;
  headline: string;
  publisher: string | null;
  publishedAt: Date;
  summary: string | null;
  category: string | null;
  relatedTickers: string[];
}

export interface NewsProvider extends ProviderInfo {
  getMarketNews(): Promise<Fetched<NewsItem[]>>;
  getCompanyNews(ticker: string, from: IsoDate, to: IsoDate): Promise<Fetched<NewsItem[]>>;
}

export interface EarningsEvent {
  ticker: string;
  date: IsoDate;
  /** bmo | amc | dmh | null */
  hour: string | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export interface EarningsCalendarProvider extends ProviderInfo {
  getEarningsCalendar(from: IsoDate, to: IsoDate): Promise<Fetched<EarningsEvent[]>>;
}

/** Contract for grounded AI explanations (implemented in the explanation-layer phase). */
export interface AIExplanationRequest<TInput> {
  subjectType: string;
  subjectKey: string;
  promptName: string;
  input: TInput;
  /** Ids of stored sources the input was built from; the model may only cite these. */
  sourceRefs: Array<{ sourceId: number; label: string; url: string | null }>;
}

export interface AIExplanationResult<TOutput> {
  model: string;
  promptVersion: number;
  output: TOutput;
  generatedAt: Date;
}

export interface AIExplanationProvider extends ProviderInfo {
  explain<TInput, TOutput>(
    req: AIExplanationRequest<TInput>,
    validate: (raw: unknown) => TOutput,
  ): Promise<AIExplanationResult<TOutput>>;
}
