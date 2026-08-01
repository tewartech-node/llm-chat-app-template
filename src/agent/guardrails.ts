import { Env } from "../types";
import { getConnector } from "../connectors/index";
import { GuardrailVerdict, Plan, PlanStep, TaskOptions } from "./types";

/**
 * PROTECTED FILE — see plan §6.3.
 *
 * `protected-files-check` blocks any pull request that modifies this file,
 * and that workflow runs on `pull_request_target` so it is always evaluated
 * from main's copy rather than the PR's. The agent's own self-modification
 * pipeline therefore cannot weaken these rules, which is the entire reason
 * the enforcement lives outside the repository (scoped PAT + branch
 * protection) rather than in code the agent can reach.
 *
 * This module is also the ONLY code path permitted to read or write the
 * kill-switch key. No connector action may target it.
 */

const KILL_SWITCH_KEY = "agent:kill-switch";

/** Connector actions the agent may never invoke, whatever a plan says. */
const FORBIDDEN_ACTIONS = new Set([
  // Credential surface — the agent must not be able to rewrite its own auth.
  "d1:execute:vault",
  // Reserved for future explicit denials; the check below is prefix-based.
]);

/**
 * Task categories and connector/action pairs the agent is expected to work
 * within (plan §5). Anything outside this is flagged as scope drift and
 * alerted on — deliberately NOT blocked, per the owner's explicit choice.
 */
const DECLARED_SCOPE: Record<string, string[]> = {
  github: ["listRepos", "getFileContent", "updateFile", "createPR", "triggerWorkflow"],
  "google-drive": ["createFolder", "uploadFile", "listFiles", "downloadFile", "getFileMetadata"],
  aws: ["s3.uploadObject", "s3.getObject", "s3.listObjects", "s3.copyObject", "logs.getLogEvents"],
  supabase: ["select", "insert", "upsert", "update", "rpc"],
  d1: ["query", "execute"],
  huggingface: ["runInference", "createJob", "jobStatus", "callSpace"],
  shell: ["run"],
};

/** Per-task ceiling on estimated cost. Plans above this are refused outright. */
const MAX_TASK_COST = 100;

export async function isKillSwitchEngaged(env: Env): Promise<boolean> {
  return (await env.RATELIMIT.get(KILL_SWITCH_KEY)) === "engaged";
}

export async function engageKillSwitch(env: Env, reason: string): Promise<void> {
  await env.RATELIMIT.put(KILL_SWITCH_KEY, "engaged");
  await env.RATELIMIT.put(`${KILL_SWITCH_KEY}:reason`, reason);
}

export async function releaseKillSwitch(env: Env): Promise<void> {
  await env.RATELIMIT.delete(KILL_SWITCH_KEY);
  await env.RATELIMIT.delete(`${KILL_SWITCH_KEY}:reason`);
}

export async function killSwitchReason(env: Env): Promise<string | null> {
  return env.RATELIMIT.get(`${KILL_SWITCH_KEY}:reason`);
}

function isDestructive(step: PlanStep): boolean {
  const connector = getConnector(step.connector);
  const spec = connector?.actions.find((a) => a.name === step.action);
  return spec?.destructive === true;
}

function isInDeclaredScope(step: PlanStep): boolean {
  return DECLARED_SCOPE[step.connector]?.includes(step.action) ?? false;
}

/**
 * Validates one step. Returns "needs_confirmation" rather than "block" for
 * destructive actions so a caller who genuinely intends the deletion can
 * re-submit with `confirmed: true` — the connectors enforce the same
 * `params.confirmed === true` convention one layer down, so this is defence
 * in depth rather than the only check.
 */
export function validateStep(step: PlanStep, options: TaskOptions): GuardrailVerdict {
  const scopeDrift = !isInDeclaredScope(step);

  const connector = getConnector(step.connector);
  if (!connector) {
    return { decision: "block", reason: `Unknown connector "${step.connector}"`, rule: "unknown_connector" };
  }

  if (FORBIDDEN_ACTIONS.has(`${step.connector}:${step.action}`)) {
    return { decision: "block", reason: "Action is on the forbidden list", rule: "forbidden_action", scopeDrift };
  }

  // Privilege escalation: the agent must not touch its own credential store
  // or the kill switch through a generic database/storage action.
  const paramBlob = JSON.stringify(step.params).toLowerCase();
  if (paramBlob.includes(KILL_SWITCH_KEY) || paramBlob.includes("vault_encryption_key")) {
    return {
      decision: "block",
      reason: "Step references the kill switch or vault key material",
      rule: "privilege_escalation",
      scopeDrift,
    };
  }

  if (isDestructive(step) && options.confirmed !== true && step.params.confirmed !== true) {
    return {
      decision: "needs_confirmation",
      reason: `"${step.action}" is destructive and needs explicit confirmation`,
      rule: "destructive_needs_confirmation",
      scopeDrift,
    };
  }

  const check = connector.validateAction(step.action, step.params);
  if (!check.valid) {
    return { decision: "block", reason: check.reason ?? "Connector rejected the action", rule: "connector_validation", scopeDrift };
  }

  return { decision: "allow", reason: "Passed all guardrails", scopeDrift };
}

/**
 * Whole-plan checks that can't be made per-step: the kill switch, and the
 * cost ceiling (a plan can be individually-safe at every step and still be
 * collectively too expensive).
 */
export async function validatePlan(
  env: Env,
  plan: Plan,
  options: TaskOptions,
): Promise<GuardrailVerdict> {
  if (await isKillSwitchEngaged(env)) {
    const reason = (await killSwitchReason(env)) ?? "no reason recorded";
    return { decision: "block", reason: `Kill switch engaged: ${reason}`, rule: "kill_switch" };
  }

  if (plan.estimatedCost > MAX_TASK_COST) {
    return {
      decision: "block",
      reason: `Estimated cost ${plan.estimatedCost} exceeds the per-task ceiling of ${MAX_TASK_COST}`,
      rule: "cost_ceiling",
    };
  }

  if (plan.steps.length === 0) {
    return { decision: "block", reason: "Plan contains no steps", rule: "empty_plan" };
  }

  return { decision: "allow", reason: "Plan passed pre-execution checks" };
}
