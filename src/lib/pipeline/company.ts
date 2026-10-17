/**
 * Company / SEC ingestion: CIK linking, profile, filings, governance events from 8-K items,
 * XBRL facts → normalized statements → financial-health report.
 *
 * Fundamentals are re-fetched only when a new periodic filing (10-K/10-Q/20-F/40-F or amendments)
 * or an 8-K Item 2.02 earnings release appears, or when facts were never loaded.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { analysisReports, companies, filings, financialFacts, financialStatements, governanceEvents, securities } from "../db/schema";
import { fingerprint } from "../hash";
import { computeHealthMetrics } from "../fundamentals/metrics";
import { MAPPED_TAGS, METRIC_BY_NAME, TAG_TO_METRIC } from "../fundamentals/mapping";
import { buildStatements } from "../fundamentals/statements";
import type { JobContext } from "../jobs/runner";
import type { CompanySubmissions, FilingRecord, TickerMapEntry } from "../providers/types";
import { getDataset, markAttempt, markFailure, markSuccess, recordSource, STALE_AFTER } from "./store";

/** Official SEC Form 8-K item titles (used verbatim; no interpretation). */
export const EIGHT_K_ITEMS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.05": "Material Cybersecurity Incidents",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03": "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement of a Registrant",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02": "Non-Reliance on Previously Issued Financial Statements or a Related Audit Report or Completed Interim Review",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

/** 8-K items that are governance-relevant, mapped to a neutral event type. */
export const GOVERNANCE_ITEMS: Record<string, string> = {
  "5.02": "leadership_or_board_change",
  "4.01": "auditor_change",
  "4.02": "non_reliance_restatement",
  "5.01": "change_in_control",
  "5.03": "charter_or_bylaw_amendment",
  "5.07": "shareholder_vote_results",
  "1.05": "cybersecurity_incident",
  "3.01": "listing_notice",
};

const PERIODIC_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const STORED_FORMS = new Set([...PERIODIC_FORMS, "8-K", "8-K/A", "DEF 14A", "DEFA14A", "6-K", "S-1", "S-3", "4", "SC 13D", "SC 13G", "SC 13D/A", "SC 13G/A"]);

export function needsFundamentalsRefresh(newFilings: FilingRecord[]): boolean {
  return newFilings.some((f) => PERIODIC_FORMS.has(f.form) || (f.form.startsWith("8-K") && f.items.includes("2.02")));
}

/**
 * Store the full SEC ticker list (untracked) so users can search any SEC-registered company.
 * Untracked companies have no data until someone requests analysis or an admin tracks them.
 */
export async function syncTickerDirectory(ctx: JobContext, map: TickerMapEntry[]): Promise<number> {
  const key = "reference:sec-tickers";
  await markAttempt(ctx.db, { key, kind: "reference", provider: "sec_edgar", staleAfterSeconds: STALE_AFTER.reference }, ctx.now);
  const byCik = new Map<string, TickerMapEntry>();
  for (const e of map) if (!byCik.has(e.cik)) byCik.set(e.cik, e);
  const cos = [...byCik.values()];
  await ctx.db.transaction(async (tx) => {
    for (let i = 0; i < cos.length; i += 500) {
      await tx
        .insert(companies)
        .values(cos.slice(i, i + 500).map((e) => ({ cik: e.cik, name: e.title })))
        .onConflictDoNothing();
    }
    const ids = new Map((await tx.select({ id: companies.id, cik: companies.cik }).from(companies)).map((c) => [c.cik, c.id]));
    for (let i = 0; i < map.length; i += 500) {
      await tx
        .insert(securities)
        .values(map.slice(i, i + 500).map((e) => ({ ticker: e.ticker, name: e.title, assetType: "stock", companyId: ids.get(e.cik) ?? null })))
        .onConflictDoNothing();
    }
    // Attach existing (e.g. config-created) securities that were not yet linked.
    const byTicker = new Map(map.map((e) => [e.ticker, e]));
    const unlinked = await tx.select({ id: securities.id, ticker: securities.ticker }).from(securities).where(and(isNull(securities.companyId), eq(securities.assetType, "stock")));
    for (const u of unlinked) {
      const e = byTicker.get(u.ticker);
      const cid = e ? ids.get(e.cik) : undefined;
      if (cid) await tx.update(securities).set({ companyId: cid, name: e!.title }).where(eq(securities.id, u.id));
    }
  });
  await markSuccess(ctx.db, key, ctx.now, { changed: true, dataAsOf: ctx.now.toISOString().slice(0, 10), recordCount: map.length });
  ctx.log(`SEC ticker directory: ${map.length} tickers, ${cos.length} companies.`);
  return map.length;
}

/** A company is tracked whenever one of its securities is tracked. */
export async function syncCompanyTracking(ctx: Pick<JobContext, "db">): Promise<void> {
  await ctx.db.execute(sql`UPDATE companies SET tracked = true WHERE tracked = false AND id IN (SELECT company_id FROM securities WHERE tracked = true AND company_id IS NOT NULL)`);
}

