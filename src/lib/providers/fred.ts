/**
 * FRED (Federal Reserve Bank of St. Louis) adapter: macro series (10Y yield, VIX close, WTI, dollar index,
 * Bitcoin reference price) and official release calendars (CPI, jobs, GDP, PPI).
 * https://fred.stlouisfed.org/docs/api/fred/
 */
import { envSecret } from "../env";
import { z } from "zod";
import { ProviderError } from "./errors";
import { HttpClient, type HttpClientOptions } from "./http";
import type { Fetched, MacroDataProvider, ReleaseDate, SeriesPoint } from "./types";

const observationsSchema = z.object({
  observations: z.array(z.object({ date: z.string(), value: z.string() })),
});

const releaseDatesSchema = z.object({
  release_dates: z.array(z.object({ release_id: z.number(), release_name: z.string().optional(), date: z.string() })),
});

export class FredProvider implements MacroDataProvider {
  readonly id = "fred";
  readonly displayName = "FRED (Federal Reserve Bank of St. Louis)";
  readonly isDemo = false;
  readonly configured: boolean;
  private readonly http: HttpClient;

  constructor(opts: Partial<HttpClientOptions> & { apiKey?: string } = {}) {
    const apiKey = opts.apiKey ?? envSecret("FRED_API_KEY");
    this.configured = apiKey.length > 0;
    this.http = new HttpClient({
      provider: this.id,
      baseUrl: "https://api.stlouisfed.org",
      requestsPerMinute: Number(process.env.FRED_REQUESTS_PER_MINUTE ?? 60),
      secretQuery: { api_key: apiKey },
      ...opts,
    });
  }

  private ensure() {
    if (!this.configured) throw new ProviderError(this.id, "not_configured", "FRED_API_KEY is not set");
  }

  async getSeries(seriesId: string, from: string): Promise<Fetched<SeriesPoint[]>> {
    this.ensure();
    const res = await this.http.getJson({
      path: "/fred/series/observations",
      query: { series_id: seriesId, observation_start: from, file_type: "json" },
      schema: observationsSchema,
      sourceName: `FRED series ${seriesId}`,
    });
    // FRED uses "." for missing observations: drop them, never coerce to 0.
    const data = res.data.observations
      .filter((o) => o.value !== "." && o.value.trim() !== "" && Number.isFinite(Number(o.value)))
      .map((o) => ({ date: o.date, value: Number(o.value) }));
    return { data, source: { ...res.source, url: `https://fred.stlouisfed.org/series/${seriesId}`, raw: undefined } };
  }

  async getReleaseDates(releaseId: number, from: string, to: string): Promise<Fetched<ReleaseDate[]>> {
    this.ensure();
    const res = await this.http.getJson({
      path: "/fred/release/dates",
      query: {
        release_id: releaseId,
        realtime_start: from,
        realtime_end: to,
        include_release_dates_with_no_data: "true",
        file_type: "json",
      },
      schema: releaseDatesSchema,
      sourceName: `FRED release calendar (release ${releaseId})`,
    });
    const data = res.data.release_dates
      .filter((d) => d.date >= from && d.date <= to)
      .map((d) => ({ releaseId: d.release_id, releaseName: d.release_name ?? `FRED release ${d.release_id}`, date: d.date }));
    return { data, source: { ...res.source, url: `https://fred.stlouisfed.org/releases/calendar?rid=${releaseId}` } };
  }
}
