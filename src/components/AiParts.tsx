import type { Claim } from "@/lib/ai/prompts";
import type { Ref, StoredSummary } from "@/lib/ai/service";
import { fmtTime } from "./data";

const KIND: Record<Claim["kind"], { cls: string; text: string }> = {
  fact: { cls: "tag-fact", text: "Fact" },
  interpretation: { cls: "tag-interpretation", text: "Interpretation" },
  risk: { cls: "tag-risk", text: "Risk" },
  unknown: { cls: "tag-unknown", text: "Unknown" },
};

/** Footnote-style links to the stored sources an AI statement cites. */
export function RefLinks({ ids, refs }: { ids: string[]; refs: Ref[] }) {
  const found = ids.map((id) => refs.find((r) => r.id === id)).filter((r): r is Ref => !!r);
  if (!found.length) return <span className="tiny muted"> (no source cited)</span>;
  return (
    <span className="tiny muted">
      {" "}
      [
      {found.map((r, i) => (
        <span key={r.id}>
          {i ? "; " : ""}
          {r.url ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" title={r.label}>
              {r.label.length > 60 ? `${r.label.slice(0, 57)}…` : r.label}
            </a>
          ) : (
            r.label
          )}
        </span>
      ))}
      ]
    </span>
  );
}

export function ClaimLine({ c, refs }: { c: Claim; refs: Ref[] }) {
  const k = KIND[c.kind];
  return (
    <li>
      <span className={`badge ${k.cls}`}>{k.text}</span>{" "}
      {c.text}
      {c.kind !== "fact" ? <span className="tiny muted"> · {c.confidence} confidence</span> : null}
      <RefLinks ids={c.refs} refs={refs} />
    </li>
  );
}

export function AiMeta({ s }: { s: StoredSummary<unknown> }) {
  return (
    <p className="tiny muted" style={{ marginBottom: 0 }}>
      AI explanation generated {fmtTime(s.generatedAt.toISOString())} by {s.model} (prompt {s.promptName} v{s.promptVersion}; {s.evidenceStatus ?? "grounded"}). It only restates the cited stored data, but may contain errors — check the linked sources.
    </p>
  );
}
