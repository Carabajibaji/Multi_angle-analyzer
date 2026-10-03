import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { TechnicalPanel } from "@/components/TechnicalPanel";
import { Unavailable } from "@/components/data";
import { getDb } from "@/lib/db/client";
import { securities } from "@/lib/db/schema";
import { getSecurity, normalizeTicker, technicalView } from "@/lib/queries/company";

export const metadata: Metadata = { title: "Technical Lab" };
export const dynamic = "force-dynamic";

export default async function TechnicalLab({ searchParams }: { searchParams: Promise<{ ticker?: string }> }) {
  const ticker = normalizeTicker((await searchParams).ticker ?? "SPY") ?? "SPY";
  const { db } = await getDb();
  const options = await db.select({ ticker: securities.ticker, name: securities.name }).from(securities).where(and(eq(securities.tracked, true))).orderBy(asc(securities.ticker));
  const row = await getSecurity(db, ticker);
  const view = row ? await technicalView(db, row.security.id) : null;
  return (
    <>
      <h1>Technical Lab</h1>
      <p className="lede">Interactive daily candlestick charts with indicators calculated from stored price data, possible W/M patterns, and a three-part verification filter. Learning tool only — not trading advice.</p>
      <form className="searchbar card" action="/technical-lab">
        <label htmlFor="tk" className="sr-only">Ticker</label>
        <input id="tk" name="ticker" list="tracked-tickers" defaultValue={ticker} placeholder="Ticker" />
        <datalist id="tracked-tickers">{options.map((o) => <option key={o.ticker} value={o.ticker}>{o.name}</option>)}</datalist>
        <button className="primary" type="submit">Load chart</button>
      </form>
      <div className="section">
        {view ? <TechnicalPanel ticker={ticker} view={view} /> : <Unavailable detail={row ? "no stored daily candles for this ticker" : "unknown ticker — only tracked or directory tickers can be charted"} />}
      </div>
      <section className="section card" aria-labelledby="how">
        <h2 id="how">How the Triple Verification Filter works</h2>
        <ol className="small">
          <li><strong>Trend</strong> — is price on the right side of its 50-day average, and is the 50-day on the right side of the 200-day?</li>
          <li><strong>Momentum</strong> — do MACD and RSI agree with the direction?</li>
          <li><strong>Price & volume</strong> — did price break out of its 20-day range on heavy volume, or complete a volume-confirmed W/M pattern?</li>
        </ol>
        <p className="small">0 of 3 = insufficient evidence · 1 = weak signal · 2 = developing signal · 3 = technically confirmed under these rules. Even 3 of 3 does not mean the price will move that way.</p>
      </section>
    </>
  );
}
