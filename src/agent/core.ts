import { Env } from "../types";
import { plan as buildPlan } from "./planner";
import { validatePlan } from "./guardrails";
import { execute } from "./executor";
import { reflect, recordAction } from "./memory";
import { TaskOptions, TaskOutcome } from "./types";

/**
 * The agent loop: plan → validate → execute → reflect.
 *
 * Every entry point (HTTP, chat, email, cron) funnels through here rather
 * than calling the executor directly, so no path can skip the guardrails.
 * That is why `scheduled_tasks` is driven by a Worker Cron Trigger and not
 * by `pg_cron` — an in-database scheduler would bypass this function
 * entirely (plan §2, §13).
 */
export async function handleTask(
  env: Env,
  task: string,
  options: TaskOptions = {},
): Promise<TaskOutcome> {
  const plan = await buildPlan(env, task);

  if (!plan || plan.steps.length === 0) {
    const reason = plan
      ? "Planner could not accomplish this with the available connectors"
      : "Planner returned an unparseable response";
    await recordAction(env, {
      task,
      decision: reason,
      connector: "none",
      action: "plan",
      params: {},
      result: reason,
      success: false,
      approvedBy: options.actor,
      source: options.source,
    });
    return { task, plan, results: [], success: false, refusedReason: reason };
  }

  const verdict = await validatePlan(env, plan, options);
  if (verdict.decision !== "allow") {
    await recordAction(env, {
      task,
      decision: `Plan blocked by ${verdict.rule ?? "guardrails"}`,
      connector: "none",
      action: "validate",
      params: { steps: plan.steps.length, estimatedCost: plan.estimatedCost },
      result: verdict.reason,
      success: false,
      approvedBy: options.actor,
      source: options.source,
    });
    return { task, plan, results: [], success: false, refusedReason: verdict.reason };
  }

  const results = await execute(env, plan, options);
  const success = results.length > 0 && results.every((r) => r.success);
  const outcome: TaskOutcome = { task, plan, results, success };

  // Learning is best-effort: a reflection failure must not fail a task that
  // otherwise succeeded, and dry runs produce no real outcome to learn from.
  if (!options.dryRun) {
    reflect(env, outcome).catch((e) => console.error("reflect() failed:", e));
  }

  return outcome;
}

/**
 * Runs any `scheduled_tasks` rows that are due. Called from the Worker's
 * scheduled() handler. Each task goes through handleTask, so scheduled work
 * is subject to exactly the same guardrails as an interactive request.
 */
export async function runDueScheduledTasks(env: Env): Promise<number> {
  const { executeConnectorAction } = await import("../connectors/index");

  const due = await executeConnectorAction(env, "supabase", "select", {
    table: "scheduled_tasks",
    filters: { enabled: "eq.true", next_run_at: `lte.${new Date().toISOString()}` },
    select: "id,description,frequency",
    limit: 10,
  });

  if (!due.success || !Array.isArray(due.data)) return 0;
  const rows = due.data as Record<string, unknown>[];

  for (const row of rows) {
    await handleTask(env, String(row.description), { source: "cron", actor: "scheduler" });

    const next = new Date();
    const frequency = String(row.frequency ?? "daily");
    if (frequency === "hourly") next.setHours(next.getHours() + 1);
    else if (frequency === "weekly") next.setDate(next.getDate() + 7);
    else next.setDate(next.getDate() + 1);

    await executeConnectorAction(env, "supabase", "update", {
      table: "scheduled_tasks",
      filters: { id: `eq.${row.id}` },
      patch: { last_run_at: new Date().toISOString(), next_run_at: next.toISOString() },
    });
  }

  return rows.length;
}
