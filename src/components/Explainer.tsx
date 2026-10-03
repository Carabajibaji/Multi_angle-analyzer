import type { Explainer as ExplainerData, ExplainTag } from "@/lib/analysis/explain";

const TAG_TEXT: Record<ExplainTag, string> = { fact: "Fact", calculation: "Calculation", interpretation: "Interpretation", risk: "Risk", unknown: "Unknown" };

function Tag({ tag }: { tag: ExplainTag }) {
  return <span className={`badge tag-${tag}`}>{TAG_TEXT[tag]}</span>;
}

/** The consistent four-part plain-English explainer. Generated deterministically, not by AI. */
export function Explainer({ data, title = "In plain English" }: { data: ExplainerData; title?: string }) {
  return (
    <section className="card explainer" aria-label={title}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <dl>
        <dt>What is happening? <Tag tag={data.what.tag} /></dt>
        <dd>{data.what.text}</dd>
        <dt>Why might this matter? <Tag tag={data.why.tag} /></dt>
        <dd>{data.why.text}</dd>
        {data.analogy ? (
          <>
            <dt>Everyday analogy <Tag tag={data.analogy.tag} /></dt>
            <dd>{data.analogy.text}</dd>
          </>
        ) : null}
        <dt>Bottom line <Tag tag={data.bottomLine.tag} /></dt>
        <dd>{data.bottomLine.text}</dd>
      </dl>
      <p className="tiny muted" style={{ margin: 0 }}>Generated from the calculated values above by fixed rules (no AI).</p>
    </section>
  );
}
