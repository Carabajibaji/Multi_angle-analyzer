/**
 * Database schema (PostgreSQL via Drizzle ORM).
 *
 * Integrity conventions used throughout:
 * - Every externally sourced row carries `sourceId` (-> sources) and `retrievedAt`.
 * - `dataNature` states what the value IS (end-of-day, 15-min delayed, filing, calculated, demo...).
 *   The UI renders this label verbatim; nothing is ever labelled "real time" unless the provider plan is.
 * - `isDemo` marks synthetic development data so it can never be mistaken for market data.
 * - Missing values are NULL, never 0.
 * - Unique constraints make every ingest an idempotent upsert.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const dataNatureEnum = pgEnum("data_nature", [
  "real_time",
  "delayed_15m",
  "end_of_day",
  "previous_close",
  "filing",
  "calculated",
  "ai_generated",
  "demo",
]);

export const valueKindEnum = pgEnum("value_kind", ["reported", "estimated", "derived", "ai_interpreted"]);

export const jobStatusEnum = pgEnum("job_status", ["running", "succeeded", "partial", "failed", "skipped"]);

export const datasetStatusEnum = pgEnum("dataset_status", ["fresh", "stale", "failed", "never"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/** One row per distinct provider response (deduplicated by content hash). Secrets are stripped from `url`. */
export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    contentHash: text("content_hash").notNull(),
    httpStatus: integer("http_status"),
    firstRetrievedAt: ts("first_retrieved_at").notNull().defaultNow(),
    lastRetrievedAt: ts("last_retrieved_at").notNull().defaultNow(),
    /** Raw payload kept when small enough to be useful for audits; never contains credentials. */
    raw: jsonb("raw"),
  },
  (t) => [unique("sources_provider_url_hash").on(t.provider, t.url, t.contentHash).nullsNotDistinct()],
);

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    cik: text("cik").unique(),
    name: text("name").notNull(),
    sicCode: text("sic_code"),
    sicDescription: text("sic_description"),
    sector: text("sector"),
    industry: text("industry"),
    description: text("description"),
    exchange: text("exchange"),
    stateOfIncorporation: text("state_of_incorporation"),
    fiscalYearEnd: text("fiscal_year_end"),
    tracked: boolean("tracked").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("companies_name_idx").on(t.name)],
);

export const securities = pgTable(
  "securities",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companies.id),
    ticker: text("ticker").notNull().unique(),
    name: text("name").notNull(),
    /** stock | etf | index | rate | fx | commodity | crypto */
    assetType: text("asset_type").notNull(),
    exchange: text("exchange"),
    currency: text("currency").notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    tracked: boolean("tracked").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("securities_company_idx").on(t.companyId)],
);

/* ------------------------------------------------------------------ */
/* Market data                                                         */
/* ------------------------------------------------------------------ */

export const priceCandles = pgTable(
  "price_candles",
  {
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id),
    interval: text("interval").notNull(), // '1d'
    /** Trading date in America/New_York for daily candles. */
    date: date("date", { mode: "string" }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: bigint("volume", { mode: "number" }),
    vwap: doublePrecision("vwap"),
    adjusted: boolean("adjusted").notNull(),
    dataNature: dataNatureEnum("data_nature").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.securityId, t.interval, t.date] })],
);

/** Latest-value cards for the Market Snapshot (index proxies, VIX, yields, commodities, crypto). */
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: serial("id").primaryKey(),
    instrumentKey: text("instrument_key").notNull(),
    label: text("label").notNull(),
    /** Honest description of what is measured, e.g. "SPY ETF used as a proxy for the S&P 500". */
    measureNote: text("measure_note"),
    value: doublePrecision("value").notNull(),
    previousValue: doublePrecision("previous_value"),
    changeAbs: doublePrecision("change_abs"),
    changePct: doublePrecision("change_pct"),
    unit: text("unit"),
    /** Date (ET) the value refers to. */
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    sessionLabel: text("session_label").notNull(),
    dataNature: dataNatureEnum("data_nature").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [unique("market_snapshots_key_date").on(t.instrumentKey, t.asOfDate)],
);

/* ------------------------------------------------------------------ */
/* Filings & fundamentals                                              */
/* ------------------------------------------------------------------ */

