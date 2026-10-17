/**
 * Polygon.io (now branded Massive) market-data adapter: daily aggregates (OHLCV).
 * Free plans provide end-of-day data; paid plans provide 15-minute delayed or real-time data.
 * The label shown to users comes from POLYGON_DATA_NATURE, which must match your plan.
 */
import { envSecret } from "../env";
import { z } from "zod";
import { toEt } from "../time/marketCalendar";
import { ProviderError } from "./errors";
import { HttpClient, type HttpClientOptions } from "./http";
import type { Candle, DataNature, Fetched, MarketDataProvider } from "./types";

const aggsSchema = z.object({
  status: z.string(),
  ticker: z.string().optional(),
  resultsCount: z.number().optional(),
  results: z
    .array(z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number().optional(), vw: z.number().optional() }))
    .optional(),
});

export class PolygonMarketDataProvider implements MarketDataProvider {
  readonly id = "polygon";
  readonly displayName = "Polygon.io / Massive";
  readonly isDemo = false;
  readonly adjusted = true;
  readonly configured: boolean;
  readonly candleNature: DataNature;
  private readonly http: HttpClient;

  constructor(opts: Partial<HttpClientOptions> & { apiKey?: string; dataNature?: DataNature } = {}) {
    const apiKey = opts.apiKey ?? envSecret("POLYGON_API_KEY");
    this.configured = apiKey.length > 0;
    this.candleNature = opts.dataNature ?? ((process.env.POLYGON_DATA_NATURE as DataNature | undefined) ?? "end_of_day");
    this.http = new HttpClient({
      provider: this.id,
      baseUrl: process.env.POLYGON_BASE_URL ?? "https://api.polygon.io",
      requestsPerMinute: Number(process.env.POLYGON_REQUESTS_PER_MINUTE ?? 5),
      headers: { Authorization: `Bearer ${apiKey}` },
      ...opts,
    });
  }

  async getDailyCandles(ticker: string, from: string, to: string): Promise<Fetched<Candle[]>> {
    if (!this.configured) throw new ProviderError(this.id, "not_configured", "POLYGON_API_KEY is not set");
    const res = await this.http.getJson({
      path: `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}`,
      query: { adjusted: "true", sort: "asc", limit: 50000 },
      schema: aggsSchema,
      sourceName: `Polygon.io daily aggregates (${ticker})`,
    });
    if (res.data.status === "ERROR") throw new ProviderError(this.id, "client", `Polygon returned ERROR for ${ticker}`);
    const data = (res.data.results ?? []).map((r) => ({
      // Daily bars are stamped at 00:00 America/New_York of the session date.
      date: toEt(new Date(r.t)).date,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v ?? null,
      vwap: r.vw ?? null,
    }));
    return { data, source: { ...res.source, raw: undefined } };
  }
}
