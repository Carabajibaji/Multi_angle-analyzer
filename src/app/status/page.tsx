import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { fmtTime, FreshnessBadge, Unavailable } from "@/components/data";
import { ADMIN_COOKIE, adminConfigured, verifySession } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/client";
import { getStatus } from "@/lib/queries/status";
import { AdminLogin, RefreshButtons } from "./AdminControls";

export const metadata: Metadata = { title: "Data Status" };
export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const isAdmin = verifySession((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!isAdmin) {
    return (
      <>
        <h1>Data Status</h1>
        <p className="lede">Pipeline monitoring is restricted to administrators.</p>
        {adminConfigured() ? <AdminLogin /> : <Unavailable detail="ADMIN_TOKEN is not configured on the server" />}
      </>
    );
  }
  const { db } = await getDb();
  const s = await getStatus(db, new Date());
  return (
    <>
      <h1>Data Status</h1>
      <p className="lede">Generated {fmtTime(s.generatedAt)}. All schedules run in America/New_York time.</p>

      <div className="grid cards">
        <div className="card"><div className="value">{s.counts.fresh}</div><div className="small muted">datasets up to date</div></div>
        <div className="card"><div className="value">{s.counts.stale}</div><div className="small muted">stale datasets (showing last verified data)</div></div>
        <div className="card"><div className="value">{s.counts.failed}</div><div className="small muted">never loaded / failed</div></div>
        <div className="card"><div className="value">{s.counts.failedRecords7d}</div><div className="small muted">failed records, last 7 days</div></div>
      </div>

      <section className="section card" aria-labelledby="jobs">
        <div className="section-head"><h2 id="jobs">Scheduled jobs</h2></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Job</th><th>Schedule</th><th>Last attempt</th><th>Last success</th><th>Next scheduled</th></tr></thead>
            <tbody>
              {s.jobs.map((j) => (
                <tr key={j.name}>
                  <td><strong>{j.name}</strong>{j.running ? <span className="badge stale"> running</span> : null}<div className="tiny muted">{j.description}</div></td>
                  <td className="small">{j.schedule}</td>
                  <td className="small">{j.lastAttempt ? <>{fmtTime(j.lastAttempt.startedAt)}<br /><Link href={`/status/runs/${j.lastAttempt.id}`}>{j.lastAttempt.status}</Link> · {j.lastAttempt.itemsOk} ok / {j.lastAttempt.itemsFailed} failed · {j.lastAttempt.trigger}</> : "Never"}</td>
                  <td className="small">{j.lastSuccess ? fmtTime(j.lastSuccess.startedAt) : "Never"}</td>
                  <td className="small">{fmtTime(j.nextScheduled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <RefreshButtons jobs={s.jobs.map((j) => j.name)} />
      </section>

      <section className="section card" aria-labelledby="providers">
        <div className="section-head"><h2 id="providers">Provider health</h2></div>
        {s.providers.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Provider</th><th>Status</th><th>Last OK</th><th>Last error</th><th>Rate limited until</th><th>Requests</th></tr></thead>
              <tbody>
                {s.providers.map((p) => (
                  <tr key={p.provider}>
                    <td>{p.provider}</td>
                    <td><span className={`badge ${p.status === "ok" ? "fresh" : p.status === "degraded" ? "stale" : "failed"}`}>{p.status}</span></td>
                    <td className="small">{p.lastOkAt ? fmtTime(p.lastOkAt.toISOString()) : "—"}</td>
                    <td className="small">{p.lastError ?? "—"}</td>
                    <td className="small">{p.rateLimitedUntil ? fmtTime(p.rateLimitedUntil.toISOString()) : "—"}</td>
                    <td className="num">{p.requestCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No provider activity recorded yet.</p>}
      </section>

      <section className="section card" aria-labelledby="datasets">
        <div className="section-head"><h2 id="datasets">Datasets needing attention</h2></div>
        {s.datasets.filter((d) => d.status !== "fresh").length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Dataset</th><th>Status</th><th>Data as of</th><th>Last success</th><th>Reason</th></tr></thead>
              <tbody>
                {s.datasets.filter((d) => d.status !== "fresh").map((d) => (
                  <tr key={d.key}>
                    <td>{d.key}</td>
                    <td><FreshnessBadge freshness={d} /></td>
                    <td className="small">{d.dataAsOf ?? "—"}</td>
                    <td className="small">{d.lastSuccessAt ? fmtTime(d.lastSuccessAt) : "Never"}</td>
                    <td className="small">{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">All {s.counts.datasets} datasets are up to date.</p>}
      </section>

      <section className="section card" aria-labelledby="errors">
        <div className="section-head"><h2 id="errors">Recent errors (7 days)</h2></div>
        {s.recentErrors.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>When</th><th>Item</th><th>Class</th><th>Message</th></tr></thead>
              <tbody>
                {s.recentErrors.map((e) => (
                  <tr key={e.id}><td className="small">{fmtTime(e.at.toISOString())}</td><td className="small">{e.itemKey}</td><td><span className="badge failed">{e.errorClass}</span></td><td className="small">{e.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No errors recorded.</p>}
      </section>

      <section className="section card" aria-labelledby="runs">
        <div className="section-head"><h2 id="runs">Recent runs</h2></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>#</th><th>Job</th><th>Run key</th><th>Status</th><th>Trigger</th><th>Started</th><th>OK / failed / unchanged</th></tr></thead>
            <tbody>
              {s.recentRuns.map((r) => (
                <tr key={r.id}><td><Link href={`/status/runs/${r.id}`}>{r.id}</Link></td><td>{r.job}</td><td className="tiny">{r.runKey}</td><td>{r.status}</td><td>{r.trigger}</td><td className="small">{fmtTime(r.startedAt.toISOString())}</td><td className="num">{r.itemsOk} / {r.itemsFailed} / {r.itemsSkipped}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section card" aria-labelledby="recon">
        <div className="section-head"><h2 id="recon">Latest weekly reconciliation</h2></div>
        {s.reconciliation ? (
          <details><summary>Report for {s.reconciliation.asOf}</summary><pre className="log">{JSON.stringify(s.reconciliation.content, null, 2)}</pre></details>
        ) : <p className="muted">No reconciliation has run yet.</p>}
      </section>
    </>
  );
}
