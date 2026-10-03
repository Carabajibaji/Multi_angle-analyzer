import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fmtTime } from "@/components/data";
import { ADMIN_COOKIE, verifySession } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/client";
import { getRunLog } from "@/lib/queries/status";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  if (!verifySession((await cookies()).get(ADMIN_COOKIE)?.value)) redirect("/status");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const { db } = await getDb();
  const run = await getRunLog(db, id);
  if (!run) notFound();
  return (
    <>
      <p><Link href="/status">← Data Status</Link></p>
      <h1>Run #{run.id}: {run.jobName}</h1>
      <p className="lede">{run.status} · {run.trigger} · started {fmtTime(run.startedAt.toISOString())}{run.finishedAt ? ` · finished ${fmtTime(run.finishedAt.toISOString())}` : ""}</p>
      <div className="card"><h2>Summary</h2><pre className="log">{JSON.stringify(run.summary, null, 2)}</pre></div>
      <div className="card section"><h2>Log</h2><pre className="log">{run.log ?? "(no log)"}</pre></div>
    </>
  );
}
