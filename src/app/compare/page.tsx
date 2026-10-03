import type { Metadata } from "next";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Compare" };

export default function Page() {
  return (
    <Planned title="Compare" phase="Phase 3 (peer comparison and moat evidence)">
      <p>Transparent peer suggestions (industry code, business model, scale) with manual add/remove, a side-by-side metric table, and evidence-and-counterevidence moat assessments.</p>
    </Planned>
  );
}
