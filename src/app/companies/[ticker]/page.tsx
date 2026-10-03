import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FreshnessBadge, Unavailable } from "@/components/data";
import { getDb } from "@/lib/db/client";
import { companyFreshness, getSecurity, normalizeTicker } from "@/lib/queries/company";
import { AnalyzeButton } from "./AnalyzeButton";
import { CompetitionTab, FinancialsTab, FilingsTab, GovernanceTab, OverviewTab, TechnicalTab } from "./sections";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "financials", label: "Financial Health" },
  { key: "governance", label: "Governance" },
  { key: "competition", label: "Competitive Landscape" },
  { key: "technical", label: "Technical Analysis" },
  { key: "filings", label: "Filings & Sources" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const t = normalizeTicker((await params).ticker);
  return { title: t ?? "Company" };
}

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ tab?: string; peers?: string }> }) {
  const ticker = normalizeTicker((await params).ticker);
  if (!ticker) notFound();
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;
  const { db } = await getDb();
  const row = await getSecurity(db, ticker);
  if (!row) {
    return (
      <>
        <h1>{ticker}</h1>
        <Unavailable detail="this ticker is not in the company directory" />
        <p><Link href={`/companies?q=${encodeURIComponent(ticker)}`}>Search for it</Link></p>
      </>
    );
  }
  const { security, company } = row;
  const now = new Date();
  const fresh = await companyFreshness(db, ticker, company?.cik ?? null, now);

  return (
    <>
      <p className="small"><Link href="/companies">← Companies</Link></p>
      <div className="section-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>
            {company?.name ?? (security.name !== ticker ? security.name : ticker)}
            {(company?.name ?? security.name) !== ticker ? <span className="muted"> ({ticker})</span> : null}
          </h1>
          <p className="lede" style={{ marginBottom: 8 }}>
            {[company?.exchange ?? security.exchange, company?.sicDescription ? `SEC industry: ${company.sicDescription}` : null, security.assetType === "etf" ? "Exchange-traded fund" : null].filter(Boolean).join(" · ") || "Exchange and industry unavailable"}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="small muted">Prices</span> <FreshnessBadge freshness={fresh.get(`candles:${ticker}`)!} lastSuccessAt={fresh.get(`candles:${ticker}`)?.lastSuccessAt} />
            {company?.cik ? (
              <>
                <span className="small muted">Filings</span> <FreshnessBadge freshness={fresh.get(`filings:${company.cik}`)!} lastSuccessAt={fresh.get(`filings:${company.cik}`)?.lastSuccessAt} />
                <span className="small muted">Financials</span> <FreshnessBadge freshness={fresh.get(`fundamentals:${company.cik}`)!} lastSuccessAt={fresh.get(`fundamentals:${company.cik}`)?.lastSuccessAt} />
              </>
            ) : null}
          </div>
        </div>
        {security.assetType === "stock" ? <AnalyzeButton ticker={ticker} tracked={security.tracked} /> : null}
      </div>

      <nav className="tabs" aria-label="Company sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/companies/${encodeURIComponent(ticker)}?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} scroll={false}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab db={db} security={security} company={company} now={now} />}
      {tab === "financials" && <FinancialsTab db={db} company={company} />}
      {tab === "governance" && <GovernanceTab db={db} company={company} now={now} />}
      {tab === "competition" && <CompetitionTab db={db} ticker={ticker} company={company} peersParam={sp.peers} />}
      {tab === "technical" && <TechnicalTab db={db} ticker={ticker} securityId={security.id} />}
      {tab === "filings" && <FilingsTab db={db} company={company} />}
    </>
  );
}
