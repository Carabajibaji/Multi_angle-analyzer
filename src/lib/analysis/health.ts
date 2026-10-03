/**
 * Financial Health Check: transparent pass / watch / fail / unknown checks with stated thresholds.
 * No hidden composite score. Banks, insurers and REITs get a warning that standard ratios may mislead.
 */
import type { HealthMetrics } from "../fundamentals/metrics";
import type { StatementPeriod } from "../fundamentals/statements";

export type CheckStatus = "pass" | "watch" | "fail" | "unknown";

export interface HealthCheck {
  key: string;
  name: string;
  status: CheckStatus;
  rule: string;
  value: string;
  why: string;
}

const pct = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const x = (v: number | null | undefined) => (v == null ? "n/a" : `${v.toFixed(2)}×`);

function band(v: number | null, passIf: (n: number) => boolean, watchIf: (n: number) => boolean): CheckStatus {
  if (v == null) return "unknown";
  if (passIf(v)) return "pass";
  if (watchIf(v)) return "watch";
  return "fail";
}

/** SIC 6000–6799: finance, insurance, real estate. */
export function isFinancialSic(sic: string | null | undefined): boolean {
  const n = Number(sic);
  return Number.isFinite(n) && n >= 6000 && n <= 6799;
}

export function healthChecks(annual: StatementPeriod[], metrics: HealthMetrics[]): HealthCheck[] {
  // annual & metrics are newest-first and aligned
  const latest = metrics[0];
  const margins = metrics.slice(0, 5).map((m) => m.grossMargin.value).filter((v): v is number => v != null);
  const fcfs = metrics.slice(0, 5).map((m) => m.freeCashFlow.value).filter((v): v is number => v != null);
  const mean = margins.length ? margins.reduce((s, v) => s + v, 0) / margins.length : null;
  const sd = mean != null && margins.length >= 3 ? Math.sqrt(margins.reduce((s, v) => s + (v - mean) ** 2, 0) / margins.length) : null;
  const fcfPositiveYears = fcfs.filter((v) => v > 0).length;

  return [
    {
      key: "revenue_growth",
      name: "Revenue growth",
      status: band(latest?.revenueGrowthYoY.value ?? null, (n) => n > 0.03, (n) => n >= -0.03),
      rule: "Pass: latest fiscal-year revenue grew > 3%. Watch: between −3% and +3%. Fail: fell > 3%.",
      value: pct(latest?.revenueGrowthYoY.value),
      why: "A shrinking top line makes it harder to grow profits over time.",
    },
    {
      key: "margin_stability",
      name: "Gross-margin stability",
      status: sd == null ? "unknown" : sd <= 0.02 ? "pass" : sd <= 0.05 ? "watch" : "fail",
      rule: "Standard deviation of annual gross margin over up to 5 years. Pass ≤ 2 pts, watch ≤ 5 pts, fail > 5 pts (needs ≥ 3 years).",
      value: sd == null ? `n/a (${margins.length} year(s) available)` : `${(sd * 100).toFixed(1)} pts across ${margins.length} years`,
      why: "Stable margins suggest pricing power and predictable costs; swings suggest cyclicality or competition.",
    },
    {
      key: "fcf",
      name: "Positive, sustained free cash flow",
      status: fcfs.length === 0 ? "unknown" : (fcfs[0] ?? 0) > 0 && fcfPositiveYears >= Math.min(3, fcfs.length) ? "pass" : (fcfs[0] ?? 0) > 0 ? "watch" : "fail",
      rule: "Pass: latest year positive and positive in at least 3 of the last up-to-5 years. Watch: latest positive only. Fail: latest negative.",
      value: fcfs.length ? `${fcfPositiveYears} of ${fcfs.length} years positive` : "n/a",
      why: "Free cash flow is the cash left after investing in the business; it funds dividends, buybacks and debt repayment.",
    },
    {
      key: "liquidity",
      name: "Liquidity (current ratio)",
      status: band(latest?.currentRatio.value ?? null, (n) => n >= 1.2, (n) => n >= 0.8),
      rule: "Pass ≥ 1.2×, watch 0.8–1.2×, fail < 0.8×.",
      value: x(latest?.currentRatio.value),
      why: "Shows whether short-term assets cover bills due within a year. Some strong companies run below 1× by design.",
    },
    {
      key: "leverage",
      name: "Leverage (debt-to-equity)",
      status: band(latest?.debtToEquity.value ?? null, (n) => n <= 1, (n) => n <= 2),
      rule: "Pass ≤ 1.0×, watch 1–2×, fail > 2×. Not meaningful when equity is negative.",
      value: latest?.debtToEquity.value == null ? (latest?.debtToEquity.note ?? "n/a") : x(latest.debtToEquity.value),
      why: "More debt raises fixed obligations and risk in downturns.",
    },
    {
      key: "interest",
      name: "Interest burden (coverage)",
      status: band(latest?.interestCoverage.value ?? null, (n) => n >= 5, (n) => n >= 2),
      rule: "Operating income ÷ interest expense. Pass ≥ 5×, watch 2–5×, fail < 2×.",
      value: x(latest?.interestCoverage.value),
      why: "Low coverage means a large share of profit goes to lenders.",
    },
    {
      key: "dilution",
      name: "Share dilution",
      status: band(latest?.dilutionYoY.value ?? null, (n) => n <= 0.01, (n) => n <= 0.03),
      rule: "Change in diluted share count vs prior year. Pass ≤ +1%, watch +1–3%, fail > +3%.",
      value: pct(latest?.dilutionYoY.value),
      why: "Issuing more shares shrinks each existing shareholder's slice of the company.",
    },
  ].map((c) => ({ ...c, status: c.status as CheckStatus })).filter(() => annual.length > 0);
}
