# Architecture

## 1. Audit (starting point)

| Question | Finding |
|---|---|
| Existing stack | None for this product. The only repository available was `fitroom`, a single static `index.html` (3D fitting-room demo) unrelated to markets. At the owner's request this is a **separate, new project** with no shared code or history. |
| Working features | None to preserve. No prior market code existed in any accessible repository. |
| Previously removed components (Daily Market Dashboard) | Not present in any accessible history, so it was **rebuilt from scratch** on top of the pipeline instead of restored. |
| Static / mocked / stale data | None carried over. The only synthetic data is the explicit `DATA_MODE=demo` provider, which labels every row `demo`. |
| Database & scheduler capability | Nothing existed. Chosen: PostgreSQL (hosted in prod, embedded PGlite locally) + GitHub Actions cron (works with any host), with an HTTP cron endpoint as an alternative. |
| External providers | SEC EDGAR (free; needs a contact User-Agent), Polygon.io/Massive (prices), FRED (macro + release calendar), Finnhub (news + earnings calendar). Anthropic API reserved for the explanation layer. |

## 2. System overview

```
GitHub Actions cron (UTC, 2 slots per job)            Admin "Refresh" button / external cron
              │                                                   │
              ▼                                                   ▼
   scripts/run-job.ts  ──────────────►  src/lib/jobs/service.ts  ◄──  /api/admin/refresh, /api/cron/scheduled
                                               │
                         runner.ts: ET schedule gate → run-key idempotency → lease lock
                                    → per-item isolation → job_runs / job_failures / logs
                                               │
                 ┌─────────────────────────────┼──────────────────────────────┐
                 ▼                             ▼                              ▼
        pipeline/market.ts            pipeline/company.ts             pipeline/events.ts, watchlist.ts
   candles, snapshots, indicators   SEC filings, 8-K governance,      news, earnings & macro calendar,
   sector pulse                     XBRL facts → statements → health  rules-based Stocks to Watch
                 │                             │                              │
                 └──────────── providers (interfaces in providers/types.ts) ──┘
                     HttpClient: timeout · retry/backoff · Retry-After · rate limit
                     · zod validation · error classes · secret redaction · health
                                               │
                                               ▼
                         PostgreSQL (Drizzle schema, migrations in /drizzle)
                                               │
                                               ▼
                    Next.js App Router (server components read the DB directly)
                    Today dashboard · Data Status (admin) · health API
```

## 3. Daily schedule (America/New_York)

| Job | Window (ET) | Run key | What it does |
|---|---|---|---|
| `pre-market` | trading days 05:00–09:30 | `pre-market:<ET date>` | Previous-session candles for benchmark & sector ETFs, Market Snapshot, earnings (21 days), FRED release calendar (45 days), market + company news |
| `post-market` | trading days ≥ close + 15 min (handles 1 pm early closes) | `post-market:<session date>` | OHLCV for every tracked security, snapshots, indicators, sector pulse vs SPY, Stocks to Watch |
| `nightly-company` | 21:00–06:00 | `nightly-company:<ET date>` | SEC submissions → new filings by accession number, 8-K governance events; refetch XBRL facts **only** if a new 10-K/10-Q/20-F/40-F or 8-K Item 2.02 arrived |
| `weekly-reconcile` | weekends | `weekly-reconcile:<ISO week>` | Ticker→CIK relink, candle-gap detection + backfill, OHLC consistency, stale/failed dataset list, failure summary, retention; stores a reconciliation report |

* NYSE holidays (incl. Good Friday, Juneteenth, observed-date rules, the Saturday-New-Year exception) and early closes are computed in `src/lib/time/marketCalendar.ts`. Ad-hoc closures go in `MARKET_EXTRA_CLOSURES`.
* DST is handled by the IANA zone via `Intl`, never by fixed offsets. The two UTC cron slots per job cover both EST and EDT. Tests assert that both slots land in-window in July and December.
* A run key succeeds at most once (partial unique index `job_runs_success_once`). A **partial** or **failed** run does not consume the key, so the second cron slot retries automatically.
* `job_locks` holds a lease (TTL per job). A second runner is skipped, and an expired lease from a crashed run is taken over. The workflow also sets `concurrency: data-refresh`.