export const filings = pgTable(
  "filings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    accessionNo: text("accession_no").notNull().unique(),
    form: text("form").notNull(),
    filedAt: date("filed_at", { mode: "string" }).notNull(),
    reportDate: date("report_date", { mode: "string" }),
    acceptedAt: ts("accepted_at"),
    primaryDocUrl: text("primary_doc_url"),
    primaryDocDescription: text("primary_doc_description"),
    /** 8-K item numbers, e.g. ["2.02","5.02"]. */
    items: text("items").array(),
    isXbrl: boolean("is_xbrl"),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [index("filings_company_filed_idx").on(t.companyId, t.filedAt)],
);

export const filingSections = pgTable(
  "filing_sections",
  {
    id: serial("id").primaryKey(),
    filingId: integer("filing_id")
      .notNull()
      .references(() => filings.id),
    sectionKey: text("section_key").notNull(),
    title: text("title"),
    text: text("text").notNull(),
    contentHash: text("content_hash").notNull(),
    extractedAt: ts("extracted_at").notNull().defaultNow(),
  },
  (t) => [unique("filing_sections_filing_key").on(t.filingId, t.sectionKey)],
);

/** Individual XBRL facts exactly as reported (SEC companyfacts), with canonical metric mapping. */
export const financialFacts = pgTable(
  "financial_facts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    taxonomy: text("taxonomy").notNull(),
    tag: text("tag").notNull(),
    /** Canonical metric (e.g. "revenue") or NULL if the tag is stored but unmapped. */
    metric: text("metric"),
    unit: text("unit").notNull(),
    value: doublePrecision("value").notNull(),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    fiscalYear: integer("fiscal_year"),
    fiscalPeriod: text("fiscal_period"),
    form: text("form").notNull(),
    accessionNo: text("accession_no").notNull(),
    filedAt: date("filed_at", { mode: "string" }).notNull(),
    frame: text("frame"),
    valueKind: valueKindEnum("value_kind").notNull().default("reported"),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [
    unique("financial_facts_identity")
      .on(t.companyId, t.taxonomy, t.tag, t.unit, t.periodStart, t.periodEnd, t.accessionNo)
      .nullsNotDistinct(),
    index("financial_facts_company_metric_idx").on(t.companyId, t.metric, t.periodEnd),
  ],
);

/** Normalized statements derived from financial_facts, one row per company/statement/period. */
export const financialStatements = pgTable(
  "financial_statements",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    statement: text("statement").notNull(), // income | balance | cashflow
    periodType: text("period_type").notNull(), // annual | quarterly
    fiscalYear: integer("fiscal_year"),
    fiscalPeriod: text("fiscal_period"),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    /** { metric: { value, tag, unit, accessionNo, form, filedAt } } — NULL metrics are omitted, not zeroed. */
    lineItems: jsonb("line_items").notNull(),
    inputHash: text("input_hash").notNull(),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [unique("financial_statements_identity").on(t.companyId, t.statement, t.periodType, t.periodEnd)],
);

/* ------------------------------------------------------------------ */
/* Governance                                                          */
/* ------------------------------------------------------------------ */

export const executives = pgTable(
  "executives",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    title: text("title").notNull(),
    role: text("role"), // CEO | CFO | CHAIR | OTHER
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    totalCompensation: doublePrecision("total_compensation"),
    compensationYear: integer("compensation_year"),
    filingAccession: text("filing_accession"),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [unique("executives_identity").on(t.companyId, t.name, t.title)],
);

export const directors = pgTable(
  "directors",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    independent: boolean("independent"),
    isChair: boolean("is_chair"),
    committees: text("committees").array(),
    since: integer("since_year"),
    otherPublicBoards: integer("other_public_boards"),
    background: text("background"),
    filingAccession: text("filing_accession"),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [unique("directors_identity").on(t.companyId, t.name)],
);

export const governanceEvents = pgTable(
  "governance_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /** executive_change | auditor_change | restatement | material_weakness | ... */
    eventType: text("event_type").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    filingAccession: text("filing_accession"),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [unique("governance_events_identity").on(t.companyId, t.eventType, t.filingAccession).nullsNotDistinct()],
);

