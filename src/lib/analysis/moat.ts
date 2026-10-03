/**
 * Economic-moat evidence from reported financial data only. Each category lists evidence AND
 * counterevidence; categories that financial statements cannot measure say so explicitly.
 * Stock performance and brand recognition are never used as evidence.
 */
import type { HealthMetrics } from "../fundamentals/metrics";

export type MoatLabel = "Strong supporting evidence" | "Moderate supporting evidence" | "Limited evidence" | "No reliable evidence found" | "Evidence weakening";

export interface MoatCategory {
  category: string;
  label: MoatLabel;
  evidence: string[];
  counterevidence: string[];
  method: string;
}

export interface PeerMetricRow {
  ticker: string;
  revenue: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  rdIntensity: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pts = (v: number) => `${(v * 100).toFixed(1)}%`;

export function assessMoat(history: HealthMetrics[], self: PeerMetricRow, peers: PeerMetricRow[]): MoatCategory[] {
  const gm = history.map((m) => m.grossMargin.value).filter((v): v is number => v != null); // newest first
  const om = history.map((m) => m.operatingMargin.value).filter((v): v is number => v != null);
  const peerGm = median(peers.map((p) => p.grossMargin).filter((v): v is number => v != null));
  const peerOm = median(peers.map((p) => p.operatingMargin).filter((v): v is number => v != null));
  const peerRev = median(peers.map((p) => p.revenue).filter((v): v is number => v != null));
  const out: MoatCategory[] = [];

  // Pricing power (consistent with brand / IP / switching costs, but does not prove which)
  {
    const evidence: string[] = [];
    const counter: string[] = [];
    const above = peerGm != null && self.grossMargin != null ? self.grossMargin - peerGm : null;
    if (above != null) (above >= 0.1 ? evidence : above < 0 ? counter : evidence).push(`Gross margin ${pts(self.grossMargin!)} vs peer median ${pts(peerGm!)} (${above >= 0 ? "+" : ""}${(above * 100).toFixed(1)} pts).`);
    if (gm.length >= 3) {
      const trend = gm[0]! - gm[gm.length - 1]!;
      (trend >= -0.02 ? evidence : counter).push(`Gross margin ${trend >= 0 ? "rose" : "fell"} ${(Math.abs(trend) * 100).toFixed(1)} pts over ${gm.length} years.`);
    }
    let label: MoatLabel = "No reliable evidence found";
    if (above != null && gm.length >= 3) {
      const trend = gm[0]! - gm[gm.length - 1]!;
      if (above >= 0.1 && trend >= -0.02 && gm.length >= 4) label = "Strong supporting evidence";
      else if (above >= 0.1 && trend < -0.03) label = "Evidence weakening";
      else if (above >= 0.05) label = "Moderate supporting evidence";
      else label = "Limited evidence";
    } else if (above != null || gm.length) label = "Limited evidence";
    out.push({
      category: "Pricing power (brand, intellectual property or switching costs)",
      label,
      evidence,
      counterevidence: counter,
      method: "Sustained gross margin ≥ 10 pts above the peer median for 4+ years without a > 2-pt decline. High margins are consistent with several moat types but do not identify which one.",
    });
  }

  // Scale / cost advantage
  {
    const evidence: string[] = [];
    const counter: string[] = [];
    if (peerRev != null && self.revenue != null) (self.revenue > peerRev ? evidence : counter).push(`Revenue ${self.revenue > peerRev ? "above" : "below"} the peer median.`);
    if (peerOm != null && self.operatingMargin != null) (self.operatingMargin > peerOm ? evidence : counter).push(`Operating margin ${pts(self.operatingMargin)} vs peer median ${pts(peerOm)}.`);
    if (om.length >= 3 && om[0]! < om[om.length - 1]! - 0.03) counter.push(`Operating margin fell ${((om[om.length - 1]! - om[0]!) * 100).toFixed(1)} pts over ${om.length} years.`);
    const label: MoatLabel =
      evidence.length === 2 && counter.length === 0 ? "Moderate supporting evidence" : evidence.length === 2 ? "Evidence weakening" : evidence.length === 1 ? "Limited evidence" : "No reliable evidence found";
    out.push({ category: "Scale and cost advantage", label, evidence, counterevidence: counter, method: "Larger than the peer median by revenue AND a higher operating margin, without a > 3-pt margin decline." });
  }

  // R&D intensity (intellectual property inputs, not outputs)
  {
    const evidence: string[] = [];
    const counter: string[] = [];
    const peerRd = median(peers.map((p) => p.rdIntensity).filter((v): v is number => v != null));
    if (self.rdIntensity != null && peerRd != null) (self.rdIntensity >= peerRd ? evidence : counter).push(`R&D is ${pts(self.rdIntensity)} of revenue vs peer median ${pts(peerRd)}.`);
    out.push({
      category: "Intellectual property (R&D investment)",
      label: evidence.length ? "Limited evidence" : "No reliable evidence found",
      evidence,
      counterevidence: counter,
      method: "R&D spending is an input, not proof of protected IP. Patents and litigation outcomes require document review.",
    });
  }

  for (const category of ["Network effects", "Switching costs (direct)", "Distribution", "Regulatory advantage", "Data advantage"]) {
    out.push({
      category,
      label: "No reliable evidence found",
      evidence: [],
      counterevidence: [],
      method: "Cannot be measured from reported financial statements. Requires qualitative evidence from filings (e.g. 10-K Item 1 Business) — planned for the filing-analysis layer.",
    });
  }
  return out;
}
