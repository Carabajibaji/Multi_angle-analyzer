CREATE TYPE "public"."data_nature" AS ENUM('real_time', 'delayed_15m', 'end_of_day', 'previous_close', 'filing', 'calculated', 'ai_generated', 'demo');--> statement-breakpoint
CREATE TYPE "public"."dataset_status" AS ENUM('fresh', 'stale', 'failed', 'never');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'succeeded', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."value_kind" AS ENUM('reported', 'estimated', 'derived', 'ai_interpreted');--> statement-breakpoint
CREATE TABLE "ai_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_key" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version_id" integer NOT NULL,
	"input_hash" text NOT NULL,
	"input_refs" jsonb NOT NULL,
	"source_refs" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"output_version" integer NOT NULL,
	"evidence_status" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_summaries_identity" UNIQUE("subject_type","subject_key","prompt_version_id","input_hash")
);
--> statement-breakpoint
CREATE TABLE "analysis_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"report_type" text NOT NULL,
	"subject_key" text NOT NULL,
	"as_of" date NOT NULL,
	"content" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_reports_identity" UNIQUE("report_type","subject_key","input_hash")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"cik" text,
	"name" text NOT NULL,
	"sic_code" text,
	"sic_description" text,
	"sector" text,
	"industry" text,
	"description" text,
	"exchange" text,
	"state_of_incorporation" text,
	"fiscal_year_end" text,
	"tracked" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"source_id" integer,
	"retrieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cik_unique" UNIQUE("cik")
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"data_nature" "data_nature",
	"status" "dataset_status" DEFAULT 'never' NOT NULL,
	"data_as_of" text,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"stale_after_seconds" integer NOT NULL,
	"record_count" integer,
	"last_error" text,
	"last_source_id" integer
);
--> statement-breakpoint
CREATE TABLE "directors" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"independent" boolean,
	"is_chair" boolean,
	"committees" text[],
	"since_year" integer,
	"other_public_boards" integer,
	"background" text,
	"filing_accession" text,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "directors_identity" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "executives" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"role" text,
	"start_date" date,
	"end_date" date,
	"total_compensation" double precision,
	"compensation_year" integer,
	"filing_accession" text,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "executives_identity" UNIQUE("company_id","name","title")
);
--> statement-breakpoint
CREATE TABLE "filing_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"filing_id" integer NOT NULL,
	"section_key" text NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_sections_filing_key" UNIQUE("filing_id","section_key")
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"accession_no" text NOT NULL,
	"form" text NOT NULL,
	"filed_at" date NOT NULL,
	"report_date" date,
	"accepted_at" timestamp with time zone,
	"primary_doc_url" text,
	"primary_doc_description" text,
	"items" text[],
	"is_xbrl" boolean,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "filings_accession_no_unique" UNIQUE("accession_no")
);
--> statement-breakpoint
CREATE TABLE "financial_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"taxonomy" text NOT NULL,
	"tag" text NOT NULL,
	"metric" text,
	"unit" text NOT NULL,
	"value" double precision NOT NULL,
	"period_start" date,
	"period_end" date NOT NULL,
	"fiscal_year" integer,
	"fiscal_period" text,
	"form" text NOT NULL,
	"accession_no" text NOT NULL,
	"filed_at" date NOT NULL,
	"frame" text,
	"value_kind" "value_kind" DEFAULT 'reported' NOT NULL,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "financial_facts_identity" UNIQUE NULLS NOT DISTINCT("company_id","taxonomy","tag","unit","period_start","period_end","accession_no")
);
--> statement-breakpoint
CREATE TABLE "financial_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"statement" text NOT NULL,
	"period_type" text NOT NULL,
	"fiscal_year" integer,
	"fiscal_period" text,
	"period_start" date,
	"period_end" date NOT NULL,
	"currency" text NOT NULL,
	"line_items" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_statements_identity" UNIQUE("company_id","statement","period_type","period_end")
);
--> statement-breakpoint
CREATE TABLE "governance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_date" date NOT NULL,
	"description" text NOT NULL,
	"filing_accession" text,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "governance_events_identity" UNIQUE NULLS NOT DISTINCT("company_id","event_type","filing_accession")
);
--> statement-breakpoint
CREATE TABLE "job_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_run_id" integer NOT NULL,
	"item_key" text NOT NULL,
	"provider" text,
	"error_class" text NOT NULL,
	"message" text NOT NULL,
	"attempts" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"job_name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"run_key" text NOT NULL,
	"trigger" text NOT NULL,
	"status" "job_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_ok" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"items_skipped" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"log" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"event_date" date NOT NULL,
	"event_time" text,
	"date_status" text NOT NULL,
	"security_id" integer,
	"details" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_key" text NOT NULL,
	"label" text NOT NULL,
	"measure_note" text,
	"value" double precision NOT NULL,
	"previous_value" double precision,
	"change_abs" double precision,
	"change_pct" double precision,
	"unit" text,
	"as_of_date" date NOT NULL,
	"session_label" text NOT NULL,
	"data_nature" "data_nature" NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_snapshots_key_date" UNIQUE("instrument_key","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_article_id" text,
	"url" text NOT NULL,
	"headline" text NOT NULL,
	"publisher" text,
	"published_at" timestamp with time zone NOT NULL,
	"provider_summary" text,
	"category" text,
	"related_tickers" text[],
	"is_demo" boolean DEFAULT false NOT NULL,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "news_articles_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "pattern_detections" (
	"id" serial PRIMARY KEY NOT NULL,
	"security_id" integer NOT NULL,
	"pattern" text NOT NULL,
	"points_key" text NOT NULL,
	"points" jsonb NOT NULL,
	"neckline" double precision,
	"detected_on" date NOT NULL,
	"status" text NOT NULL,
	"confidence" double precision,
	"volume_confirmed" boolean,
	"invalidation_level" double precision,
	"input_hash" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pattern_detections_identity" UNIQUE("security_id","pattern","points_key")
);
--> statement-breakpoint
CREATE TABLE "peers" (
	"company_id" integer NOT NULL,
	"peer_company_id" integer NOT NULL,
	"method" text NOT NULL,
	"rationale" jsonb,
	"removed_by_user" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peers_company_id_peer_company_id_pk" PRIMARY KEY("company_id","peer_company_id")
);
--> statement-breakpoint
CREATE TABLE "price_candles" (
	"security_id" integer NOT NULL,
	"interval" text NOT NULL,
	"date" date NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" bigint,
	"vwap" double precision,
	"adjusted" boolean NOT NULL,
	"data_nature" "data_nature" NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"source_id" integer,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "price_candles_security_id_interval_date_pk" PRIMARY KEY("security_id","interval","date")
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"template_hash" text NOT NULL,
	"output_schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_identity" UNIQUE("name","version")
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"provider" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"rate_limited_until" timestamp with time zone,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"asset_type" text NOT NULL,
	"exchange" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"tracked" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"content_hash" text NOT NULL,
	"http_status" integer,
	"first_retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "sources_provider_url_hash" UNIQUE NULLS NOT DISTINCT("provider","url","content_hash")
);
--> statement-breakpoint
CREATE TABLE "technical_indicators" (
	"security_id" integer NOT NULL,
	"interval" text NOT NULL,
	"indicator_key" text NOT NULL,
	"as_of_date" date NOT NULL,
	"params" jsonb NOT NULL,
	"values" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technical_indicators_security_id_interval_indicator_key_as_of_date_pk" PRIMARY KEY("security_id","interval","indicator_key","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"watchlist_id" integer NOT NULL,
	"security_id" integer NOT NULL,
	"label" text,
	"reasons" jsonb,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_watchlist_id_security_id_pk" PRIMARY KEY("watchlist_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"name" text NOT NULL,
	"as_of_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_identity" UNIQUE NULLS NOT DISTINCT("owner_key","name","as_of_date")
);
--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_last_source_id_sources_id_fk" FOREIGN KEY ("last_source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directors" ADD CONSTRAINT "directors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directors" ADD CONSTRAINT "directors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executives" ADD CONSTRAINT "executives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executives" ADD CONSTRAINT "executives_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_sections" ADD CONSTRAINT "filing_sections_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_facts" ADD CONSTRAINT "financial_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_facts" ADD CONSTRAINT "financial_facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_events" ADD CONSTRAINT "governance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_events" ADD CONSTRAINT "governance_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_failures" ADD CONSTRAINT "job_failures_job_run_id_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_detections" ADD CONSTRAINT "pattern_detections_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peers" ADD CONSTRAINT "peers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peers" ADD CONSTRAINT "peers_peer_company_id_companies_id_fk" FOREIGN KEY ("peer_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_candles" ADD CONSTRAINT "price_candles_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_candles" ADD CONSTRAINT "price_candles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "securities" ADD CONSTRAINT "securities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_indicators" ADD CONSTRAINT "technical_indicators_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "filings_company_filed_idx" ON "filings" USING btree ("company_id","filed_at");--> statement-breakpoint
CREATE INDEX "financial_facts_company_metric_idx" ON "financial_facts" USING btree ("company_id","metric","period_end");--> statement-breakpoint
CREATE INDEX "job_failures_run_idx" ON "job_failures" USING btree ("job_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_success_once" ON "job_runs" USING btree ("run_key") WHERE status = 'succeeded';--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "market_events_date_idx" ON "market_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "news_published_idx" ON "news_articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "securities_company_idx" ON "securities" USING btree ("company_id");