/* ------------------------------------------------------------------ */
/* Competitive landscape                                               */
/* ------------------------------------------------------------------ */

export const peers = pgTable(
  "peers",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    peerCompanyId: integer("peer_company_id")
      .notNull()
      .references(() => companies.id),
    /** sic_match | user_added | ... */
    method: text("method").notNull(),
    /** Transparent selection reasons, e.g. { sic: "3571", marketCapRatio: 0.4 }. */
    rationale: jsonb("rationale"),
    removedByUser: boolean("removed_by_user").notNull().default(false),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.peerCompanyId] })],
);

/* ------------------------------------------------------------------ */
/* News & events                                                       */
/* ------------------------------------------------------------------ */

export const newsArticles = pgTable(
  "news_articles",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    providerArticleId: text("provider_article_id"),
    url: text("url").notNull().unique(),
    headline: text("headline").notNull(),
    publisher: text("publisher"),
    publishedAt: ts("published_at").notNull(),
    /** Provider-supplied summary (not AI generated). */
    providerSummary: text("provider_summary"),
    category: text("category"),
    relatedTickers: text("related_tickers").array(),
    isDemo: boolean("is_demo").notNull().default(false),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [index("news_published_idx").on(t.publishedAt)],
);

export const marketEvents = pgTable(
  "market_events",
  {
    id: serial("id").primaryKey(),
    /** Stable dedupe key, e.g. "earnings:AAPL:2026-10-29" or "fred-release:10:2026-10-14". */
    eventKey: text("event_key").notNull().unique(),
    eventType: text("event_type").notNull(), // earnings | macro_release | ...
    title: text("title").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    eventTime: text("event_time"), // bmo | amc | HH:MM ET | null
    /** confirmed | estimated — shown to users verbatim. */
    dateStatus: text("date_status").notNull(),
    securityId: integer("security_id").references(() => securities.id),
    details: jsonb("details"),
    isDemo: boolean("is_demo").notNull().default(false),
    sourceId: integer("source_id").references(() => sources.id),
    retrievedAt: ts("retrieved_at").notNull(),
  },
  (t) => [index("market_events_date_idx").on(t.eventDate)],
);

/* ------------------------------------------------------------------ */
/* Calculations                                                        */
/* ------------------------------------------------------------------ */

/** Daily snapshot of each indicator per security (latest value + params). Series are recomputed from candles. */
export const technicalIndicators = pgTable(
  "technical_indicators",
  {
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id),
    interval: text("interval").notNull(),
    indicatorKey: text("indicator_key").notNull(), // sma_20, rsi_14, macd_12_26_9 ...
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    params: jsonb("params").notNull(),
    values: jsonb("values").notNull(),
    inputHash: text("input_hash").notNull(),
    calculatedAt: ts("calculated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.securityId, t.interval, t.indicatorKey, t.asOfDate] })],
);

export const patternDetections = pgTable(
  "pattern_detections",
  {
    id: serial("id").primaryKey(),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id),
    pattern: text("pattern").notNull(), // double_bottom | double_top
    pointsKey: text("points_key").notNull(),
    points: jsonb("points").notNull(),
    neckline: doublePrecision("neckline"),
    detectedOn: date("detected_on", { mode: "string" }).notNull(),
    status: text("status").notNull(), // forming | completed | invalidated
    confidence: doublePrecision("confidence"),
    volumeConfirmed: boolean("volume_confirmed"),
    invalidationLevel: doublePrecision("invalidation_level"),
    inputHash: text("input_hash").notNull(),
    calculatedAt: ts("calculated_at").notNull().defaultNow(),
  },
  (t) => [unique("pattern_detections_identity").on(t.securityId, t.pattern, t.pointsKey)],
);

/* ------------------------------------------------------------------ */
/* Watchlists, reports, AI                                             */
/* ------------------------------------------------------------------ */

export const watchlists = pgTable(
  "watchlists",
  {
    id: serial("id").primaryKey(),
    /** "system:stocks-to-watch" for the rules-based daily list, or a user id. */
    ownerKey: text("owner_key").notNull(),
    name: text("name").notNull(),
    asOfDate: date("as_of_date", { mode: "string" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("watchlists_identity").on(t.ownerKey, t.name, t.asOfDate).nullsNotDistinct()],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id),
    /** Neutral label: worth_researching | elevated_volatility | positive_unconfirmed | mixed | risk_flag | upcoming_catalyst */
    label: text("label"),
    /** Exact rule hits that caused inclusion, with the measured values. */
    reasons: jsonb("reasons"),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.watchlistId, t.securityId] })],
);

