import type { FilingSummary } from "@/lib/ai/prompts";
import type { StoredSummary } from "@/lib/ai/service";
import { AiMeta, ClaimLine } from "./AiParts";

export function FilingSummaryView({ s }: { s: StoredSummary<FilingSummary> }) {
  const f = s.output;
  return (
    <section className="card" aria-labelledby="ai-filing">
      <div className="section-head">
        <h2 id="ai-filing">Plain-English summary</h2>
        <span className="badge tag-interpretation">AI explanation</span>
      </div>
      <p>{f.plainSummary}</p>
      {f.keyPoints.length ? <><h3>Key points</h3><ul className="plain">{f.keyPoints.map((c) => <ClaimLine key={c.text} c={c} refs={s.refs} />)}</ul></> : null}
      {f.risks.length ? <><h3>Risks mentioned</h3><ul className="plain">{f.risks.map((c) => <ClaimLine key={c.text} c={c} refs={s.refs} />)}</ul></> : null}
      {f.changesVsPrior.length ? <><h3>What changed vs the prior filing</h3><ul className="plain">{f.changesVsPrior.map((c) => <ClaimLine key={c.text} c={c} refs={s.refs} />)}</ul></> : null}
      {f.questionsForResearch.length ? <><h3>Questions worth researching</h3><ul className="small">{f.questionsForResearch.map((q) => <li key={q}>{q}</li>)}</ul></> : null}
      <p className="small muted">What this summary does not cover: {f.evidenceNote}</p>
      <AiMeta s={s} />
    </section>
  );
}
