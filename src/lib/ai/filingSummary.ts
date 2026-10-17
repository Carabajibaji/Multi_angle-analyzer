/**
 * Build a grounded filing summary from the deterministic analysis (P# = quoted passages).
 * Only excerpts are sent (bounded size), never the whole filing.
 */
import type { Db } from "../db/client";
import type { DocumentAnalysis } from "../filings/analyzer";
import type { Explainer } from "./explainer";
import { FILING_SUMMARY, type FilingSummary } from "./prompts";
import { generateGrounded, latestSummary, type GroundedInput, type Ref } from "./service";

export const FILING_SUBJECT = "filing_summary";
const MAX_DATA_CHARS = 60_000; // ≈ 15k tokens

export function buildFilingInput(a: DocumentAnalysis): GroundedInput {
  const refs: Ref[] = [];
  const lines: string[] = [];
  let p = 0;
  const add = (label: string, text: string) => {
    const id = `P${++p}`;
    refs.push({ id, label, url: a.source.url });
    lines.push(`${id} [${label}]\n${text.replace(/\s+/g, " ").trim()}\n`);
  };
  lines.push(`Document: ${a.identity.companyName ?? "unknown company"} — ${a.identity.documentType ?? "unknown form"} — period ${a.identity.period ?? "unknown"} — ${a.source.label}\n`);
  for (const f of a.flags) for (const ps of f.passages) add(`${f.label} — ${ps.section}`, ps.text);
  for (const s of a.statements.facts) add(`Reported figure — ${s.section}`, s.text);
  for (const s of a.statements.commentary) add(`Management commentary — ${s.section}`, s.text);
  if (a.comparison) for (const para of a.comparison.newRiskParagraphs) add(`NEW vs prior filing (${a.comparison.priorLabel}) — risk factors`, para.slice(0, 1500));
  for (const s of a.sections) add(`Section excerpt — ${s.title}`, s.excerpt);
  let data = lines.join("\n");
  if (data.length > MAX_DATA_CHARS) data = data.slice(0, MAX_DATA_CHARS);
  const kept = refs.filter((r) => data.includes(`${r.id} [`));
  return {
    subjectType: FILING_SUBJECT,
    subjectKey: a.source.accessionNo ?? a.source.label,
    data,
    refs: kept,
    inputIds: { accessionNo: a.source.accessionNo, form: a.source.form, flags: a.flags.map((f) => f.key), sections: a.sections.map((s) => s.key) },
  };
}

export function generateFilingSummary(db: Db, explainer: Explainer, analysis: DocumentAnalysis, now = new Date()) {
  return generateGrounded<FilingSummary>(db, explainer, FILING_SUMMARY, buildFilingInput(analysis), now);
}

export const storedFilingSummary = (db: Db, accessionNo: string) => latestSummary<FilingSummary>(db, FILING_SUBJECT, accessionNo);
