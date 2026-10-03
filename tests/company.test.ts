import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import { securities } from "@/lib/db/schema";
import { financialHealthExplainer } from "@/lib/analysis/explain";
import { governanceFlags } from "@/lib/analysis/governance";
import { healthChecks, isFinancialSic } from "@/lib/analysis/health";
import { assessMoat } from "@/lib/analysis/moat";
import { onDemandJob } from "@/lib/jobs/definitions";
import { runJob } from "@/lib/jobs/runner";
import { comparisonRow, financialView, getSecurity, searchCompanies, technicalView } from "@/lib/queries/company";
import type { XbrlFact } from "@/lib/providers/types";
import { fakeProviders, filing, memoryDb } from "./helpers";

const fact = (tag: string, value: number, start: string | null, end: string, accn: string, filedAt: string, unit = "USD"): XbrlFact => ({
  taxonomy: "us-gaap", tag, unit, value, periodStart: start, periodEnd: end, fiscalYear: null, fiscalPeriod: "FY", form: "10-K", accessionNo: accn, filedAt, frame: null,
});

function threeYears(): XbrlFact[] {
  const out: XbrlFact[] = [];
  const years: Array<[string, string, number, number, string, string]> = [
    ["2022-10-01", "2023-09-30", 1000, 450, "0000320193-23-000106", "2023-11-03"],
    ["2023-10-01", "2024-09-28", 1100, 500, "0000320193-24-000123", "2024-11-01"],
    ["2024-09-29", "2025-09-27", 1250, 575, "0000320193-25-000079", "2025-10-31"],
  ];
  for (const [s, e, rev, gp, acc, filed] of years) {
    out.push(fact("RevenueFromContractWithCustomerExcludingAssessedTax", rev, s, e, acc, filed));
    out.push(fact("GrossProfit", gp, s, e, acc, filed));
    out.push(fact("OperatingIncomeLoss", rev * 0.3, s, e, acc, filed));
    out.push(fact("NetIncomeLoss", rev * 0.25, s, e, acc, filed));
    out.push(fact("NetCashProvidedByUsedInOperatingActivities", rev * 0.3, s, e, acc, filed));
    out.push(fact("PaymentsToAcquirePropertyPlantAndEquipment", rev * 0.05, s, e, acc, filed));
    out.push(fact("AssetsCurrent", 600, null, e, acc, filed));
    out.push(fact("LiabilitiesCurrent", 400, null, e, acc, filed));
    out.push(fact("LongTermDebtNoncurrent", 300, null, e, acc, filed));
    out.push(fact("StockholdersEquity", 500, null, e, acc, filed));
  }
  out.push({ ...fact("EntityCommonStockSharesOutstanding", 10, null, "2025-10-17", "0000320193-25-000079", "2025-10-31", "shares"), taxonomy: "dei" });
  return out;
}

let h: DbHandle;
beforeAll(async () => {
  process.env.TRACKED_TICKERS = "MSFT";
  h = await memoryDb();
});
afterAll(async () => {
  delete process.env.TRACKED_TICKERS;
  await h.close();
});

describe("company directory + on-demand analysis", () => {
  it("loads the SEC directory, then analyzes an untracked company on request", async () => {
    const { providers, sec } = fakeProviders();
    sec.tickerMap = [
      { cik: "0000320193", ticker: "AAPL", title: "Apple Inc." },
      { cik: "0000789019", ticker: "MSFT", title: "Microsoft Corp" },
      { cik: "0001652044", ticker: "GOOGL", title: "Alphabet Inc." },
      { cik: "0001652044", ticker: "GOOG", title: "Alphabet Inc." },
    ];
    sec.facts = threeYears();
    sec.filingsByCik.set("0000320193", [filing("0000320193-25-000079", "10-K", "2025-10-31"), filing("0000320193-25-000090", "8-K", "2025-12-01", ["4.01"])]);

    const { nightlyCompanyJob } = await import("@/lib/jobs/definitions");
    const night = await runJob(nightlyCompanyJob, { db: h.db, providers, now: new Date("2026-10-02T02:15:00Z"), trigger: "schedule" });
    expect(["succeeded", "partial"]).toContain(night.status);

    const found = await searchCompanies(h.db, "alpha");
    expect(found.map((r) => r.ticker).sort()).toEqual(["GOOG", "GOOGL"]);
    expect((await searchCompanies(h.db, "AAPL"))[0]).toMatchObject({ ticker: "AAPL", tracked: false });
    expect(await searchCompanies(h.db, "%")).toEqual([]); // LIKE wildcards are escaped

    const r = await runJob(onDemandJob("AAPL"), { db: h.db, providers, now: new Date("2026-10-02T21:00:00Z"), trigger: "manual", force: true });
    expect(r.status).toBe("succeeded");
    const [aapl] = await h.db.select().from(securities).where(eq(securities.ticker, "AAPL"));
    expect(aapl!.tracked).toBe(true);

    const row = await getSecurity(h.db, "AAPL");
    expect(row!.company!.name).toBe("Apple Inc.");
    const fv = await financialView(h.db, row!.company!.id);
    expect(fv.annual.map((p) => p.periodEnd)).toEqual(["2025-09-27", "2024-09-28", "2023-09-30"]);
    expect(fv.annual[0]!.items.revenue!.value).toBe(1250);
    expect(fv.annualMetrics[0]!.revenueGrowthYoY.value).toBeCloseTo(1250 / 1100 - 1);

    const cmp = await comparisonRow(h.db, "AAPL");
    expect(cmp.found).toBe(true);
    if (cmp.found) {
      expect(cmp.marketCap).toBeGreaterThan(0); // close × 10 shares
      expect(cmp.pe).toBeCloseTo(cmp.marketCap! / (1250 * 0.25));
      expect(cmp.roe).toBeCloseTo((1250 * 0.25) / 500);
    }
    const tv = await technicalView(h.db, aapl!.id);
    expect(tv!.bars.length).toBeGreaterThan(200);
    expect(tv!.verification.bullish.checks).toHaveLength(3);
  });
});

