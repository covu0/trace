import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy singleton so `next build` (which imports route modules) never needs a
// database. The connection is only opened on first runtime query.
let _db: ReturnType<typeof create> | null = null;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

export function db() {
  _db ??= create();
  return _db;
}

export * as schema from "./schema";
