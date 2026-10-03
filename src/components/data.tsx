import type { Freshness } from "@/lib/pipeline/freshness";
import { DATA_NATURE_LABEL, type DataNature } from "@/lib/providers/types";

export const UNAVAILABLE = "Data unavailable from the connected provider.";

export function Unavailable({ detail }: { detail?: string }) {
  return (
    <p className="unavailable">
      {UNAVAILABLE}
      {detail ? <span className="small"> ({detail})</span> : null}
    </p>
  );
}

const FRESH_TEXT: Record<Freshness["status"], string> = { fresh: "Up to date", stale: "Stale", failed: "Update failed", never: "Not loaded" };
const FRESH_ICON: Record<Freshness["status"], string> = { fresh: "●", stale: "◐", failed: "✕", never: "○" };

export function FreshnessBadge({ freshness, lastSuccessAt }: { freshness: Freshness; lastSuccessAt?: string | null }) {
  const title = `${freshness.reason}${lastSuccessAt ? ` Last successful update: ${fmtTime(lastSuccessAt)}.` : ""}`;
  return (
    <span className={`badge ${freshness.status}`} title={title}>
      <span aria-hidden="true">{FRESH_ICON[freshness.status]}</span>
      {FRESH_TEXT[freshness.status]}
      <span className="sr-only">: {title}</span>
    </span>
  );
}

export function NatureBadge({ nature }: { nature: string | null }) {
  if (!nature) return null;
  return <span className="badge nature">{DATA_NATURE_LABEL[nature as DataNature] ?? nature}</span>;
}

export function SourceLine({ name, url, retrievedAt, extra }: { name: string; url: string | null; retrievedAt?: string | null; extra?: string }) {
  return (
    <p className="tiny muted" style={{ margin: "8px 0 0" }}>
      Source:{" "}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow">
          {name}
        </a>
      ) : (
        name
      )}
      {retrievedAt ? ` · retrieved ${fmtTime(retrievedAt)}` : ""}
      {extra ? ` · ${extra}` : ""}
    </p>
  );
}

export function Change({ pct, abs, unit }: { pct: number | null; abs?: number | null; unit?: string | null }) {
  if (pct == null) return <span className="chg flat">No prior value to compare</span>;
  const dir = pct > 0.0001 ? "up" : pct < -0.0001 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  const word = dir === "up" ? "Up" : dir === "down" ? "Down" : "Unchanged";
  const absText = abs != null ? `${abs > 0 ? "+" : ""}${fmtNum(abs)}${unit === "%" ? " pts" : ""} ` : "";
  return (
    <span className={`chg ${dir}`}>
      <span aria-hidden="true">{arrow} </span>
      <span className="sr-only">{word} </span>
      {absText}({pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%)
    </span>
  );
}

export function fmtNum(v: number, digits?: number): string {
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export function Disclosure({ children }: { children: React.ReactNode }) {
  return <p className="tiny muted" style={{ marginTop: 8 }}>{children}</p>;
}
