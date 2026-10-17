/**
 * Database client factory.
 *
 * - DATABASE_URL=postgres://...  -> node-postgres (production: Neon, Supabase, RDS, local Postgres)
 * - DATABASE_URL=pglite:./.data/pglite (or unset) -> embedded PGlite (real Postgres compiled to WASM) for local dev
 * - DATABASE_URL=pglite:memory -> in-memory PGlite (tests)
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { cleanDatabaseUrl } from "../env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function createDb(rawUrl = process.env.DATABASE_URL || "pglite:./.data/pglite"): Promise<DbHandle> {
  const url = cleanDatabaseUrl(rawUrl);
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    const db = drizzle(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: "postgres",
      migrate: () => migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => pool.end(),
    };
  }
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const target = url.slice("pglite:".length);
    if (target !== "memory") mkdirSync(path.resolve(target), { recursive: true });
    const client = target === "memory" ? new PGlite() : new PGlite(path.resolve(target));
    const db = drizzle(client, { schema }) as unknown as Db;
    return {
      db,
      kind: "pglite",
      migrate: () => migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    };
  }
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or pglite:");
}

let shared: Promise<DbHandle> | undefined;

/** Process-wide handle for the web app (migrations are applied once on first use). */
export function getDb(): Promise<DbHandle> {
  shared ??= (async () => {
    const handle = await createDb();
    if (handle.kind === "pglite" || process.env.AUTO_MIGRATE === "true") await handle.migrate();
    return handle;
  })().catch((err) => {
    shared = undefined;
    throw err;
  });
  return shared;
}
