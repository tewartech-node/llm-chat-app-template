import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";
import { getCredential, hasCredential } from "../vault";

const actions: ActionSpec[] = [
  { name: "select", requiredParams: ["table"] },
  { name: "insert", requiredParams: ["table", "rows"] },
  { name: "upsert", requiredParams: ["table", "rows"] },
  { name: "update", requiredParams: ["table", "filters", "patch"] },
  { name: "delete", requiredParams: ["table", "filters"], destructive: true },
  { name: "rpc", requiredParams: ["function"] },
];

interface SupabaseCreds {
  url: string; // e.g. https://<ref>.supabase.co
  serviceRoleKey: string;
}

/**
 * Talks to Postgres via Supabase's PostgREST HTTP API over fetch, not the
 * Postgres wire protocol — Workers have no raw TCP without Hyperdrive, and
 * PostgREST's stateless-HTTP model means there's no persistent connection
 * for Hyperdrive to usefully pool for this connector's write-heavy,
 * moderate-QPS usage (agent/firewall logging, not hot-path joined reads).
 * Matches the fetch-only convention already used by google-drive.ts/aws.ts.
 */
async function getCreds(env: Env): Promise<SupabaseCreds | null> {
  const creds = (await getCredential(env, "supabase")) as unknown as SupabaseCreds | null;
  if (!creds?.url || !creds?.serviceRoleKey) return null;
  return creds;
}

function authHeaders(creds: SupabaseCreds, extra?: Record<string, string>) {
  return {
    apikey: creds.serviceRoleKey,
    authorization: `Bearer ${creds.serviceRoleKey}`,
    ...extra,
  };
}

/**
 * PostgREST filters are passed through as-is, e.g. { id: "eq.5", status: "neq.done" } —
 * the caller supplies the operator prefix (eq./neq./gt./in./...) per PostgREST syntax
 * rather than this connector inventing its own filter DSL.
 */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  const filters = (params.filters as Record<string, string>) ?? {};
  for (const [key, value] of Object.entries(filters)) qs.set(key, value);
  if (params.select) qs.set("select", String(params.select));
  if (params.order) qs.set("order", String(params.order));
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return query ? `?${query}` : "";
}

export const supabaseConnector: Connector = {
  name: "supabase",
  actions,

  async isAuthenticated(env: Env): Promise<boolean> {
    return hasCredential(env, "supabase");
  },

  validateAction(action, params) {
    return validateAgainstSpec(actions, action, params);
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const creds = await getCreds(env);
    if (!creds) return fail("Supabase connector not authenticated — call /api/connectors/auth first");

    const table = String(params.table ?? "");
    const base = creds.url.replace(/\/$/, "");

    try {
      switch (action) {
        case "select": {
          const resp = await fetch(`${base}/rest/v1/${table}${buildQuery(params)}`, {
            headers: authHeaders(creds),
          });
          if (!resp.ok) return fail(`select failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "insert": {
          const resp = await fetch(`${base}/rest/v1/${table}`, {
            method: "POST",
            headers: authHeaders(creds, {
              "content-type": "application/json",
              prefer: "return=representation",
            }),
            body: JSON.stringify(params.rows),
          });
          if (!resp.ok) return fail(`insert failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "upsert": {
          const onConflict = params.onConflict ? `?on_conflict=${encodeURIComponent(String(params.onConflict))}` : "";
          const resp = await fetch(`${base}/rest/v1/${table}${onConflict}`, {
            method: "POST",
            headers: authHeaders(creds, {
              "content-type": "application/json",
              prefer: "resolution=merge-duplicates,return=representation",
            }),
            body: JSON.stringify(params.rows),
          });
          if (!resp.ok) return fail(`upsert failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "update": {
          const resp = await fetch(`${base}/rest/v1/${table}${buildQuery(params)}`, {
            method: "PATCH",
            headers: authHeaders(creds, {
              "content-type": "application/json",
              prefer: "return=representation",
            }),
            body: JSON.stringify(params.patch),
          });
          if (!resp.ok) return fail(`update failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "delete": {
          if (params.confirmed !== true) return fail("delete requires params.confirmed = true");
          const resp = await fetch(`${base}/rest/v1/${table}${buildQuery(params)}`, {
            method: "DELETE",
            headers: authHeaders(creds, { prefer: "return=representation" }),
          });
          if (!resp.ok) return fail(`delete failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "rpc": {
          const resp = await fetch(`${base}/rest/v1/rpc/${params.function}`, {
            method: "POST",
            headers: authHeaders(creds, { "content-type": "application/json" }),
            body: JSON.stringify(params.args ?? {}),
          });
          if (!resp.ok) return fail(`rpc failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json().catch(() => ({})));
        }
        default:
          return fail(`Unhandled action "${action}"`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Supabase API call failed");
    }
  },
};
