import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";
import { getCredential, hasCredential } from "../vault";

const actions: ActionSpec[] = [
  { name: "runInference", requiredParams: ["model", "inputs"] },
  { name: "createJob", requiredParams: ["namespace", "spec"] },
  { name: "jobStatus", requiredParams: ["namespace", "jobId"] },
  { name: "callSpace", requiredParams: ["url"] },
];

interface HuggingFaceCreds {
  token: string;
}

/**
 * Offloads compute-heavy or longer-running analysis (batch anomaly re-scoring,
 * firewall signature re-evaluation over large windows) that doesn't fit a
 * Worker's request-scoped CPU-time budget. The agent still makes decisions in
 * the Worker; this connector just hands off the number-crunching and polls
 * for a result — it's an offload target, not a second decision-maker.
 *
 * Job/Space endpoint shapes should be re-verified against current Hugging
 * Face API docs at implementation/testing time — HF's Jobs API in particular
 * is newer and more likely to have shifted than the long-stable Inference API.
 */
async function getCreds(env: Env): Promise<HuggingFaceCreds | null> {
  const creds = (await getCredential(env, "huggingface")) as unknown as HuggingFaceCreds | null;
  if (!creds?.token) return null;
  return creds;
}

export const huggingFaceConnector: Connector = {
  name: "huggingface",
  actions,

  async isAuthenticated(env: Env): Promise<boolean> {
    return hasCredential(env, "huggingface");
  },

  validateAction(action, params) {
    return validateAgainstSpec(actions, action, params);
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const creds = await getCreds(env);
    if (!creds) return fail("Hugging Face connector not authenticated — call /api/connectors/auth first");

    const authHeader = { authorization: `Bearer ${creds.token}` };

    try {
      switch (action) {
        case "runInference": {
          const resp = await fetch(`https://api-inference.huggingface.co/models/${params.model}`, {
            method: "POST",
            headers: { ...authHeader, "content-type": "application/json" },
            body: JSON.stringify({ inputs: params.inputs, parameters: params.parameters ?? undefined }),
          });
          if (!resp.ok) return fail(`runInference failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "createJob": {
          const resp = await fetch(`https://huggingface.co/api/jobs/${params.namespace}`, {
            method: "POST",
            headers: { ...authHeader, "content-type": "application/json" },
            body: JSON.stringify(params.spec),
          });
          if (!resp.ok) return fail(`createJob failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "jobStatus": {
          const resp = await fetch(
            `https://huggingface.co/api/jobs/${params.namespace}/${params.jobId}`,
            { headers: authHeader },
          );
          if (!resp.ok) return fail(`jobStatus failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "callSpace": {
          const resp = await fetch(String(params.url), {
            method: params.payload ? "POST" : "GET",
            headers: { ...authHeader, "content-type": "application/json" },
            body: params.payload ? JSON.stringify(params.payload) : undefined,
          });
          if (!resp.ok) return fail(`callSpace failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json().catch(() => ({})));
        }
        default:
          return fail(`Unhandled action "${action}"`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Hugging Face API call failed");
    }
  },
};
