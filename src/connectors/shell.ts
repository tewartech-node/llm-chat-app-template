import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";
import { githubConnector } from "./github";

/**
 * Cloudflare Workers run in a V8 isolate with no filesystem or subprocess
 * access — there is no way to literally exec() a shell command here. Instead,
 * this connector validates the command against an allow/deny list and
 * dispatches it to a GitHub Actions workflow (via workflow_dispatch) that
 * does the actual execution in a runner. The workflow run is async — this
 * call returns once dispatch succeeds, not once the command finishes; check
 * the Actions run logs (or poll actions_get_worker/run status) for output.
 *
 * The target repo must have a workflow that accepts a `command` input and
 * runs it through the same allow-list — this connector only prevents
 * obviously dangerous commands from being *dispatched*, it does not sandbox
 * what the runner executes once it's over there.
 */

const actions: ActionSpec[] = [
  { name: "run", requiredParams: ["owner", "repo", "workflowId", "ref", "command"] },
];

const ALLOWED_PREFIXES = ["ls", "curl", "git status", "git log", "git diff", "cat", "find", "grep"];
const BLOCKED_PATTERNS = [
  /rm\s+-rf/i,
  /\bsudo\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /[;&|`]/, // command chaining / injection
  /\$\(/, // command substitution
];

function validateCommand(command: string): { valid: boolean; reason?: string } {
  if (BLOCKED_PATTERNS.some((p) => p.test(command))) {
    return { valid: false, reason: "Command matches a blocked pattern (chaining, sudo, chmod, rm -rf, etc.)" };
  }
  if (!ALLOWED_PREFIXES.some((prefix) => command.trim().startsWith(prefix))) {
    return { valid: false, reason: `Command must start with one of: ${ALLOWED_PREFIXES.join(", ")}` };
  }
  return { valid: true };
}

export const shellConnector: Connector = {
  name: "shell",
  actions,

  async isAuthenticated(env: Env): Promise<boolean> {
    // Piggybacks on the GitHub connector's credentials — no separate auth.
    return githubConnector.isAuthenticated(env);
  },

  validateAction(action, params) {
    const base = validateAgainstSpec(actions, action, params);
    if (!base.valid) return base;
    return validateCommand(String(params.command));
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const dispatch = await githubConnector.execute(env, "triggerWorkflow", {
      owner: params.owner,
      repo: params.repo,
      workflowId: params.workflowId,
      ref: params.ref,
      inputs: { command: String(params.command) },
    });

    if (!dispatch.success) return fail(dispatch.error ?? "workflow dispatch failed");
    return ok({ dispatched: true, note: "Command runs async in GitHub Actions — check the workflow run for output." });
  },
};
