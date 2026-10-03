import type { Metadata } from "next";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Companies" };

export default function Page() {
  return (
    <Planned title="Companies" phase="Phase 3 (company search, overview, financial health, governance)">
      <p>Search by ticker or company name, then see a unified company page with Overview, Financial Health, Governance, Competitive Landscape, Technical Analysis and Filings & Sources tabs. SEC filings, 8-K governance events and normalized financial statements are already being collected nightly.</p>
    </Planned>
  );
}
