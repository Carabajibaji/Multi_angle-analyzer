import Link from "next/link";
import { CheckBadge } from "@/components/Status";
import { Change, Disclosure, fmtMoney, fmtNum, fmtRatio, fmtTime, NatureBadge, secFilingIndexUrl, SourceLine, Unavailable } from "@/components/data";
import { Explainer } from "@/components/Explainer";
import { TechnicalPanel } from "@/components/TechnicalPanel";
import { Term } from "@/components/Term";
import { financialHealthExplainer } from "@/lib/analysis/explain";
import { GOVERNANCE_NOT_YET_EXTRACTED, governanceFlags } from "@/lib/analysis/governance";
import { healthChecks, isFinancialSic } from "@/lib/analysis/health";
import { assessMoat } from "@/lib/analysis/moat";
import type { Db } from "@/lib/db/client";
import type { companies, securities } from "@/lib/db/schema";
import { METRIC_BY_NAME } from "@/lib/fundamentals/mapping";
import type { HealthMetrics } from "@/lib/fundamentals/metrics";
import type { StatementPeriod } from "@/lib/fundamentals/statements";
import {
  companyFilings,
  companyGovernanceEvents,
  comparisonRow,
  financialView,
  latestSharesOutstanding,
  nextEarnings,
  normalizeTicker,
  priceSummary,
  sourcesByIds,
  suggestPeers,
  technicalView,
} from "@/lib/queries/company";
import { toEt } from "@/lib/time/marketCalendar";

