/**
 * Plain-English explainers built deterministically from calculated values (no AI). Each part is tagged
 * as fact, calculation, interpretation, risk or unknown.
 */
import type { HealthCheck } from "./health";

export type ExplainTag = "fact" | "calculation" | "interpretation" | "risk" | "unknown";

export interface Explainer {
  what: { text: string; tag: ExplainTag };
  why: { text: string; tag: ExplainTag };
  analogy: { text: string; tag: ExplainTag } | null;
  bottomLine: { text: string; tag: ExplainTag };
}

export function financialHealthExplainer(checks: HealthCheck[], periodEnd: string | null): Explainer {
  const pass = checks.filter((c) => c.status === "pass").map((c) => c.name.toLowerCase());
  const fail = checks.filter((c) => c.status === "fail").map((c) => c.name.toLowerCase());
  const unknown = checks.filter((c) => c.status === "unknown").length;
  if (!periodEnd || checks.length === 0) {
    return {
      what: { text: "No reported financial statements are stored for this company yet.", tag: "unknown" },
      why: { text: "Without filings we cannot judge revenue, profits, cash or debt.", tag: "unknown" },
      analogy: null,
      bottomLine: { text: "Data unavailable from the connected provider.", tag: "unknown" },
    };
  }
  return {
    what: {
      text: `Based on the fiscal year ending ${periodEnd}, ${checks.length - unknown} of ${checks.length} health checks could be evaluated: ${pass.length} passed${fail.length ? `, ${fail.length} failed (${fail.join(", ")})` : ""}.`,
      tag: "calculation",
    },
    why: {
      text: "Growth, steady margins, real cash generation and manageable debt together determine how well a business can absorb a bad year and keep investing.",
      tag: "interpretation",
    },
    analogy: {
      text: "Think of a household: revenue is the paycheck, free cash flow is what's left after bills and home repairs, and the current ratio is whether the checking account covers this month's bills.",
      tag: "interpretation",
    },
    bottomLine: {
      text: fail.length
        ? `Mixed picture: strengths in ${pass.join(", ") || "no measured area"}; areas to investigate: ${fail.join(", ")}. These are past results from filings, not a forecast.`
        : `No measured check failed for this period${unknown ? `, but ${unknown} could not be evaluated` : ""}. Past filings do not guarantee future results.`,
      tag: fail.length ? "risk" : "interpretation",
    },
  };
}
