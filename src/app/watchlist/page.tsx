import type { Metadata } from "next";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Watchlist" };

export default function Page() {
  return (
    <Planned title="Watchlist" phase="Phase 3 (personal watchlists)">
      <p>Save companies to your own watchlist. The system's rules-based Stocks to Watch list is already built daily and shown on the Today page.</p>
    </Planned>
  );
}
