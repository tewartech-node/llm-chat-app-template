import { Env } from "../types";
import { executeConnectorAction, getConnectorStatus } from "../connectors/index";
import { isKillSwitchEngaged, killSwitchReason } from "./guardrails";
import { allQuotaStates } from "./quota";

/**
 * Backs GET /api/agent/health and the governance dashboard (plan §5).
 *
 * Every probe is individually try/caught and time-boxed: a health endpoint
 * that itself fails when one dependency is down is useless precisely when
 * it's needed most.
 */

const PROBE_TIMEOUT_MS = 5000;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS)),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : "probe failed" };
  }
}

export interface HealthReport {
  status: "ok" | "degraded" | "critical";
  checkedAt: string;
  stores: Record<string, { ok: boolean; ms: number; error?: string }>;
  connectors: Record<string, { authenticated: boolean; actions: string[] }>;
  firewall: { recentThreats: number; criticalThreats: number; cachedSignatures: number };
  quotas: Array<{ ceiling: string; used: number; limit: number; fraction: number; degraded: boolean }>;
  killSwitch: { engaged: boolean; reason: string | null };
  scopeDrift: { recentFlagged: number };
}

export async function buildHealthReport(env: Env): Promise<HealthReport> {
  const [d1, supabase] = await Promise.all([
    timed(() => env.DB.prepare("SELECT 1").first()),
    timed(async () => {
      const res = await executeConnectorAction(env, "supabase", "select", {
        table: "schema_meta",
        select: "*",
        limit: 1,
      });
      if (!res.success) throw new Error(res.error ?? "supabase select failed");
    }),
  ]);

  const connectors = await getConnectorStatus(env).catch(() => ({}) as Awaited<ReturnType<typeof getConnectorStatus>>);
  const quotas = await allQuotaStates(env).catch(() => []);

  let cachedSignatures = 0;
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM signature_cache").first<{ n: number }>();
    cachedSignatures = Number(row?.n ?? 0);
  } catch {
    // Cache table absent on a fresh database — reported as zero, not an error.
  }

  let recentThreats = 0;
  let criticalThreats = 0;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await executeConnectorAction(env, "supabase", "select", {
      table: "threat_events",
      filters: { occurred_at: `gte.${since}` },
      select: "threat_level",
      limit: 1000,
    });
    if (res.success && Array.isArray(res.data)) {
      const rows = res.data as Record<string, unknown>[];
      recentThreats = rows.length;
      criticalThreats = rows.filter((r) => r.threat_level === "CRITICAL").length;
    }
  } catch {
    // Leave counts at zero rather than failing the whole report.
  }

  const killSwitch = {
    engaged: await isKillSwitchEngaged(env).catch(() => false),
    reason: await killSwitchReason(env).catch(() => null),
  };

  // Scope drift is alert-only by design (plan §5) — surfaced here and by
  // email, never used to auto-pause the agent.
  let recentFlagged = 0;
  try {
    const res = await executeConnectorAction(env, "supabase", "select", {
      table: "agent_actions",
      filters: { result: "like.*scope*" },
      select: "id",
      limit: 100,
    });
    if (res.success && Array.isArray(res.data)) recentFlagged = res.data.length;
  } catch {
    /* non-fatal */
  }

  const anyStoreDown = !d1.ok || !supabase.ok;
  const anyQuotaDegraded = quotas.some((q) => q.degraded);
  const status: HealthReport["status"] = killSwitch.engaged || (!d1.ok && !supabase.ok)
    ? "critical"
    : anyStoreDown || anyQuotaDegraded || criticalThreats > 0
      ? "degraded"
      : "ok";

  return {
    status,
    checkedAt: new Date().toISOString(),
    stores: { d1, supabase },
    connectors,
    firewall: { recentThreats, criticalThreats, cachedSignatures },
    quotas,
    killSwitch,
    scopeDrift: { recentFlagged },
  };
}
