import type { MarketBrief } from "@/lib/ai/prompts";
import type { StoredSummary } from "@/lib/ai/service";
import { AiMeta, ClaimLine, RefLinks } from "./AiParts";

export const NEWS_CATEGORY: Record<MarketBrief["newsGroups"][number]["category"], string> = {
  macro_economy: "Macro & economy",
  fed_rates: "Federal Reserve & interest rates",
  company_earnings: "Company earnings",
  regulation_policy: "Regulation & policy",
  geopolitics: "Geopolitics",
  sector_specific: "Sector developments",
  other: "Other",
};

export function AiBrief({ s }: { s: StoredSummary<MarketBrief> }) {
  const b = s.output;
  return (
    <section className="card" aria-labelledby="ai-brief">
      <div className="section-head">
        <h2 id="ai-brief">What happened, and why it might matter</h2>
        <span className="badge tag-interpretation">AI explanation · {s.generatedAt.toISOString().slice(0, 10)}</span>
      </div>
      <p style={{ fontWeight: 650, marginTop: 0 }}>{b.headline}</p>
      <ul className="plain">{b.sixtySeconds.map((c) => <ClaimLine key={c.text} c={c} refs={s.refs} />)}</ul>
      {b.drivers.length ? (
        <>
          <h3>Possible drivers</h3>
          <ul className="plain">
            {b.drivers.map((d) => (
              <li key={d.driver}>
                <span className="badge tag-interpretation">Interpretation</span> <strong>{d.driver}</strong>: {d.explanation} <span className="tiny muted">· {d.confidence} confidence</span>
                <RefLinks ids={d.refs} refs={s.refs} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>Risk to watch</h3>
      <ul className="plain"><ClaimLine c={b.riskToWatch} refs={s.refs} /></ul>
      {b.sectorNotes.length ? (
        <details>
          <summary className="small">Sector notes</summary>
          <ul className="small">{b.sectorNotes.map((n) => <li key={n.sector}><strong>{n.sector}:</strong> {n.note} <span className="tiny muted">· {n.confidence} confidence</span><RefLinks ids={n.refs} refs={s.refs} /></li>)}</ul>
        </details>
      ) : null}
      {b.dataGaps.length ? <p className="small muted">Not covered: {b.dataGaps.join("; ")}</p> : null}
      <AiMeta s={s} />
    </section>
  );
}

export function GroupedNews({ s, news }: { s: StoredSummary<MarketBrief>; news: Array<{ id: number; url: string; headline: string; publisher: string | null; publishedAt: Date }> }) {
  const byRef = new Map(news.map((n) => [`N${n.id}`, n]));
  const groups = s.output.newsGroups.map((g) => ({ ...g, items: g.items.filter((i) => byRef.has(i.ref)) })).filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div>
      {groups.map((g) => (
        <section key={g.category} style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 4 }}>{NEWS_CATEGORY[g.category]}</h3>
          <ul className="plain">
            {g.items.map((i) => {
              const n = byRef.get(i.ref)!;
              return (
                <li key={i.ref}>
                  <a href={n.url} target="_blank" rel="noopener noreferrer nofollow">{n.headline}</a>
                  <div className="tiny muted">{n.publisher ?? "Unknown publisher"} · {n.publishedAt.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET{i.relatedTickers.length ? ` · ${i.relatedTickers.join(", ")}` : ""}</div>
                  <div className="small"><span className="badge tag-fact">Summary</span> {i.factualSummary}</div>
                  <div className="small"><span className="badge tag-interpretation">Why it might matter</span> {i.plainEnglish} <span className="tiny muted">· market-connection confidence: {i.connectionConfidence}</span></div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
