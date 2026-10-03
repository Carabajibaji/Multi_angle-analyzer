"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const KEY = "mmta:watchlist";
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

type Quote = { ticker: string; found: boolean; name?: string; tracked?: boolean; price?: { date: string; close: number; changePct: number | null; dataNature: string; isDemo: boolean } | null };

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string" && TICKER.test(t)).slice(0, 25) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: list lives for this page view only */
  }
}

export function WatchlistClient() {
  const [list, setList] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setList(load()), []);
  const refresh = useCallback(async (l: string[]) => {
    if (!l.length) return setQuotes([]);
    const res = await fetch(`/api/quotes?tickers=${encodeURIComponent(l.join(","))}`);
    if (res.ok) setQuotes(await res.json());
  }, []);
  useEffect(() => void refresh(list), [list, refresh]);

  const update = (l: string[]) => {
    setList(l);
    save(l);
  };

  return (
    <>
      <form
        className="searchbar card"
        onSubmit={(e) => {
          e.preventDefault();
          const t = input.trim().toUpperCase();
          if (!TICKER.test(t)) return setErr("Enter a valid ticker symbol.");
          if (list.includes(t)) return setErr(`${t} is already on your watchlist.`);
          if (list.length >= 25) return setErr("Watchlists are limited to 25 tickers.");
          setErr(null);
          setInput("");
          update([...list, t]);
        }}
      >
        <label htmlFor="add" className="sr-only">Ticker to add</label>
        <input id="add" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add a ticker, e.g. MSFT" autoComplete="off" />
        <button className="primary" type="submit">Add</button>
        {err ? <p role="alert" className="small" style={{ flexBasis: "100%", margin: 0, color: "var(--blush-ink)" }}>{err}</p> : null}
      </form>
      <section className="section card" aria-live="polite">
        {list.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Ticker</th><th>Name</th><th className="r">Last close</th><th className="r">Change</th><th>As of</th><th /></tr></thead>
              <tbody>
                {list.map((t) => {
                  const q = quotes.find((x) => x.ticker === t);
                  const chg = q?.price?.changePct;
                  return (
                    <tr key={t}>
                      <td><Link href={`/companies/${t}`}><strong>{t}</strong></Link></td>
                      <td className="small">{q?.found === false ? "Not in directory" : (q?.name ?? "…")}{q?.tracked === false ? <span className="badge never" style={{ marginLeft: 6 }}>Not tracked</span> : null}</td>
                      <td className="r">{q?.price ? q.price.close.toFixed(2) : "—"}</td>
                      <td className="r">{chg == null ? "—" : <span className={`chg ${chg > 0 ? "up" : chg < 0 ? "down" : "flat"}`}><span aria-hidden="true">{chg > 0 ? "▲ " : chg < 0 ? "▼ " : ""}</span>{chg > 0 ? "+" : ""}{chg.toFixed(2)}%</span>}</td>
                      <td className="small">{q?.price ? `${q.price.date}${q.price.isDemo ? " (demo)" : ""}` : "—"}</td>
                      <td><button type="button" onClick={() => update(list.filter((x) => x !== t))} aria-label={`Remove ${t}`}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Your watchlist is empty. Add tickers above; they are saved in this browser.</p>
        )}
      </section>
      {list.length > 1 ? <p className="section"><Link href={`/compare?tickers=${list.slice(0, 8).join(",")}`}>Compare these companies →</Link></p> : null}
    </>
  );
}
