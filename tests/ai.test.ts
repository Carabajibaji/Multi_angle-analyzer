import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnthropicExplainer } from "@/lib/ai/explainer";
import { buildFilingInput } from "@/lib/ai/filingSummary";
import { generateMarketBrief, latestMarketBrief } from "@/lib/ai/marketBrief";
import { FILING_SUMMARY, MARKET_BRIEF } from "@/lib/ai/prompts";
import { enforceCitations, generateGrounded } from "@/lib/ai/service";
import type { DbHandle } from "@/lib/db/client";
import { analyzeText } from "@/lib/filings/analyzer";
import { JOBS } from "@/lib/jobs/definitions";
import { runJob } from "@/lib/jobs/runner";
import { FakeExplainer, fakeProviders, memoryDb } from "./helpers";

const claim = (text: string, refs: string[], kind = "fact") => ({ text, kind, confidence: "high", refs });

describe("citation enforcement", () => {
  it("removes unknown refs and drops facts left without support", () => {
    const { output, removed } = enforceCitations(
      {
        points: [claim("SPY fell 0.5%", ["D1"]), claim("Invented fact", ["D99"]), claim("A guess", ["X"], "interpretation")],
        news: [{ ref: "N1" }, { ref: "N404" }],
      },
      new Set(["D1", "N1"]),
    );
    expect(output.points).toHaveLength(2);
    expect(output.points[1]).toMatchObject({ text: "A guess", refs: [] });
    expect(output.news).toEqual([{ ref: "N1" }]);
    expect(removed).toBe(4);
  });
});

