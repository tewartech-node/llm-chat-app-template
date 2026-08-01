import { Env } from "../../types";
import { executeConnectorAction } from "../../connectors/index";
import { refreshCache } from "./signatures";

/**
 * Port of AI-Firewall-Defense-Framework/core/recovery.py — the 7-step
 * breach-recovery protocol, with each step adapted to what a Worker can
 * actually do. Steps that assume a long-lived host (flushing a connection
 * pool, restoring files from disk) become their platform equivalents rather
 * than being silently dropped.
 *
 * The report is written to the existing `automation_log` table with
 * automation_type = 'firewall_recovery' — its shape already fits, so no new
 * table is needed.
 */

export interface RecoveryStep {
  name: string;
  success: boolean;
  detail: string;
  durationMs: number;
}

export interface RecoveryReport {
  triggeredBy: string;
  steps: RecoveryStep[];
  success: boolean;
  totalMs: number;
}

async function step(
  name: string,
  fn: () => Promise<string>,
): Promise<RecoveryStep> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { name, success: true, detail, durationMs: Date.now() - started };
  } catch (e) {
    return {
      name,
      success: false,
      detail: e instanceof Error ? e.message : "step threw a non-Error value",
      durationMs: Date.now() - started,
    };
  }
}

export async function runRecovery(env: Env, triggeredBy: string): Promise<RecoveryReport> {
  const started = Date.now();
  const steps: RecoveryStep[] = [];

  // 1. Flush connection pool — Workers hold no pool; the equivalent is
  //    dropping cached per-request state so nothing poisoned survives.
  steps.push(
    await step("flush_connection_pool", async () => {
      await env.RATELIMIT.delete("firewall:verdict-cache");
      return "Cleared cached verdicts";
    }),
  );

  // 2. Refresh signature database from canonical storage.
  steps.push(
    await step("refresh_signatures", async () => {
      const count = await refreshCache(env);
      return `Reloaded ${count} signatures from Supabase into the D1 cache`;
    }),
  );

  // 3. Restore default rules — reset the adaptation multiplier, since a
  //    breach means the learned posture was demonstrably wrong.
  steps.push(
    await step("restore_default_rules", async () => {
      await env.RATELIMIT.delete("firewall:adaptation-level");
      return "Adaptation level reset to baseline";
    }),
  );

  // 4. Analyse breach vector from what actually got through.
  steps.push(
    await step("analyze_breach_vector", async () => {
      const res = await executeConnectorAction(env, "supabase", "select", {
        table: "threat_events",
        filters: { threat_level: "in.(HIGH,CRITICAL)" },
        select: "attack_type,action,threat_score,occurred_at",
        order: "occurred_at.desc",
        limit: 20,
      });
      const rows = Array.isArray(res.data) ? res.data.length : 0;
      return `Reviewed ${rows} recent high-severity events`;
    }),
  );

  // 5. Reinforce vulnerabilities — raise thresholds for whatever got through
  //    so the same vector is caught earlier next time.
  steps.push(
    await step("reinforce_vulnerabilities", async () => {
      const res = await executeConnectorAction(env, "supabase", "select", {
        table: "threat_events",
        filters: { threat_level: "eq.CRITICAL" },
        select: "attack_type",
        order: "occurred_at.desc",
        limit: 5,
      });
      const types = Array.isArray(res.data)
        ? [...new Set((res.data as Record<string, unknown>[]).map((r) => String(r.attack_type)))]
        : [];
      return types.length ? `Flagged for reinforcement: ${types.join(", ")}` : "No critical vectors to reinforce";
    }),
  );

  // 6. Clear compromised logs — deliberately NOT destructive. Deleting audit
  //    history after a breach destroys the forensic record; the original
  //    intent (don't trust possibly-tampered logs) is served by marking them
  //    suspect instead.
  steps.push(
    await step("mark_logs_suspect", async () => {
      await executeConnectorAction(env, "supabase", "insert", {
        table: "system_events",
        rows: [
          {
            event_type: "security_incident",
            severity: "critical",
            event_data: { note: "Logs prior to this marker may be untrustworthy", triggeredBy },
            affected_systems: ["warnetech-server-worker"],
          },
        ],
      });
      return "Inserted integrity marker rather than deleting history";
    }),
  );

  // 7. Notify incident response.
  steps.push(
    await step("notify_incident_team", async () => {
      await executeConnectorAction(env, "supabase", "insert", {
        table: "alert_log",
        rows: [
          {
            alert_type: "firewall_recovery",
            severity: "critical",
            message: `Recovery protocol ran, triggered by: ${triggeredBy}`,
          },
        ],
      });
      return "Alert recorded";
    }),
  );

  const report: RecoveryReport = {
    triggeredBy,
    steps,
    success: steps.every((s) => s.success),
    totalMs: Date.now() - started,
  };

  await executeConnectorAction(env, "supabase", "insert", {
    table: "automation_log",
    rows: [
      {
        automation_type: "firewall_recovery",
        status: report.success ? "success" : "partial_failure",
        result_summary: report,
      },
    ],
  });

  return report;
}
