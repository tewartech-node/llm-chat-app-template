-- Applied to tewartech-project-supabase (dcepcfnnqiwccbnnsdcq) 2026-08-01
-- via mcp__Supabase__apply_migration, name "agent_core".
--
-- Reconciles Phase 2's originally-D1-scoped agent_learnings/agent_actions/
-- scheduled_tasks tables with what's already live: learned_patterns already
-- has the shape agent_learnings wanted (trigger_conditions JSONB,
-- success_rate, confidence_score, times_applied, learned_from_anomalies),
-- so it's reused via a discriminator column rather than duplicated.

ALTER TABLE learned_patterns
  ADD COLUMN IF NOT EXISTS pattern_domain VARCHAR(20) NOT NULL DEFAULT 'anomaly'
    CHECK (pattern_domain IN ('anomaly', 'agent', 'firewall'));
CREATE INDEX IF NOT EXISTS idx_learned_patterns_domain ON learned_patterns(pattern_domain);

-- Genuinely new: agent connector-call decisions, distinct from the generic
-- system_events/audit_log ops logs (no connector/decision/cost columns there).
-- D1's connector_audit_log stays the synchronous in-request write; this is
-- mirrored into asynchronously, fire-and-forget, so Supabase never sits on
-- the hot path.
CREATE TABLE IF NOT EXISTS agent_actions (
  id BIGSERIAL PRIMARY KEY,
  task TEXT NOT NULL,
  decision TEXT,
  connector VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  params JSONB,
  result TEXT,
  success BOOLEAN NOT NULL,
  cost NUMERIC(10, 4),
  approved_by VARCHAR(255),
  related_anomaly_id BIGINT REFERENCES anomalies(id) ON DELETE SET NULL,
  source VARCHAR(50) DEFAULT 'agent',
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_occurred ON agent_actions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_connector ON agent_actions(connector);
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

-- Genuinely new: proactive tasks. Execution is driven by a Cloudflare Worker
-- Cron Trigger (not pg_cron, despite it being installed) so every scheduled
-- action still goes through Agent.plan()/validate()/execute() guardrails.
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id BIGSERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  task_type VARCHAR(100),
  frequency VARCHAR(50),
  next_run_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_run_at TIMESTAMP WITH TIME ZONE,
  enabled BOOLEAN DEFAULT TRUE,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks(next_run_at) WHERE enabled;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
