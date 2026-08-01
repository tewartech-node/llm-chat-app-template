import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";
import { getCredential, hasCredential, storeCredential } from "../vault";

const actions: ActionSpec[] = [
  { name: "createFolder", requiredParams: ["name"] },
  { name: "uploadFile", requiredParams: ["name", "content", "mimeType"] },
  { name: "listFiles", requiredParams: [] },
  { name: "downloadFile", requiredParams: ["fileId"] },
  { name: "deleteFile", requiredParams: ["fileId"], destructive: true },
  { name: "getFileMetadata", requiredParams: ["fileId"] },
];

interface GDriveCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string; // ISO timestamp
}

/**
 * Google access tokens expire (~1hr). We hold clientId/clientSecret/refreshToken
 * long-term in the vault and refresh the short-lived access token on demand,
 * writing it back so most calls in a short window skip the refresh round-trip.
 */
async function getValidAccessToken(env: Env): Promise<string | null> {
  const creds = (await getCredential(env, "google-drive")) as unknown as GDriveCreds | null;
  if (!creds?.refreshToken) return null;

  const stillValid = creds.accessToken && creds.expiresAt && new Date(creds.expiresAt) > new Date();
  if (stillValid) return creds.accessToken!;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { access_token: string; expires_in: number };

  const updated: GDriveCreds = {
    ...creds,
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
  };
  await storeCredential(env, "google-drive", updated as unknown as Record<string, string>);
  return data.access_token;
}

export const googleDriveConnector: Connector = {
  name: "google-drive",
  actions,

  async isAuthenticated(env: Env): Promise<boolean> {
    return hasCredential(env, "google-drive");
  },

  validateAction(action, params) {
    return validateAgainstSpec(actions, action, params);
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const token = await getValidAccessToken(env);
    if (!token) return fail("Google Drive connector not authenticated or refresh failed");

    const authHeaders = { authorization: `Bearer ${token}` };

    try {
      switch (action) {
        case "createFolder": {
          const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
            method: "POST",
            headers: { ...authHeaders, "content-type": "application/json" },
            body: JSON.stringify({
              name: params.name,
              mimeType: "application/vnd.google-apps.folder",
              parents: params.parentId ? [params.parentId] : undefined,
            }),
          });
          if (!resp.ok) return fail(`createFolder failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "uploadFile": {
          const metadata = {
            name: params.name,
            parents: params.parentId ? [params.parentId] : undefined,
          };
          const boundary = "warnetech-server-boundary";
          const body =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: ${params.mimeType}\r\n\r\n${String(params.content)}\r\n` +
            `--${boundary}--`;
          const resp = await fetch(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
            {
              method: "POST",
              headers: { ...authHeaders, "content-type": `multipart/related; boundary=${boundary}` },
              body,
            },
          );
          if (!resp.ok) return fail(`uploadFile failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "listFiles": {
          const q = params.query ? `?q=${encodeURIComponent(String(params.query))}` : "";
          const resp = await fetch(`https://www.googleapis.com/drive/v3/files${q}`, {
            headers: authHeaders,
          });
          if (!resp.ok) return fail(`listFiles failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "downloadFile": {
          const resp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${params.fileId}?alt=media`,
            { headers: authHeaders },
          );
          if (!resp.ok) return fail(`downloadFile failed: ${resp.status} ${await resp.text()}`);
          return ok({ content: await resp.text() });
        }
        case "deleteFile": {
          if (params.confirmed !== true) return fail("deleteFile requires params.confirmed = true");
          const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${params.fileId}`, {
            method: "DELETE",
            headers: authHeaders,
          });
          if (!resp.ok) return fail(`deleteFile failed: ${resp.status} ${await resp.text()}`);
          return ok({ deleted: true });
        }
        case "getFileMetadata": {
          const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${params.fileId}`, {
            headers: authHeaders,
          });
          if (!resp.ok) return fail(`getFileMetadata failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        default:
          return fail(`Unhandled action "${action}"`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Google Drive API call failed");
    }
  },
};
