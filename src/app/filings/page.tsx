import type { Metadata } from "next";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Filings" };

export default function Page() {
  return (
    <Planned title="Filings" phase="Phase 3 (filing and document analyzer)">
      <p>Analyze 10-K, 10-Q, 8-K and proxy filings or pasted text. Facts are separated from management commentary, with cited passages and prompt-injection protection.</p>
    </Planned>
  );
}
