"use client";
/**
 * Interactive daily candlestick chart (TradingView lightweight-charts, Apache-2.0).
 * All indicator values are computed on the server from stored candles and passed in; the client only draws.
 * Up candles are hollow and down candles filled, so direction is visible without relying on colour.
 */
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TechnicalView } from "@/lib/queries/company";

type Range = "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";
const RANGE_DAYS: Record<Range, number | null> = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "5Y": 1827, MAX: null };

interface Props {
  view: Pick<TechnicalView, "bars" | "overlays" | "rsi" | "macd" | "patterns" | "levels" | "lastDate" | "firstDate">;
  ticker: string;
  summary: string;
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function PriceChart({ view, ticker, summary }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<Range>("1Y");
  const [show, setShow] = useState({ sma20: false, sma50: true, sma200: true, bb: false, rsi: true, macd: true, patterns: true, levels: true });
  const [legend, setLegend] = useState<string>("");
  const [full, setFull] = useState(false);

  const lastBar = view.bars.at(-1);
  const defaultLegend = useMemo(
    () => (lastBar ? `${lastBar.time}  O ${lastBar.open.toFixed(2)}  H ${lastBar.high.toFixed(2)}  L ${lastBar.low.toFixed(2)}  C ${lastBar.close.toFixed(2)}  Vol ${lastBar.volume?.toLocaleString("en-US") ?? "n/a"}` : ""),
    [lastBar],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ink = cssVar("--ink", "#26282b");
    const line = cssVar("--line", "#e4dfd6");
    const surface = cssVar("--surface", "#ffffff");
    const up = cssVar("--sage-ink", "#2f5d3a");
    const down = cssVar("--blush-ink", "#8a2f2f");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: surface }, textColor: ink, fontFamily: "ui-sans-serif, system-ui, sans-serif", panes: { separatorColor: line } },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line },
      localization: { locale: "en-US" },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "rgba(0,0,0,0)",
      borderUpColor: up,
      wickUpColor: up,
      downColor: down,
      borderDownColor: down,
      wickDownColor: down,
      priceLineVisible: false,
    });
    candles.setData(view.bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));

    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(view.bars.filter((b) => b.volume != null).map((b) => ({ time: b.time as Time, value: b.volume as number, color: b.close >= b.open ? `${up}55` : `${down}55` })));

    const addLine = (data: Array<{ time: string; value: number }>, color: string, pane = 0, opts: Record<string, unknown> = {}) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts }, pane);
      s.setData(data.map((d) => ({ time: d.time as Time, value: d.value })));
      return s;
    };
    if (show.sma20) addLine(view.overlays.sma20, "#7a6fb0");
    if (show.sma50) addLine(view.overlays.sma50, "#2f6fa3");
    if (show.sma200) addLine(view.overlays.sma200, "#b07a1f", 0, { lineStyle: LineStyle.Dashed });
    if (show.bb) {
      addLine(view.overlays.bbUpper, "#9a8fc9", 0, { lineWidth: 1, lineStyle: LineStyle.Dotted });
      addLine(view.overlays.bbMiddle, "#9a8fc9", 0, { lineWidth: 1 });
      addLine(view.overlays.bbLower, "#9a8fc9", 0, { lineWidth: 1, lineStyle: LineStyle.Dotted });
    }
    let pane = 1;
    if (show.rsi) {
      const r = addLine(view.rsi, "#7a6fb0", pane, { lastValueVisible: true });
      r.createPriceLine({ price: 70, color: down, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "70" });
      r.createPriceLine({ price: 30, color: up, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "30" });
      pane++;
    }
    if (show.macd) {
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      h.setData(view.macd.histogram.map((d) => ({ time: d.time as Time, value: d.value, color: d.value >= 0 ? `${up}88` : `${down}88` })));
      addLine(view.macd.line, "#2f6fa3", pane, { lastValueVisible: true });
      addLine(view.macd.signal, "#b07a1f", pane, { lineWidth: 1 });
    }
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0]!.setStretchFactor(3);
      for (let i = 1; i < panes.length; i++) panes[i]!.setStretchFactor(1);
    }

    if (show.patterns && view.patterns.length) {
      const markers: SeriesMarker<Time>[] = [];
      for (const p of view.patterns.filter((x) => x.status !== "invalidated").slice(0, 2)) {
        const bottom = p.pattern === "double_bottom";
        const tag = bottom ? "W" : "M";
        for (const [pt, label] of [[p.first, `${tag}1`], [p.second, `${tag}2`]] as const) {
          markers.push({ time: pt.date as Time, position: bottom ? "belowBar" : "aboveBar", shape: bottom ? "arrowUp" : "arrowDown", color: bottom ? up : down, text: label });
        }
        candles.createPriceLine({ price: p.neckline, color: "#7a6fb0", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `${tag} neckline (${p.status})` });
      }
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      createSeriesMarkers(candles, markers);
    }
    if (show.levels) {
      if (view.levels.support) candles.createPriceLine({ price: view.levels.support.price, color: up, lineStyle: LineStyle.SparseDotted, lineWidth: 1, axisLabelVisible: true, title: `Support (${view.levels.support.touches} touches)` });
      if (view.levels.resistance) candles.createPriceLine({ price: view.levels.resistance.price, color: down, lineStyle: LineStyle.SparseDotted, lineWidth: 1, axisLabelVisible: true, title: `Resistance (${view.levels.resistance.touches} touches)` });
    }

    chart.subscribeCrosshairMove((param) => {
      const d = param.time ? (param.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined) : undefined;
      if (!d || !param.time) return setLegend("");
      const v = (param.seriesData.get(vol) as { value: number } | undefined)?.value;
      setLegend(`${String(param.time)}  O ${d.open.toFixed(2)}  H ${d.high.toFixed(2)}  L ${d.low.toFixed(2)}  C ${d.close.toFixed(2)}  Vol ${v?.toLocaleString("en-US") ?? "n/a"}`);
    });

    const days = RANGE_DAYS[range];
    if (days && view.bars.length) {
      const end = view.lastDate;
      const start = new Date(Date.parse(end) - days * 86_400_000).toISOString().slice(0, 10);
      chart.timeScale().setVisibleRange({ from: (start < view.firstDate ? view.firstDate : start) as Time, to: end as Time });
    } else chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [view, show, range]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div ref={wrap} className="card" style={full ? { borderRadius: 0, height: "100vh", display: "flex", flexDirection: "column" } : undefined}>
      <div className="toolbar" role="toolbar" aria-label={`${ticker} chart controls`}>
        {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
            {r === "MAX" ? "Max" : r}
          </button>
        ))}
        <span aria-hidden="true" style={{ width: 8 }} />
        {(
          [
            ["sma20", "SMA 20"],
            ["sma50", "SMA 50"],
            ["sma200", "SMA 200"],
            ["bb", "Bollinger"],
            ["rsi", "RSI"],
            ["macd", "MACD"],
            ["patterns", "W/M"],
            ["levels", "Support/Resistance"],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            <input type="checkbox" checked={show[k]} onChange={() => toggle(k)} /> {label}
          </label>
        ))}
        <button
          type="button"
          style={{ marginLeft: "auto" }}
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen())}
        >
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      <div className="chart-legend" aria-live="off">{legend || defaultLegend}</div>
      <div ref={box} className="chart-box" style={full ? { flex: 1, height: "auto" } : undefined} role="img" aria-label={summary} />
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>
        Daily candles (1 candle = 1 trading day). Hollow candle = closed higher than it opened; filled = closed lower. Drag to pan, scroll or pinch to zoom.
      </p>
      <p className="sr-only">{summary}</p>
    </div>
  );
}
