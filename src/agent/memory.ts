import { Env } from "../types";
import { executeConnectorAction } from "../connectors/index";
import { LearnedPattern, StepResult, TaskOutcome } from "./types";

/**
 * Agent memory, backed by the pre-existing `learned_patterns` table rather
 * than a parallel `agent_learnings` table — its columns already covered what
 * was needed (plan §2.3). `pattern_domain = 'agent'` separates these rows
 * from the anomaly-domain rows that were already there.
 *
 * Note: `success_rate` and `confidence_score` are NOT written here. A
 * `refresh_learned_pattern_stats` BEFORE trigger on the table computes both
 * from `times_applied`/`times_successful` (confidence is scaled by an
 * evidence factor that saturates at 20 applications). Writing them directly
 * would be overwritten anyway — discovered while reconstructing the baseline
 * schema in migration 000.
 */

const DOMAIN = "agent";

export async function recordAction(
  env: Env,
  row: {
    task: string;
    decision: string;
    connector: string;
    action: string;
    params: Record<string, unknown>;
    result: string;
    success: boolean;
    cost?: number;
    approvedBy?: string;
    source?: string;
  },
): Promise<void> {
  const res = await executeConnectorAction(env, "supabase", "insert", {
    table: "agent_actions",
    rows: [
      {
        task: row.task,
        decision: row.decision,
        connector: row.connector,
        action: row.action,
        params: row.params,
        result: row.result,
        success: row.success,
        cost: row.cost ?? null,
        approved_by: row.approvedBy ?? null,
        source: row.source ?? "agent",
      },
    ],
  });
  if (!res.success) console.error("Failed to write agent_actions row:", res.error);
}

export async function getRelevantPatterns(env: Env, limit = 10): Promise<LearnedPattern[]> {
  const res = await executeConnectorAction(env, "supabase", "select", {
    table: "learned_patterns",
    filters: { pattern_domain: `eq.${DOMAIN}` },
    select: "id,pattern_name,pattern_description,trigger_conditions,confidence_score,times_applied,times_successful",
    order: "confidence_score.desc",
    limit,
  });
  if (!res.success || !Array.isArray(res.data)) return [];
  return (res.data as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    patternName: String(r.pattern_name ?? ""),
    patternDescription: String(r.pattern_description ?? ""),
    triggerConditions: (r.trigger_conditions as Record<string, unknown>) ?? {},
    confidenceScore: Number(r.confidence_score ?? 0),
    timesApplied: Number(r.times_applied ?? 0),
    timesSuccessful: Number(r.times_successful ?? 0),
  }));
}

/**
 * Extracts a durable lesson from a finished task. Keyed on
 * connector+action+outcome so repeat runs reinforce one row rather than
 * creating near-duplicates; the DB trigger recomputes confidence from the
 * updated counters.
 */
export async function reflect(env: Env, outcome: TaskOutcome): Promise<void> {
  for (const result of outcome.results) {
    const name = `${result.step.connector}:${result.step.action}`;
    const existing = await executeConnectorAction(env, "supabase", "select", {
      table: "learned_patterns",
      filters: { pattern_domain: `eq.${DOMAIN}`, pattern_name: `eq.${name}` },
      select: "id,times_applied,times_successful",
      limit: 1,
    });

    const rows = Array.isArray(existing.data) ? (existing.data as Record<string, unknown>[]) : [];

    if (rows.length > 0) {
      const row = rows[0];
      await executeConnectorAction(env, "supabase", "update", {
        table: "learned_patterns",
        filters: { id: `eq.${row.id}` },
        patch: {
          times_applied: Number(row.times_applied ?? 0) + 1,
          times_successful: Number(row.times_successful ?? 0) + (result.success ? 1 : 0),
          last_applied: new Date().toISOString(),
        },
      });
    } else {
      await executeConnectorAction(env, "supabase", "insert", {
        table: "learned_patterns",
        rows: [
          {
            pattern_domain: DOMAIN,
            pattern_name: name,
            anomaly_type: "agent_action",
            pattern_description: result.step.rationale.slice(0, 500),
            trigger_conditions: { connector: result.step.connector, action: result.step.action },
            times_applied: 1,
            times_successful: result.success ? 1 : 0,
          },
        ],
      });
    }
  }
}

/** Summarises what the agent knows, for injection into the planner prompt. */
export function summarizePatterns(patterns: LearnedPattern[]): string {
  if (!patterns.length) return "";
  const lines = patterns
    .filter((p) => p.timesApplied > 0)
    .map((p) => {
      const rate = Math.round((p.timesSuccessful / p.timesApplied) * 100);
      return `- ${p.patternName}: ${rate}% success over ${p.timesApplied} runs (confidence ${p.confidenceScore})`;
    });
  return lines.length ? `\n\nWhat has worked before:\n${lines.join("\n")}` : "";
}
