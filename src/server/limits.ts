import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Spend protection. Both caps count only LLM-invoking outcomes ("answer",
 * "insufficient_model") — gated/declined queries cost zero tokens and never
 * count. Enforced against the queries table, so caps survive restarts and
 * hold across multiple server instances.
 *
 *   TRACE_DAILY_QUERY_CAP         per-user per UTC day (default 50)
 *   TRACE_GLOBAL_DAILY_QUERY_CAP  whole app per UTC day (default 100)
 *
 * Global default is deliberately low: 100 × ~$0.08 ≈ $8/day worst case.
 */
const USER_CAP = () => Number(process.env.TRACE_DAILY_QUERY_CAP ?? 50);
const GLOBAL_CAP = () => Number(process.env.TRACE_GLOBAL_DAILY_QUERY_CAP ?? 100);

const LLM_OUTCOMES = ["answer", "insufficient_model"] as const;

/** Lifetime free-trial queries on the house key (TRACE_FREE_QUERIES, default 3). */
export const FREE_CAP = () => Number(process.env.TRACE_FREE_QUERIES ?? 3);

/**
 * Lifetime count of house-key LLM queries — the free-trial meter. BYOK
 * queries (key_source='byok') and zero-token outcomes never count.
 */
export async function freeQueriesUsed(userId: number): Promise<number> {
  const [{ value }] = await db()
    .select({ value: count() })
    .from(schema.queries)
    .where(
      and(
        eq(schema.queries.userId, userId),
        eq(schema.queries.keySource, "house"),
        inArray(schema.queries.outcome, [...LLM_OUTCOMES]),
      ),
    );
  return value;
}

export type CapCheck =
  | { allowed: true; usedByUser: number; usedGlobal: number }
  | { allowed: false; status: 429; error: string };

export async function checkDailyCaps(userId: number): Promise<CapCheck> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [[{ value: usedGlobal }], [{ value: usedByUser }]] = await Promise.all([
    // Caps protect OUR balance: only house-key queries count. BYOK spend is
    // the user's own and is deliberately uncapped by us.
    db()
      .select({ value: count() })
      .from(schema.queries)
      .where(
        and(
          gte(schema.queries.createdAt, dayStart),
          eq(schema.queries.keySource, "house"),
          inArray(schema.queries.outcome, [...LLM_OUTCOMES]),
        ),
      ),
    db()
      .select({ value: count() })
      .from(schema.queries)
      .where(
        and(
          eq(schema.queries.userId, userId),
          gte(schema.queries.createdAt, dayStart),
          eq(schema.queries.keySource, "house"),
          inArray(schema.queries.outcome, [...LLM_OUTCOMES]),
        ),
      ),
  ]);

  if (usedGlobal >= GLOBAL_CAP()) {
    return {
      allowed: false,
      status: 429,
      error: "Trace is at capacity for today — try again tomorrow.",
    };
  }
  if (usedByUser >= USER_CAP()) {
    return {
      allowed: false,
      status: 429,
      error: `Daily query limit reached (${USER_CAP()}). Resets at midnight UTC.`,
    };
  }
  return { allowed: true, usedByUser, usedGlobal };
}
