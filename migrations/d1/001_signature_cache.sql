-- D1 (warnetech-server-data) — hot-path caches.
--
-- Separate from migrations/0NN_*.sql, which target Supabase Postgres. These
-- run against D1 via `wrangler d1 execute warnetech-server-data --remote
-- --file=...` or the Cloudflare API.
--
-- Why this exists: the threat-block path must never depend on Supabase being
-- reachable (plan §3.3). Signatures are canonical in Postgres but scored from
-- this cache, so a Supabase outage degrades learning, not blocking. The table
-- is fully rebuildable from Postgres at any time — see refreshCache() in
-- src/agent/firewall/signatures.ts, which the cron job calls.

CREATE TABLE IF NOT EXISTS signature_cache (
  id              TEXT PRIMARY KEY,
  attack_type     TEXT NOT NULL,
  pattern         TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 0.30,
  confidence      REAL NOT NULL DEFAULT 0.50,
  occurrences     INTEGER NOT NULL DEFAULT 1,
  false_positives INTEGER NOT NULL DEFAULT 0,
  cached_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signature_cache_type ON signature_cache(attack_type);
