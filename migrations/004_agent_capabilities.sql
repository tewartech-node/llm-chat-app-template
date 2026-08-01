-- Applied to tewartech-project-supabase (dcepcfnnqiwccbnnsdcq) 2026-08-01
-- via mcp__Supabase__apply_migration, name "agent_capabilities".
--
-- Versioned ledger of what the agent can do and how it acquired each
-- ability (plan §7). Motivated directly by migration 000: ten migrations
-- existed only as live database state with no file anywhere, and had to be
-- reconstructed. The same must not happen to the agent's capabilities.

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  version       VARCHAR(20)  NOT NULL,
  description   TEXT,
  added_via     VARCHAR(20)  NOT NULL CHECK (added_via IN ('connector','self-modification','human')),
  source_pr_url TEXT,
  added_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
  CONSTRAINT agent_capabilities_name_version_key UNIQUE (name, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_capabilities_status ON agent_capabilities(status);
ALTER TABLE agent_capabilities ENABLE ROW LEVEL SECURITY;

-- Seed one row per connector that exists today.
INSERT INTO agent_capabilities (name, version, description, added_via) VALUES
  ('connector:github',        '1.0.0', 'Repo read/write, pull requests, workflow dispatch',        'connector'),
  ('connector:google-drive',  '1.0.0', 'Drive file operations and backup target',                  'connector'),
  ('connector:aws',           '1.0.0', 'S3, Lambda invoke, CloudWatch Logs via SigV4',             'connector'),
  ('connector:shell',         '1.0.0', 'Allow-listed commands dispatched via GitHub Actions',      'connector'),
  ('connector:d1',            '1.0.0', 'Cloudflare D1 queries via the Worker binding',             'connector'),
  ('connector:supabase',      '1.0.0', 'Postgres via PostgREST over HTTP',                         'connector'),
  ('connector:huggingface',   '1.0.0', 'Inference, Jobs and Spaces for compute offload',           'connector'),
  ('agent:core',              '1.0.0', 'Plan/validate/execute/reflect loop with guardrails',       'human'),
  ('agent:firewall',          '1.0.0', 'Adaptive threat scoring, learning and 7-step recovery',    'human')
ON CONFLICT (name, version) DO NOTHING;
