import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ProviderError, redactSecrets } from "@/lib/providers/errors";
import { HttpClient, parseRetryAfter } from "@/lib/providers/http";
import { FredProvider } from "@/lib/providers/fred";

type Reply = { status: number; body: string; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status, headers: r.headers });
  };
  return { impl, calls };
}

function client(replies: Reply[], extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  const sleeps: number[] = [];
  const f = fakeFetch(replies);
  const c = new HttpClient({
    provider: "test",
    baseUrl: "https://api.example.com",
    requestsPerMinute: 6000,
    fetchImpl: f.impl,
    sleep: async (ms) => void sleeps.push(ms),
    baseBackoffMs: 100,
    ...extra,
  });
  return { c, sleeps, calls: f.calls };
}

const schema = z.object({ ok: z.boolean() });
const spec = { path: "/x", schema, sourceName: "test" };

describe("HttpClient", () => {
  afterEach(() => {
    delete process.env.FRED_API_KEY;
  });

  it("retries server errors with backoff and then succeeds", async () => {
    const { c, sleeps, calls } = client([{ status: 503, body: "busy" }, { status: 502, body: "" }, { status: 200, body: '{"ok":true}' }]);
    const res = await c.getJson(spec);
    expect(res.data.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps.filter((s) => s >= 50)).toHaveLength(2);
    expect(res.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("honours Retry-After on 429 and reports rate limiting", async () => {
    let limitedUntil = 0;
    const { c, sleeps } = client([{ status: 429, body: "slow down", headers: { "retry-after": "7" } }, { status: 200, body: '{"ok":true}' }], {
      observer: { onRateLimited: (_p, until) => void (limitedUntil = until) },
    });
    await c.getJson(spec);
    expect(sleeps).toContain(7000);
    expect(limitedUntil).toBeGreaterThan(0);
  });

  it("does not retry auth errors", async () => {
    const { c, calls } = client([{ status: 401, body: "bad key" }]);
    await expect(c.getJson(spec)).rejects.toMatchObject({ errorClass: "auth" });
    expect(calls).toHaveLength(1);
  });

  it("gives up after maxRetries and classifies network errors", async () => {
    const { c, calls } = client([new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")], { maxRetries: 2 });
    const err = await c.getJson(spec).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.errorClass).toBe("network");
    expect(calls).toHaveLength(3);
  });

  it("times out slow requests", async () => {
    const c = new HttpClient({
      provider: "test",
      baseUrl: "https://api.example.com",
      requestsPerMinute: 6000,
      timeoutMs: 20,
      maxRetries: 0,
      fetchImpl: (_u, init) =>
        new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    });
    await expect(c.getJson(spec)).rejects.toMatchObject({ errorClass: "timeout" });
  });

  it("rejects malformed and unexpected responses without retrying", async () => {
    const { c, calls } = client([{ status: 200, body: "<html>" }]);
    await expect(c.getJson(spec)).rejects.toMatchObject({ errorClass: "validation" });
    const b = client([{ status: 200, body: '{"ok":"yes"}' }]);
    await expect(b.c.getJson(spec)).rejects.toMatchObject({ errorClass: "validation" });
    expect(calls).toHaveLength(1);
  });

  it("spaces requests to respect the per-minute limit", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const f = fakeFetch([{ status: 200, body: '{"ok":true}' }, { status: 200, body: '{"ok":true}' }, { status: 200, body: '{"ok":true}' }]);
    const c = new HttpClient({
      provider: "test",
      baseUrl: "https://api.example.com",
      requestsPerMinute: 60,
      fetchImpl: f.impl,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await Promise.all([c.getJson(spec), c.getJson(spec), c.getJson(spec)]);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("never records API keys in source URLs or error messages", async () => {
    process.env.FRED_API_KEY = "supersecretkey123";
    const f = fakeFetch([{ status: 200, body: '{"observations":[{"date":"2026-10-01","value":"4.10"},{"date":"2026-10-02","value":"."}]}' }]);
    const fred = new FredProvider({ fetchImpl: f.impl, sleep: async () => {} });
    const res = await fred.getSeries("DGS10", "2026-09-01");
    expect(f.calls[0]!.url).toContain("api_key=supersecretkey123"); // sent to the provider…
    expect(JSON.stringify(res.source)).not.toContain("supersecretkey123"); // …but never stored
    expect(res.data).toEqual([{ date: "2026-10-01", value: 4.1 }]); // "." (missing) dropped, not zero
    expect(redactSecrets("GET https://x?api_key=supersecretkey123&a=1")).toBe("GET https://x?api_key=[REDACTED]&a=1");
    expect(redactSecrets("error with supersecretkey123 inside")).not.toContain("supersecretkey123");
  });

  it("parses Retry-After dates", () => {
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", Date.parse("2026-01-01T00:00:00Z"))).toBe(10_000);
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});
