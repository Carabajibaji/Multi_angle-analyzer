/**
 * Algorithmic detection of POSSIBLE double bottoms ("W") and double tops ("M").
 * These are candidate shapes, not predictions. Every parameter and the confidence formula are
 * exposed so users can see exactly why something was flagged.
 */
import { sma } from "../indicators";
import { findPivots, type Bar, type Pivot } from "./pivots";

export interface PatternParams {
  pivotWindow: number;
  /** Max difference between the two lows (or highs), as a fraction of their average. */
  similarityTolerance: number;
  /** Min height of the middle peak (trough) relative to the lows (highs). */
  minDepth: number;
  minSeparation: number;
  maxSeparation: number;
  /** Only report patterns whose second point is within this many bars of the latest bar. */
  lookback: number;
  /** Breakout volume must be ≥ this multiple of its 20-day average for volume confirmation. */
  volumeMultiple: number;
}

export const DEFAULT_PATTERN_PARAMS: PatternParams = {
  pivotWindow: 5,
  similarityTolerance: 0.03,
  minDepth: 0.05,
  minSeparation: 10,
  maxSeparation: 120,
  lookback: 90,
  volumeMultiple: 1.3,
};

export type PatternKind = "double_bottom" | "double_top";
export type PatternStatus = "forming" | "completed" | "invalidated";

export interface PatternDetection {
  pattern: PatternKind;
  first: Pivot;
  middle: Pivot;
  second: Pivot;
  neckline: number;
  status: PatternStatus;
  /** Bar where the neckline break (completion) or invalidation happened. */
  resolvedAt: { index: number; date: string } | null;
  detectedOn: string;
  volumeConfirmed: boolean | null;
  invalidationLevel: number;
  confidence: number;
  confidenceBreakdown: Record<string, number>;
  /** Measured-move objective (neckline ± pattern height); a reference level, not a forecast. */
  measuredTarget: number;
  explanation: string;
}

export function detectDoublePatterns(bars: Bar[], params: Partial<PatternParams> = {}): PatternDetection[] {
  const p = { ...DEFAULT_PATTERN_PARAMS, ...params };
  if (bars.length < p.minSeparation + 2 * p.pivotWindow) return [];
  const pivots = findPivots(bars, p.pivotWindow);
  const volAvg = sma(bars.map((b) => b.volume), 20);
  const lastIndex = bars.length - 1;
  const results: PatternDetection[] = [];

  for (const kind of ["double_bottom", "double_top"] as const) {
    const extremeKind = kind === "double_bottom" ? "low" : "high";
    const extremes = pivots.filter((x) => x.kind === extremeKind);
    for (let a = 0; a < extremes.length; a++) {
      for (let b = a + 1; b < extremes.length; b++) {
        const first = extremes[a]!;
        const second = extremes[b]!;
        const sep = second.index - first.index;
        if (sep < p.minSeparation) continue;
        if (sep > p.maxSeparation) break;
        if (lastIndex - second.index > p.lookback) continue;
        const avg = (first.price + second.price) / 2;
        const diff = Math.abs(first.price - second.price) / avg;
        if (diff > p.similarityTolerance) continue;

        // Middle: highest high (W) / lowest low (M) strictly between the two points.
        let middleIdx = first.index + 1;
        for (let i = first.index + 1; i < second.index; i++) {
          if (kind === "double_bottom" ? bars[i]!.high > bars[middleIdx]!.high : bars[i]!.low < bars[middleIdx]!.low) middleIdx = i;
        }
        const neckline = kind === "double_bottom" ? bars[middleIdx]!.high : bars[middleIdx]!.low;
        const depth = kind === "double_bottom" ? neckline / Math.max(first.price, second.price) - 1 : 1 - neckline / Math.min(first.price, second.price);
        if (depth < p.minDepth) continue;
        // The second point must be the extreme between the middle and itself (no deeper dip in between).
        let clean = true;
        for (let i = first.index + 1; i < second.index; i++) {
          if (kind === "double_bottom" ? bars[i]!.low < Math.min(first.price, second.price) : bars[i]!.high > Math.max(first.price, second.price)) clean = false;
        }
        if (!clean) continue;

        const invalidationLevel = kind === "double_bottom" ? Math.min(first.price, second.price) : Math.max(first.price, second.price);
        let status: PatternStatus = "forming";
        let resolvedAt: PatternDetection["resolvedAt"] = null;
        let volumeConfirmed: boolean | null = null;
        for (let i = second.index + 1; i <= lastIndex; i++) {
          const c = bars[i]!.close;
          if (kind === "double_bottom" ? c > neckline : c < neckline) {
            status = "completed";
            resolvedAt = { index: i, date: bars[i]!.date };
            const v = bars[i]!.volume;
            const va = volAvg[i - 1] ?? null;
            volumeConfirmed = v != null && va != null ? v >= p.volumeMultiple * va : null;
            break;
          }
          if (kind === "double_bottom" ? c < invalidationLevel : c > invalidationLevel) {
            status = "invalidated";
            resolvedAt = { index: i, date: bars[i]!.date };
            break;
          }
        }

        const height = Math.abs(neckline - invalidationLevel);
        const breakdown = {
          similarity: round(0.3 * (1 - diff / p.similarityTolerance)),
          depth: round(0.2 * Math.min(1, depth / (2 * p.minDepth))),
          completion: status === "completed" ? 0.25 : 0,
          volume: volumeConfirmed ? 0.25 : 0,
        };
        const confidence = status === "invalidated" ? 0 : round(Object.values(breakdown).reduce((s, x) => s + x, 0));
        const label = kind === "double_bottom" ? "double bottom (W)" : "double top (M)";
        results.push({
          pattern: kind,
          first,
          middle: { index: middleIdx, date: bars[middleIdx]!.date, price: neckline, kind: kind === "double_bottom" ? "high" : "low" },
          second,
          neckline,
          status,
          resolvedAt,
          detectedOn: bars[lastIndex]!.date,
          volumeConfirmed,
          invalidationLevel,
          confidence,
          confidenceBreakdown: breakdown,
          measuredTarget: kind === "double_bottom" ? neckline + height : neckline - height,
          explanation:
            `Possible ${label}: ${extremeKind}s of ${first.price.toFixed(2)} (${first.date}) and ${second.price.toFixed(2)} (${second.date}) ` +
            `are within ${(diff * 100).toFixed(1)}% of each other, with a ${kind === "double_bottom" ? "peak" : "trough"} at ${neckline.toFixed(2)} between them. ` +
            (status === "completed"
              ? `Price closed ${kind === "double_bottom" ? "above" : "below"} the neckline on ${resolvedAt!.date}${volumeConfirmed ? " on above-average volume" : volumeConfirmed === false ? " without above-average volume" : ""}.`
              : status === "invalidated"
                ? `The pattern was invalidated on ${resolvedAt!.date} when price closed ${kind === "double_bottom" ? "below the lows" : "above the highs"}.`
                : `Not confirmed: no close ${kind === "double_bottom" ? "above" : "below"} the neckline yet.`),
        });
      }
    }
  }
  // Keep the most recent, highest-confidence candidate per kind and second point.
  const best = new Map<string, PatternDetection>();
  for (const r of results) {
    const key = `${r.pattern}:${r.second.index}`;
    const cur = best.get(key);
    if (!cur || r.confidence > cur.confidence || (r.confidence === cur.confidence && r.first.index > cur.first.index)) best.set(key, r);
  }
  return [...best.values()].sort((x, y) => y.second.index - x.second.index);
}

const round = (n: number) => Math.round(n * 1000) / 1000;