export const analysisReports = pgTable(
  "analysis_reports",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companies.id),
    reportType: text("report_type").notNull(), // financial_health | governance | moat | market_day ...
    subjectKey: text("subject_key").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    content: jsonb("content").notNull(),
    inputHash: text("input_hash").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("analysis_reports_identity").on(t.reportType, t.subjectKey, t.inputHash)],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    template: text("template").notNull(),
    templateHash: text("template_hash").notNull(),
    outputSchemaVersion: integer("output_schema_version").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("prompt_versions_identity").on(t.name, t.version)],
);

export const aiSummaries = pgTable(
  "ai_summaries",
  {
    id: serial("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectKey: text("subject_key").notNull(),
    model: text("model").notNull(),
    promptVersionId: integer("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id),
    /** Fingerprint of all inputs; identical inputs never trigger a second generation. */
    inputHash: text("input_hash").notNull(),
    inputRefs: jsonb("input_refs").notNull(),
    sourceRefs: jsonb("source_refs").notNull(),
    output: jsonb("output").notNull(),
    outputVersion: integer("output_version").notNull(),
    evidenceStatus: text("evidence_status"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
  },
  (t) => [unique("ai_summaries_identity").on(t.subjectType, t.subjectKey, t.promptVersionId, t.inputHash)],
);

/* ------------------------------------------------------------------ */
/* Pipeline state                                                      */
/* ------------------------------------------------------------------ */

/** Freshness ledger: one row per logical dataset (e.g. "candles:AAPL", "snapshot:VIX", "filings:0000320193"). */
export const datasets = pgTable("datasets", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  provider: text("provider"),
  dataNature: dataNatureEnum("data_nature"),
  status: datasetStatusEnum("status").notNull().default("never"),
  /** The period/date the newest stored data refers to (e.g. last candle date, latest filing date). */
  dataAsOf: text("data_as_of"),
  lastAttemptAt: ts("last_attempt_at"),
  lastSuccessAt: ts("last_success_at"),
  lastChangedAt: ts("last_changed_at"),
  staleAfterSeconds: integer("stale_after_seconds").notNull(),
  recordCount: integer("record_count"),
  lastError: text("last_error"),
  lastSourceId: integer("last_source_id").references(() => sources.id),
});

export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    jobName: text("job_name").notNull(),
    /** Idempotency key, e.g. "post-market:2026-10-02". */
    runKey: text("run_key").notNull(),
    trigger: text("trigger").notNull(), // schedule | manual | cli
    status: jobStatusEnum("status").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    itemsOk: integer("items_ok").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    itemsSkipped: integer("items_skipped").notNull().default(0),
    summary: jsonb("summary"),
    log: text("log"),
    error: text("error"),
  },
  (t) => [
    // At most one successful run per run key -> scheduled jobs are idempotent.
    uniqueIndex("job_runs_success_once").on(t.runKey).where(sql`status = 'succeeded'`),
    index("job_runs_job_started_idx").on(t.jobName, t.startedAt),
  ],
);

export const jobFailures = pgTable(
  "job_failures",
  {
    id: serial("id").primaryKey(),
    jobRunId: integer("job_run_id")
      .notNull()
      .references(() => jobRuns.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    provider: text("provider"),
    errorClass: text("error_class").notNull(),
    message: text("message").notNull(),
    attempts: integer("attempts"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("job_failures_run_idx").on(t.jobRunId)],
);

/** Lease-based lock preventing two copies of the same job from running at once. */
export const jobLocks = pgTable("job_locks", {
  jobName: text("job_name").primaryKey(),
  holder: text("holder").notNull(),
  acquiredAt: ts("acquired_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export const providerHealth = pgTable("provider_health", {
  provider: text("provider").primaryKey(),
  status: text("status").notNull(), // ok | degraded | down | not_configured
  lastOkAt: ts("last_ok_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  rateLimitedUntil: ts("rate_limited_until"),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