/** Attach tracked stock securities to SEC companies (by CIK), creating company rows as needed. */
export async function linkTrackedCompanies(ctx: JobContext, tickerMap?: TickerMapEntry[]): Promise<number> {
  const unlinked = await ctx.db
    .select()
    .from(securities)
    .where(and(eq(securities.tracked, true), eq(securities.assetType, "stock"), isNull(securities.companyId)));
  if (unlinked.length === 0) return 0;
  let map = tickerMap;
  if (!map) {
    const res = await ctx.providers.sec.getTickerMap();
    await recordSource(ctx.db, res.source);
    map = res.data;
  }
  const byTicker = new Map(map.map((e) => [e.ticker, e]));
  let linked = 0;
  for (const sec of unlinked) {
    const entry = byTicker.get(sec.ticker) ?? byTicker.get(sec.ticker.replace(".", "-"));
    if (!entry) {
      ctx.log(`No SEC CIK found for ${sec.ticker}; fundamentals will show as unavailable.`);
      continue;
    }
    const [company] = await ctx.db
      .insert(companies)
      .values({ cik: entry.cik, name: entry.title, tracked: true })
      .onConflictDoUpdate({ target: companies.cik, set: { tracked: true } })
      .returning({ id: companies.id });
    await ctx.db.update(securities).set({ companyId: company!.id, name: entry.title }).where(eq(securities.id, sec.id));
    linked++;
  }
  return linked;
}

export interface CompanyRefreshResult {
  newFilings: number;
  newFilingRecords: Array<{ accessionNo: string; form: string; items: string[] }>;
  factsUpserted: number;
  statementsChanged: number;
  fundamentalsRefreshed: boolean;
}

export async function refreshCompany(ctx: JobContext, company: typeof companies.$inferSelect): Promise<CompanyRefreshResult> {
  const result: CompanyRefreshResult = { newFilings: 0, newFilingRecords: [], factsUpserted: 0, statementsChanged: 0, fundamentalsRefreshed: false };
  if (!company.cik) return result;
  const filingsKey = `filings:${company.cik}`;
  await markAttempt(ctx.db, { key: filingsKey, kind: "filings", provider: "sec_edgar", dataNature: "filing", staleAfterSeconds: STALE_AFTER.filings }, ctx.now);

  let subs: CompanySubmissions;
  let sourceId: number;
  try {
    const res = await ctx.providers.sec.getSubmissions(company.cik);
    subs = res.data;
    sourceId = await recordSource(ctx.db, res.source);
  } catch (err) {
    await markFailure(ctx.db, filingsKey, err);
    throw err;
  }

  const retrievedAt = ctx.now;
  const relevant = subs.filings.filter((f) => STORED_FORMS.has(f.form));
  const known = new Set(
    relevant.length
      ? (
          await ctx.db
            .select({ a: filings.accessionNo })
            .from(filings)
            .where(inArray(filings.accessionNo, relevant.map((f) => f.accessionNo)))
        ).map((r) => r.a)
      : [],
  );
  const fresh = relevant.filter((f) => !known.has(f.accessionNo));
  result.newFilings = fresh.length;
  result.newFilingRecords = fresh.map((f) => ({ accessionNo: f.accessionNo, form: f.form, items: f.items }));

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({
        name: subs.name,
        sicCode: subs.sic,
        sicDescription: subs.sicDescription,
        industry: subs.sicDescription,
        exchange: subs.exchanges[0] ?? null,
        fiscalYearEnd: subs.fiscalYearEnd,
        stateOfIncorporation: subs.stateOfIncorporation,
        sourceId,
        retrievedAt,
        updatedAt: retrievedAt,
      })
      .where(eq(companies.id, company.id));

    for (const f of fresh) {
      await tx
        .insert(filings)
        .values({
          companyId: company.id,
          accessionNo: f.accessionNo,
          form: f.form,
          filedAt: f.filedAt,
          reportDate: f.reportDate,
          acceptedAt: f.acceptedAt,
          primaryDocUrl: f.primaryDocUrl,
          primaryDocDescription: f.primaryDocDescription,
          items: f.items,
          isXbrl: f.isXbrl,
          sourceId,
          retrievedAt,
        })
        .onConflictDoNothing();

      if (f.form.startsWith("8-K")) {
        for (const item of f.items) {
          const eventType = GOVERNANCE_ITEMS[item];
          if (!eventType) continue;
          await tx
            .insert(governanceEvents)
            .values({
              companyId: company.id,
              eventType,
              eventDate: f.filedAt,
              description: `Form 8-K Item ${item}: ${EIGHT_K_ITEMS[item]}`,
              filingAccession: f.accessionNo,
              sourceId,
              retrievedAt,
            })
            .onConflictDoNothing();
        }
      }
    }
  });

  const latest = relevant.reduce<string | null>((m, f) => (!m || f.filedAt > m ? f.filedAt : m), null);
  await markSuccess(ctx.db, filingsKey, ctx.now, { changed: fresh.length > 0, dataAsOf: latest, recordCount: relevant.length, sourceId });
  if (fresh.length) ctx.log(`${subs.name}: ${fresh.length} new filing(s): ${fresh.slice(0, 5).map((f) => `${f.form} ${f.filedAt}`).join(", ")}${fresh.length > 5 ? "…" : ""}`);

  const factsKey = `fundamentals:${company.cik}`;
  const factsDataset = await getDataset(ctx.db, factsKey);
  const neverLoaded = !factsDataset?.lastSuccessAt;
  if (neverLoaded || needsFundamentalsRefresh(fresh)) {
    Object.assign(result, await refreshFundamentals(ctx, company.id, company.cik));
    result.fundamentalsRefreshed = true;
  } else {
    // The daily check succeeded; nothing new to process.
    await markAttempt(ctx.db, { key: factsKey, kind: "fundamentals", provider: "sec_edgar", dataNature: "filing", staleAfterSeconds: STALE_AFTER.fundamentals }, ctx.now);
    await markSuccess(ctx.db, factsKey, ctx.now, { changed: false });
  }
  return result;
}

