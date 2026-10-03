import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { Unavailable } from "@/components/data";
import { getDb } from "@/lib/db/client";
import { securities } from "@/lib/db/schema";
import { searchCompanies } from "@/lib/queries/company";

export const metadata: Metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").slice(0, 60);
  const { db } = await getDb();
  const results = q ? await searchCompanies(db, q, 30) : [];
  const tracked = q ? [] : await db.select().from(securities).where(and(eq(securities.tracked, true), eq(securities.assetType, "stock"))).orderBy(desc(securities.ticker)).limit(200);
  return (
    <>
      <h1>Companies</h1>
      <p className="lede">Search by ticker or company name. Tracked companies refresh automatically every day; any other SEC-registered company can be analyzed on request.</p>
      <form className="searchbar card" role="search" action="/companies">
        <label htmlFor="q" className="sr-only">Ticker or company name</label>
        <input id="q" name="q" defaultValue={q} placeholder="e.g. AAPL or Apple" autoComplete="off" />
        <button className="primary" type="submit">Search</button>
      </form>
      {q ? (
        <section className="section card" aria-labelledby="res">
          <h2 id="res">Results for “{q}”</h2>
          {results.length ? (
            <ul className="plain">
              {results.map((r) => (
                <li key={r.ticker}>
                  <Link href={`/companies/${encodeURIComponent(r.ticker)}`}><strong>{r.ticker}</strong></Link> · {r.companyName ?? r.name}{" "}
                  <span className={`badge ${r.tracked ? "fresh" : "never"}`}>{r.tracked ? "Tracked daily" : "Not tracked yet"}</span>
                  {r.assetType === "etf" ? <span className="badge nature">ETF</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No matching company. The company directory is loaded from the SEC ticker list by the nightly/weekly jobs; if it has not run yet only tracked companies are searchable.</p>
          )}
        </section>
      ) : (
        <section className="section card" aria-labelledby="tr">
          <h2 id="tr">Tracked companies</h2>
          {tracked.length ? (
            <ul className="grid cards" style={{ listStyle: "none", padding: 0 }}>
              {[...tracked].reverse().map((s) => (
                <li key={s.ticker}><Link href={`/companies/${encodeURIComponent(s.ticker)}`}><strong>{s.ticker}</strong></Link> <span className="small muted">{s.name !== s.ticker ? s.name : ""}</span></li>
              ))}
            </ul>
          ) : (
            <Unavailable />
          )}
        </section>
      )}
    </>
  );
}
