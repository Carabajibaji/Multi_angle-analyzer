import type { Metadata } from "next";
import { GLOSSARY } from "@/content/glossary";

export const metadata: Metadata = { title: "Learn" };

export default function LearnPage() {
  const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  return (
    <>
      <h1>Learn: Jargon Buster</h1>
      <p className="lede">Plain-English definitions of the terms used across this site. Underlined terms with a “?” elsewhere open these definitions without leaving the page.</p>
      <section className="card" aria-labelledby="labels">
        <h2 id="labels">How to read labels on this site</h2>
        <ul className="small">
          <li><span className="badge tag-fact">Fact</span> reported by a company, regulator or data provider, with a source.</li>
          <li><span className="badge tag-calculation">Calculation</span> computed by this site&apos;s code from facts, with the formula shown.</li>
          <li><span className="badge tag-interpretation">Interpretation</span> a reasoned reading of facts or calculations; others may read them differently.</li>
          <li><span className="badge tag-risk">Risk</span> something that could hurt the business or shareholders.</li>
          <li><span className="badge tag-unknown">Unknown</span> information that is missing or not yet extracted.</li>
        </ul>
      </section>
      <nav className="section card" aria-label="Glossary index">
        <p className="small" style={{ margin: 0 }}>{sorted.map((g, i) => <span key={g.slug}>{i ? " · " : ""}<a href={`#${g.slug}`}>{g.term}</a></span>)}</p>
      </nav>
      <div className="grid two section">
        {sorted.map((g) => (
          <article key={g.slug} id={g.slug} className="card" style={{ scrollMarginTop: 80 }}>
            <h2>{g.term}</h2>
            <p>{g.plain}</p>
            <dl className="small" style={{ margin: 0 }}>
              <dt style={{ fontWeight: 650 }}>Why investors look at it</dt><dd style={{ margin: "2px 0 8px" }}>{g.why}</dd>
              <dt style={{ fontWeight: 650 }}>Example (illustrative numbers)</dt><dd style={{ margin: "2px 0 8px" }}>{g.example}</dd>
              <dt style={{ fontWeight: 650 }}>Important limitation</dt><dd style={{ margin: "2px 0 0" }}>{g.limitation}</dd>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
