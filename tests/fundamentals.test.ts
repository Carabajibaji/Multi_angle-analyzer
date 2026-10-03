import { describe, expect, it } from "vitest";
import { cagr, computeHealthMetrics, freeCashFlow, growth, ratio } from "@/lib/fundamentals/metrics";
import { buildStatements, type FactInput } from "@/lib/fundamentals/statements";

const f = (tag: string, value: number, end: string, start: string | null, accn = "0000000000-24-000001", filedAt = "2024-11-01", unit = "USD", taxonomy = "us-gaap"): FactInput => ({
  taxonomy,
  tag,
  unit,
  value,
  periodStart: start,
  periodEnd: end,
  form: "10-K",
  accessionNo: accn,
  filedAt,
});

const FIXTURE: FactInput[] = [
  // FY2024 (Oct–Sep fiscal year)
  f("RevenueFromContractWithCustomerExcludingAssessedTax", 1200, "2024-09-28", "2023-10-01"),
  f("Revenues", 9999, "2024-09-28", "2023-10-01"), // lower-priority tag: must be ignored
  f("CostOfGoodsAndServicesSold", 700, "2024-09-28", "2023-10-01"),
  f("OperatingIncomeLoss", 300, "2024-09-28", "2023-10-01"),
  f("NetIncomeLoss", 240, "2024-09-28", "2023-10-01"),
  f("NetCashProvidedByUsedInOperatingActivities", 350, "2024-09-28", "2023-10-01"),
  f("PaymentsToAcquirePropertyPlantAndEquipment", 50, "2024-09-28", "2023-10-01"),
  f("AssetsCurrent", 500, "2024-09-28", null),
  f("LiabilitiesCurrent", 400, "2024-09-28", null),
  f("LongTermDebtNoncurrent", 300, "2024-09-28", null),
  f("StockholdersEquity", 600, "2024-09-28", null),
  f("CashAndCashEquivalentsAtCarryingValue", 100, "2024-09-28", null),
  f("WeightedAverageNumberOfDilutedSharesOutstanding", 98, "2024-09-28", "2023-10-01", undefined, undefined, "shares"),
  // FY2023: originally reported 1000, restated to 1010 in the later filing
  f("RevenueFromContractWithCustomerExcludingAssessedTax", 1000, "2023-09-30", "2022-10-02", "0000000000-23-000001", "2023-11-03"),
  f("RevenueFromContractWithCustomerExcludingAssessedTax", 1010, "2023-09-30", "2022-10-02", "0000000000-24-000001", "2024-11-01"),
  f("WeightedAverageNumberOfDilutedSharesOutstanding", 100, "2023-09-30", "2022-10-02", "0000000000-23-000001", "2023-11-03", "shares"),
  // A quarter
  f("RevenueFromContractWithCustomerExcludingAssessedTax", 310, "2024-06-29", "2024-03-31", "0000000000-24-000002", "2024-08-02"),
  // A nine-month YTD value: neither annual nor quarterly -> ignored
  f("RevenueFromContractWithCustomerExcludingAssessedTax", 900, "2024-06-29", "2023-10-01", "0000000000-24-000002", "2024-08-02"),
];

describe("buildStatements", () => {
  const periods = buildStatements(FIXTURE);
  const fy24 = periods.find((p) => p.periodType === "annual" && p.periodEnd === "2024-09-28")!;
  const fy23 = periods.find((p) => p.periodType === "annual" && p.periodEnd === "2023-09-30")!;
  const q = periods.find((p) => p.periodType === "quarterly")!;

  it("classifies annual and quarterly periods and ignores YTD durations", () => {
    expect(periods.filter((p) => p.periodType === "annual")).toHaveLength(2);
    expect(periods.filter((p) => p.periodType === "quarterly")).toHaveLength(1);
    expect(q.items.revenue!.value).toBe(310);
  });
  it("uses tag priority and records the chosen tag + accession", () => {
    expect(fy24.items.revenue).toMatchObject({ value: 1200, tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", accessionNo: "0000000000-24-000001" });
  });
  it("prefers the most recently filed value for a period (restatements)", () => {
    expect(fy23.items.revenue!.value).toBe(1010);
  });
  it("attaches balance-sheet instants by period end and never zero-fills", () => {
    expect(fy24.items.currentAssets!.value).toBe(500);
    expect(fy24.items.shortTermDebt).toBeUndefined();
    expect(fy23.items.currentAssets).toBeUndefined();
  });
});

describe("health metrics", () => {
  const periods = buildStatements(FIXTURE);
  const fy24 = periods.find((p) => p.periodEnd === "2024-09-28")!;
  const m = computeHealthMetrics(fy24, periods);

  it("calculates growth, margins and free cash flow", () => {
    expect(m.revenueGrowthYoY.value).toBeCloseTo(1200 / 1010 - 1);
    expect(m.grossProfit.value).toBe(500); // derived: revenue − cost
    expect(m.grossProfit.note).toMatch(/Derived/);
    expect(m.grossMargin.value).toBeCloseTo(500 / 1200);
    expect(m.operatingMargin.value).toBeCloseTo(0.25);
    expect(m.netMargin.value).toBeCloseTo(0.2);
    expect(m.freeCashFlow.value).toBe(300);
    expect(m.freeCashFlowMargin.value).toBeCloseTo(0.25);
    expect(m.cashConversion.value).toBeCloseTo(350 / 240);
  });
  it("calculates liquidity and leverage with partial-data notes", () => {
    expect(m.currentRatio.value).toBeCloseTo(1.25);
    expect(m.workingCapital.value).toBe(100);
    expect(m.totalDebt.value).toBe(300);
    expect(m.totalDebt.note).toMatch(/understated/);
    expect(m.debtToEquity.value).toBeCloseTo(0.5);
    expect(m.netDebt.value).toBe(200);
    expect(m.dilutionYoY.value).toBeCloseTo(-0.02);
  });
  it("returns null (not 0) when inputs are missing", () => {
    expect(m.interestCoverage.value).toBeNull();
    const fy23 = periods.find((p) => p.periodEnd === "2023-09-30")!;
    const m23 = computeHealthMetrics(fy23, periods);
    expect(m23.revenueGrowthYoY.value).toBeNull();
    expect(m23.freeCashFlow.value).toBeNull();
  });
});

describe("primitive formulas", () => {
  it("guards division and negative bases", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(null, 2)).toBeNull();
    expect(growth(10, -5)).toBeNull();
    expect(growth(110, 100)).toBeCloseTo(0.1);
    expect(freeCashFlow(100, -30)).toBe(70); // tolerate negative-signed capex
    expect(freeCashFlow(100, null)).toBeNull();
    expect(cagr(121, 100, 2)).toBeCloseTo(0.1);
  });
  it("marks D/E not meaningful with negative equity", () => {
    const periods = buildStatements([
      f("RevenueFromContractWithCustomerExcludingAssessedTax", 100, "2024-12-31", "2024-01-01"),
      f("LongTermDebtNoncurrent", 50, "2024-12-31", null),
      f("StockholdersEquity", -10, "2024-12-31", null),
    ]);
    const m = computeHealthMetrics(periods[0]!, periods);
    expect(m.debtToEquity.value).toBeNull();
    expect(m.debtToEquity.note).toMatch(/negative/);
  });
});
