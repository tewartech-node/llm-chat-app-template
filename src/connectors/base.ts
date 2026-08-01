import { ActionSpec } from "./types";

/**
 * Shared validateAction() logic: confirms the action exists on the connector
 * and that every required param was supplied. Connector-specific value
 * validation (e.g. "is this a valid repo name") stays in each connector.
 */
export function validateAgainstSpec(
  actions: ActionSpec[],
  action: string,
  params: Record<string, unknown>,
): { valid: boolean; reason?: string; spec?: ActionSpec } {
  const spec = actions.find((a) => a.name === action);
  if (!spec) {
    return { valid: false, reason: `Unknown action "${action}"` };
  }
  const missing = spec.requiredParams.filter((key) => params[key] === undefined || params[key] === null);
  if (missing.length) {
    return { valid: false, reason: `Missing required params: ${missing.join(", ")}`, spec };
  }
  return { valid: true, spec };
}

export function ok(data?: unknown) {
  return { success: true, data };
}

export function fail(error: string) {
  return { success: false, error };
}
