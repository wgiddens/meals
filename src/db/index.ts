import path from "node:path";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * The app talks to Postgres through Drizzle either way. Which Postgres depends
 * on the environment:
 *
 *  - DATABASE_URL set   -> a real Postgres server (Supabase in production).
 *                          Run `npm run db:migrate` to apply migrations.
 *  - DATABASE_URL unset -> PGlite, an embedded Postgres that lives in
 *                          ./data/pglite. Migrations are applied automatically
 *                          on first use, so `npm run dev` just works.
 */
export type Db =
  | PgliteDatabase<typeof schema>
  | PostgresJsDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

declare global {
  var __mealsDb: Promise<Db> | undefined;
}

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { prepare: false, max: 10 });
    return drizzlePostgres(client, { schema });
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir =
    process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), "data", "pglite");
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/**
 * Returns the shared database handle, creating it on first call.
 *
 * Inside Next.js this first waits for the incoming request (`connection()`),
 * which tells the framework that whatever is rendered after this point is
 * fresh per-request data and must not be baked into the prerendered shell.
 */
export async function getDb(): Promise<Db> {
  if (process.env.NEXT_RUNTIME) {
    const { connection } = await import("next/server");
    await connection();
  }
  // Cached on globalThis so Next.js dev hot-reloads reuse one connection.
  if (!globalThis.__mealsDb) {
    globalThis.__mealsDb = createDb().catch((err) => {
      globalThis.__mealsDb = undefined;
      throw err;
    });
  }
  return globalThis.__mealsDb;
}

export { schema };
