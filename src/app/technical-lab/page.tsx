import type { Metadata } from "next";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Technical Lab" };

export default function Page() {
  return (
    <Planned title="Technical Lab" phase="Phase 3 (interactive charting)">
      <p>Interactive candlestick and volume charts with SMA, EMA, RSI, MACD and Bollinger Bands calculated from stored daily candles, W/M pattern candidates, and the triple-verification filter. Indicators are already recalculated after every close.</p>
    </Planned>
  );
}
