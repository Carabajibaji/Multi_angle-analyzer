import { describe, expect, it } from "vitest";
import { cleanDatabaseUrl, cleanSecret, envSecret } from "@/lib/env";

describe("pasted secret cleanup", () => {
  it("handles whitespace, quotes, NAME= prefixes and trailing lines", () => {
    expect(cleanSecret("  abc123\n\n")).toBe("abc123");
    expect(cleanSecret("FRED_API_KEY=abc", "FRED_API_KEY")).toBe("abc");
    expect(cleanSecret("'abc'")).toBe("abc");
    expect(cleanSecret(undefined)).toBe("");
  });
  it("extracts a Postgres URL from pasted snippets", () => {
    const url = "postgresql://user:pw@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require";
    expect(cleanDatabaseUrl(`psql '${url}'`)).toBe(url);
    expect(cleanDatabaseUrl(`DATABASE_URL=${url}\n\n`)).toBe(url);
    expect(cleanDatabaseUrl(`# Neon\nDATABASE_URL="${url}"\n`)).toBe(url);
    expect(cleanDatabaseUrl("pglite:memory")).toBe("pglite:memory");
  });
});

describe("secret name aliases", () => {
  it("accepts FRED_KEY for FRED_API_KEY and prefers the exact name", () => {
    process.env.FRED_KEY = " abc ";
    expect(envSecret("FRED_API_KEY")).toBe("abc");
    process.env.FRED_API_KEY = "exact";
    expect(envSecret("FRED_API_KEY")).toBe("exact");
    delete process.env.FRED_KEY;
    delete process.env.FRED_API_KEY;
  });
});