export async function refreshFundamentals(ctx: JobContext, companyId: number, cik: string) {
  const key = `fundamentals:${cik}`;
  await markAttempt(ctx.db, { key, kind: "fundamentals", provider: "sec_edgar", dataNature: "filing", staleAfterSeconds: STALE_AFTER.fundamentals }, ctx.now);
  try {
    const res = await ctx.providers.fundamentals.getCompanyFacts(cik, MAPPED_TAGS);
    const sourceId = await recordSource(ctx.db, res.source);
    const facts = res.data;
    if (facts.length === 0) {
      ctx.log(`No mapped XBRL facts for CIK ${cik} (company may use non-standard tags, e.g. banks/insurers).`);
    }
    await ctx.db.transaction(async (tx) => {
      for (let i = 0; i < facts.length; i += 500) {
        await tx
          .insert(financialFacts)
          .values(
            facts.slice(i, i + 500).map((f) => ({
              companyId,
              taxonomy: f.taxonomy,
              tag: f.tag,
              metric: TAG_TO_METRIC.get(`${f.taxonomy}:${f.tag}`) ?? null,
              unit: f.unit,
              value: f.value,
              periodStart: f.periodStart,
              periodEnd: f.periodEnd,
              fiscalYear: f.fiscalYear,
              fiscalPeriod: f.fiscalPeriod,
              form: f.form,
              accessionNo: f.accessionNo,
              filedAt: f.filedAt,
              frame: f.frame,
              valueKind: "reported" as const,
              sourceId,
              retrievedAt: res.source.retrievedAt,
            })),
          )
          .onConflictDoNothing();
      }
    });

    const statementsChanged = await rebuildStatements(ctx, companyId, facts);
    const latestFiled = facts.reduce<string | null>((m, f) => (!m || f.filedAt > m ? f.filedAt : m), null);
    await markSuccess(ctx.db, key, ctx.now, { changed: statementsChanged > 0, dataAsOf: latestFiled, recordCount: facts.length, sourceId });
    return { factsUpserted: facts.length, statementsChanged };
  } catch (err) {
    await markFailure(ctx.db, key, err);
    throw err;
  }
}

async function rebuildStatements(ctx: JobContext, companyId: number, facts: Parameters<typeof buildStatements>[0]): Promise<number> {
  const periods = buildStatements(facts);
  let changed = 0;
  for (const p of periods) {
    for (const statement of ["income", "balance", "cashflow"] as const) {
      const lineItems = Object.fromEntries(Object.entries(p.items).filter(([m]) => {
        const def = METRIC_BY_NAME.get(m);
        return def && (def.statement === statement || (statement === "income" && def.statement === "shares"));
      }));
      if (Object.keys(lineItems).length === 0) continue;
      const inputHash = fingerprint(lineItems);
      const row = {
        companyId,
        statement,
        periodType: p.periodType,
        fiscalYear: Number(p.periodEnd.slice(0, 4)),
        fiscalPeriod: p.periodType === "annual" ? "FY" : null,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        currency: p.currency,
        lineItems,
        inputHash,
        computedAt: ctx.now,
      };
      const updated = await ctx.db
        .insert(financialStatements)
        .values(row)
        .onConflictDoUpdate({
          target: [financialStatements.companyId, financialStatements.statement, financialStatements.periodType, financialStatements.periodEnd],
          set: row,
          setWhere: sql`${financialStatements.inputHash} <> excluded.input_hash`,
        })
        .returning({ id: financialStatements.id });
      changed += updated.length;
    }
  }

  // Financial-health report: regenerated only when inputs change (input hash).
  const annual = periods.filter((p) => p.periodType === "annual");
  const metrics = periods.map((p) => computeHealthMetrics(p, periods));
  const content = { periods, metrics, annualCount: annual.length, method: "Deterministic formulas in src/lib/fundamentals/metrics.ts applied to SEC XBRL facts." };
  const asOf = periods[0]?.periodEnd ?? ctx.now.toISOString().slice(0, 10);
  await ctx.db
    .insert(analysisReports)
    .values({ companyId, reportType: "financial_health", subjectKey: String(companyId), asOf, content, inputHash: fingerprint(content) })
    .onConflictDoNothing();
  return changed;
}
