"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SummaryButton({ accession }: { accession: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="card">
      <button
        type="button"
        className="primary"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setMsg("Writing a plain-English summary from the cited passages…");
          const res = await fetch(`/api/filings/${accession}/summary`, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (res.ok) {
            setMsg(null);
            router.refresh();
          } else setMsg(body.error ?? `Failed (${res.status}).`);
        }}
      >
        {busy ? "Summarizing…" : "Explain this filing in plain English (AI)"}
      </button>
      <p className="small muted" role="status" aria-live="polite">{msg ?? "Uses only the passages shown below; every statement links back to its passage."}</p>
    </div>
  );
}
