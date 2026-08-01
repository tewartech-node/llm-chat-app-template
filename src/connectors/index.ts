import { Env } from "../types";
import { Connector, ConnectorActionResult, ConnectorName } from "./types";
import { d1Connector } from "./d1";
import { githubConnector } from "./github";
import { googleDriveConnector } from "./google-drive";
import { awsConnector } from "./aws";
import { shellConnector } from "./shell";
import { storeCredential, deleteCredential } from "../vault";

const registry: Record<ConnectorName, Connector> = {
  d1: d1Connector,
  github: githubConnector,
  "google-drive": googleDriveConnector,
  aws: awsConnector,
  shell: shellConnector,
};

export function getConnector(name: string): Connector | null {
  return (registry as Record<string, Connector>)[name] ?? null;
}

export function listConnectorNames(): ConnectorName[] {
  return Object.keys(registry) as ConnectorName[];
}

export async function authenticateConnector(
  env: Env,
  name: string,
  creds: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  if (!getConnector(name)) return { ok: false, error: `Unknown connector "${name}"` };
  await storeCredential(env, name, creds);
  return { ok: true };
}

export async function deauthenticateConnector(env: Env, name: string): Promise<void> {
  await deleteCredential(env, name);
}

export async function executeConnectorAction(
  env: Env,
  name: string,
  action: string,
  params: Record<string, unknown>,
): Promise<ConnectorActionResult> {
  const connector = getConnector(name);
  if (!connector) return { success: false, error: `Unknown connector "${name}"` };
  return connector.execute(env, action, params);
}

export async function getConnectorStatus(
  env: Env,
): Promise<Record<ConnectorName, { authenticated: boolean; actions: string[] }>> {
  const entries = await Promise.all(
    listConnectorNames().map(async (name) => {
      const connector = registry[name];
      return [
        name,
        {
          authenticated: await connector.isAuthenticated(env),
          actions: connector.actions.map((a) => a.name),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ConnectorName, { authenticated: boolean; actions: string[] }>;
}