describe("AnthropicExplainer (injected transport)", () => {
  const schema = MARKET_BRIEF.schema;
  const valid = { headline: "h", sixtySeconds: [], drivers: [], riskToWatch: claim("r", [], "unknown"), sectorNotes: [], newsGroups: [], dataGaps: [] };
  const call = (res: object) => new AnthropicExplainer({ parse: async () => ({ model: "claude-haiku-4-5", usage: { input_tokens: 10, output_tokens: 5 }, ...res }) as never });

  it("defaults to Claude Haiku 4.5 and returns validated output", async () => {
    let sent: Record<string, unknown> = {};
    const e = new AnthropicExplainer({ parse: async (p) => ((sent = p), { model: "claude-haiku-4-5", stop_reason: "end_turn", parsed_output: valid, usage: { input_tokens: 10, output_tokens: 5 } }) });
    const r = await e.explain({ system: "s", user: "u", schema, maxTokens: 100 });
    expect(sent.model).toBe("claude-haiku-4-5");
    expect(sent.output_config).toBeDefined();
    expect(r).toMatchObject({ model: "claude-haiku-4-5", inputTokens: 10, outputTokens: 5 });
  });
  it("treats refusal, truncation and malformed output as errors", async () => {
    await expect(call({ stop_reason: "refusal", parsed_output: null }).explain({ system: "s", user: "u", schema, maxTokens: 1 })).rejects.toMatchObject({ errorClass: "validation" });
    await expect(call({ stop_reason: "max_tokens", parsed_output: null }).explain({ system: "s", user: "u", schema, maxTokens: 1 })).rejects.toThrow(/cut off/);
    await expect(call({ stop_reason: "end_turn", parsed_output: { headline: 1 } }).explain({ system: "s", user: "u", schema, maxTokens: 1 })).rejects.toThrow(/schema/);
  });
  it("is unconfigured without an API key", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const e = new AnthropicExplainer();
    expect(e.configured).toBe(false);
    await expect(e.explain({ system: "s", user: "u", schema, maxTokens: 1 })).rejects.toMatchObject({ errorClass: "not_configured" });
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe("grounded generation", () => {
  let h: DbHandle;
  beforeAll(async () => {
    process.env.TRACKED_TICKERS = "AAPL";
    h = await memoryDb();
  });
  afterAll(async () => {
    delete process.env.TRACKED_TICKERS;
    delete process.env.AI_DAILY_TOKEN_BUDGET;
    await h.close();
  });
  beforeEach(async () => {
    await h.db.execute(`TRUNCATE ai_summaries, prompt_versions RESTART IDENTITY CASCADE` as never);
    delete process.env.AI_DAILY_TOKEN_BUDGET;
  });

  const input = { subjectType: "test", subjectKey: "k", data: "D1 | SPY close 100", refs: [{ id: "D1", label: "SPY", url: null }], inputIds: {} };
  const out = { plainSummary: "s", keyPoints: [claim("SPY closed at 100", ["D1"])], risks: [], changesVsPrior: [], questionsForResearch: [], evidenceNote: "n" };

  it("caches by input fingerprint and records provenance", async () => {
    const ai = new FakeExplainer();
    ai.configured = true;
    ai.respond = () => out;
    const a = await generateGrounded(h.db, ai, FILING_SUMMARY, input);
    const b = await generateGrounded(h.db, ai, FILING_SUMMARY, input);
    expect(ai.calls).toHaveLength(1);
    expect(b.cached).toBe(true);
    expect(a).toMatchObject({ model: "claude-haiku-4-5", promptName: "filing_summary", promptVersion: 1, evidenceStatus: "grounded" });
    expect(a.refs.map((r) => r.id)).toEqual(["D1"]);
    expect(ai.calls[0]!.user).toContain("<data>");
    expect(ai.calls[0]!.system).toMatch(/untrusted/);
    await generateGrounded(h.db, ai, FILING_SUMMARY, { ...input, data: "D1 | SPY close 101" });
    expect(ai.calls).toHaveLength(2); // changed data -> regenerate
  });

  it("stops at the daily token budget", async () => {
    process.env.AI_DAILY_TOKEN_BUDGET = "1000";
    const ai = new FakeExplainer();
    ai.configured = true;
    ai.respond = () => out;
    await generateGrounded(h.db, ai, FILING_SUMMARY, input); // uses 1200 tokens
    await expect(generateGrounded(h.db, ai, FILING_SUMMARY, { ...input, subjectKey: "other" })).rejects.toThrow(/budget/);
  });

  it("generates the market brief in the post-market job from stored data only", async () => {
    const { providers: base, news, ai } = fakeProviders();
    const { DemoMacroProvider } = await import("@/lib/providers/demo");
    const dm = new DemoMacroProvider();
    // a non-demo macro source so the brief is allowed (demo data is never narrated)
    const providers = { ...base, macro: Object.assign(Object.create(Object.getPrototypeOf(dm)), dm, { isDemo: false, id: "fake_macro" }) };
    ai.configured = true;
    news.items = [{ providerArticleId: "1", url: "https://news.example/fed", headline: "Fed holds rates", publisher: "Wire", publishedAt: new Date("2026-10-02T15:00:00Z"), summary: "s", category: "general", relatedTickers: [] }];
    // pre-market stores news; post-market builds the brief
    await runJob(JOBS["pre-market"], { db: h.db, providers, now: new Date("2026-10-02T11:05:00Z"), trigger: "schedule" });
    ai.calls = [];
    ai.respond = (req) => {
      const ids = [...req.user.matchAll(/\b(N\d+|D\d+)\b/g)].map((m) => m[1]!);
      const n = ids.find((i) => i.startsWith("N"))!;
      return {
        headline: "Stocks mixed",
        sixtySeconds: [claim("The S&P 500 fund moved", ["D1"]), claim("Made-up claim", ["D999"])],
        drivers: [],
        riskToWatch: claim("Rates", [n], "risk"),
        sectorNotes: [],
        newsGroups: [{ category: "fed_rates", items: [{ ref: n, factualSummary: "Fed held", plainEnglish: "Borrowing costs unchanged", relatedTickers: [], connectionConfidence: "medium" }] }],
        dataGaps: [],
      };
    };
    const r = await runJob(JOBS["post-market"], { db: h.db, providers, now: new Date("2026-10-02T21:35:00Z"), trigger: "schedule" });
    expect(r.status).toBe("succeeded");
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]!.user).toContain("Fed holds rates");
    const brief = (await latestMarketBrief(h.db))!;
    expect(brief.output.sixtySeconds).toHaveLength(1); // unsupported claim removed
    expect(brief.evidenceStatus).toMatch(/removed/);
    expect(brief.refs.some((x) => x.url === "https://news.example/fed")).toBe(true);
  });

  it("does not narrate demo prices and skips quietly when AI is not configured", async () => {
    const { DemoMarketDataProvider } = await import("@/lib/providers/demo");
    const { providers, ai } = fakeProviders();
    const demo = { ...providers, market: new DemoMarketDataProvider() };
    ai.configured = true;
    await runJob(JOBS["post-market"], { db: h.db, providers: demo, now: new Date("2026-10-05T21:35:00Z"), trigger: "manual", force: true });
    expect(ai.calls).toHaveLength(0);
    expect((await generateMarketBrief(h.db, ai, new Date("2026-10-05T21:40:00Z"))) as object).toMatchObject({ skipped: expect.stringMatching(/demo/) });
    ai.configured = false;
    const r2 = await runJob(JOBS["post-market"], { db: h.db, providers, now: new Date("2026-10-06T21:35:00Z"), trigger: "schedule" });
    expect(r2.status).toBe("succeeded");
    expect(r2.log.join("\n")).toMatch(/AI market brief skipped/);
  });
});

describe("filing summary input", () => {
  it("is built from cited passages and bounded in size", () => {
    const text = `FORM 10-K\nItem 9A. Controls and Procedures\nManagement identified a material weakness in internal control over financial reporting. ${"word ".repeat(80)}`;
    const a = analyzeText(text, { kind: "sec_filing", label: "X 10-K", url: "https://www.sec.gov/Archives/edgar/data/1/1/x.htm", accessionNo: "0000000001-26-000001", form: "10-K", filedAt: "2026-01-01" });
    const input = buildFilingInput(a);
    expect(input.subjectKey).toBe("0000000001-26-000001");
    expect(input.refs[0]!.id).toBe("P1");
    expect(input.data).toContain("P1 [Material weakness");
    expect(input.data.length).toBeLessThanOrEqual(60_000);
  });
});
