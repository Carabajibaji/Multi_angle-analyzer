import { describe, expect, it } from "vitest";
import { cleanDatabaseUrl, cleanSecret } from "@/lib/env";

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
