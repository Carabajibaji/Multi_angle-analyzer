import type { Metadata } from "next";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Learn" };

export default function Page() {
  return (
    <Planned title="Learn" phase="Phase 4 (plain-English layer and Jargon Buster)">
      <p>A glossary of investing terms with plain-English definitions, examples and limitations, available from every analysis screen.</p>
    </Planned>
  );
}
