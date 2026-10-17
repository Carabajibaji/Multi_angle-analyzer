ALTER TABLE "ai_summaries" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
CREATE INDEX "ai_summaries_subject_idx" ON "ai_summaries" USING btree ("subject_type","subject_key","generated_at");