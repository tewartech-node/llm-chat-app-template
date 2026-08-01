/**
 * Encrypted credential storage for connectors, backed by the VAULT KV namespace.
 * Credentials are AES-256-GCM encrypted with a key derived from the
 * VAULT_ENCRYPTION_KEY secret before being written to KV, so a KV read alone
 * (e.g. via the Cloudflare dashboard) never exposes plaintext tokens.
 */
import { Env } from "./types";

const KV_KEY_PREFIX = "cred:";

async function importKey(env: Env): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(env.VAULT_ENCRYPTION_KEY), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function storeCredential(
  env: Env,
  connector: string,
  creds: Record<string, string>,
): Promise<void> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(creds));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const payload = JSON.stringify({
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  });
  await env.VAULT.put(KV_KEY_PREFIX + connector, payload);
}

export async function getCredential(
  env: Env,
  connector: string,
): Promise<Record<string, string> | null> {
  const raw = await env.VAULT.get(KV_KEY_PREFIX + connector);
  if (!raw) return null;
  const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
  const key = await importKey(env);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      key,
      fromBase64(data),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    // Wrong key or corrupted ciphertext — treat as "not authenticated" rather
    // than throwing, so a rotated VAULT_ENCRYPTION_KEY degrades gracefully.
    return null;
  }
}

export async function deleteCredential(env: Env, connector: string): Promise<void> {
  await env.VAULT.delete(KV_KEY_PREFIX + connector);
}

export async function hasCredential(env: Env, connector: string): Promise<boolean> {
  return (await env.VAULT.get(KV_KEY_PREFIX + connector)) !== null;
}
