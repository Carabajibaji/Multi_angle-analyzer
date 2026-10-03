import type { DocumentAnalysis } from "@/lib/filings/analyzer";

/** Renders a deterministic document analysis. Pure presentational: usable from server and client components. */
export function AnalysisView({ a }: { a: DocumentAnalysis }) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="id">
        <h2 id="id">Document</h2>
        <dl className="kv">
          <div><dt>Company</dt><dd>{a.identity.companyName ?? "Not detected"}</dd></div>
          <div><dt>Document type</dt><dd>{a.identity.documentType ?? "Not detected"}</dd></div>
          <div><dt>Reporting period</dt><dd>{a.identity.period ?? "Not detected"}</dd></div>
          <div><dt>Source</dt><dd>{a.source.url ? <a href={a.source.url} target="_blank" rel="noopener noreferrer nofollow">{a.source.label}</a> : a.source.label}</dd></div>
        </dl>
        <p className="tiny muted">{a.identity.method} {a.characters.toLocaleString("en-US")} characters analysed at {new Date(a.analyzedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.</p>
        {a.incomplete.length ? (
          <div className="banner info" role="note" style={{ marginTop: 8 }}>
            <strong>Evidence may be incomplete:</strong>
            <ul style={{ margin: "4px 0 0" }}>{a.incomplete.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        ) : null}
      </section>

      {a.instructionLikeText.length ? (
        <section className="card" aria-labelledby="inj" style={{ borderColor: "var(--blush-ink)" }}>
          <h2 id="inj">Instruction-like text found in the document</h2>
          <p className="small">This document contains wording that looks like instructions to software or an AI. It was treated as ordinary document text and ignored. It may indicate a manipulated document.</p>
          <ul className="small">{a.instructionLikeText.map((p) => <li key={p.offset}>“…{p.text}…”</li>)}</ul>
        </section>
      ) : null}

      <section className="card" aria-labelledby="fl">
        <h2 id="fl">Risk and disclosure flags</h2>
        {a.flags.length ? (
          <ul className="plain">
            {a.flags.map((f) => (
              <li key={f.key}>
                <span className={`badge ${f.severity === "risk" ? "failed" : "stale"}`}>{f.severity === "risk" ? "Risk" : "Watch"}</span> <strong>{f.label}</strong> <span className="small muted">({f.count} mention{f.count === 1 ? "" : "s"})</span>
                <div className="small">{f.plain}</div>
                {f.passages.map((p) => (
                  <blockquote key={p.offset} className="small" style={{ margin: "6px 0 0", paddingLeft: 10, borderLeft: "3px solid var(--line)" }}>
                    “{p.text}” <span className="tiny muted">— {p.section}, character {p.offset.toLocaleString("en-US")}</span>
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None of the monitored phrases (material weakness, restatement, going concern, covenant breach, default, impairment, related-party transactions, auditor change, cybersecurity incident, litigation, liquidity pressure) were found. Negated mentions such as “no material weakness” are excluded.</p>
        )}
      </section>

      {a.comparison ? (
        <section className="card" aria-labelledby="cmp">
          <h2 id="cmp">Changes vs prior period</h2>
          <p className="small muted">Compared with {a.comparison.priorLabel}.</p>
          <ul className="small">
            {a.comparison.newFlags.length ? <li>New flags this period: {a.comparison.newFlags.join(", ")}</li> : <li>No new flags compared with the prior filing.</li>}
            {a.comparison.resolvedFlags.length ? <li>Flags no longer present: {a.comparison.resolvedFlags.join(", ")}</li> : null}
            <li>{a.comparison.newRiskParagraphs.length} new or reworded risk-factor paragraph(s); {a.comparison.removedRiskParagraphs} removed or reworded.</li>
          </ul>
          {a.comparison.newRiskParagraphs.map((p) => (
            <blockquote key={p.slice(0, 40)} className="small" style={{ margin: "6px 0", paddingLeft: 10, borderLeft: "3px solid var(--lavender-ink)" }}>{p.slice(0, 700)}{p.length > 700 ? "…" : ""}</blockquote>
          ))}
          <div className="table-scroll">
            <table>
              <thead><tr><th>Section</th><th className="r">Words now</th><th className="r">Words prior</th></tr></thead>
              <tbody>{a.comparison.sectionChanges.map((s) => <tr key={s.title}><td>{s.title}</td><td className="r">{s.currentWords.toLocaleString("en-US")}</td><td className="r">{s.priorWords?.toLocaleString("en-US") ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card" aria-labelledby="fv">
        <h2 id="fv">Reported facts vs management commentary</h2>
        <div className="grid two">
          <div>
            <h3 style={{ marginTop: 0 }}><span className="badge tag-fact">Fact</span> Reported figures</h3>
            {a.statements.facts.length ? <ul className="small">{a.statements.facts.map((s) => <li key={s.text}>{s.text} <span className="tiny muted">— {s.section}</span></li>)}</ul> : <p className="muted small">None found.</p>}
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}><span className="badge tag-interpretation">Commentary</span> Management views & expectations</h3>
            {a.statements.commentary.length ? <ul className="small">{a.statements.commentary.map((s) => <li key={s.text}>{s.text} <span className="tiny muted">— {s.section}</span></li>)}</ul> : <p className="muted small">None found.</p>}
          </div>
        </div>
        <p className="tiny muted">{a.statements.method}</p>
      </section>

      <section className="card" aria-labelledby="sec">
        <h2 id="sec">Sections found</h2>
        {a.sections.length ? (
          <ul className="plain">
            {a.sections.map((s) => (
              <li key={s.key}>
                <details>
                  <summary><strong>{s.title}</strong> <span className="small muted">({s.words.toLocaleString("en-US")} words)</span></summary>
                  <p className="small">{s.excerpt}…</p>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No standard item sections recognised; flags were searched across the whole text.</p>
        )}
      </section>
      <p className="tiny muted">This analysis uses fixed text rules, not AI. It highlights passages to read; it does not judge the company. Always read the cited text in the original document.</p>
    </div>
  );
}
