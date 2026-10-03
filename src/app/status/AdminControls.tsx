"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card"
      style={{ maxWidth: 420 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const token = new FormData(e.currentTarget).get("token");
        const res = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        setBusy(false);
        if (res.ok) router.refresh();
        else setError(res.status === 429 ? "Too many attempts. Wait a minute and try again." : "That token was not accepted.");
      }}
    >
      <label htmlFor="token">Admin token</label>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input id="token" name="token" type="password" autoComplete="current-password" required style={{ flex: 1 }} />
        <button className="primary" type="submit" disabled={busy}>Sign in</button>
      </div>
      {error ? <p role="alert" className="small" style={{ color: "var(--blush-ink)" }}>{error}</p> : null}
    </form>
  );
}

export function RefreshButtons({ jobs }: { jobs: string[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {jobs.map((j) => (
          <button
            key={j}
            type="button"
            disabled={busy !== null}
            aria-busy={busy === j}
            onClick={async () => {
              setBusy(j);
              setMessage(`Running ${j}…`);
              const res = await fetch("/api/admin/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: j }) });
              const body = await res.json().catch(() => ({}));
              setBusy(null);
              setMessage(res.ok ? `${j}: ${body.status ?? "requested"}${body.message ? ` (${body.message})` : ""}` : `${j}: ${body.error ?? `failed (${res.status})`}`);
              router.refresh();
            }}
          >
            {busy === j ? "Refreshing…" : `Refresh ${j}`}
          </button>
        ))}
      </div>
      <p className="small muted" role="status" aria-live="polite">{message ?? "Manual refresh runs a job immediately, outside its schedule."}</p>
    </div>
  );
}
