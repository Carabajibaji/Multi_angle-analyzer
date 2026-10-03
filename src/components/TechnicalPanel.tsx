import { chartSummary, indicatorRows } from "@/lib/analysis/indicatorText";
import type { TechnicalView } from "@/lib/queries/company";
import { DATA_NATURE_LABEL, type DataNature } from "@/lib/providers/types";
import { Disclosure, fmtTime } from "./data";
import { PriceChart } from "./PriceChart";
import { Term } from "./Term";

const CHECK_ICON = { true: "✓", false: "✕", null: "?" } as const;

export function TechnicalPanel({ ticker, view }: { ticker: string; view: TechnicalView }) {
  const rows = indicatorRows(view);
  const summary = chartSummary(ticker, view);
  return (
    <>
      {view.isDemo ? (
        <div className="banner demo" role="alert">DEMO DATA: this chart uses synthetic prices, not real market data.</div>
      ) : null}
      <PriceChart ticker={ticker} view={view} summary={summary} />
      <p className="tiny muted">
        {DATA_NATURE_LABEL[view.dataNature as DataNature] ?? view.dataNature} · {view.adjusted ? "split/dividend-adjusted" : "unadjusted"} · {view.firstDate} to {view.lastDate}
        {view.indicatorsCalculatedAt ? ` · indicators last recalculated ${fmtTime(view.indicatorsCalculatedAt)}` : ""}. All indicators are calculated in code from these candles.
      </p>

      <section className="section" aria-labelledby="tv">
        <div className="section-head">
          <h2 id="tv">Triple Verification Filter</h2>
        </div>
        <div className="grid two">
          {([view.verification.bullish, view.verification.bearish] as const).map((r) => (
            <div className="card" key={r.direction}>
              <div className="section-head">
                <h3 style={{ margin: 0 }}>{r.direction === "bullish" ? "Upside case" : "Downside case"}</h3>
                <span className={`badge ${r.passedCount === 3 ? "fresh" : r.passedCount === 2 ? "label" : r.passedCount === 1 ? "stale" : "never"}`}>
                  {r.passedCount} of 3 · {r.label}
                </span>
              </div>
              <ul className="plain">
                {r.checks.map((c) => (
                  <li key={c.key}>
                    <strong>
                      <span aria-hidden="true">{CHECK_ICON[String(c.passed) as "true" | "false" | "null"]} </span>
                      {c.name}: {c.passed === null ? "insufficient data" : c.passed ? "passed" : "not passed"}
                    </strong>
                    <div className="small">Rule: {c.rule}</div>
                    <div className="small muted">{c.detail}</div>
                  </li>
                ))}
              </ul>
              <Disclosure>{r.disclaimer}</Disclosure>
            </div>
          ))}
        </div>
      </section>

      <section className="section card" aria-labelledby="pat">
        <div className="section-head">
          <h2 id="pat">Possible W and M patterns</h2>
        </div>
        {view.patterns.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Pattern</th><th>Points</th><th className="r">Neckline</th><th>Status</th><th>Volume confirmed</th><th className="r">Confidence</th><th className="r">Invalidation</th></tr>
              </thead>
              <tbody>
                {view.patterns.slice(0, 6).map((p) => (
                  <tr key={`${p.pattern}${p.first.date}${p.second.date}`}>
                    <td>{p.pattern === "double_bottom" ? "W · possible double bottom" : "M · possible double top"}</td>
                    <td className="small">{p.first.date} ({p.first.price.toFixed(2)}), {p.middle.date} ({p.middle.price.toFixed(2)}), {p.second.date} ({p.second.price.toFixed(2)})</td>
                    <td className="r">{p.neckline.toFixed(2)}</td>
                    <td>{p.status}{p.resolvedAt ? ` (${p.resolvedAt.date})` : ""}</td>
                    <td>{p.volumeConfirmed == null ? "Not applicable yet" : p.volumeConfirmed ? "Yes" : "No"}</td>
                    <td className="r" title={Object.entries(p.confidenceBreakdown).map(([k, v]) => `${k}: ${v}`).join(", ")}>{Math.round(p.confidence * 100)}%</td>
                    <td className="r">{p.pattern === "double_bottom" ? "close below " : "close above "}{p.invalidationLevel.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No candidate double bottoms or tops in the last 90 sessions under the current rules.</p>
        )}
        <Disclosure>
          Detection: two swing lows (highs) within 3% of each other, 10–120 sessions apart, with a middle peak (trough) at least 5% away. Confidence = similarity (30%) + depth (20%) + neckline break (25%) + breakout volume ≥ 1.3× average (25%). These are possible shapes, not predictions.
        </Disclosure>
      </section>

      <section className="section card" aria-labelledby="ind">
        <div className="section-head">
          <h2 id="ind">Indicators</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Indicator</th><th>Settings</th><th>Current value</th><th>Plain-English reading</th><th>Formula</th><th>Limitation</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><strong>{r.glossary ? <Term slug={r.glossary}>{r.name}</Term> : r.name}</strong></td>
                  <td className="small">{r.params}</td>
                  <td className="small num">{r.value}</td>
                  <td className="small">{r.reading}</td>
                  <td className="small muted">{r.formula}</td>
                  <td className="small muted">{r.limitation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.levels.support || view.levels.resistance ? (
          <p className="small">
            Nearest support: {view.levels.support ? `${view.levels.support.price.toFixed(2)} (${view.levels.support.touches} touches)` : "none found"} · nearest resistance:{" "}
            {view.levels.resistance ? `${view.levels.resistance.price.toFixed(2)} (${view.levels.resistance.touches} touches)` : "none found"}. Levels are clusters of past swing points within 1.5%.
          </p>
        ) : null}
        <Disclosure>Technical signals can fail. Past price behaviour does not guarantee future results.</Disclosure>
      </section>
    </>
  );
}
