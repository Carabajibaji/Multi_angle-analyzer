import { describe, expect, it } from "vitest";
import { nearestLevels, supportResistance } from "@/lib/technical/levels";
import { detectDoublePatterns } from "@/lib/technical/patterns";
import { findPivots, type Bar } from "@/lib/technical/pivots";
import { tripleVerification } from "@/lib/technical/verification";

/** Build bars by linear interpolation through [index, price] knots. */
function path(knots: Array<[number, number]>, opts: { volume?: (i: number) => number } = {}): Bar[] {
  const bars: Bar[] = [];
  for (let k = 0; k < knots.length - 1; k++) {
    const [i0, p0] = knots[k]!;
    const [i1, p1] = knots[k + 1]!;
    for (let i = i0; i < i1; i++) {
      const close = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
      bars.push(bar(i, close, opts.volume?.(i) ?? 1000));
    }
  }
  const [iL, pL] = knots.at(-1)!;
  bars.push(bar(iL, pL, opts.volume?.(iL) ?? 1000));
  return bars;
}

function bar(i: number, close: number, volume: number): Bar {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  return { date: d, open: close, high: close + 0.2, low: close - 0.2, close, volume };
}

describe("pivots", () => {
  it("finds strict swing highs and lows", () => {
    const bars = path([[0, 100], [10, 90], [20, 100], [30, 90]]);
    const p = findPivots(bars, 3);
    expect(p.filter((x) => x.kind === "low").map((x) => x.index)).toEqual([10]);
    expect(p.filter((x) => x.kind === "high").map((x) => x.index)).toEqual([20]);
  });
});

describe("double bottom / double top", () => {
  it("detects a completed, volume-confirmed W", () => {
    const bars = path([[0, 100], [20, 80], [30, 90], [40, 80.5], [50, 89], [52, 95], [60, 96]], { volume: (i) => (i === 51 ? 5000 : 1000) });
    const w = detectDoublePatterns(bars).find((p) => p.pattern === "double_bottom")!;
    expect(w).toBeDefined();
    expect(w.first.index).toBe(20);
    expect(w.second.index).toBe(40);
    expect(w.neckline).toBeCloseTo(90.2);
    expect(w.status).toBe("completed");
    expect(w.resolvedAt!.index).toBe(51);
    expect(w.volumeConfirmed).toBe(true);
    expect(w.invalidationLevel).toBeCloseTo(79.8);
    expect(w.confidence).toBeGreaterThan(0.7);
    expect(w.explanation).toMatch(/Possible double bottom/);
  });

  it("reports a forming W without a neckline break, and no volume verdict", () => {
    const bars = path([[0, 100], [20, 80], [30, 90], [40, 80.5], [50, 86]]);
    const w = detectDoublePatterns(bars).find((p) => p.pattern === "double_bottom")!;
    expect(w.status).toBe("forming");
    expect(w.volumeConfirmed).toBeNull();
    expect(w.confidenceBreakdown.completion).toBe(0);
  });

  it("marks a W invalidated when price breaks the lows", () => {
    const bars = path([[0, 100], [20, 80], [30, 90], [40, 80.5], [45, 84], [55, 70], [60, 72]]);
    const w = detectDoublePatterns(bars).find((p) => p.pattern === "double_bottom" && p.second.index === 40)!;
    expect(w.status).toBe("invalidated");
    expect(w.confidence).toBe(0);
  });

  it("detects an M (double top)", () => {
    const bars = path([[0, 80], [20, 100], [30, 90], [40, 99.5], [50, 91], [52, 85], [60, 84]], { volume: (i) => (i === 51 ? 5000 : 1000) });
    const m = detectDoublePatterns(bars).find((p) => p.pattern === "double_top")!;
    expect(m.status).toBe("completed");
    expect(m.volumeConfirmed).toBe(true);
    expect(m.measuredTarget).toBeLessThan(m.neckline);
  });

  it("ignores lows that are too different or too shallow", () => {
    expect(detectDoublePatterns(path([[0, 100], [20, 80], [30, 90], [40, 70], [55, 75]])).filter((p) => p.pattern === "double_bottom" && p.first.index === 20)).toHaveLength(0);
    expect(detectDoublePatterns(path([[0, 100], [20, 80], [30, 81.5], [40, 80], [55, 79]])).filter((p) => p.pattern === "double_bottom")).toHaveLength(0);
  });
});

describe("triple verification", () => {
  const up = Array.from({ length: 260 }, (_, i) => bar(i, 50 + i * 0.3 + Math.sin(i / 2), i === 259 ? 5000 : 1000));
  // make the last bar a 20-day closing high
  up[259] = { ...up[259]!, close: up[258]!.close + 3, high: up[258]!.close + 3.2 };

  it("passes all three checks in a strong uptrend with a volume breakout", () => {
    const r = tripleVerification(up, "bullish");
    expect(r.checks.map((c) => c.passed)).toEqual([true, true, true]);
    expect(r.label).toBe("Technically confirmed under the selected rules");
    expect(r.disclaimer).toMatch(/does not predict/);
  });

  it("fails the bearish view of the same data", () => {
    const r = tripleVerification(up, "bearish");
    expect(r.passedCount).toBe(0);
    expect(r.label).toBe("Insufficient evidence");
  });

  it("reports insufficient data instead of guessing", () => {
    const r = tripleVerification(up.slice(0, 15), "bullish");
    expect(r.checks.every((c) => c.passed === null)).toBe(true);
  });

  it("explains each rule and the measured values", () => {
    const r = tripleVerification(up, "bullish");
    expect(r.checks[0]!.detail).toMatch(/SMA50/);
    expect(r.checks[1]!.rule).toMatch(/MACD/);
  });
});

describe("support & resistance", () => {
  it("clusters repeated pivots into levels", () => {
    const bars = path([[0, 100], [10, 90], [20, 100], [30, 90.5], [40, 100.4], [50, 95]]);
    const levels = supportResistance(bars, { window: 3 });
    const { support, resistance } = nearestLevels(levels, 95);
    expect(support!.price).toBeCloseTo(90.05, 0);
    expect(support!.touches).toBe(2);
    expect(resistance!.price).toBeCloseTo(100.4, 0);
  });
});
