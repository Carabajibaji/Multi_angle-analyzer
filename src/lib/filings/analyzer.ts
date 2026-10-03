/**
 * Deterministic filing & document analyzer.
 *
 * Uploaded or fetched text is treated strictly as DATA: it is parsed with regular expressions and never
 * executed, followed, or passed to any component as instructions. Instruction-like text is detected and
 * reported to the user as suspicious content. (When AI summaries are added, documents are passed inside a
 * delimited data block with a system instruction that the content is untrusted.)
 */
import { sha256 } from "../hash";

export const MAX_TEXT_CHARS = 2_000_000;
export const MAX_UPLOAD_BYTES = 1_000_000;

/* ------------------------------------------------------------------ */
/* HTML → text                                                         */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", bull: "•", hellip: "…", sect: "§", reg: "®", trade: "™", copy: "©" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  const looksHtml = /<(html|body|div|p|table|span|font)\b/i.test(html);
  let t = html;
  if (looksHtml) {
    t = t
      .replace(/<(script|style|head|title|ix:header)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " \t ")
      .replace(/<[^>]+>/g, " ");
  }
  t = decodeEntities(t)
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.slice(0, MAX_TEXT_CHARS);
}

/* ------------------------------------------------------------------ */
/* Document identification                                             */
/* ------------------------------------------------------------------ */

export interface DocumentIdentity {
  documentType: string | null;
  companyName: string | null;
  period: string | null;
  method: string;
}

