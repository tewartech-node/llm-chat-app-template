import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";

const actions: ActionSpec[] = [
  { name: "query", requiredParams: ["sql"] },
  { name: "execute", requiredParams: ["sql"], destructive: true },
];

const DESTRUCTIVE_SQL = /\b(drop|delete|truncate|alter)\b/i;

/**
 * Thin wrapper around the DB binding — auth is implicit (Cloudflare grants
 * the binding at deploy time, there's no separate credential to vault).
 * A basic destructive-statement check lives here as defense in depth; the
 * agent's guardrails (Phase 2) are the primary enforcement point for
 * "never delete without confirmation."
 */
export const d1Connector: Connector = {
  name: "d1",
  actions,

  async isAuthenticated(): Promise<boolean> {
    return true;
  },

  validateAction(action, params) {
    const base = validateAgainstSpec(actions, action, params);
    if (!base.valid) return base;
    const sql = String(params.sql ?? "");
    if (base.spec?.destructive && DESTRUCTIVE_SQL.test(sql) && params.confirmed !== true) {
      return { valid: false, reason: "Destructive statement requires params.confirmed = true" };
    }
    return { valid: true };
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const sql = String(params.sql);
    const bindings = Array.isArray(params.params) ? (params.params as unknown[]) : [];

    try {
      if (action === "query") {
        const { results } = await env.DB.prepare(sql).bind(...bindings).all();
        return ok(results);
      }
      // action === "execute"
      const result = await env.DB.prepare(sql).bind(...bindings).run();
      return ok({ changes: result.meta.changes, lastRowId: result.meta.last_row_id });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "D1 query failed");
    }
  },
};
