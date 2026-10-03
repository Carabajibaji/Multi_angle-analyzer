import { describe, expect, it } from "vitest";
import { bollinger, computeIndicatorSnapshots, ema, macd, rsi, sma, volumeAverage } from "@/lib/indicators";

const close = (xs: number[]) => xs;

describe("SMA", () => {
  it("averages the trailing window and leaves warm-up as null", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("does not average across missing values", () => {
    expect(sma([1, 2, null, 4, 5, 6], 2)).toEqual([null, 1.5, null, null, 4.5, 5.5]);
  });
  it("rejects invalid periods", () => {
    expect(() => sma([1, 2], 0)).toThrow(RangeError);
  });
});

describe("EMA", () => {
  it("is seeded with the SMA and uses alpha = 2/(n+1)", () => {
    const out = ema([2, 4, 6, 8], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(4); // SMA seed
    expect(out[3]).toBeCloseTo(0.5 * 8 + 0.5 * 4); // alpha = 0.5
  });
});

describe("RSI (Wilder)", () => {
  it("is 100 when there are only gains and 50 when price is flat", () => {
    expect(rsi(close([1, 2, 3, 4, 5, 6]), 3).at(-1)).toBe(100);
    expect(rsi(close([5, 5, 5, 5, 5]), 3).at(-1)).toBe(50);
  });
  it("matches a hand-computed example", () => {
    // changes: +1, -1, +2, -1 ; period 2
    // first avg (changes 1..2): gain 0.5, loss 0.5 -> RSI 50 at index 2
    // idx3: gain (0.5*1+2)/2=1.25, loss (0.5*1+0)/2=0.25 -> RS 5 -> 83.333
    // idx4: gain (1.25)/2=0.625, loss (0.25+1)/2=0.625 -> 50
    const out = rsi([10, 11, 10, 12, 11], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(50);
    expect(out[3]).toBeCloseTo(83.3333, 3);
    expect(out[4]).toBeCloseTo(50);
  });
  it("stays within 0..100 on noisy data", () => {
    const xs = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 3) * 10 + (i % 7));
    for (const v of rsi(xs, 14)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });
});

describe("MACD", () => {
  it("line = EMA12 − EMA26, histogram = line − signal", () => {
    const xs = Array.from({ length: 80 }, (_, i) => 50 + i * 0.5 + Math.sin(i) * 2);
    const m = macd(xs);
    const e12 = ema(xs, 12);
    const e26 = ema(xs, 26);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).toBeCloseTo((e12[25] as number) - (e26[25] as number));
    const firstSignal = m.signal.findIndex((v) => v !== null);
    expect(firstSignal).toBe(25 + 8); // 9-period EMA of the MACD line
    expect(m.histogram[60]).toBeCloseTo((m.macd[60] as number) - (m.signal[60] as number));
  });
  it("is positive in a steady uptrend", () => {
    const xs = Array.from({ length: 60 }, (_, i) => 100 + i);
    expect(macd(xs).macd.at(-1)!).toBeGreaterThan(0);
  });
  it("rejects fast >= slow", () => {
    expect(() => macd([1, 2, 3], 26, 12)).toThrow();
  });
});

describe("Bollinger Bands", () => {
  it("uses population standard deviation", () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2); // classic example: mean 5, sd 2
    expect(b.middle.at(-1)).toBeCloseTo(5);
    expect(b.upper.at(-1)).toBeCloseTo(9);
    expect(b.lower.at(-1)).toBeCloseTo(1);
    expect(b.bandwidth.at(-1)).toBeCloseTo(8 / 5);
  });
  it("collapses to the price when there is no volatility", () => {
    const b = bollinger(Array(20).fill(10), 20, 2);
    expect(b.upper.at(-1)).toBe(10);
    expect(b.lower.at(-1)).toBe(10);
  });
});

describe("volume average & snapshot set", () => {
  it("returns null ratio when volume is missing", () => {
    expect(volumeAverage([100, null, 300], 2)).toEqual([null, null, null]);
    const snaps = computeIndicatorSnapshots(Array.from({ length: 30 }, (_, i) => ({ close: 10 + i, volume: null })));
    const vol = snaps.find((s) => s.key === "volume_avg_20")!;
    expect(vol.values.ratio).toBeNull();
    expect(snaps.find((s) => s.key === "sma_200")!.values.value).toBeNull(); // not enough history -> null, not 0
  });
});
