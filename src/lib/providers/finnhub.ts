/**
 * Finnhub adapter: market news, company news and the earnings calendar.
 * https://finnhub.io/docs/api
 */
import { envSecret } from "../env";
import { z } from "zod";
import { ProviderError } from "./errors";
import { HttpClient, type HttpClientOptions } from "./http";
import type { EarningsCalendarProvider, EarningsEvent, Fetched, NewsItem, NewsProvider } from "./types";

const newsSchema = z.array(
  z.object({
    id: z.number().optional(),
    category: z.string().optional(),
    datetime: z.number(),
    headline: z.string(),
    related: z.string().optional(),
    source: z.string().optional(),
    summary: z.string().optional(),
    url: z.string(),
  }),
);

const earningsSchema = z.object({
  earningsCalendar: z.array(
    z.object({
      symbol: z.string(),
      date: z.string(),
      hour: z.string().nullish(),
      year: z.number().nullish(),
      quarter: z.number().nullish(),
      epsEstimate: z.number().nullish(),
      epsActual: z.number().nullish(),
      revenueEstimate: z.number().nullish(),
      revenueActual: z.number().nullish(),
    }),
  ),
});

/** Only accept http(s) links from providers; anything else is dropped rather than rendered. */
export function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function toNews(items: z.infer<typeof newsSchema>): NewsItem[] {
  const out: NewsItem[] = [];
  for (const n of items) {
    const url = safeExternalUrl(n.url);
    if (!url || !n.headline.trim()) continue;
    out.push({
      providerArticleId: n.id !== undefined ? String(n.id) : null,
      url,
      headline: n.headline.trim(),
      publisher: n.source?.trim() || null,
      publishedAt: new Date(n.datetime * 1000),
      summary: n.summary?.trim() || null,
      category: n.category ?? null,
      relatedTickers: (n.related ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    });
  }
  return out;
}

export class FinnhubProvider implements NewsProvider, EarningsCalendarProvider {
  readonly id = "finnhub";
  readonly displayName = "Finnhub";
  readonly isDemo = false;
  readonly configured: boolean;
  private readonly http: HttpClient;

  constructor(opts: Partial<HttpClientOptions> & { apiKey?: string } = {}) {
    const apiKey = opts.apiKey ?? envSecret("FINNHUB_API_KEY");
    this.configured = apiKey.length > 0;
    this.http = new HttpClient({
      provider: this.id,
      baseUrl: "https://finnhub.io",
      requestsPerMinute: Number(process.env.FINNHUB_REQUESTS_PER_MINUTE ?? 50),
      headers: { "X-Finnhub-Token": apiKey },
      ...opts,
    });
  }

  private ensure() {
    if (!this.configured) throw new ProviderError(this.id, "not_configured", "FINNHUB_API_KEY is not set");
  }

  async getMarketNews(): Promise<Fetched<NewsItem[]>> {
    this.ensure();
    const res = await this.http.getJson({ path: "/api/v1/news", query: { category: "general" }, schema: newsSchema, sourceName: "Finnhub market news" });
    return { data: toNews(res.data), source: { ...res.source, raw: undefined } };
  }

  async getCompanyNews(ticker: string, from: string, to: string): Promise<Fetched<NewsItem[]>> {
    this.ensure();
    const res = await this.http.getJson({
      path: "/api/v1/company-news",
      query: { symbol: ticker, from, to },
      schema: newsSchema,
      sourceName: `Finnhub company news (${ticker})`,
    });
    return { data: toNews(res.data).map((n) => ({ ...n, relatedTickers: n.relatedTickers.length ? n.relatedTickers : [ticker] })), source: { ...res.source, raw: undefined } };
  }

  async getEarningsCalendar(from: string, to: string): Promise<Fetched<EarningsEvent[]>> {
    this.ensure();
    const res = await this.http.getJson({
      path: "/api/v1/calendar/earnings",
      query: { from, to },
      schema: earningsSchema,
      sourceName: "Finnhub earnings calendar",
    });
    const data = res.data.earningsCalendar.map((e) => ({
      ticker: e.symbol.toUpperCase(),
      date: e.date,
      hour: e.hour || null,
      fiscalYear: e.year ?? null,
      fiscalQuarter: e.quarter ?? null,
      epsEstimate: e.epsEstimate ?? null,
      epsActual: e.epsActual ?? null,
      revenueEstimate: e.revenueEstimate ?? null,
      revenueActual: e.revenueActual ?? null,
    }));
    return { data, source: { ...res.source, raw: undefined } };
  }
}
