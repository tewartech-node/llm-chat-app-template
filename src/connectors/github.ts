import { Octokit } from "@octokit/rest";
import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";
import { getCredential, hasCredential } from "../vault";

const actions: ActionSpec[] = [
  { name: "listRepos", requiredParams: ["org"] },
  { name: "getFileContent", requiredParams: ["owner", "repo", "path"] },
  { name: "updateFile", requiredParams: ["owner", "repo", "path", "content", "message"] },
  { name: "createPR", requiredParams: ["owner", "repo", "title", "head", "base"] },
  { name: "triggerWorkflow", requiredParams: ["owner", "repo", "workflowId", "ref"] },
  { name: "createBranch", requiredParams: ["owner", "repo", "branch", "fromBranch"] },
  { name: "getPRChecks", requiredParams: ["owner", "repo", "pullNumber"] },
  // Merging to main ships code to production via the deploy workflow, so it
  // carries the same weight as any other destructive action.
  { name: "mergePR", requiredParams: ["owner", "repo", "pullNumber"], destructive: true },
];

async function getClient(env: Env): Promise<Octokit | null> {
  const creds = await getCredential(env, "github");
  if (!creds?.token) return null;
  return new Octokit({ auth: creds.token });
}

export const githubConnector: Connector = {
  name: "github",
  actions,

  async isAuthenticated(env: Env): Promise<boolean> {
    return hasCredential(env, "github");
  },

  validateAction(action, params) {
    return validateAgainstSpec(actions, action, params);
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const client = await getClient(env);
    if (!client) return fail("GitHub connector not authenticated — call /api/connectors/auth first");

    try {
      switch (action) {
        case "listRepos": {
          const { data } = await client.repos.listForOrg({ org: String(params.org), per_page: 50 });
          return ok(data.map((r) => ({ name: r.name, full_name: r.full_name, private: r.private })));
        }
        case "getFileContent": {
          const { data } = await client.repos.getContent({
            owner: String(params.owner),
            repo: String(params.repo),
            path: String(params.path),
            ref: params.ref ? String(params.ref) : undefined,
          });
          if (Array.isArray(data) || data.type !== "file") return fail("Path is not a file");
          return ok({ content: atob(data.content), sha: data.sha });
        }
        case "updateFile": {
          // sha required when overwriting an existing file — look it up if not provided
          let sha = params.sha ? String(params.sha) : undefined;
          if (!sha) {
            try {
              const existing = await client.repos.getContent({
                owner: String(params.owner),
                repo: String(params.repo),
                path: String(params.path),
                ref: params.branch ? String(params.branch) : undefined,
              });
              if (!Array.isArray(existing.data) && existing.data.type === "file") {
                sha = existing.data.sha;
              }
            } catch {
              // file doesn't exist yet — creating new, no sha needed
            }
          }
          const { data } = await client.repos.createOrUpdateFileContents({
            owner: String(params.owner),
            repo: String(params.repo),
            path: String(params.path),
            message: String(params.message),
            content: btoa(String(params.content)),
            branch: params.branch ? String(params.branch) : undefined,
            sha,
          });
          return ok({ commitSha: data.commit.sha });
        }
        case "createPR": {
          const { data } = await client.pulls.create({
            owner: String(params.owner),
            repo: String(params.repo),
            title: String(params.title),
            head: String(params.head),
            base: String(params.base),
            body: params.body ? String(params.body) : undefined,
          });
          return ok({ number: data.number, url: data.html_url });
        }
        case "triggerWorkflow": {
          await client.actions.createWorkflowDispatch({
            owner: String(params.owner),
            repo: String(params.repo),
            workflow_id: String(params.workflowId),
            ref: String(params.ref),
            inputs: (params.inputs as Record<string, string>) ?? undefined,
          });
          return ok({ dispatched: true });
        }
        case "createBranch": {
          const { data: ref } = await client.git.getRef({
            owner: String(params.owner),
            repo: String(params.repo),
            ref: `heads/${params.fromBranch}`,
          });
          const { data } = await client.git.createRef({
            owner: String(params.owner),
            repo: String(params.repo),
            ref: `refs/heads/${params.branch}`,
            sha: ref.object.sha,
          });
          return ok({ ref: data.ref, sha: data.object.sha });
        }
        case "getPRChecks": {
          const { data: pr } = await client.pulls.get({
            owner: String(params.owner),
            repo: String(params.repo),
            pull_number: Number(params.pullNumber),
          });
          const { data: checks } = await client.checks.listForRef({
            owner: String(params.owner),
            repo: String(params.repo),
            ref: pr.head.sha,
          });
          const runs = checks.check_runs.map((c) => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
          }));
          return ok({
            mergeable: pr.mergeable,
            mergeableState: pr.mergeable_state,
            checks: runs,
            allComplete: runs.length > 0 && runs.every((c) => c.status === "completed"),
            allPassed: runs.length > 0 && runs.every((c) => c.conclusion === "success"),
          });
        }
        case "mergePR": {
          if (params.confirmed !== true) return fail("mergePR requires params.confirmed = true");
          const { data } = await client.pulls.merge({
            owner: String(params.owner),
            repo: String(params.repo),
            pull_number: Number(params.pullNumber),
            merge_method: "squash",
          });
          return ok({ merged: data.merged, sha: data.sha });
        }
        default:
          return fail(`Unhandled action "${action}"`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : "GitHub API call failed");
    }
  },
};
