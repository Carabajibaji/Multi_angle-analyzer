export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface Pivot {
  index: number;
  date: string;
  price: number;
  kind: "high" | "low";
}

/**
 * Swing pivots: bar i is a pivot low if its low is the strict minimum of the `k` bars on each side
 * (pivot high: strict maximum of highs). Pivots need `k` bars after them, so they lag by `k` bars.
 */
export function findPivots(bars: Bar[], k = 5): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j]!.low <= bars[i]!.low) isLow = false;
      if (bars[j]!.high >= bars[i]!.high) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) out.push({ index: i, date: bars[i]!.date, price: bars[i]!.low, kind: "low" });
    if (isHigh) out.push({ index: i, date: bars[i]!.date, price: bars[i]!.high, kind: "high" });
  }
  return out;
}
