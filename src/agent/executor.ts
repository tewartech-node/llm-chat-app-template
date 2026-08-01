import { Env } from "../types";
import { executeConnectorAction } from "../connectors/index";
import { validateStep } from "./guardrails";
import { recordAction } from "./memory";
import { Plan, StepResult, TaskOptions } from "./types";

/** Per-step wall-clock ceiling. Workers cap total request time anyway, but a
 *  hung connector shouldn't consume the whole budget and starve later steps. */
const STEP_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Runs a validated plan step by step. Every step is re-validated immediately
 * before it runs rather than trusting the plan-level check — a plan is data,
 * and the gap between planning and execution is exactly where a stale or
 * tampered plan would slip through.
 *
 * Execution stops at the first failure. Steps are ordered by the planner and
 * frequently depend on each other, so continuing past a failure would run
 * later steps against state that never materialised.
 */
export async function execute(
  env: Env,
  plan: Plan,
  options: TaskOptions,
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (const step of plan.steps) {
    const verdict = validateStep(step, options);

    if (verdict.decision !== "allow") {
      results.push({ step, success: false, error: verdict.reason, verdict });
      await recordAction(env, {
        task: plan.task,
        decision: step.rationale,
        connector: step.connector,
        action: step.action,
        params: step.params,
        result: `${verdict.decision}: ${verdict.reason}`,
        success: false,
        approvedBy: options.actor,
        source: options.source,
      });
      break;
    }

    if (options.dryRun) {
      results.push({ step, success: true, data: { dryRun: true }, verdict });
      continue;
    }

    let success = false;
    let data: unknown;
    let error: string | undefined;

    try {
      const res = await withTimeout(
        executeConnectorAction(env, step.connector, step.action, step.params),
        STEP_TIMEOUT_MS,
      );
      success = res.success;
      data = res.data;
      error = res.error;
    } catch (e) {
      error = e instanceof Error ? e.message : "Step threw a non-Error value";
    }

    results.push({ step, success, data, error, verdict });

    await recordAction(env, {
      task: plan.task,
      decision: step.rationale,
      connector: step.connector,
      action: step.action,
      params: step.params,
      result: success ? "ok" : (error ?? "failed"),
      success,
      approvedBy: options.actor,
      source: options.source,
    });

    if (!success) break;
  }

  return results;
}
