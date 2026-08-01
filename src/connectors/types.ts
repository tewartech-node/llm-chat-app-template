import { Env } from "../types";

export type ConnectorName = "github" | "google-drive" | "aws" | "shell" | "d1" | "supabase" | "huggingface";

export interface ConnectorActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ActionSpec {
  /** e.g. "listRepos", "uploadFile" */
  name: string;
  /** Required param keys — checked before execute() runs. */
  requiredParams: string[];
  /** True for actions that mutate/destroy data — surfaced to guardrails. */
  destructive?: boolean;
}

/**
 * Connectors are stateless: Workers isolates don't persist instance state
 * between requests, so credentials are fetched from the vault (via env.VAULT)
 * on every execute() call rather than cached on the connector instance.
 */
export interface Connector {
  readonly name: ConnectorName;
  readonly actions: ActionSpec[];

  isAuthenticated(env: Env): Promise<boolean>;

  validateAction(
    action: string,
    params: Record<string, unknown>,
  ): { valid: boolean; reason?: string };

  execute(
    env: Env,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorActionResult>;
}
