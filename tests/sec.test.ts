import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAPPED_TAGS } from "@/lib/fundamentals/mapping";
import { needsFundamentalsRefresh } from "@/lib/pipeline/company";
import { padCik, SecEdgarProvider } from "@/lib/providers/sec";
import { filing } from "./helpers";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

function provider(routes: Record<string, string>) {
  const seen: Array<{ url: string; ua: string | null }> = [];
  const p = new SecEdgarProvider({
    userAgent: "Test Research admin@example.com",
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      seen.push({ url, ua: new Headers(init?.headers).get("user-agent") });
      const key = Object.keys(routes).find((k) => url.includes(k));
      return key ? new Response(routes[key], { status: 200 }) : new Response("not found", { status: 404 });
    },
  });
  return { p, seen };
}

describe("SEC EDGAR adapter", () => {
  it("requires a contact User-Agent", async () => {
    const p = new SecEdgarProvider({ userAgent: "" });
    expect(p.configured).toBe(false);
    await expect(p.getSubmissions("320193")).rejects.toMatchObject({ errorClass: "not_configured" });
  });

  it("parses submissions into filing records with document links", async () => {
    const { p, seen } = provider({ "/submissions/CIK0000320193.json": fixture("sec-submissions.json") });
    const res = await p.getSubmissions("320193");
    expect(seen[0]!.ua).toBe("Test Research admin@example.com");
    expect(res.data.name).toBe("Fixture Computer Co");
    expect(res.data.filings[1]).toMatchObject({ form: "8-K", items: ["2.02", "9.01"], filedAt: "2026-07-30" });
    expect(res.data.filings[0]!.primaryDocUrl).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000010/fixc-20260627.htm");
    expect(res.source.url).toBe("https://data.sec.gov/submissions/CIK0000320193.json");
  });

  it("parses companyfacts and keeps only mapped tags", async () => {
    const { p } = provider({ "/api/xbrl/companyfacts/CIK0000320193.json": fixture("sec-companyfacts.json") });
    const res = await p.getCompanyFacts("320193", MAPPED_TAGS);
    expect(res.data.map((f) => f.tag).sort()).toEqual(["EntityCommonStockSharesOutstanding", "NetIncomeLoss"]);
    expect(res.data.find((f) => f.tag === "NetIncomeLoss")).toMatchObject({ periodStart: "2024-09-29", periodEnd: "2025-09-27", accessionNo: "0000320193-25-000079", form: "10-K" });
  });

  it("decides when fundamentals need a refresh", () => {
    expect(needsFundamentalsRefresh([filing("a", "8-K", "2026-01-01", ["5.02"])])).toBe(false);
    expect(needsFundamentalsRefresh([filing("a", "8-K", "2026-01-01", ["2.02"])])).toBe(true);
    expect(needsFundamentalsRefresh([filing("a", "10-Q", "2026-01-01")])).toBe(true);
    expect(padCik(320193)).toBe("0000320193");
  });
});
