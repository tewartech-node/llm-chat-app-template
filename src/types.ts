export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database; // warnetech-server-data — users, messages, memories, shared_knowledge
  SESSIONS: KVNamespace; // warnetech-server-sessions
  RATELIMIT: KVNamespace; // warnetech-server-ratelimit
  VAULT: KVNamespace; // warnetech-server-vault — encrypted connector credentials
  BACKUP: R2Bucket; // warnetech-server-backup
  // Secret — set via `wrangler secret put VAULT_ENCRYPTION_KEY` before first deploy.
  // 32 random bytes, base64-encoded (e.g. `openssl rand -base64 32`). Used as an
  // AES-256-GCM key to encrypt connector credentials at rest in VAULT.
  VAULT_ENCRYPTION_KEY: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
