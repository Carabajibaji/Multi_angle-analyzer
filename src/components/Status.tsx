import type { CheckStatus } from "@/lib/analysis/health";

const STATUS: Record<CheckStatus, { cls: string; icon: string; text: string }> = {
  pass: { cls: "fresh", icon: "✓", text: "Pass" },
  watch: { cls: "stale", icon: "!", text: "Watch" },
  fail: { cls: "failed", icon: "✕", text: "Fail" },
  unknown: { cls: "never", icon: "?", text: "Unknown" },
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  const s = STATUS[status];
  return (
    <span className={`badge ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span> {s.text}
    </span>
  );
}
