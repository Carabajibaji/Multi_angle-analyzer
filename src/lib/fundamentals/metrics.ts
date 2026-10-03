/**
 * Financial-health calculations. Pure functions; every result records its formula and inputs.
 * A missing input yields `null` (shown as "Data unavailable"), never 0.
 */
import { daysBetween, type StatementPeriod } from "./statements";

export interface Derived {
  value: number | null;
  formula: string;
  inputs: string[];
  /** Explains caveats, e.g. a partial total or a non-meaningful sign. */
  note?: string;
}

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!num(numerator) || !num(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** Growth from `previous` to `current`. Undefined (null) when the base is missing, zero or negative. */
export function growth(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!num(current) || !num(previous) || previous <= 0) return null;
  return current / previous - 1;
}

export function freeCashFlow(operatingCashFlow: number | null | undefined, capex: number | null | undefined): number | null {
  if (!num(operatingCashFlow) || !num(capex)) return null;
  // capex is reported as a positive payment; guard against issuers that tag it negative.
  return operatingCashFlow - Math.abs(capex);
}

/** Compound annual growth rate over `years`. */
export function cagr(end: number | null | undefined, start: number | null | undefined, years: number): number | null {
  if (!num(end) || !num(start) || start <= 0 || end <= 0 || years <= 0) return null;
  return (end / start) ** (1 / years) - 1;
}

export interface HealthMetrics {
  periodEnd: string;
  periodType: StatementPeriod["periodType"];
  revenueGrowthYoY: Derived;
  grossProfit: Derived;
  grossMargin: Derived;
  operatingMargin: Derived;
  netMargin: Derived;
  freeCashFlow: Derived;
  freeCashFlowMargin: Derived;
  cashConversion: Derived;
  workingCapital: Derived;
  currentRatio: Derived;
  totalDebt: Derived;
  netDebt: Derived;
  debtToEquity: Derived;
  interestCoverage: Derived;
  dilutionYoY: Derived;
}

function v(p: StatementPeriod | undefined, metric: string): number | null {
  return p?.items[metric]?.value ?? null;
}

/** Find the comparable period one year earlier (same period type, end date 350–380 days before). */
export function priorYearPeriod(p: StatementPeriod, all: StatementPeriod[]): StatementPeriod | undefined {
  return all.find((q) => q.periodType === p.periodType && q !== p && (() => {
    const d = daysBetween(q.periodEnd, p.periodEnd);
    return d >= 350 && d <= 380;
  })());
}

export function computeHealthMetrics(p: StatementPeriod, all: StatementPeriod[]): HealthMetrics {
  const prev = priorYearPeriod(p, all);
  const revenue = v(p, "revenue");

  const reportedGP = v(p, "grossProfit");
  const derivedGP = num(revenue) && num(v(p, "costOfRevenue")) ? revenue - (v(p, "costOfRevenue") as number) : null;
  const gp = reportedGP ?? derivedGP;

  const fcf = freeCashFlow(v(p, "operatingCashFlow"), v(p, "capex"));

  const st = v(p, "shortTermDebt");
  const lt = v(p, "longTermDebt");
  const totalDebt = num(st) || num(lt) ? (st ?? 0) + (lt ?? 0) : null;
  const debtPartial = num(st) !== num(lt);
  const equity = v(p, "equity");

  return {
    periodEnd: p.periodEnd,
    periodType: p.periodType,
    revenueGrowthYoY: {
      value: growth(revenue, v(prev, "revenue")),
      formula: "Revenue ÷ revenue in the same period one year earlier − 1",
      inputs: ["revenue", "revenue (prior year)"],
      note: prev ? undefined : "No comparable prior-year period in stored filings.",
    },
    grossProfit: {
      value: gp,
      formula: reportedGP !== null ? "Reported gross profit" : "Revenue − cost of revenue",
      inputs: reportedGP !== null ? ["grossProfit"] : ["revenue", "costOfRevenue"],
      note: reportedGP === null && derivedGP !== null ? "Derived: the company does not tag gross profit directly." : undefined,
    },
    grossMargin: { value: ratio(gp, revenue), formula: "Gross profit ÷ revenue", inputs: ["grossProfit", "revenue"] },
    operatingMargin: { value: ratio(v(p, "operatingIncome"), revenue), formula: "Operating income ÷ revenue", inputs: ["operatingIncome", "revenue"] },
    netMargin: { value: ratio(v(p, "netIncome"), revenue), formula: "Net income ÷ revenue", inputs: ["netIncome", "revenue"] },
    freeCashFlow: {
      value: fcf,
      formula: "Free cash flow = operating cash flow − capital expenditures",
      inputs: ["operatingCashFlow", "capex"],
      note: "Capital expenditures = payments to acquire property, plant and equipment, as tagged by the company.",
    },
    freeCashFlowMargin: { value: ratio(fcf, revenue), formula: "Free cash flow ÷ revenue", inputs: ["freeCashFlow", "revenue"] },
    cashConversion: {
      value: num(v(p, "netIncome")) && (v(p, "netIncome") as number) > 0 ? ratio(v(p, "operatingCashFlow"), v(p, "netIncome")) : null,
      formula: "Operating cash flow ÷ net income",
      inputs: ["operatingCashFlow", "netIncome"],
      note: "Not meaningful when net income is zero or negative.",
    },
    workingCapital: {
      value: num(v(p, "currentAssets")) && num(v(p, "currentLiabilities")) ? (v(p, "currentAssets") as number) - (v(p, "currentLiabilities") as number) : null,
      formula: "Current assets − current liabilities",
      inputs: ["currentAssets", "currentLiabilities"],
    },
    currentRatio: { value: ratio(v(p, "currentAssets"), v(p, "currentLiabilities")), formula: "Current assets ÷ current liabilities", inputs: ["currentAssets", "currentLiabilities"] },
    totalDebt: {
      value: totalDebt,
      formula: "Short-term debt + long-term debt",
      inputs: ["shortTermDebt", "longTermDebt"],
      note: debtPartial ? "Only one debt component is tagged; the total may be understated." : undefined,
    },
    netDebt: {
      value: num(totalDebt) && num(v(p, "cash")) ? totalDebt - (v(p, "cash") as number) : null,
      formula: "Total debt − cash and cash equivalents",
      inputs: ["totalDebt", "cash"],
    },
    debtToEquity: {
      value: num(equity) && equity > 0 ? ratio(totalDebt, equity) : null,
      formula: "Total debt ÷ shareholders' equity",
      inputs: ["totalDebt", "equity"],
      note: num(equity) && equity <= 0 ? "Not meaningful: shareholders' equity is zero or negative (often due to buybacks)." : undefined,
    },
    interestCoverage: {
      value: ratio(v(p, "operatingIncome"), v(p, "interestExpense")),
      formula: "Operating income ÷ interest expense",
      inputs: ["operatingIncome", "interestExpense"],
    },
    dilutionYoY: {
      value: growth(v(p, "dilutedShares"), v(prev, "dilutedShares")),
      formula: "Diluted weighted-average shares ÷ prior-year diluted shares − 1",
      inputs: ["dilutedShares", "dilutedShares (prior year)"],
      note: "Positive = more shares (dilution); negative = fewer shares (e.g. buybacks).",
    },
  };
}