type Company = typeof companies.$inferSelect | null;
type Security = typeof securities.$inferSelect;

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export async function OverviewTab({ db, security, company, now }: { db: Db; security: Security; company: Company; now: Date }) {
  const [price, shares, fv, earnings, latestFiling] = await Promise.all([
    priceSummary(db, security.id),
    company ? latestSharesOutstanding(db, company.id) : null,
    company ? financialView(db, company.id) : null,
    nextEarnings(db, security.id, now),
    company ? companyFilings(db, company.id, { limit: 1, forms: ["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"] }) : [],
  ]);
  const marketCap = price && shares ? price.close * shares.value : null;
  const a = fv?.annual[0];
  const m = fv?.annualMetrics[0];
  const lf = latestFiling[0];
  return (
    <>
      {price?.isDemo ? <div className="banner demo" role="alert">DEMO DATA: prices for this company are synthetic, not real market data.</div> : null}
      <div className="grid two">
        <section className="card" aria-labelledby="px">
          <h2 id="px">Price</h2>
          {price ? (
            <>
              <div className="value">{fmtNum(price.close)} <span className="small muted">USD</span></div>
              <Change pct={price.changePct} abs={price.change} />
              <dl className="kv" style={{ marginTop: 12 }}>
                <div><dt>Session</dt><dd>{price.date}</dd></div>
                <div><dt>52-week range</dt><dd>{fmtNum(price.low52)} – {fmtNum(price.high52)}</dd></div>
                <div><dt><Term slug="market-cap">Market cap</Term></dt><dd>{marketCap ? fmtMoney(marketCap) : "n/a"}</dd></div>
              </dl>
              <p className="tiny muted">
                {price.rangeSessions < 252 ? `52-week range uses the ${price.rangeSessions} sessions stored. ` : ""}
                {marketCap && shares ? `Market cap is derived: latest close × ${fmtNum(shares.value, 0)} shares outstanding reported as of ${shares.periodEnd} (${shares.form}, accession ${shares.accessionNo}).` : "Market cap unavailable: needs both a price and a reported share count."}
              </p>
              <NatureBadge nature={price.dataNature} />
              {price.source ? <SourceLine name={price.source.name} url={price.source.url} retrievedAt={price.source.retrievedAt} /> : null}
            </>
          ) : (
            <Unavailable detail="no stored candles for this ticker" />
          )}
        </section>
        <section className="card" aria-labelledby="co">
          <h2 id="co">Company</h2>
          <dl className="kv">
            <div><dt>Ticker</dt><dd>{security.ticker}</dd></div>
            <div><dt>Exchange</dt><dd>{company?.exchange ?? security.exchange ?? "n/a"}</dd></div>
            <div><dt>Industry (SEC SIC)</dt><dd>{company?.sicDescription ? `${company.sicDescription} (${company.sicCode})` : "n/a"}</dd></div>
            <div><dt>Sector (GICS)</dt><dd>{company?.sector ?? "Not assigned"}</dd></div>
            <div><dt>Fiscal year end</dt><dd>{company?.fiscalYearEnd ? `${company.fiscalYearEnd.slice(0, 2)}/${company.fiscalYearEnd.slice(2)}` : "n/a"}</dd></div>
            <div><dt>Incorporated</dt><dd>{company?.stateOfIncorporation ?? "n/a"}</dd></div>
            <div><dt>Latest periodic filing</dt><dd>{lf ? <a href={lf.primaryDocUrl ?? "#"} target="_blank" rel="noopener noreferrer nofollow">{lf.form} filed {lf.filedAt}</a> : "n/a"}</dd></div>
            <div><dt>Next earnings</dt><dd>{earnings ? `${earnings.eventDate} (${earnings.dateStatus})` : "n/a"}</dd></div>
          </dl>
          <p className="small muted">Business description: Data unavailable from the connected provider. It can be read from 10-K Item 1 in the <Link href={`/filings?ticker=${security.ticker}`}>Filing analyzer</Link>.</p>
          {company?.retrievedAt ? <SourceLine name="SEC EDGAR submissions API" url={company.cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}` : null} retrievedAt={company.retrievedAt.toISOString()} /> : null}
        </section>
      </div>
      <section className="section card" aria-labelledby="snap">
        <h2 id="snap">Latest fiscal year at a glance</h2>
        {a && m ? (
          <>
            <dl className="kv">
              <div><dt><Term slug="revenue">Revenue</Term></dt><dd>{fmtMoney(a.items.revenue?.value, a.currency)}</dd></div>
              <div><dt>Revenue growth</dt><dd>{fmtRatio(m.revenueGrowthYoY.value)}</dd></div>
              <div><dt><Term slug="profit-margin">Net margin</Term></dt><dd>{fmtRatio(m.netMargin.value)}</dd></div>
              <div><dt><Term slug="free-cash-flow">Free cash flow</Term></dt><dd>{fmtMoney(m.freeCashFlow.value, a.currency)}</dd></div>
              <div><dt><Term slug="current-ratio">Current ratio</Term></dt><dd>{fmtRatio(m.currentRatio.value, "x")}</dd></div>
              <div><dt><Term slug="debt-to-equity">Debt-to-equity</Term></dt><dd>{fmtRatio(m.debtToEquity.value, "x")}</dd></div>
            </dl>
            <p className="tiny muted">Fiscal year ending {a.periodEnd}. Reported in SEC filings; see the Financial Health tab for formulas and sources.</p>
          </>
        ) : (
          <Unavailable detail={company ? "no reported financial statements stored yet" : "not linked to an SEC registrant"} />
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Financial Health                                                    */
/* ------------------------------------------------------------------ */

type Row = { label: string; glossary?: string; get: (p: StatementPeriod, m: HealthMetrics) => string; formula?: string };

const money = (metric: string) => (p: StatementPeriod) => (p.items[metric] ? fmtMoney(p.items[metric]!.value, p.currency) : "—");
const der = (k: keyof HealthMetrics, kind: "pct" | "x" | "money" = "pct") => (p: StatementPeriod, m: HealthMetrics) => {
  const d = m[k] as { value: number | null };
  return kind === "money" ? (d.value == null ? "—" : fmtMoney(d.value, p.currency)) : d.value == null ? "—" : fmtRatio(d.value, kind);
};

const INCOME: Row[] = [
  { label: "Revenue", glossary: "revenue", get: money("revenue") },
  { label: "Revenue growth (YoY)", get: der("revenueGrowthYoY"), formula: "Revenue ÷ prior-year revenue − 1" },
  { label: "Gross profit", glossary: "gross-profit", get: der("grossProfit", "money") },
  { label: "Gross margin", get: der("grossMargin"), formula: "Gross profit ÷ revenue" },
  { label: "Operating income", glossary: "operating-income", get: money("operatingIncome") },
  { label: "Operating margin", get: der("operatingMargin"), formula: "Operating income ÷ revenue" },
  { label: "Net income", glossary: "net-income", get: money("netIncome") },
  { label: "Net margin", glossary: "profit-margin", get: der("netMargin"), formula: "Net income ÷ revenue" },
  { label: "R&D expense", get: money("researchAndDevelopment") },
  { label: "Interest coverage", get: der("interestCoverage", "x"), formula: "Operating income ÷ interest expense" },
  { label: "Diluted shares", get: (p) => (p.items.dilutedShares ? fmtNum(p.items.dilutedShares.value / 1e6, 1) + "M" : "—") },
  { label: "Dilution (YoY)", glossary: "dilution", get: der("dilutionYoY"), formula: "Diluted shares ÷ prior-year diluted shares − 1" },
];
const BALANCE: Row[] = [
  { label: "Cash & equivalents", get: money("cash") },
  { label: "Current assets", get: money("currentAssets") },
  { label: "Total assets", get: money("totalAssets") },
  { label: "Current liabilities", get: money("currentLiabilities") },
  { label: "Total liabilities", get: money("totalLiabilities") },
  { label: "Short-term debt", get: money("shortTermDebt") },
  { label: "Long-term debt", get: money("longTermDebt") },
  { label: "Shareholders' equity", get: money("equity") },
  { label: "Working capital", glossary: "working-capital", get: der("workingCapital", "money"), formula: "Current assets − current liabilities" },
  { label: "Current ratio", glossary: "current-ratio", get: der("currentRatio", "x"), formula: "Current assets ÷ current liabilities" },
  { label: "Debt-to-equity", glossary: "debt-to-equity", get: der("debtToEquity", "x"), formula: "(Short-term + long-term debt) ÷ equity" },
  { label: "Net debt", get: der("netDebt", "money"), formula: "Total debt − cash" },
];
const CASH: Row[] = [
  { label: "Operating cash flow", get: money("operatingCashFlow") },
  { label: "Capital expenditures", glossary: "capital-expenditure", get: money("capex") },
  { label: "Free cash flow", glossary: "free-cash-flow", get: der("freeCashFlow", "money"), formula: "Operating cash flow − capital expenditures" },
  { label: "FCF margin", get: der("freeCashFlowMargin"), formula: "Free cash flow ÷ revenue" },
  { label: "Cash conversion", get: der("cashConversion", "x"), formula: "Operating cash flow ÷ net income" },
  { label: "Share repurchases", get: money("buybacks") },
  { label: "Dividends paid", get: money("dividendsPaid") },
  { label: "Debt issued", get: money("debtIssued") },
  { label: "Debt repaid", get: money("debtRepaid") },
];

function StatementTable({ title, rows, periods, metrics, cik }: { title: string; rows: Row[]; periods: StatementPeriod[]; metrics: HealthMetrics[]; cik: string | null }) {
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col">{title}</th>
            {periods.map((p) => {
              const acc = p.items.revenue?.accessionNo ?? Object.values(p.items)[0]?.accessionNo;
              const form = p.items.revenue?.form ?? Object.values(p.items)[0]?.form;
              return (
                <th key={p.periodEnd} scope="col" className="r">
                  {p.periodType === "annual" ? "FY" : "Qtr"} ending {p.periodEnd}
                  {acc && cik ? (
                    <div className="tiny" style={{ textTransform: "none", letterSpacing: 0 }}>
                      <a href={secFilingIndexUrl(cik, acc)} target="_blank" rel="noopener noreferrer nofollow">{form} {acc}</a>
                    </div>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" style={{ textTransform: "none", fontSize: 14, color: "var(--ink)", fontWeight: 550, letterSpacing: 0 }}>
                {r.glossary ? <Term slug={r.glossary}>{r.label}</Term> : r.label}
                {r.formula ? <div className="tiny muted">{r.formula}</div> : null}
              </th>
              {periods.map((p, i) => (
                <td key={p.periodEnd} className="r">{r.get(p, metrics[i]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function FinancialsTab({ db, company }: { db: Db; company: Company }) {
  if (!company) return <Unavailable detail="this security is not linked to an SEC registrant (ETFs have no company financial statements)" />;
  const fv = await financialView(db, company.id);
  if (!fv.annual.length && !fv.quarterly.length) return <Unavailable detail="no reported financial statements stored yet — use “Analyze this company” or wait for the nightly job" />;
  const checks = healthChecks(fv.annual, fv.annualMetrics);
  const explainer = financialHealthExplainer(checks, fv.annual[0]?.periodEnd ?? null);
  const annual = fv.annual.slice(0, 5);
  const annualM = fv.annualMetrics.slice(0, 5);
  const quarterly = fv.quarterly.slice(0, 6);
  const quarterlyM = fv.quarterlyMetrics.slice(0, 6);
  const capexNote = METRIC_BY_NAME.get("capex")?.note;
  return (
    <>
      {isFinancialSic(company.sicCode) ? (
        <div className="banner info" role="note">
          This company is in finance, insurance or real estate (SIC {company.sicCode}). Standard ratios such as the current ratio and debt-to-equity are often misleading for banks and insurers, whose balance sheets are built from loans, deposits and policy reserves. Many of their line items also use tags outside this app&apos;s mapping and will show as unavailable.
        </div>
      ) : null}
      <section className="card" aria-labelledby="hc">
        <h2 id="hc">Health checks</h2>
        <p className="small muted">Each check has a visible rule. There is no hidden overall score. “Assets exceed liabilities” is never used on its own as a health test.</p>
        <ul className="plain">
          {checks.map((c) => (
            <li key={c.key}>
              <CheckBadge status={c.status} /> <strong>{c.name}</strong> · <span className="num">{c.value}</span>
              <div className="small">{c.why}</div>
              <div className="tiny muted">Rule: {c.rule}</div>
            </li>
          ))}
        </ul>
      </section>
      <div className="section"><Explainer data={explainer} /></div>
      <section className="section card" aria-labelledby="an">
        <h2 id="an">Annual trends</h2>
        {annual.length ? (
          <>
            <StatementTable title="Income statement" rows={INCOME} periods={annual} metrics={annualM} cik={company.cik} />
            <StatementTable title="Balance sheet" rows={BALANCE} periods={annual} metrics={annualM} cik={company.cik} />
            <StatementTable title="Cash flow" rows={CASH} periods={annual} metrics={annualM} cik={company.cik} />
          </>
        ) : (
          <Unavailable detail="no annual periods" />
        )}
      </section>
      <section className="section card" aria-labelledby="qt">
        <h2 id="qt">Recent quarters</h2>
        {quarterly.length ? (
          <StatementTable title="Quarterly income statement" rows={INCOME.slice(0, 8)} periods={quarterly} metrics={quarterlyM} cik={company.cik} />
        ) : (
          <Unavailable detail="no three-month periods reported" />
        )}
        <Disclosure>Quarterly cash-flow figures are usually reported year-to-date and are therefore not shown per quarter rather than derived by subtraction.</Disclosure>
      </section>
      <section className="section card" aria-labelledby="meth">
        <h2 id="meth">Method & sources</h2>
        <ul className="small">
          <li>Values are reported XBRL facts from SEC EDGAR filings. Column headers link to the exact filing (form and accession number). When a period was reported more than once (comparatives or restatements), the most recently filed value is used.</li>
          <li>Annual = reported periods of about one year; quarterly = about three months. Values are in the reporting currency ({fv.periods[0]?.currency ?? "USD"}).</li>
          <li>Free cash flow = operating cash flow − capital expenditures. {capexNote}</li>
          <li>Missing values are shown as “—” and are never treated as zero.</li>
          <li>Filing data reflects the latest officially available reporting period, not necessarily the company&apos;s current condition.</li>
        </ul>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Governance                                                          */
/* ------------------------------------------------------------------ */

export async function GovernanceTab({ db, company, now }: { db: Db; company: Company; now: Date }) {
  if (!company) return <Unavailable detail="not linked to an SEC registrant" />;
  const [events, proxies] = await Promise.all([companyGovernanceEvents(db, company.id), companyFilings(db, company.id, { forms: ["DEF 14A", "DEFA14A"], limit: 3 })]);
  const flags = governanceFlags(events, toEt(now).date);
  return (
    <>
      <section className="card" aria-labelledby="gf">
        <h2 id="gf">Governance flags from filings</h2>
        {flags.length ? (
          <ul className="plain">
            {flags.map((f) => (
              <li key={f.flag}>
                <span className={`badge ${f.severity === "risk" ? "failed" : f.severity === "watch" ? "stale" : "nature"}`}>{f.severity === "risk" ? "Risk flag" : f.severity === "watch" ? "Watch" : "Info"}</span> <strong>{f.flag}</strong>
                <div className="small">{f.evidence}</div>
                <div className="tiny muted">{f.basis}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No governance-related 8-K disclosures (auditor change, non-reliance, change in control, cybersecurity incident, listing notice, frequent officer/director changes) in the stored filings.</p>
        )}
        <Disclosure>A flag describes a disclosure. It is not an allegation of misconduct.</Disclosure>
      </section>
      <section className="section card" aria-labelledby="ge">
        <h2 id="ge">Leadership and board disclosures (8-K)</h2>
        {events.length ? (
          <ul className="plain">
            {events.slice(0, 25).map((e) => (
              <li key={e.id}>
                <strong className="num">{e.eventDate}</strong> · {e.description}
                {e.filingAccession && company.cik ? (
                  <> · <a href={secFilingIndexUrl(company.cik, e.filingAccession)} target="_blank" rel="noopener noreferrer nofollow">filing</a></>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable detail="no governance-related 8-K items stored" />
        )}
      </section>
      <section className="section card" aria-labelledby="gm">
        <h2 id="gm">Missing information</h2>
        <p className="small">These items come from the proxy statement (<Term slug="proxy-statement">DEF 14A</Term>) and are not yet extracted automatically, so no conclusion is drawn about them:</p>
        <ul className="small">{GOVERNANCE_NOT_YET_EXTRACTED.map((g) => <li key={g}>{g}</li>)}</ul>
        {proxies.length ? (
          <p className="small">Latest proxy filing: {proxies.map((p) => <a key={p.accessionNo} href={p.primaryDocUrl ?? secFilingIndexUrl(company.cik!, p.accessionNo)} target="_blank" rel="noopener noreferrer nofollow" style={{ marginRight: 8 }}>{p.form} filed {p.filedAt}</a>)}</p>
        ) : (
          <p className="small muted">No proxy statement stored.</p>
        )}
      </section>
      <div className="section">
        <Explainer
          title="Governance in plain English"
          data={{
            what: { text: flags.length ? `${flags.length} governance-related disclosure flag(s) were found in recent 8-K filings.` : "No governance-related warning disclosures were found in the stored 8-K filings.", tag: "fact" },
            why: { text: "Boards hire, pay and oversee management on shareholders' behalf. Auditor changes, restatements or frequent leadership turnover can signal weaker oversight.", tag: "interpretation" },
            analogy: { text: "The board is like a homeowners' association overseeing a property manager: you want it independent, attentive and asking hard questions.", tag: "interpretation" },
            bottomLine: { text: "Board independence, CEO/chair roles and pay have not been extracted yet, so this view is incomplete. Read the proxy statement before drawing conclusions.", tag: "unknown" },
          }}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Competitive landscape                                               */
/* ------------------------------------------------------------------ */

export async function CompetitionTab({ db, ticker, company, peersParam }: { db: Db; ticker: string; company: Company; peersParam?: string }) {
  if (!company) return <Unavailable detail="not linked to an SEC registrant" />;
  const fv = await financialView(db, company.id);
  const ownRevenue = fv.annual[0]?.items.revenue?.value ?? null;
  const manual = (peersParam ?? "").split(",").map((t) => normalizeTicker(t)).filter((t): t is string => !!t && t !== ticker).slice(0, 8);
  const suggested = peersParam === undefined ? await suggestPeers(db, company, ownRevenue) : [];
  const peerTickers = peersParam === undefined ? suggested.map((s) => s.ticker) : manual;
  const rows = await Promise.all([ticker, ...peerTickers].map((t) => comparisonRow(db, t)));
  const self = rows[0]!;
  const peerRows = rows.slice(1).filter((r): r is Extract<typeof r, { found: true }> => r.found);
  const moat =
    self.found && fv.annualMetrics.length
      ? assessMoat(fv.annualMetrics.slice(0, 5), { ticker, revenue: self.revenue, grossMargin: self.grossMargin, operatingMargin: self.operatingMargin, rdIntensity: self.rdIntensity }, peerRows.map((r) => ({ ticker: r.ticker, revenue: r.revenue, grossMargin: r.grossMargin, operatingMargin: r.operatingMargin, rdIntensity: r.rdIntensity })))
      : [];
  const periods = new Set(rows.filter((r) => r.found && r.periodEnd).map((r) => (r as { periodEnd: string }).periodEnd.slice(5)));
  return (
    <>
      <section className="card" aria-labelledby="pp">
        <h2 id="pp">Peers</h2>
        <form className="searchbar" action={`/companies/${encodeURIComponent(ticker)}`}>
          <input type="hidden" name="tab" value="competition" />
          <label htmlFor="peers" className="sr-only">Peer tickers, comma separated</label>
          <input id="peers" name="peers" defaultValue={peerTickers.join(",")} placeholder="Comma-separated tickers, e.g. MSFT,GOOGL" />
          <button type="submit">Update peers</button>
          <Link className="btn" href={`/companies/${encodeURIComponent(ticker)}?tab=competition`}>Reset to suggested</Link>
        </form>
        {peersParam === undefined ? (
          suggested.length ? (
            <ul className="small">{suggested.map((s) => <li key={s.ticker}><strong>{s.ticker}</strong> {s.name}: {s.rationale}</li>)}</ul>
          ) : (
            <p className="small muted">No suggested peers: suggestions require other companies with the same SEC industry code (SIC {company.sicCode ?? "n/a"}) that have stored financials. Add tickers manually above.</p>
          )
        ) : (
          <p className="small muted">Showing your manually chosen peers.</p>
        )}
        <Disclosure>Suggestion method: same SEC Standard Industrial Classification code, ranked by closeness of annual revenue. SIC codes are broad and can group very different businesses.</Disclosure>
      </section>

      <section className="section card" aria-labelledby="cmp">
        <h2 id="cmp">Comparison (latest fiscal year)</h2>
        <ComparisonTable rows={rows} />
        <Disclosure>
          {periods.size > 1 ? "Fiscal years end in different months for these companies, so periods do not fully overlap. " : ""}
          Valuation multiples use the latest stored close and the latest annual net income/revenue; they are derived values, not provider quotes. Market share and customer concentration are not available from this data.
        </Disclosure>
      </section>

      <section className="section card" aria-labelledby="moat">
        <h2 id="moat"><Term slug="economic-moat">Economic moat</Term> evidence</h2>
        {moat.length ? (
          <ul className="plain">
            {moat.map((m) => (
              <li key={m.category}>
                <strong>{m.category}</strong> <span className={`badge ${m.label.startsWith("Strong") ? "fresh" : m.label.startsWith("Moderate") ? "label" : m.label === "Evidence weakening" ? "stale" : "never"}`}>{m.label}</span>
                {m.evidence.length ? <div className="small">Evidence: {m.evidence.join(" ")}</div> : null}
                {m.counterevidence.length ? <div className="small">Counterevidence: {m.counterevidence.join(" ")}</div> : null}
                <div className="tiny muted">Method: {m.method}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable detail="needs stored financial statements" />
        )}
        <Disclosure>Moat labels are never based on stock performance or brand recognition. Financial data alone cannot prove a moat.</Disclosure>
      </section>
    </>
  );
}

export function ComparisonTable({ rows }: { rows: Awaited<ReturnType<typeof comparisonRow>>[] }) {
  const cols: Array<[string, (r: Extract<(typeof rows)[number], { found: true }>) => string, string?]> = [
    ["FY end", (r) => r.periodEnd ?? "—"],
    ["Revenue", (r) => fmtMoney(r.revenue, r.currency ?? "USD"), "revenue"],
    ["Rev. growth", (r) => fmtRatio(r.revenueGrowth)],
    ["Gross margin", (r) => fmtRatio(r.grossMargin), "gross-profit"],
    ["Op. margin", (r) => fmtRatio(r.operatingMargin), "operating-income"],
    ["Net margin", (r) => fmtRatio(r.netMargin), "profit-margin"],
    ["FCF margin", (r) => fmtRatio(r.fcfMargin), "free-cash-flow"],
    ["ROE", (r) => fmtRatio(r.roe), "roe"],
    ["Debt/equity", (r) => fmtRatio(r.debtToEquity, "x"), "debt-to-equity"],
    ["R&D / revenue", (r) => fmtRatio(r.rdIntensity)],
    ["Market cap", (r) => fmtMoney(r.marketCap), "market-cap"],
    ["P/E", (r) => (r.pe == null ? "—" : r.pe.toFixed(1)), "pe-ratio"],
    ["P/S", (r) => (r.ps == null ? "—" : r.ps.toFixed(1)), "price-to-sales"],
  ];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Company</th>
            {cols.map(([h, , g]) => <th key={h} scope="col" className="r">{g ? <Term slug={g}>{h}</Term> : h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) =>
            r.found ? (
              <tr key={r.ticker} style={i === 0 ? { background: "var(--surface-2)" } : undefined}>
                <th scope="row" style={{ textTransform: "none", color: "var(--ink)", fontSize: 14, letterSpacing: 0 }}>
                  <Link href={`/companies/${encodeURIComponent(r.ticker)}`}>{r.ticker}</Link>
                  <div className="tiny muted">{r.name}{r.isDemoPrice ? " · demo price" : ""}</div>
                </th>
                {cols.map(([h, get]) => <td key={h} className="r">{get(r)}</td>)}
              </tr>
            ) : (
              <tr key={r.ticker}><th scope="row">{r.ticker}</th><td colSpan={cols.length} className="muted">Not found in the company directory.</td></tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Technical                                                           */
/* ------------------------------------------------------------------ */

export async function TechnicalTab({ db, ticker, securityId }: { db: Db; ticker: string; securityId: number }) {
  const view = await technicalView(db, securityId);
  if (!view) return <Unavailable detail="no stored daily candles for this ticker yet" />;
  return <TechnicalPanel ticker={ticker} view={view} />;
}

/* ------------------------------------------------------------------ */
/* Filings & sources                                                   */
/* ------------------------------------------------------------------ */

export async function FilingsTab({ db, company }: { db: Db; company: Company }) {
  if (!company) return <Unavailable detail="not linked to an SEC registrant" />;
  const list = await companyFilings(db, company.id, { limit: 100 });
  const srcs = await sourcesByIds(db, [...list.map((f) => f.sourceId ?? -1), company.sourceId ?? -1]);
  return (
    <>
      <section className="card" aria-labelledby="fl">
        <h2 id="fl">Filings</h2>
        {list.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Filed</th><th>Form</th><th>Period</th><th>Description / items</th><th>Links</th></tr></thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.accessionNo}>
                    <td className="num">{f.filedAt}</td>
                    <td>{f.form}</td>
                    <td className="num">{f.reportDate ?? "—"}</td>
                    <td className="small">{f.items?.length ? `Items ${f.items.join(", ")}` : (f.primaryDocDescription ?? "")}</td>
                    <td className="small">
                      {f.primaryDocUrl ? <a href={f.primaryDocUrl} target="_blank" rel="noopener noreferrer nofollow">Document</a> : null}
                      {" · "}
                      <a href={secFilingIndexUrl(company.cik!, f.accessionNo)} target="_blank" rel="noopener noreferrer nofollow">Index</a>
                      {" · "}
                      <Link href={`/filings?accession=${encodeURIComponent(f.accessionNo)}`}>Analyze</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Unavailable detail="no filings stored yet" />
        )}
      </section>
      <section className="section card" aria-labelledby="src">
        <h2 id="src">Sources used for this company</h2>
        {srcs.length ? (
          <ul className="small">
            {srcs.map((s) => (
              <li key={s.id}>
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.name}</a> : s.name} · {s.provider} · last retrieved {fmtTime(s.lastRetrievedAt.toISOString())}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No sources recorded yet.</p>
        )}
      </section>
    </>
  );
}
