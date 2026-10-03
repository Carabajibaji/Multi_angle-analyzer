"use client";
import { useState } from "react";
import { AnalysisView } from "@/components/AnalysisView";
import type { DocumentAnalysis } from "@/lib/filings/analyzer";

const MAX_BYTES = 1_000_000;

export function TextAnalyzer() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DocumentAnalysis | null>(null);

  async function submit(body: BodyInit, headers?: HeadersInit) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/filings/analyze", { method: "POST", body, headers });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? `Analysis failed (${res.status}).`);
    setResult(json as DocumentAnalysis);
  }

  return (
    <div>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void submit(JSON.stringify({ text }), { "Content-Type": "application/json" });
        }}
      >
        <label htmlFor="doc-text"><strong>Paste financial text</strong> (10-K/10-Q/8-K excerpt, earnings release, transcript…)</label>
        <textarea id="doc-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} maxLength={MAX_BYTES} style={{ width: "100%", marginTop: 6, font: "inherit", padding: 10, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <button className="primary" type="submit" disabled={busy || !text.trim()}>{busy ? "Analyzing…" : "Analyze text"}</button>
          <label className="small">
            or upload a .txt / .htm / .html file (max 1 MB):{" "}
            <input
              type="file"
              accept=".txt,.htm,.html,text/plain,text/html"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > MAX_BYTES) return setError("File is larger than 1 MB.");
                const fd = new FormData();
                fd.append("file", f);
                void submit(fd);
              }}
            />
          </label>
        </div>
        <p className="tiny muted">Your text is analysed on the server and not stored. Content is treated as data only; instructions inside it are never followed.</p>
        {error ? <p role="alert" className="small" style={{ color: "var(--blush-ink)" }}>{error}</p> : null}
      </form>
      {result ? <div className="section"><AnalysisView a={result} /></div> : null}
    </div>
  );
}