## 4. Data integrity rules (enforced in code)

* **Provenance.** Every fetched payload becomes a `sources` row (provider, public URL with credentials stripped, content hash, retrieval time). Data rows reference `source_id` and carry `retrieved_at`.
* **Nature of data.** `data_nature` (`end_of_day`, `delayed_15m`, `real_time`, `filing`, `calculated`, `ai_generated`, `demo`) is stored per row and rendered verbatim. Polygon's label comes from `POLYGON_DATA_NATURE`, which must match your plan. Nothing is labelled "real time" by default.
* **Honest proxies.** Index levels need paid licences, so snapshot cards say exactly what is measured. For example, "SPY ETF used as a proxy for the S&P 500", or "Fed broad dollar index, NOT ICE DXY".
* **No silent zeros.** FRED's `"."`, missing XBRL tags and short histories become `NULL`, shown as "Data unavailable from the connected provider."
* **Never overwrite good data with bad.** Responses are schema-validated, and inconsistent candles are dropped and logged. An empty response when new data is expected raises an `empty` error and leaves existing rows untouched. Failures mark the dataset `stale` and record `last_error`.
* **Freshness.** The `datasets` ledger plus `evaluateFreshness()` judge market data against the trading calendar (Friday's close is fresh on Monday morning but stale by Wednesday).
* **Recompute only on change.** Indicators, statements and reports are keyed by an input fingerprint, so unchanged inputs are skipped. The `ai_summaries` table uses the same mechanism for the explanation layer.

## 5. Schema (migration `drizzle/0000_initial.sql`)

| Area | Tables |
|---|---|
| Provenance | `sources` |
| Reference | `companies`, `securities` |
| Market | `price_candles` (PK security+interval+date), `market_snapshots` (unique key+date) |
| Filings & fundamentals | `filings` (unique accession), `filing_sections`, `financial_facts` (unique company+tag+unit+period+accession, NULLS NOT DISTINCT), `financial_statements` |
| Governance | `executives`, `directors`, `governance_events` |
| Competition | `peers` |
| News & events | `news_articles` (unique URL), `market_events` (unique event key, `date_status` confirmed/scheduled/estimated) |
| Calculations | `technical_indicators`, `pattern_detections`, `analysis_reports` |
| Lists | `watchlists`, `watchlist_items` (stores rule hits + thresholds) |
| AI | `prompt_versions`, `ai_summaries` (model, prompt version, input hash, input & source refs, output version) |
| Pipeline | `datasets`, `job_runs`, `job_failures`, `job_locks`, `provider_health` |

## 6. Financial normalization

* `src/lib/fundamentals/mapping.ts` maps canonical metrics to prioritized XBRL tags. Capex = `PaymentsToAcquirePropertyPlantAndEquipment` (documented on the metric).
* `statements.ts`: ~1-year durations count as annual and ~1-quarter durations as quarterly. YTD (6/9-month) values are ignored rather than differenced. Instants attach by period end. Restated values use the latest filing, and the accession number is kept.
* `metrics.ts`: growth, margins, FCF = OCF − capex, FCF margin, cash conversion, working capital, current ratio, total/net debt (flagged when only one component is tagged), D/E (not meaningful with negative equity), interest coverage, dilution. Each result carries its formula, inputs and caveat.

## 7. Security

* Secrets are read only from server environment variables. They are redacted from logs, stored URLs and error messages (`redactSecrets`, tested). Bearer headers are used where providers support them.
* Admin access is `ADMIN_TOKEN` → an HMAC-signed, expiring, HttpOnly, SameSite=strict cookie. Mutations require same-origin. Login and refresh are rate-limited, and comparisons are constant-time.
* CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy are set in `next.config.ts`.
* Only http(s) news links are accepted and rendered with `rel="noopener noreferrer nofollow"`. Provider URLs are fixed per adapter (no user-supplied fetch targets, so no SSRF surface).
* All SQL goes through Drizzle's parameterized builder.
* `npm audit` reports 4 moderate advisories, all in `drizzle-kit`'s dev-only esbuild dependency (not shipped to production).