describe("analysis helpers", () => {
  it("builds transparent health checks", async () => {
    const { buildStatements } = await import("@/lib/fundamentals/statements");
    const { computeHealthMetrics } = await import("@/lib/fundamentals/metrics");
    const periods = buildStatements(threeYears());
    const annual = periods.filter((p) => p.periodType === "annual");
    const checks = healthChecks(annual, annual.map((p) => computeHealthMetrics(p, periods)));
    const byKey = Object.fromEntries(checks.map((c) => [c.key, c.status]));
    expect(byKey).toMatchObject({ revenue_growth: "pass", margin_stability: "pass", fcf: "pass", liquidity: "pass", leverage: "pass", interest: "unknown", dilution: "unknown" });
    const ex = financialHealthExplainer(checks, annual[0]!.periodEnd);
    expect(ex.what.tag).toBe("calculation");
    expect(ex.bottomLine.text).toMatch(/could not be evaluated/);
    expect(financialHealthExplainer([], null).bottomLine.text).toBe("Data unavailable from the connected provider.");
    expect(isFinancialSic("6021")).toBe(true);
    expect(isFinancialSic("3571")).toBe(false);
  });

  it("assesses moat evidence with counterevidence and never invents qualitative evidence", () => {
    const hist = [0.6, 0.6, 0.59, 0.58].map((gm) => ({ grossMargin: { value: gm }, operatingMargin: { value: 0.3 } })) as never;
    const out = assessMoat(hist, { ticker: "X", revenue: 100, grossMargin: 0.6, operatingMargin: 0.3, rdIntensity: 0.1 }, [
      { ticker: "A", revenue: 50, grossMargin: 0.4, operatingMargin: 0.1, rdIntensity: 0.05 },
      { ticker: "B", revenue: 80, grossMargin: 0.35, operatingMargin: 0.15, rdIntensity: 0.02 },
    ]);
    expect(out[0]!.label).toBe("Strong supporting evidence");
    expect(out[1]!.label).toBe("Moderate supporting evidence");
    expect(out.find((m) => m.category === "Network effects")!.label).toBe("No reliable evidence found");
    const weak = assessMoat([0.45, 0.5, 0.55].map((gm) => ({ grossMargin: { value: gm }, operatingMargin: { value: 0.2 } })) as never, { ticker: "X", revenue: 10, grossMargin: 0.45, operatingMargin: 0.05, rdIntensity: null }, [{ ticker: "A", revenue: 50, grossMargin: 0.3, operatingMargin: 0.1, rdIntensity: null }]);
    expect(weak[0]!.label).toBe("Evidence weakening");
    expect(weak[0]!.counterevidence.join(" ")).toMatch(/fell/);
  });

  it("derives governance flags only from disclosures", () => {
    const flags = governanceFlags(
      [
        { eventType: "auditor_change", eventDate: "2025-12-01", description: "", filingAccession: "a" },
        { eventType: "non_reliance_restatement", eventDate: "2019-01-01", description: "", filingAccession: "b" }, // too old
        ...Array.from({ length: 4 }, (_, i) => ({ eventType: "leadership_or_board_change", eventDate: `2026-0${i + 1}-01`, description: "", filingAccession: `c${i}` })),
      ],
      "2026-10-02",
    );
    expect(flags.map((f) => f.flag)).toEqual(["Auditor change", "Frequent officer/director disclosures"]);
    expect(flags[1]!.basis).toMatch(/routine/);
  });
});
