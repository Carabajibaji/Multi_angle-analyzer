import Link from "next/link";
import { AiBrief, GroupedNews } from "@/components/AiBrief";
import { latestMarketBrief } from "@/lib/ai/marketBrief";
import { Change, Disclosure, FreshnessBadge, fmtNum, fmtTime, NatureBadge, SourceLine, Unavailable } from "@/components/data";
import { getDb } from "@/lib/db/client";
import { datasetFreshness, fmtPct, getLatestNews, getSectorPulse, getSnapshotCards, getStocksToWatch, getUpcomingEvents, sixtySecondSummary } from "@/lib/queries/dashboard";
import { marketStatus } from "@/lib/time/marketCalendar";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const now = new Date();
  let data;
  try {
    const { db } = await getDb();
    const [cards, pulse, watch, events, news, fresh, brief] = await Promise.all([
      getSnapshotCards(db, now),
      getSectorPulse(db),
      getStocksToWatch(db),
      getUpcomingEvents(db, now),
      getLatestNews(db, 15),
      datasetFreshness(db, ["indicators:SPY", "events:earnings", "events:macro", "news:market"], now),
      latestMarketBrief(db).catch(() => null),
    ]);
    data = { cards, pulse, watch, events, news, fresh, brief };
  } catch (err) {
    console.error("Today page: database unavailable", err instanceof Error ? err.message : err);
    return (
      <>
        <h1>Today</h1>
        <Unavailable detail="the database could not be reached; please try again shortly" />
      </>
    );
  }
  const { cards, pulse, watch, events, news, fresh, brief } = data;
  const status = marketStatus(now);
  const anyDemo = cards.some((c) => c.isDemo);
  const summary = sixtySecondSummary({ cards, pulse, events });
  const newsIds = new Set(news.map((n) => `N${n.id}`));
  const groupedNews = !!brief?.output.newsGroups.some((g) => g.items.some((i) => newsIds.has(i.ref)));

  return (
    <>
      {anyDemo ? (
        <div className="banner demo" role="alert">
          DEMO DATA: prices on this page are synthetic and generated for development. They are not real market data.
        </div>
      ) : null}
      <h1>Today</h1>
      <p className="lede">
        {status.label} · {fmtTime(now.toISOString())}. Every figure below comes from the automated daily pipeline and shows its source and freshness.
      </p>

      <section className="card" aria-labelledby="sixty">
        <div className="section-head">
          <h2 id="sixty">Today in 60 seconds</h2>
          <span className="badge nature">Generated from stored data by fixed rules (no AI)</span>
        </div>
        {summary.length ? (
          <ul>
            {summary.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <Unavailable />
        )}
        <Disclosure>This summary states measurements only. It does not claim why markets moved.</Disclosure>
      </section>

      {brief ? <div className="section"><AiBrief s={brief} /></div> : null}

      <section className="section" aria-labelledby="snapshot">
        <div className="section-head">
          <h2 id="snapshot">Market snapshot</h2>
        </div>
        <div className="grid cards">
          {cards.map((c) => (
            <article className="card" key={c.key} aria-label={c.label}>
              <div className="section-head" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{c.label}</h3>
                <FreshnessBadge freshness={c.freshness} />
              </div>
              {c.value == null ? (
                <Unavailable />
              ) : (
                <>
                  <div className="value">
                    {c.unit === "%" ? `${c.value.toFixed(2)}%` : fmtNum(c.value)}
                    {c.unit && c.unit !== "%" && c.unit !== "index" ? <span className="small muted"> {c.unit}</span> : null}
                  </div>
                  <Change pct={c.changePct} abs={c.changeAbs} unit={c.unit} />
                  <p className="tiny muted" style={{ margin: "6px 0" }}>{c.sessionLabel}</p>
                  <NatureBadge nature={c.dataNature} />
                </>
              )}
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>{c.measureNote}</p>
              {c.source ? <SourceLine name={c.source.name} url={c.source.url} retrievedAt={c.source.retrievedAt} /> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="sectors">
        <div className="section-head">
          <h2 id="sectors">Sector pulse</h2>
          {pulse ? <span className="badge nature">Calculated {fmtTime(pulse.calculatedAt)}</span> : null}
        </div>
        {pulse ? (
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>
              Session {pulse.asOf}. Benchmark SPY: {fmtPct(pulse.benchmark.change1d)} (1 day), {fmtPct(pulse.benchmark.change5d)} (5 days).
            </p>
            <div className="heat" role="list">
              {pulse.sectors.map((s) => {
                const dir = s.change1d == null ? "flat" : s.change1d > 0 ? "up" : s.change1d < 0 ? "down" : "flat";
                return (
                  <div role="listitem" className={`cell ${dir}`} key={s.ticker}>
                    <div className="small" style={{ fontWeight: 650 }}>{s.sector}</div>
                    <div className="num">
                      <span aria-hidden="true">{dir === "up" ? "▲" : dir === "down" ? "▼" : "■"} </span>
                      {fmtPct(s.change1d)} <span className="tiny muted">1d</span>
                    </div>
                    <div className="tiny muted num">
                      5d {fmtPct(s.change5d)} · vs SPY {fmtPct(s.relative1d)}
                    </div>
                    <div className="tiny muted">via <Link href={`/technical-lab?ticker=${s.ticker}`}>{s.ticker}</Link></div>
                  </div>
                );
              })}
            </div>
            <Disclosure>{pulse.method} Possible drivers, when the data supports any, appear in the AI explanation above with their cited sources.</Disclosure>
          </div>
        ) : (
          <Unavailable />
        )}
      </section>

      <div className="grid two section">
        <section className="card" aria-labelledby="watch">
          <div className="section-head">
            <h2 id="watch">Stocks to watch</h2>
            <FreshnessBadge freshness={fresh.get("indicators:SPY")!} />
          </div>
          {watch && watch.items.length ? (
            <ul className="plain">
              {watch.items.map((i) => (
                <li key={i.ticker}>
                  <Link href={`/companies/${encodeURIComponent(i.ticker)}`}><strong>{i.ticker}</strong></Link> <span className="small muted">{i.name}</span> <span className="badge label">{i.labelText}</span>
                  <details>
                    <summary className="small">Why am I seeing this?</summary>
                    <ul className="small">
                      {i.hits.map((h) => (
                        <li key={h.rule + h.detail}>{h.detail}</li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          ) : watch ? (
            <p className="muted">No tracked company met a watch rule in session {watch.asOfDate}.</p>
          ) : (
            <Unavailable />
          )}
          <Disclosure>Rules-based screen ({watch ? `session ${watch.asOfDate}` : "no session yet"}). Not a recommendation to buy or sell.</Disclosure>
        </section>

        <section className="card" aria-labelledby="catalysts">
          <div className="section-head">
            <h2 id="catalysts">Upcoming catalysts</h2>
            <FreshnessBadge freshness={fresh.get("events:macro")!} />
          </div>
          {events.length ? (
            <ul className="plain">
              {events.map((e) => (
                <li key={e.eventKey}>
                  <div>
                    <strong className="num">{e.eventDate}</strong> · {e.title}
                    {e.eventTime ? <span className="small muted"> · {e.eventTime}</span> : null}
                  </div>
                  <span className={`badge ${e.dateStatus === "estimated" ? "stale" : "fresh"}`}>{e.dateStatus === "estimated" ? "Estimated date" : e.dateStatus === "scheduled" ? "Officially scheduled" : "Confirmed"}</span>
                  {e.source ? <SourceLine name={e.source.name} url={e.source.url} retrievedAt={e.source.retrievedAt} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Unavailable />
          )}
        </section>
      </div>

      <section className="section card" aria-labelledby="news">
        <div className="section-head">
          <h2 id="news">Market news</h2>
          <FreshnessBadge freshness={fresh.get("news:market")!} />
        </div>
        {groupedNews ? (
          <GroupedNews s={brief!} news={news} />
        ) : news.length ? (
          <ul className="plain">
            {news.map((n) => (
              <li key={n.id}>
                <a href={n.url} target="_blank" rel="noopener noreferrer nofollow">
                  {n.headline}
                </a>
                <div className="tiny muted">
                  {n.publisher ?? "Unknown publisher"} · {fmtTime(n.publishedAt.toISOString())}
                  {n.relatedTickers?.length ? ` · ${n.relatedTickers.slice(0, 5).join(", ")}` : ""}
                </div>
                {n.providerSummary ? <p className="small" style={{ margin: "4px 0 0" }}>{n.providerSummary.slice(0, 280)}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable />
        )}
        <Disclosure>Headlines and links come from the news provider. Groupings and “why it might matter” notes are AI interpretations of those headlines and can be wrong.</Disclosure>
      </section>
    </>
  );
}
