/**
 * Analyze a stored SEC filing: fetch its primary document from EDGAR (sec.gov archive URLs only),
 * cache the extracted text in filing_sections, and compare with the previous filing of the same form.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, filings, filingSections } from "../db/schema";
import { sha256 } from "../hash";
import type { SecFilingsProvider } from "../providers/types";
import { analyzeText, htmlToText, type DocumentAnalysis } from "./analyzer";

async function filingText(db: Db, sec: SecFilingsProvider, filing: typeof filings.$inferSelect): Promise<string> {
  const [cached] = await db
    .select()
    .from(filingSections)
    .where(and(eq(filingSections.filingId, filing.id), eq(filingSections.sectionKey, "full_text")));
  if (cached) return cached.text;
  if (!filing.primaryDocUrl) throw new Error("This filing has no primary document link.");
  const res = await sec.getDocument(filing.primaryDocUrl);
  const text = htmlToText(res.data);
  await db
    .insert(filingSections)
    .values({ filingId: filing.id, sectionKey: "full_text", title: "Full text (extracted)", text, contentHash: sha256(text) })
    .onConflictDoNothing();
  return text;
}

export async function analyzeStoredFiling(db: Db, sec: SecFilingsProvider, accessionNo: string): Promise<DocumentAnalysis | null> {
  const [row] = await db
    .select({ filing: filings, company: companies })
    .from(filings)
    .innerJoin(companies, eq(companies.id, filings.companyId))
    .where(eq(filings.accessionNo, accessionNo));
  if (!row) return null;
  const { filing, company } = row;
  const text = await filingText(db, sec, filing);

  let prior: { text: string; label: string } | undefined;
  if (/^(10-K|10-Q|20-F|40-F)/.test(filing.form)) {
    const [prev] = await db
      .select()
      .from(filings)
      .where(and(eq(filings.companyId, company.id), eq(filings.form, filing.form), lt(filings.filedAt, filing.filedAt)))
      .orderBy(desc(filings.filedAt))
      .limit(1);
    if (prev) {
      try {
        prior = { text: await filingText(db, sec, prev), label: `${prev.form} filed ${prev.filedAt} (${prev.accessionNo})` };
      } catch {
        prior = undefined; // comparison is optional; the main analysis still stands
      }
    }
  }

  const analysis = analyzeText(
    text,
    { kind: "sec_filing", label: `${company.name} ${filing.form} filed ${filing.filedAt}`, url: filing.primaryDocUrl, accessionNo: filing.accessionNo, form: filing.form, filedAt: filing.filedAt },
    { form: filing.form, prior },
  );
  // The SEC index is authoritative for identity; cover-page detection is only a fallback.
  analysis.identity = { documentType: filing.form, companyName: company.name, period: filing.reportDate, method: "From SEC EDGAR filing index (authoritative)." };
  if (!prior && /^(10-K|10-Q)/.test(filing.form)) analysis.incomplete.push("No earlier filing of the same form is stored, so period-over-period changes are not shown.");
  return analysis;
}
