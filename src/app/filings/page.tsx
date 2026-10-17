import type { Metadata } from "next";
import Link from "next/link";
import { AnalysisView } from "@/components/AnalysisView";
import { FilingSummaryView } from "@/components/FilingSummaryView";
import { storedFilingSummary } from "@/lib/ai/filingSummary";
import { SummaryButton } from "./SummaryButton";
import { Unavailable } from "@/components/data";
import { getDb } from "@/lib/db/client";
import { analyzeStoredFiling } from "@/lib/filings/service";
import { redactSecrets } from "@/lib/providers/errors";
import { createProviders } from "@/lib/providers/registry";
import { companyFilings, getSecurity, normalizeTicker } from "@/lib/queries/company";
import { TextAnalyzer } from "./TextAnalyzer";

export const metadata: Metadata = { title: "Filings" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

export default async function FilingsPage({ searchParams }: { searchParams: Promise<{ ticker?: string; accession?: string }> }) {
  const sp = await searchParams;
  const { db } = await getDb();
  const ticker = sp.ticker ? normalizeTicker(sp.ticker) : null;
  const accession = sp.accession && ACCESSION.test(sp.accession) ? sp.accession : null;

  let analysis = null;
  let error: string | null = null;
  if (accession) {
    try {
      analysis = await analyzeStoredFiling(db, createProviders().sec, accession);
      if (!analysis) error = "That filing is not stored. Open the company and use “Analyze this company” to load its filings first.";
    } catch (err) {
      error = `Could not retrieve the filing from SEC EDGAR: ${redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
    }
  }
  const aiSummary = analysis && accession ? await storedFilingSummary(db, accession).catch(() => null) : null;
  const aiEnabled = createProviders().ai.configured;
  const sec = ticker ? await getSecurity(db, ticker) : null;
  const list = sec?.company ? await companyFilings(db, sec.company.id, { forms: ["10-K", "10-Q", "8-K", "DEF 14A", "10-K/A", "10-Q/A", "20-F", "6-K"], limit: 30 }) : [];

  return (
    <>
      <h1>Filing & document analyzer</h1>
      <p className="lede">Find risk disclosures, separate reported facts from management commentary, and see what changed from the prior period. Every finding cites the passage it came from.</p>

      <form className="searchbar card" action="/filings">
        <label htmlFor="t" className="sr-only">Ticker</label>
        <input id="t" name="ticker" defaultValue={ticker ?? ""} placeholder="Ticker, e.g. AAPL" />
        <button type="submit">List SEC filings</button>
      </form>

      {ticker ? (
        <section className="section card" aria-labelledby="list">
          <h2 id="list">{ticker} filings</h2>
          {list.length ? (
            <ul className="plain">
              {list.map((f) => (
                <li key={f.accessionNo}>
                  <strong>{f.form}</strong> filed {f.filedAt}
                  {f.items?.length ? <span className="small muted"> · items {f.items.join(", ")}</span> : null} · <Link href={`/filings?ticker=${ticker}&accession=${f.accessionNo}`}>Analyze</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Unavailable detail={sec ? "no filings stored for this company yet" : "unknown ticker"} />
          )}
        </section>
      ) : null}

      {error ? <div className="section"><Unavailable detail={error} /></div> : null}
      {analysis && aiSummary ? <div className="section"><FilingSummaryView s={aiSummary} /></div> : null}
      {analysis && !aiSummary && aiEnabled && accession ? <div className="section"><SummaryButton accession={accession} /></div> : null}
      {analysis ? <div className="section"><AnalysisView a={analysis} /></div> : null}

      <section className="section" aria-labelledby="paste">
        <h2 id="paste" style={{ marginBottom: 12 }}>Analyze your own text</h2>
        <TextAnalyzer />
      </section>
    </>
  );
}
