import type { Metadata } from "next";
import { WatchlistClient } from "./WatchlistClient";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <>
      <h1>Your watchlist</h1>
      <p className="lede">Saved in this browser only (no account needed). Prices are the latest stored daily closes from the automated pipeline.</p>
      <WatchlistClient />
    </>
  );
}
