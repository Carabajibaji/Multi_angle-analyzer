/**
 * Governance flags derived only from stored SEC 8-K item disclosures. A flag describes a disclosure,
 * never misconduct.
 */
export interface GovEvent {
  eventType: string;
  eventDate: string;
  description: string;
  filingAccession: string | null;
}

export interface GovFlag {
  flag: string;
  severity: "info" | "watch" | "risk";
  evidence: string;
  basis: string;
}

export function governanceFlags(events: GovEvent[], asOf: string): GovFlag[] {
  const yearsAgo = (n: number) => `${Number(asOf.slice(0, 4)) - n}${asOf.slice(4)}`;
  const within = (e: GovEvent, years: number) => e.eventDate >= yearsAgo(years);
  const flags: GovFlag[] = [];
  const auditor = events.filter((e) => e.eventType === "auditor_change" && within(e, 3));
  if (auditor.length) flags.push({ flag: "Auditor change", severity: "watch", evidence: `${auditor.length} Item 4.01 filing(s) since ${yearsAgo(3)} (latest ${auditor[0]!.eventDate}).`, basis: "Form 8-K Item 4.01. Auditor changes are often routine; the filing states whether there were disagreements." });
  const nonReliance = events.filter((e) => e.eventType === "non_reliance_restatement" && within(e, 5));
  if (nonReliance.length) flags.push({ flag: "Prior financial statements should no longer be relied upon", severity: "risk", evidence: `${nonReliance.length} Item 4.02 filing(s) since ${yearsAgo(5)} (latest ${nonReliance[0]!.eventDate}).`, basis: "Form 8-K Item 4.02 (non-reliance), which precedes a restatement." });
  const leadership = events.filter((e) => e.eventType === "leadership_or_board_change" && within(e, 2));
  if (leadership.length >= 4)
    flags.push({ flag: "Frequent officer/director disclosures", severity: "watch", evidence: `${leadership.length} Item 5.02 filings in 2 years.`, basis: "Item 5.02 also covers routine elections and pay arrangements; read the filings before concluding there is turnover." });
  const control = events.filter((e) => e.eventType === "change_in_control" && within(e, 5));
  if (control.length) flags.push({ flag: "Change in control disclosed", severity: "watch", evidence: `Latest ${control[0]!.eventDate}.`, basis: "Form 8-K Item 5.01." });
  const cyber = events.filter((e) => e.eventType === "cybersecurity_incident" && within(e, 3));
  if (cyber.length) flags.push({ flag: "Material cybersecurity incident disclosed", severity: "risk", evidence: `Latest ${cyber[0]!.eventDate}.`, basis: "Form 8-K Item 1.05." });
  const listing = events.filter((e) => e.eventType === "listing_notice" && within(e, 3));
  if (listing.length) flags.push({ flag: "Listing-standard notice", severity: "risk", evidence: `Latest ${listing[0]!.eventDate}.`, basis: "Form 8-K Item 3.01." });
  return flags;
}

/** Governance facts that require proxy-statement extraction (not yet automated). */
export const GOVERNANCE_NOT_YET_EXTRACTED = [
  "Board size and independent-director ratio",
  "Whether the CEO also chairs the board",
  "Audit, compensation and nominating committee membership",
  "Director tenure, backgrounds and other board seats",
  "Executive compensation and insider ownership",
  "Dual-class share structure and controlling shareholders",
  "Related-party transactions",
];
