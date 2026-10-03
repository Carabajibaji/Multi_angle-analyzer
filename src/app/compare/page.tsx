import type { Metadata } from "next";
import { ComparisonTable } from "@/app/companies/[ticker]/sections";
import { getDb } from "@/lib/db/client";
import { comparisonRow, normalizeTicker } from "@/lib/queries/company";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ tickers?: string }> }) {
  const raw = (await searchParams).tickers ?? "";
  const tickers = [...new Set(raw.split(",").map((t) => normalizeTicker(t)).filter((t): t is string => !!t))].slice(0, 8);
  const { db } = await getDb();
  const rows = await Promise.all(tickers.map((t) => comparisonRow(db, t)));
  return (
    <>
      <h1>Compare companies</h1>
      <p className="lede">Side-by-side fundamentals from each company&apos;s latest reported fiscal year, with valuation multiples derived from the latest stored close.</p>
      <form className="searchbar card" action="/compare">
        <label htmlFor="tk" className="sr-only">Tickers to compare</label>
        <input id="tk" name="tickers" defaultValue={tickers.join(",")} placeholder="Up to 8 tickers, comma-separated, e.g. AAPL,MSFT,GOOGL" />
        <button className="primary" type="submit">Compare</button>
      </form>
      {rows.length ? (
        <section className="section card">
          <ComparisonTable rows={rows} />
          <p className="tiny muted">
            Watch for misleading comparisons: different fiscal year-ends, different business mixes within the same industry, one-off charges, and negative equity (which makes ROE and debt-to-equity not meaningful). Companies with no stored financials show “—”; use “Analyze this company” on their page to load them.
          </p>
        </section>
      ) : (
        <p className="section muted">Enter two or more tickers to compare.</p>
      )}
    </>
  );
}
