"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnalyzeButton({ ticker, tracked }: { ticker: string; tracked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="primary"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setMsg("Fetching filings, financials and prices… this can take up to a minute.");
          const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/analyze`, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          setMsg(res.ok ? `Done (${body.status}: ${body.itemsOk ?? 0} updated, ${body.itemsFailed ?? 0} failed).` : (body.error ?? `Failed (${res.status}).`));
          router.refresh();
        }}
      >
        {busy ? "Analyzing…" : tracked ? "Refresh this company now" : "Analyze this company"}
      </button>
      <p className="small muted" role="status" aria-live="polite">{msg ?? (tracked ? "Tracked companies also refresh automatically every day." : "Not tracked yet: analysis loads its data and adds it to the daily refresh.")}</p>
    </div>
  );
}