export function identifyDocument(text: string): DocumentIdentity {
  const head = text.slice(0, 20_000);
  const form = /\bFORM\s+(10-K|10-Q|8-K|20-F|40-F|6-K|S-1)\b/i.exec(head)?.[1]?.toUpperCase() ?? (/SCHEDULE\s+14A/i.test(head) ? "DEF 14A (proxy statement)" : /earnings call|conference call transcript/i.test(head) ? "Earnings-call transcript" : null);
  const period = /(?:fiscal year|quarterly period|period)\s+ended\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/i.exec(head)?.[1] ?? /date of report[^\n]*?\n?\s*\(?([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/i.exec(head)?.[1] ?? null;
  const nameMatch = /\n\s*([^\n]{3,120})\n\s*\(Exact name of registrant/i.exec(head);
  return {
    documentType: form,
    companyName: nameMatch?.[1]?.trim() ?? null,
    period,
    method: "Detected from cover-page wording; unverified for pasted or uploaded text.",
  };
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export interface SectionDef {
  key: string;
  title: string;
  /** Regex source matching the heading at the start of a line. */
  heading: string;
}

export const TEN_K_SECTIONS: SectionDef[] = [
  { key: "item1", title: "Item 1. Business", heading: "item\\s*1\\.?\\s*[-–—:]?\\s*business" },
  { key: "item1a", title: "Item 1A. Risk Factors", heading: "item\\s*1a\\.?\\s*[-–—:]?\\s*risk\\s+factors" },
  { key: "item1c", title: "Item 1C. Cybersecurity", heading: "item\\s*1c\\.?\\s*[-–—:]?\\s*cybersecurity" },
  { key: "item3", title: "Item 3. Legal Proceedings", heading: "item\\s*3\\.?\\s*[-–—:]?\\s*legal\\s+proceedings" },
  { key: "item7", title: "Item 7. Management's Discussion and Analysis", heading: "item\\s*7\\.?\\s*[-–—:]?\\s*management.{0,3}s\\s+discussion" },
  { key: "item7a", title: "Item 7A. Market Risk", heading: "item\\s*7a\\.?\\s*[-–—:]?\\s*quantitative\\s+and\\s+qualitative" },
  { key: "item8", title: "Item 8. Financial Statements", heading: "item\\s*8\\.?\\s*[-–—:]?\\s*financial\\s+statements" },
  { key: "item9a", title: "Item 9A. Controls and Procedures", heading: "item\\s*9a\\.?\\s*[-–—:]?\\s*controls\\s+and\\s+procedures" },
];

export const TEN_Q_SECTIONS: SectionDef[] = [
  { key: "p1item2", title: "Part I, Item 2. MD&A", heading: "item\\s*2\\.?\\s*[-–—:]?\\s*management.{0,3}s\\s+discussion" },
  { key: "p1item4", title: "Part I, Item 4. Controls and Procedures", heading: "item\\s*4\\.?\\s*[-–—:]?\\s*controls\\s+and\\s+procedures" },
  { key: "p2item1", title: "Part II, Item 1. Legal Proceedings", heading: "item\\s*1\\.?\\s*[-–—:]?\\s*legal\\s+proceedings" },
  { key: "p2item1a", title: "Part II, Item 1A. Risk Factors", heading: "item\\s*1a\\.?\\s*[-–—:]?\\s*risk\\s+factors" },
];

export interface Section {
  key: string;
  title: string;
  start: number;
  text: string;
  words: number;
}

/**
 * Extract sections. Each heading usually appears twice (table of contents + body); we take the
 * occurrence followed by the longest body before the next known heading.
 */
export function extractSections(text: string, defs: SectionDef[]): Section[] {
  const hits: Array<{ def: SectionDef; index: number }> = [];
  for (const def of defs) {
    const re = new RegExp(`(^|\\n)\\s*${def.heading}`, "gi");
    for (let m = re.exec(text); m; m = re.exec(text)) hits.push({ def, index: m.index + m[1]!.length });
  }
  const anyItem = /(^|\n)\s*item\s*\d+[a-c]?\.?\s/gi;
  const itemStarts: number[] = [];
  for (let m = anyItem.exec(text); m; m = anyItem.exec(text)) itemStarts.push(m.index + m[1]!.length);
  const out = new Map<string, Section>();
  for (const h of hits) {
    const next = itemStarts.find((i) => i > h.index + 10) ?? text.length;
    const body = text.slice(h.index, next).trim();
    const prev = out.get(h.def.key);
    if (!prev || body.length > prev.text.length) out.set(h.def.key, { key: h.def.key, title: h.def.title, start: h.index, text: body, words: body.split(/\s+/).length });
  }
  return defs.map((d) => out.get(d.key)).filter((s): s is Section => !!s && s.words > 40);
}

/* ------------------------------------------------------------------ */
/* Flags & passages                                                    */
/* ------------------------------------------------------------------ */

export interface FlagRule {
  key: string;
  label: string;
  category: "accounting" | "liquidity" | "debt" | "governance" | "legal" | "operations";
  pattern: RegExp;
  severity: "risk" | "watch";
  plain: string;
}

export const FLAG_RULES: FlagRule[] = [
  { key: "material_weakness", label: "Material weakness in internal control", category: "accounting", pattern: /material weakness(es)?/gi, severity: "risk", plain: "A serious gap in the controls meant to catch accounting errors." },
  { key: "restatement", label: "Restatement / non-reliance", category: "accounting", pattern: /\brestate(d|ment)\b|should no longer be relied upon/gi, severity: "risk", plain: "Previously reported numbers were or will be corrected." },
  { key: "going_concern", label: "Going-concern doubt", category: "liquidity", pattern: /substantial doubt[^.]{0,80}going concern|going concern[^.]{0,80}substantial doubt/gi, severity: "risk", plain: "Management or auditors question whether the company can keep operating for the next year." },
  { key: "covenant", label: "Debt covenant issue", category: "debt", pattern: /\b(breach|violat\w*|waiver|not in compliance)\b[^.]{0,80}\bcovenants?\b|\bcovenants?\b[^.]{0,80}\b(breach|violat\w*|waiver|not in compliance)\b/gi, severity: "risk", plain: "Possible trouble meeting the conditions lenders attached to its debt." },
  { key: "default", label: "Debt default language", category: "debt", pattern: /\bevent of default\b[^.]{0,60}\b(occurred|exists|has been)\b|\bin default\b/gi, severity: "risk", plain: "Language suggesting a default on borrowing terms." },
  { key: "impairment", label: "Impairment charge", category: "accounting", pattern: /\bimpairment (charge|loss)/gi, severity: "watch", plain: "An asset was written down because it is worth less than recorded." },
  { key: "related_party", label: "Related-party transactions", category: "governance", pattern: /related[- ]party transactions?/gi, severity: "watch", plain: "Business dealings with insiders or affiliates; usually disclosed routinely but worth reading." },
  { key: "auditor_change", label: "Auditor change", category: "governance", pattern: /(dismiss\w*|resign\w*|change\w*)[^.]{0,60}(independent registered public accounting firm|certifying accountant)/gi, severity: "watch", plain: "The company changed or lost its external auditor." },
  { key: "cyber_incident", label: "Cybersecurity incident", category: "operations", pattern: /(cybersecurity|security) incident[^.]{0,80}(material|unauthorized access|ransomware)/gi, severity: "watch", plain: "Disclosure of a security breach or attack." },
  { key: "litigation", label: "Material litigation / investigation", category: "legal", pattern: /\b(subpoena|class action|securities litigation|investigation by the (SEC|Department of Justice|DOJ))\b/gi, severity: "watch", plain: "Lawsuits or government investigations that could cost money or reputation." },
  { key: "liquidity", label: "Liquidity pressure", category: "liquidity", pattern: /\b(insufficient|inadequate) (liquidity|cash)|may not be able to (fund|meet|repay)/gi, severity: "risk", plain: "Statements that cash may not cover obligations." },
];

export interface Passage {
  section: string;
  offset: number;
  text: string;
}

export interface FlagHit {
  key: string;
  label: string;
  category: FlagRule["category"];
  severity: FlagRule["severity"];
  plain: string;
  count: number;
  passages: Passage[];
}

function sentenceAround(text: string, index: number, len: number): string {
  const start = Math.max(text.lastIndexOf(". ", index) + 2, text.lastIndexOf("\n", index) + 1, index - 400, 0);
  let end = text.indexOf(". ", index + len);
  const nl = text.indexOf("\n", index + len);
  if (end === -1 || (nl !== -1 && nl < end)) end = nl === -1 ? text.length : nl;
  return text.slice(start, Math.min(end + 1, index + len + 400)).trim();
}

/** Negated mentions ("no material weakness", "did not identify any material weakness") are excluded. */
const NEGATION = /\b(no|not|none|neither|nor|without|did not identify any|have not identified any|there (were|was) no)\b[^.]{0,40}$/i;

export function findFlags(sections: Array<{ title: string; start: number; text: string }>): FlagHit[] {
  const hits: FlagHit[] = [];
  for (const rule of FLAG_RULES) {
    const passages: Passage[] = [];
    let count = 0;
    for (const s of sections) {
      rule.pattern.lastIndex = 0;
      for (let m = rule.pattern.exec(s.text); m; m = rule.pattern.exec(s.text)) {
        const before = s.text.slice(Math.max(0, m.index - 80), m.index);
        if (NEGATION.test(before)) continue;
        count++;
        if (passages.length < 3) passages.push({ section: s.title, offset: s.start + m.index, text: sentenceAround(s.text, m.index, m[0].length) });
      }
    }
    if (count) hits.push({ key: rule.key, label: rule.label, category: rule.category, severity: rule.severity, plain: rule.plain, count, passages });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* Facts vs management commentary                                      */
/* ------------------------------------------------------------------ */

const FORWARD = /\b(expect|expects|expected|anticipate\w*|believe\w*|intend\w*|plan|plans|planned|estimate\w*|project\w*|forecast\w*|outlook|guidance|may|could|would|should|will|aim\w*|target\w*|seek\w*)\b/i;
const NUMERIC_FACT = /(\$\s?\d[\d,.]*\s*(million|billion|thousand)?|\d[\d,.]*\s?%|\b\d{1,3}(,\d{3})+\b)/i;

export interface StatementSample {
  kind: "reported_fact" | "management_commentary";
  section: string;
  text: string;
}

export function classifySentences(sections: Section[], limit = 6): { facts: StatementSample[]; commentary: StatementSample[]; method: string } {
  const facts: StatementSample[] = [];
  const commentary: StatementSample[] = [];
  const narrative = sections.filter((s) => /md&a|management|business|risk/i.test(s.title));
  for (const s of narrative.length ? narrative : sections) {
    for (const raw of s.text.split(/(?<=[.!?])\s+(?=[A-Z])|\n+/)) {
      const t = raw.replace(/\s+/g, " ").trim();
      if (t.length < 60 || t.length > 400) continue;
      const fwd = FORWARD.test(t);
      const num = NUMERIC_FACT.test(t);
      if (num && !fwd && facts.length < limit) facts.push({ kind: "reported_fact", section: s.title, text: t });
      else if (fwd && commentary.length < limit) commentary.push({ kind: "management_commentary", section: s.title, text: t });
      if (facts.length >= limit && commentary.length >= limit) break;
    }
  }
  return {
    facts,
    commentary,
    method:
      "Heuristic: sentences with figures and no forward-looking words are labelled reported facts; sentences with words like “expect”, “believe”, “may” or “will” are labelled management commentary. Labels are approximate — always check the cited section.",
  };
}

/* ------------------------------------------------------------------ */
/* Prompt-injection / instruction detection                            */
/* ------------------------------------------------------------------ */

const INJECTION = /(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the )?(system|previous) (prompt|instructions)|you are (now )?(an? )?(ai|assistant|chatgpt|claude)\b|system prompt|reveal (your|the) (secret|api key|instructions)|act as (an? )?(admin|administrator|developer)|BEGIN (SYSTEM|INSTRUCTIONS))/gi;

export function detectInstructionText(text: string): Passage[] {
  const out: Passage[] = [];
  INJECTION.lastIndex = 0;
  for (let m = INJECTION.exec(text); m && out.length < 5; m = INJECTION.exec(text)) {
    if (out.length && m.index - out.at(-1)!.offset < 160) continue; // overlapping phrases → one passage
    out.push({ section: "Document", offset: m.index, text: text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80).replace(/\s+/g, " ") });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Comparison with a prior comparable document                         */
/* ------------------------------------------------------------------ */

function paragraphs(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of text.split(/\n{1,}/)) {
    const norm = p.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
    if (norm.split(" ").length >= 25) m.set(sha256(norm), p.trim());
  }
  return m;
}

export interface Comparison {
  priorLabel: string;
  sectionChanges: Array<{ title: string; currentWords: number; priorWords: number | null }>;
  newFlags: string[];
  resolvedFlags: string[];
  newRiskParagraphs: string[];
  removedRiskParagraphs: number;
}

export function compareAnalyses(current: { sections: Section[]; flags: FlagHit[] }, prior: { sections: Section[]; flags: FlagHit[] }, priorLabel: string): Comparison {
  const priorBy = new Map(prior.sections.map((s) => [s.key, s]));
  const riskKey = current.sections.find((s) => /risk factors/i.test(s.title))?.key;
  const curRisk = riskKey ? paragraphs(current.sections.find((s) => s.key === riskKey)!.text) : new Map<string, string>();
  const priorRiskSection = riskKey ? priorBy.get(riskKey) : undefined;
  const prevRisk = priorRiskSection ? paragraphs(priorRiskSection.text) : new Map<string, string>();
  const curFlags = new Set(current.flags.map((f) => f.label));
  const prevFlags = new Set(prior.flags.map((f) => f.label));
  return {
    priorLabel,
    sectionChanges: current.sections.map((s) => ({ title: s.title, currentWords: s.words, priorWords: priorBy.get(s.key)?.words ?? null })),
    newFlags: [...curFlags].filter((f) => !prevFlags.has(f)),
    resolvedFlags: [...prevFlags].filter((f) => !curFlags.has(f)),
    newRiskParagraphs: priorRiskSection ? [...curRisk].filter(([h]) => !prevRisk.has(h)).map(([, p]) => p).slice(0, 5) : [],
    removedRiskParagraphs: priorRiskSection ? [...prevRisk.keys()].filter((h) => !curRisk.has(h)).length : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export interface DocumentAnalysis {
  identity: DocumentIdentity;
  source: { kind: "sec_filing" | "user_text"; label: string; url: string | null; accessionNo: string | null; form: string | null; filedAt: string | null };
  characters: number;
  sections: Array<{ key: string; title: string; words: number; excerpt: string }>;
  flags: FlagHit[];
  statements: ReturnType<typeof classifySentences>;
  instructionLikeText: Passage[];
  comparison: Comparison | null;
  incomplete: string[];
  analyzedAt: string;
}

export function sectionDefsFor(form: string | null | undefined): SectionDef[] {
  if (!form) return [...TEN_K_SECTIONS];
  if (/^10-Q/.test(form)) return TEN_Q_SECTIONS;
  if (/^(10-K|20-F|40-F)/.test(form)) return TEN_K_SECTIONS;
  return [];
}

export function analyzeText(
  text: string,
  source: DocumentAnalysis["source"],
  opts: { form?: string | null; prior?: { text: string; label: string } } = {},
): DocumentAnalysis {
  const identity = identifyDocument(text);
  const form = opts.form ?? identity.documentType;
  const defs = sectionDefsFor(form);
  const sections = defs.length ? extractSections(text, defs) : [];
  const scanned = sections.length ? sections : [{ key: "full", title: "Full document", start: 0, text, words: text.split(/\s+/).length }];
  const flags = findFlags(scanned);
  const incomplete: string[] = [];
  if (defs.length && sections.length < Math.min(3, defs.length)) incomplete.push("Few standard section headings were found; the document may be an exhibit, a partial excerpt or unusually formatted. Flags were searched across all recognised text.");
  if (!defs.length) incomplete.push("This document type has no standard item structure; the whole text was scanned.");
  if (text.length >= MAX_TEXT_CHARS) incomplete.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters were analysed.`);
  let comparison: Comparison | null = null;
  if (opts.prior) {
    const pSections = defs.length ? extractSections(opts.prior.text, defs) : [];
    const pScanned = pSections.length ? pSections : [{ key: "full", title: "Full document", start: 0, text: opts.prior.text, words: 0 }];
    comparison = compareAnalyses({ sections, flags }, { sections: pSections, flags: findFlags(pScanned) }, opts.prior.label);
  }
  return {
    identity,
    source,
    characters: text.length,
    sections: sections.map((s) => ({ key: s.key, title: s.title, words: s.words, excerpt: s.text.slice(0, 600) })),
    flags,
    statements: classifySentences(sections.length ? sections : (scanned as Section[])),
    instructionLikeText: detectInstructionText(text),
    comparison,
    incomplete,
    analyzedAt: new Date().toISOString(),
  };
}
