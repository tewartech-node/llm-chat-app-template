import { Env } from "../types";

/**
 * Free-tier quota watchdogs (plan §3.3).
 *
 * The owner's stated concern was that the system might fail once billing
 * engages, through lack of planning. So every ceiling gets a counter, a
 * degradation mode, and a hard stop at 80% — before billing, not after.
 *
 * Counters live in KV rather than a database because they must be readable
 * on the hot path, including when the database is exactly the thing that has
 * hit its limit.
 */

export type Ceiling = "d1_writes" | "worker_requests" | "ai_neurons" | "supabase_egress_bytes";

/** Daily free-tier limits. Egress is monthly but tracked the same way. */
const LIMITS: Record<Ceiling, number> = {
  d1_writes: 100_000,
  worker_requests: 100_000,
  ai_neurons: 10_000,
  supabase_egress_bytes: 10 * 1024 * 1024 * 1024,
};

/** Degrade at 80%, leaving headroom to notice and act before the wall. */
const DEGRADE_AT = 0.8;

function windowKey(ceiling: Ceiling): string {
  // Egress is a monthly allowance; everything else resets daily.
  const now = new Date();
  const period =
    ceiling === "supabase_egress_bytes"
      ? `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`
      : now.toISOString().slice(0, 10);
  return `quota:${ceiling}:${period}`;
}

export async function consume(env: Env, ceiling: Ceiling, amount = 1): Promise<number> {
  const key = windowKey(ceiling);
  const current = Number((await env.RATELIMIT.get(key)) ?? "0") + amount;
  // 35 days covers the longest window (monthly) with room to spare.
  await env.RATELIMIT.put(key, String(current), { expirationTtl: 60 * 60 * 24 * 35 });
  return current;
}

export async function usage(env: Env, ceiling: Ceiling): Promise<number> {
  return Number((await env.RATELIMIT.get(windowKey(ceiling))) ?? "0");
}

export interface QuotaState {
  ceiling: Ceiling;
  used: number;
  limit: number;
  fraction: number;
  degraded: boolean;
}

export async function quotaState(env: Env, ceiling: Ceiling): Promise<QuotaState> {
  const used = await usage(env, ceiling);
  const limit = LIMITS[ceiling];
  return { ceiling, used, limit, fraction: used / limit, degraded: used >= limit * DEGRADE_AT };
}

export async function allQuotaStates(env: Env): Promise<QuotaState[]> {
  return Promise.all((Object.keys(LIMITS) as Ceiling[]).map((c) => quotaState(env, c)));
}

/**
 * Whether a non-critical write should be shed. Threat and defence writes
 * never call this — they are always prioritised over metrics, because losing
 * the record of an attack is worse than losing a metric sample.
 */
export async function shouldShedNonCritical(env: Env, ceiling: Ceiling): Promise<boolean> {
  return (await quotaState(env, ceiling)).degraded;
}

/**
 * Whether AI inference is still affordable. When false, callers fall back to
 * regex/heuristic scoring rather than failing — the block path must keep
 * working with no AI at all.
 */
export async function aiAffordable(env: Env): Promise<boolean> {
  return !(await quotaState(env, "ai_neurons")).degraded;
}

/**
 * Supabase pauses a free project after 7 days of low activity, which would
 * take the whole control plane offline. One cheap request a day prevents it.
 */
export async function keepaliveSupabase(env: Env): Promise<boolean> {
  const key = "quota:supabase-keepalive";
  const last = await env.RATELIMIT.get(key);
  const today = new Date().toISOString().slice(0, 10);
  if (last === today) return false;

  const { executeConnectorAction } = await import("../connectors/index");
  const res = await executeConnectorAction(env, "supabase", "select", {
    table: "schema_meta",
    select: "*",
    limit: 1,
  });
  if (res.success) await env.RATELIMIT.put(key, today, { expirationTtl: 60 * 60 * 48 });
  return res.success;
}
