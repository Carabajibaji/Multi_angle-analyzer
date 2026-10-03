/**
 * SEC EDGAR adapter (official, free, no key). Implements filings + reported fundamentals (XBRL companyfacts).
 * SEC fair-access policy: identify yourself via User-Agent and stay under 10 requests/second.
 * https://www.sec.gov/os/accessing-edgar-data
 */
import { z } from "zod";
import { ProviderError } from "./errors";
import { HttpClient, type HttpClientOptions } from "./http";
import type {
  CompanySubmissions,
  Fetched,
  FilingRecord,
  FundamentalsProvider,
  SecFilingsProvider,
  TickerMapEntry,
  XbrlFact,
} from "./types";

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, "").padStart(10, "0");

const tickerMapSchema = z.record(z.string(), z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }));

const recentSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  reportDate: z.array(z.string()).optional(),
  acceptanceDateTime: z.array(z.string()).optional(),
  form: z.array(z.string()),
  primaryDocument: z.array(z.string()).optional(),
  primaryDocDescription: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
  isXBRL: z.array(z.number()).optional(),
});

const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  name: z.string(),
  sic: z.string().nullish(),
  sicDescription: z.string().nullish(),
  tickers: z.array(z.string()).default([]),
  exchanges: z.array(z.string().nullable()).default([]),
  fiscalYearEnd: z.string().nullish(),
  stateOfIncorporation: z.string().nullish(),
  filings: z.object({ recent: recentSchema }),
});

const factSchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string(),
  fy: z.number().nullish(),
  fp: z.string().nullish(),
  form: z.string(),
  filed: z.string(),
  frame: z.string().optional(),
});

const companyFactsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), z.object({ units: z.record(z.string(), z.array(factSchema)) }))),
});

export interface SecOptions extends Partial<HttpClientOptions> {
  userAgent?: string;
}

export class SecEdgarProvider implements SecFilingsProvider, FundamentalsProvider {
  readonly id = "sec_edgar";
  readonly displayName = "SEC EDGAR";
  readonly isDemo = false;
  readonly configured: boolean;
  private readonly http: HttpClient;

  constructor(opts: SecOptions = {}) {
    const userAgent = opts.userAgent ?? process.env.SEC_USER_AGENT ?? "";
    // SEC requires a descriptive UA with contact email; refuse to run anonymously.
    this.configured = /\S+@\S+/.test(userAgent);
    this.http = new HttpClient({
      provider: this.id,
      baseUrl: "https://data.sec.gov",
      requestsPerMinute: Number(process.env.SEC_REQUESTS_PER_MINUTE ?? 300),
      headers: { "User-Agent": userAgent },
      ...opts,
    });
  }

  private ensure() {
    if (!this.configured) throw new ProviderError(this.id, "not_configured", "SEC_USER_AGENT (with contact email) is not set");
  }

  async getTickerMap(): Promise<Fetched<TickerMapEntry[]>> {
    this.ensure();
    const res = await this.http.getJson({
      baseUrl: "https://www.sec.gov",
      path: "/files/company_tickers.json",
      schema: tickerMapSchema,
      sourceName: "SEC EDGAR company tickers",
    });
    const data = Object.values(res.data).map((e) => ({ cik: padCik(e.cik_str), ticker: e.ticker.toUpperCase(), title: e.title }));
    if (data.length === 0) throw new ProviderError(this.id, "empty", "SEC ticker map was empty");
    return { data, source: { ...res.source, raw: undefined } };
  }

  async getSubmissions(cik: string): Promise<Fetched<CompanySubmissions>> {
    this.ensure();
    const padded = padCik(cik);
    const res = await this.http.getJson({
      path: `/submissions/CIK${padded}.json`,
      schema: submissionsSchema,
      sourceName: "SEC EDGAR submissions API",
    });
    const r = res.data.filings.recent;
    const cikNum = String(Number(padded));
    const filings: FilingRecord[] = r.accessionNumber.map((accessionNo, i) => {
      const primaryDocument = r.primaryDocument?.[i] || null;
      const accepted = r.acceptanceDateTime?.[i];
      return {
        accessionNo,
        form: r.form[i] ?? "",
        filedAt: r.filingDate[i] ?? "",
        reportDate: r.reportDate?.[i] || null,
        acceptedAt: accepted ? new Date(accepted) : null,
        primaryDocument,
        primaryDocDescription: r.primaryDocDescription?.[i] || null,
        primaryDocUrl: primaryDocument
          ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNo.replace(/-/g, "")}/${primaryDocument}`
          : null,
        items: (r.items?.[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        isXbrl: r.isXBRL?.[i] === undefined ? null : r.isXBRL[i] === 1,
      };
    });
    return {
      data: {
        cik: padded,
        name: res.data.name,
        sic: res.data.sic ?? null,
        sicDescription: res.data.sicDescription ?? null,
        tickers: res.data.tickers,
        exchanges: res.data.exchanges.filter((x): x is string => !!x),
        fiscalYearEnd: res.data.fiscalYearEnd ?? null,
        stateOfIncorporation: res.data.stateOfIncorporation ?? null,
        filings: filings.filter((f) => f.filedAt),
      },
      source: { ...res.source, raw: undefined },
    };
  }

  async getCompanyFacts(cik: string, tags?: ReadonlySet<string>): Promise<Fetched<XbrlFact[]>> {
    this.ensure();
    const padded = padCik(cik);
    const res = await this.http.getJson({
      path: `/api/xbrl/companyfacts/CIK${padded}.json`,
      schema: companyFactsSchema,
      sourceName: "SEC EDGAR XBRL companyfacts API",
    });
    const out: XbrlFact[] = [];
    for (const [taxonomy, byTag] of Object.entries(res.data.facts)) {
      for (const [tag, concept] of Object.entries(byTag)) {
        if (tags && !tags.has(`${taxonomy}:${tag}`)) continue;
        for (const [unit, facts] of Object.entries(concept.units)) {
          for (const f of facts) {
            out.push({
              taxonomy,
              tag,
              unit,
              value: f.val,
              periodStart: f.start ?? null,
              periodEnd: f.end,
              fiscalYear: f.fy ?? null,
              fiscalPeriod: f.fp ?? null,
              form: f.form,
              accessionNo: f.accn,
              filedAt: f.filed,
              frame: f.frame ?? null,
            });
          }
        }
      }
    }
    return { data: out, source: { ...res.source, raw: undefined } };
  }
}
