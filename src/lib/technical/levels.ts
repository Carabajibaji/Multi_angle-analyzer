/** Support/resistance from clustered swing pivots (≥ 2 touches within a tolerance band). */
import { findPivots, type Bar } from "./pivots";

export interface Level {
  price: number;
  touches: number;
  kind: "support" | "resistance";
  lastTouch: string;
}

export function supportResistance(bars: Bar[], opts: { window?: number; lookback?: number; tolerance?: number } = {}): Level[] {
  const lookback = opts.lookback ?? 250;
  const tolerance = opts.tolerance ?? 0.015;
  const recent = bars.slice(-lookback);
  if (recent.length < 20) return [];
  const pivots = findPivots(recent, opts.window ?? 5).sort((a, b) => a.price - b.price);
  const clusters: Array<{ prices: number[]; last: string }> = [];
  for (const p of pivots) {
    const c = clusters.at(-1);
    if (c && p.price / (c.prices.reduce((s, x) => s + x, 0) / c.prices.length) - 1 <= tolerance) {
      c.prices.push(p.price);
      if (p.date > c.last) c.last = p.date;
    } else clusters.push({ prices: [p.price], last: p.date });
  }
  const close = recent.at(-1)!.close;
  return clusters
    .filter((c) => c.prices.length >= 2)
    .map((c) => {
      const price = c.prices.reduce((s, x) => s + x, 0) / c.prices.length;
      return { price, touches: c.prices.length, kind: price <= close ? ("support" as const) : ("resistance" as const), lastTouch: c.last };
    });
}

/** The nearest support below and resistance above the latest close. */
export function nearestLevels(levels: Level[], close: number) {
  const support = levels.filter((l) => l.price <= close).sort((a, b) => b.price - a.price)[0] ?? null;
  const resistance = levels.filter((l) => l.price > close).sort((a, b) => a.price - b.price)[0] ?? null;
  return { support, resistance };
}
