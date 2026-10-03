import { createDb, type DbHandle } from "@/lib/db/client";
import { DemoMacroProvider } from "@/lib/providers/demo";
import { ProviderError } from "@/lib/providers/errors";
import type { Providers } from "@/lib/providers/registry";
import type {
  Candle,
  CompanySubmissions,
  EarningsEvent,
  Fetched,
  FilingRecord,
  MarketDataProvider,
  NewsItem,
  SourceMeta,
  TickerMapEntry,
  XbrlFact,
} from "@/lib/providers/types";
import { addDays, isTradingDay } from "@/lib/time/marketCalendar";

export async function memoryDb(): Promise<DbHandle> {
  const h = await createDb("pglite:memory");
  await h.migrate();
  return h;
}

export const src = (name: string, hash = name): SourceMeta => ({ provider: "fake", name, url: `https://fake.example/${name}`, retrievedAt: new Date(), contentHash: hash });

export function candlesBetween(from: string, to: string, start = 100): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isTradingDay(d)) continue;
    p += 1;
    out.push({ date: d, open: p - 0.5, high: p + 1, low: p - 1, close: p, volume: 1_000_000 });
  }
  return out;
}

export class FakeMarket implements MarketDataProvider {
  readonly id = "fake_market";
  readonly displayName = "Fake market";
  readonly configured = true;
  readonly isDemo = false;
  readonly adjusted = true;
  readonly candleNature = "end_of_day" as const;
  calls: string[] = [];
  /** ticker -> behaviour */
  fail = new Map<string, ProviderError>();
  empty = new Set<string>();
  async getDailyCandles(ticker: string, from: string, to: string): Promise<Fetched<Candle[]>> {
    this.calls.push(`${ticker}:${from}:${to}`);
    const e = this.fail.get(ticker);
    if (e) throw e;
    if (this.empty.has(ticker)) return { data: [], source: src(`candles-${ticker}-empty`) };
    return { data: candlesBetween(from, to), source: src(`candles-${ticker}`, `${ticker}${from}${to}`) };
  }
}

export class FakeSec {
  readonly id = "sec_edgar";
  readonly displayName = "Fake SEC";
  readonly configured = true;
  readonly isDemo = false;
  filingsByCik = new Map<string, FilingRecord[]>();
  facts: XbrlFact[] = [];
  factCalls = 0;
  tickerMap: TickerMapEntry[] = [{ cik: "0000320193", ticker: "AAPL", title: "Apple Inc." }];
  async getTickerMap(): Promise<Fetched<TickerMapEntry[]>> {
    return { data: this.tickerMap, source: src("tickers") };
  }
  async getSubmissions(cik: string): Promise<Fetched<CompanySubmissions>> {
    return {
      data: { cik, name: "Apple Inc.", sic: "3571", sicDescription: "Electronic Computers", tickers: ["AAPL"], exchanges: ["Nasdaq"], fiscalYearEnd: "0927", stateOfIncorporation: "CA", filings: this.filingsByCik.get(cik) ?? [] },
      source: src(`subs-${cik}`, JSON.stringify(this.filingsByCik.get(cik))),
    };
  }
  documents = new Map<string, string>();
  async getDocument(url: string): Promise<Fetched<string>> {
    const doc = this.documents.get(url);
    if (!doc) throw new ProviderError("sec_edgar", "not_found", `no fixture for ${url}`);
    return { data: doc, source: src(`doc-${url}`) };
  }
  async getCompanyFacts(): Promise<Fetched<XbrlFact[]>> {
    this.factCalls++;
    return { data: this.facts, source: src("facts", String(this.factCalls)) };
  }
}

export const filing = (accessionNo: string, form: string, filedAt: string, items: string[] = []): FilingRecord => ({
  accessionNo,
  form,
  filedAt,
  reportDate: null,
  acceptedAt: null,
  primaryDocument: "doc.htm",
  primaryDocDescription: form,
  primaryDocUrl: `https://www.sec.gov/Archives/edgar/data/320193/${accessionNo.replace(/-/g, "")}/doc.htm`,
  items,
  isXbrl: true,
});

export class FakeNews {
  readonly id = "fake_news";
  readonly displayName = "Fake news";
  readonly configured = true;
  readonly isDemo = false;
  items: NewsItem[] = [];
  earnings: EarningsEvent[] = [];
  async getMarketNews(): Promise<Fetched<NewsItem[]>> {
    return { data: this.items, source: src("news") };
  }
  async getCompanyNews(): Promise<Fetched<NewsItem[]>> {
    return { data: [], source: src("cnews") };
  }
  async getEarningsCalendar(): Promise<Fetched<EarningsEvent[]>> {
    return { data: this.earnings, source: src("earn") };
  }
}

export function fakeProviders() {
  const market = new FakeMarket();
  const sec = new FakeSec();
  const news = new FakeNews();
  const providers: Providers = { market, macro: new DemoMacroProvider(), sec, fundamentals: sec, news, earnings: news };
  return { providers, market, sec, news };
}
