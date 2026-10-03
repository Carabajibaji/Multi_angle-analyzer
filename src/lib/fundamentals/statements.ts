/**
 * Normalize reported XBRL facts into annual and quarterly statement periods.
 *
 * Rules (documented for users on the Financial Health page):
 *  - Periods are defined by reported duration facts: ~1 year (350–380 days) = annual, ~1 quarter (80–100 days) = quarterly.
 *  - Balance-sheet (instant) values are attached to a period when their date equals the period end.
 *  - For each metric the highest-priority tag with a value for that period wins (see mapping.ts).
 *  - If several filings report the same period (e.g. comparatives or restatements), the most recently filed value is used,
 *    and its accession number is kept so users can open the exact filing.
 *  - Missing metrics are omitted, never zero-filled.
 *  - Quarterly cash-flow values are often reported only year-to-date by issuers; such periods show cash flow as unavailable
 *    rather than deriving them by subtraction.
 */
import { METRICS, type MetricDef } from "./mapping";

export interface FactInput {
  taxonomy: string;
  tag: string;
  unit: string;
  value: number;
  periodStart: string | null;
  periodEnd: string;
  form: string;
  accessionNo: string;
  filedAt: string;
}

export interface LineItem {
  value: number;
  tag: string;
  unit: string;
  accessionNo: string;
  form: string;
  filedAt: string;
}

export interface StatementPeriod {
  periodType: "annual" | "quarterly";
  periodStart: string;
  periodEnd: string;
  currency: string;
  items: Record<string, LineItem>;
}

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

function periodTypeOf(start: string | null, end: string): "annual" | "quarterly" | null {
  if (!start) return null;
  const d = daysBetween(start, end);
  if (d >= 350 && d <= 380) return "annual";
  if (d >= 80 && d <= 100) return "quarterly";
  return null;
}

const isCurrencyUnit = (u: string) => /^[A-Z]{3}$/.test(u);

function unitMatches(def: MetricDef, unit: string, currency: string): boolean {
  if (def.unit === "currency") return unit === currency;
  if (def.unit === "shares") return unit === "shares";
  return unit === `${currency}/shares`;
}

function dominantCurrency(facts: FactInput[]): string {
  const counts = new Map<string, number>();
  for (const f of facts) if (isCurrencyUnit(f.unit)) counts.set(f.unit, (counts.get(f.unit) ?? 0) + 1);
  let best = "USD";
  let n = -1;
  for (const [u, c] of counts) if (c > n) [best, n] = [u, c];
  return best;
}

function newest(a: FactInput, b: FactInput): FactInput {
  if (a.filedAt !== b.filedAt) return a.filedAt > b.filedAt ? a : b;
  return a.accessionNo > b.accessionNo ? a : b;
}

export function buildStatements(facts: FactInput[], opts: { maxAnnual?: number; maxQuarterly?: number } = {}): StatementPeriod[] {
  const currency = dominantCurrency(facts);
  const byTag = new Map<string, FactInput[]>();
  for (const f of facts) {
    const key = `${f.taxonomy}:${f.tag}`;
    (byTag.get(key) ?? byTag.set(key, []).get(key)!).push(f);
  }

  // 1. Discover periods from duration facts of mapped metrics.
  const periods = new Map<string, { type: "annual" | "quarterly"; start: string; end: string }>();
  for (const def of METRICS) {
    if (def.periodKind !== "duration") continue;
    for (const tag of def.tags) {
      for (const f of byTag.get(tag) ?? []) {
        const type = periodTypeOf(f.periodStart, f.periodEnd);
        if (!type) continue;
        // One period per (type, end): if starts differ slightly (52/53-week years) keep the earliest-filed shape.
        const key = `${type}:${f.periodEnd}`;
        if (!periods.has(key)) periods.set(key, { type, start: f.periodStart!, end: f.periodEnd });
      }
    }
  }

  // 2. Resolve each metric for each period.
  const result: StatementPeriod[] = [];
  for (const p of periods.values()) {
    const items: Record<string, LineItem> = {};
    for (const def of METRICS) {
      for (const tag of def.tags) {
        let chosen: FactInput | undefined;
        for (const f of byTag.get(tag) ?? []) {
          if (!unitMatches(def, f.unit, currency) || f.periodEnd !== p.end) continue;
          if (def.periodKind === "duration") {
            if (periodTypeOf(f.periodStart, f.periodEnd) !== p.type) continue;
          } else if (f.periodStart !== null) continue;
          chosen = chosen ? newest(chosen, f) : f;
        }
        if (chosen) {
          items[def.metric] = { value: chosen.value, tag, unit: chosen.unit, accessionNo: chosen.accessionNo, form: chosen.form, filedAt: chosen.filedAt };
          break;
        }
      }
    }
    if (Object.keys(items).length) result.push({ periodType: p.type, periodStart: p.start, periodEnd: p.end, currency, items });
  }

  const annual = result.filter((r) => r.periodType === "annual").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, opts.maxAnnual ?? 6);
  const quarterly = result.filter((r) => r.periodType === "quarterly").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, opts.maxQuarterly ?? 8);
  return [...annual, ...quarterly];
}
