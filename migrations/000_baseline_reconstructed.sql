-- ============================================================================
-- 000_baseline_reconstructed.sql
-- ============================================================================
--
-- RECONSTRUCTED BASELINE — NOT organically authored.
--
-- This file was written on 2026-08-01 by reverse-engineering the LIVE state
-- of the Supabase Postgres project `dcepcfnnqiwccbnnsdcq` (project name
-- tewartech-project-supabase). It exists because 10 of the 15 migrations
-- that got this database to its current shape were applied directly against
-- the remote project and were never captured as files anywhere in version
-- control. This file closes that gap after the fact.
--
-- The 15 real migrations, in the order they were actually applied
-- (per mcp__Supabase__list_migrations), were:
--
--   1. 20260729042759  add_users_and_posts                        <- covered here
--   2. 20260729223952  anomaly_detection_01_metrics_tables         <- NOT here, see below
--   3. 20260729224012  anomaly_detection_02_anomalies              <- NOT here, see below
--   4. 20260729224040  anomaly_detection_03_solutions_learning     <- NOT here, see below
--   5. 20260729224111  anomaly_detection_04_events_audit_health    <- NOT here, see below
--   6. 20260729224220  anomaly_detection_05_dashboard_views        <- NOT here, see below
--   7. 20260730023114  warnet_0001_extensions                      <- covered here
--   8. 20260730023153  warnet_0002_defense                          <- covered here
--   9. 20260730023236  warnet_0003_anomaly                          <- covered here (no-op, see note)
--  10. 20260730023254  warnet_0004_files                            <- covered here
--  11. 20260730023600  warnet_0005_reconcile_and_rollups            <- covered here
--  12. 20260730023628  warnet_0006_ai_memory                        <- covered here
--  13. 20260730023737  warnet_0007_jobs_and_quota                   <- covered here
--  14. 20260730023828  warnet_0008_seed_signatures                  <- covered here
--  15. 20260730024013  warnet_0009_fix_duplicate_anomaly_detection  <- covered here (no-op, see note)
--
-- Migrations 2-6 (the `anomaly_detection_*` ones) exactly match, verbatim or
-- near-verbatim, the schema already tracked in the separate repo
-- `tewartech-node/sql-anomaly-detection-repo`
-- (see schema/*.sql and migrations/001_init_schema.sql there). They are
-- DELIBERATELY NOT reproduced in this file — cross-reference that repo
-- instead of duplicating its 21 tables here. Those tables are:
--   system_metrics, cpu_metrics, memory_metrics, disk_metrics,
--   query_performance_metrics, application_error_metrics, network_metrics,
--   anomalies, anomaly_details, anomaly_history,
--   solutions, solution_applications, learned_patterns,
--   optimization_recommendations, configuration_baseline,
--   system_events, audit_log, alert_log, automation_log,
--   performance_baseline, system_health_score
--
-- Everything else below — migration 1 (`add_users_and_posts`) and
-- migrations 7-15 (the `warnet_000X` series) — had no source file anywhere,
-- so it is reconstructed here from the live catalog
-- (information_schema.columns/table_constraints, pg_indexes, pg_policies,
-- pg_constraint, pg_proc, pg_trigger, pg_event_trigger, cron.job) as queried
-- on 2026-08-01.
--
-- INVESTIGATION NOTE on `add_users_and_posts` (migration 1):
--   `users`/`posts` turned out to be a generic Prisma quickstart-style
--   demo schema (integer serial PKs, camelCase `authorId`, a
--   `posts_authorId_fkey` FK) — not anything specific to this project.
--   Both tables are empty (0 rows) and nothing else in the schema
--   references them. They appear orphaned: created once, presumably while
--   scaffolding/testing the project, and never wired into any application
--   code. They are reconstructed here for completeness/traceability, not
--   because they are believed to still be in active use.
--
-- INVESTIGATION NOTE on `warnet_0003_anomaly` and
-- `warnet_0009_fix_duplicate_anomaly_detection`:
--   The current live schema has exactly one copy of every anomaly-detection
--   table (anomalies, anomaly_details, anomaly_history, etc.), matching
--   sql-anomaly-detection-repo with no extras. Given `warnet_0009`'s name
--   ("fix_duplicate_anomaly_detection"), the most plausible read is that
--   `warnet_0003_anomaly` attempted to (re-)create some/all of that schema
--   a second time, and `warnet_0009` cleaned up the resulting duplicates.
--   Net effect on live state: nothing for this file to reconstruct from
--   either of those two migrations — they are listed below purely so the
--   step numbering stays traceable to the real migration history.
--
-- IMPORTANT SCOPE NOTE: while investigating this project on 2026-08-01, live
-- schema drift was observed happening *during* this session, beyond the 15
-- migrations this file targets — e.g. `agent_actions`/`scheduled_tasks`
-- tables appearing, a `pattern_domain` column appearing on
-- `learned_patterns`, and (separately) `adaptive_thresholds` gaining a
-- `level` column and 4x its seed rows. Two of those are already tracked by
-- this repo's own `migrations/001_agent_core.sql` and
-- `migrations/003_security_hardening.sql` — but verification during this
-- session found their claims did NOT fully match live state: 001's
-- `agent_actions`/`scheduled_tasks` tables did not exist at the time of
-- checking (only its `ALTER TABLE learned_patterns ADD COLUMN
-- pattern_domain` had taken effect), and 003's two fixes (the permissive
-- `chats` INSERT policy, and public EXECUTE on `rls_auto_enable()`) were
-- both still live and un-fixed per a fresh `get_advisors` run, despite the
-- files' commit-style comments claiming both were applied. Treat files
-- 001/003 with the same skepticism this whole exercise exists to justify:
-- verify against live state, don't take a checked-in file's word for it.
-- This baseline file (000) is scoped strictly to migrations 1 and 7-15 and
-- does not attempt to capture whatever is currently landing past them.
--
-- UPDATE (later the same session, after 001/002/003 finished applying): a
-- fresh verification pass confirms all of the above is now fully consistent
-- — agent_actions/scheduled_tasks exist, pattern_domain is present,
-- adaptive_thresholds has all 4 levels × 10 attack types, and a fresh
-- get_advisors run shows both chats/rls_auto_enable findings resolved. The
-- mismatch noted above was a real snapshot of an in-progress moment, not a
-- lasting discrepancy — 001/002/003 can be trusted again as of this update.
--
-- ============================================================================

-- Extensions actually installed and relied upon by the tables/functions below.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- pgcrypto backs gen_random_uuid()-adjacent digest() calls in learn_signature()
-- below (extensions.digest(...,'sha1')); confirmed installed in the
-- `extensions` schema alongside vector.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ============================================================================
-- === add_users_and_posts (20260729042759) ===
-- Generic Prisma-quickstart-style demo schema. Orphaned: 0 rows in either
-- table, nothing else in the schema references them. Reconstructed as-is.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id    SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name  TEXT,
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.posts (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT,
  published   BOOLEAN NOT NULL DEFAULT false,
  "authorId"  INTEGER NOT NULL,
  CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId")
    REFERENCES public.users(id) ON DELETE RESTRICT
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read all users" ON public.users
    FOR SELECT TO public USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read all posts" ON public.posts
    FOR SELECT TO public USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- === warnet_0001_extensions (20260730023114) ===
-- Extensions are declared at the top of this file. This migration is also
-- the most plausible home (by naming/ordering — it is the first warnet
-- migration, i.e. the project "bootstrap" step) for the security-posture
-- event trigger below, which unconditionally turns RLS on for every new
-- table created in `public` from this point forward. Attribution of the
-- event trigger to this specific migration is INFERRED (no source file
-- exists to confirm it), but its presence and current effect are directly
-- verified live (pg_event_trigger, pg_proc).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DO $$ BEGIN
  CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
    EXECUTE FUNCTION public.rls_auto_enable();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SECURITY FINDING (confirmed live via get_advisors, 2026-08-01): this
-- SECURITY DEFINER function is directly callable via PostgREST
-- (/rest/v1/rpc/rls_auto_enable) by both `anon` and `authenticated`, because
-- it was never explicitly revoked from PUBLIC. Being an event-trigger
-- function it does nothing useful when called directly (it inspects
-- pg_event_trigger_ddl_commands(), which is empty outside of an actual DDL
-- event), but leaving broad EXECUTE on a SECURITY DEFINER function is still
-- a lint-worthy exposure. Left as-is here to match live state faithfully;
-- see the scope note at the top of this file re: migrations/003_security_hardening.sql
-- claiming (but not actually having applied) a fix for this.


-- ============================================================================
-- === warnet_0002_defense (20260730023153) ===
-- Matches the Python firewall code in
-- /home/user/AI-Defense/AI-Firewall-Defense-Framework/core/{signatures,engine,learning}.py
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.signatures (
  id              TEXT PRIMARY KEY,
  attack_type     TEXT NOT NULL,
  pattern         TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 0.30,
  confidence      REAL NOT NULL DEFAULT 0.50,
  occurrences     INTEGER NOT NULL DEFAULT 1,
  false_positives INTEGER NOT NULL DEFAULT 0,
  first_seen      DATE NOT NULL DEFAULT CURRENT_DATE,
  last_seen       DATE NOT NULL DEFAULT CURRENT_DATE,
  source_projects JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT signatures_weight_check CHECK (weight >= 0 AND weight <= 1),
  CONSTRAINT signatures_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT signatures_occurrences_check CHECK (occurrences >= 0),
  CONSTRAINT signatures_false_positives_check CHECK (false_positives >= 0),
  CONSTRAINT signatures_fp_le_occurrences CHECK (false_positives <= occurrences)
);
COMMENT ON TABLE public.signatures IS 'Learned attack patterns. Canonical store; the D1 edge cache is derived from this.';
COMMENT ON COLUMN public.signatures.confidence IS 'weight * (1 - false_positives/occurrences), clamped to [0.10, 0.98]. Drives blocking.';

CREATE INDEX IF NOT EXISTS idx_signatures_attack_type ON public.signatures USING btree (attack_type);
CREATE INDEX IF NOT EXISTS idx_signatures_confidence ON public.signatures USING btree (confidence DESC);

ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
-- RLS enabled, zero policies (confirmed via get_advisors "rls_enabled_no_policy").
-- Only service_role (which bypasses RLS) and the SECURITY DEFINER functions
-- below can touch this table; anon/authenticated get nothing directly.

CREATE TABLE IF NOT EXISTS public.adaptive_thresholds (
  attack_type   TEXT PRIMARY KEY,
  threshold     REAL NOT NULL DEFAULT 0.75,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT adaptive_thresholds_threshold_check CHECK (threshold >= 0 AND threshold <= 1)
);

ALTER TABLE public.adaptive_thresholds ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.threat_events (
  id                BIGSERIAL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip         INET,
  method            TEXT,
  path              TEXT,
  matched_sig_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  signature_score   REAL NOT NULL DEFAULT 0,
  behavioral_score  REAL NOT NULL DEFAULT 0,
  anomaly_score     REAL NOT NULL DEFAULT 0,
  total_score       REAL NOT NULL DEFAULT 0,
  threat_level      TEXT NOT NULL,
  action            TEXT NOT NULL,
  outcome           TEXT,
  raw_sample_r2_key TEXT,
  project           TEXT,
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT threat_events_threat_level_check CHECK (threat_level IN ('ALLOW','LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT threat_events_action_check CHECK (action IN ('allow','log','block','recover')),
  CONSTRAINT threat_events_outcome_check CHECK (outcome IN ('confirmed','false_positive'))
) PARTITION BY RANGE (occurred_at);
COMMENT ON COLUMN public.threat_events.raw_sample_r2_key IS 'Pointer into R2. Payloads never stored here — they would consume the 500 MB quota.';

-- Monthly partitions that exist live (2026-06 through 2026-10).
CREATE TABLE IF NOT EXISTS public.threat_events_202606
  PARTITION OF public.threat_events FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.threat_events_202607
  PARTITION OF public.threat_events FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.threat_events_202608
  PARTITION OF public.threat_events FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.threat_events_202609
  PARTITION OF public.threat_events FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.threat_events_202610
  PARTITION OF public.threat_events FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

-- Created on the parent so Postgres attaches matching indexes to every
-- existing (and future) partition automatically.
CREATE INDEX IF NOT EXISTS idx_threat_events_occurred ON public.threat_events USING btree (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_threat_events_level ON public.threat_events USING btree (threat_level);
CREATE INDEX IF NOT EXISTS idx_threat_events_outcome ON public.threat_events USING btree (outcome) WHERE (outcome IS NULL);

ALTER TABLE public.threat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_events_202606 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_events_202607 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_events_202608 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_events_202609 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_events_202610 ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.learning_deltas (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  sig_id      TEXT NOT NULL REFERENCES public.signatures(id) ON DELETE CASCADE,
  delta       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  exported_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_learning_deltas_session ON public.learning_deltas USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_learning_deltas_pending ON public.learning_deltas USING btree (created_at) WHERE (exported_at IS NULL);

ALTER TABLE public.learning_deltas ENABLE ROW LEVEL SECURITY;

-- Signature learning/reinforcement functions.
CREATE OR REPLACE FUNCTION public.learn_signature(p_attack_type text, p_pattern text, p_project text)
 RETURNS signatures
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_id text;
  s    public.signatures;
begin
  v_id := 'sig_' || p_attack_type || '_' ||
          substr(encode(extensions.digest(p_pattern, 'sha1'), 'hex'), 1, 10);

  if exists (select 1 from public.signatures where id = v_id) then
    return public.reinforce_signature(v_id, p_project, false);
  end if;

  insert into public.signatures (id, attack_type, pattern, source_projects)
  values (v_id, p_attack_type, p_pattern, jsonb_build_array(p_project))
  returning * into s;

  insert into public.learning_deltas (session_id, sig_id, delta)
  values (
    coalesce(current_setting('warnet.session_id', true), 'unknown'),
    s.id,
    jsonb_build_object('new', true, 'attack_type', p_attack_type, 'pattern', p_pattern)
  );

  return s;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reinforce_signature(p_sig_id text, p_project text, p_false_positive boolean DEFAULT false)
 RETURNS signatures
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s       public.signatures;
  fp_rate real;
begin
  select * into s from public.signatures where id = p_sig_id for update;
  if not found then
    return null;
  end if;

  s.occurrences := s.occurrences + 1;
  s.last_seen   := current_date;

  if p_project is not null and not (s.source_projects ? p_project) then
    s.source_projects := s.source_projects || to_jsonb(p_project);
  end if;

  if p_false_positive then
    s.false_positives := s.false_positives + 1;
    s.weight := greatest(0.10, s.weight - 0.05);
  else
    s.weight := least(0.95, s.weight + (0.95 - s.weight) * 0.08);
  end if;

  fp_rate      := s.false_positives::real / s.occurrences::real;
  s.confidence := greatest(0.10, least(0.98, s.weight * (1 - fp_rate)));

  update public.signatures set
    occurrences     = s.occurrences,
    last_seen       = s.last_seen,
    source_projects = s.source_projects,
    false_positives = s.false_positives,
    weight          = s.weight,
    confidence      = s.confidence,
    updated_at      = now()
  where id = p_sig_id
  returning * into s;

  insert into public.learning_deltas (session_id, sig_id, delta)
  values (
    coalesce(current_setting('warnet.session_id', true), 'unknown'),
    s.id,
    jsonb_build_object(
      'weight', s.weight,
      'confidence', s.confidence,
      'occurrences', s.occurrences,
      'false_positives', s.false_positives,
      'false_positive_report', p_false_positive
    )
  );

  return s;
end;
$function$;


-- ============================================================================
-- === warnet_0003_anomaly (20260730023236) ===
-- No live objects attributable to this migration in isolation: it appears
-- to have (re-)created some/all of the sql-anomaly-detection-repo schema a
-- second time, and warnet_0009 (below) removed the duplicates. Net effect on
-- current live state is nil. Kept as a numbered placeholder for traceability.
-- ============================================================================


-- ============================================================================
-- === warnet_0004_files (20260730023254) ===
-- R2 object registry. Object bytes live in R2 at (bucket, r2_key); this
-- table is metadata only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          BIGINT NOT NULL DEFAULT 0,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  bucket        TEXT NOT NULL DEFAULT 'warnet-backups',
  etag          TEXT,
  sha256        TEXT,
  tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance    JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT files_bucket_r2_key_key UNIQUE (bucket, r2_key),
  CONSTRAINT files_size_check CHECK (size >= 0),
  CONSTRAINT files_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE public.files IS 'Registry only. Object bytes live in R2 at (bucket, r2_key); sha256 makes a restore verifiable.';
COMMENT ON COLUMN public.files.deleted_at IS 'Soft delete. The R2 object may already be gone; the row is kept so history stays auditable.';

CREATE INDEX IF NOT EXISTS idx_files_sha256 ON public.files USING btree (sha256);
CREATE INDEX IF NOT EXISTS idx_files_tags ON public.files USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_files_uploaded ON public.files USING btree (uploaded_at DESC) WHERE (deleted_at IS NULL);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.file_integrity_drift(p_present_keys jsonb)
 RETURNS TABLE(r2_key text, issue text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select f.r2_key, 'missing_in_storage'
  from public.files f
  where f.deleted_at is null
    and not (p_present_keys ? f.r2_key)
  union all
  select k.key, 'orphan_in_storage'
  from jsonb_array_elements_text(p_present_keys) as k(key)
  where not exists (
    select 1 from public.files f
    where f.r2_key = k.key and f.deleted_at is null
  );
$function$;


-- ============================================================================
-- === warnet_0005_reconcile_and_rollups (20260730023600) ===
-- Hourly/daily metric aggregates. Raw samples live in the D1 edge buffer and
-- R2 archives; PERCENTILE_CONT is native here and absent in SQLite, which is
-- why rollup computation happens on this side.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.metric_rollups (
  id            BIGSERIAL,
  source_id     TEXT NOT NULL,
  metric_type   TEXT NOT NULL,
  metric_name   TEXT NOT NULL,
  bucket_start  TIMESTAMPTZ NOT NULL,
  bucket_width  INTERVAL NOT NULL DEFAULT '01:00:00'::interval,
  sample_count  INTEGER NOT NULL,
  min_value     DOUBLE PRECISION,
  max_value     DOUBLE PRECISION,
  mean_value    DOUBLE PRECISION,
  p50_value     DOUBLE PRECISION,
  p95_value     DOUBLE PRECISION,
  p99_value     DOUBLE PRECISION,
  stddev_value  DOUBLE PRECISION,
  unit          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, bucket_start),
  CONSTRAINT metric_rollups_sample_count_check CHECK (sample_count > 0)
) PARTITION BY RANGE (bucket_start);
COMMENT ON TABLE public.metric_rollups IS 'Hourly/daily aggregates only. Raw samples live in the D1 edge buffer and R2 archives.';
COMMENT ON COLUMN public.metric_rollups.p95_value IS 'PERCENTILE_CONT — native here, absent in SQLite, which is why rollup happens on this side.';

-- Monthly partitions that exist live (2026-06 through 2026-10).
CREATE TABLE IF NOT EXISTS public.metric_rollups_202606
  PARTITION OF public.metric_rollups FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.metric_rollups_202607
  PARTITION OF public.metric_rollups FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.metric_rollups_202608
  PARTITION OF public.metric_rollups FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.metric_rollups_202609
  PARTITION OF public.metric_rollups FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS public.metric_rollups_202610
  PARTITION OF public.metric_rollups FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE INDEX IF NOT EXISTS idx_rollups_lookup ON public.metric_rollups
  USING btree (source_id, metric_type, metric_name, bucket_start DESC);

ALTER TABLE public.metric_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_rollups_202606 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_rollups_202607 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_rollups_202608 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_rollups_202609 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_rollups_202610 ENABLE ROW LEVEL SECURITY;

-- Ingestion, reconciliation and partition-maintenance functions. These
-- operate on metric_rollups/threat_events (this file) and on
-- performance_baseline/anomalies (sql-anomaly-detection-repo tables,
-- referenced but not redefined here).

CREATE OR REPLACE FUNCTION public.ingest_metric_batch(p_samples jsonb, p_bucket_width interval DEFAULT '01:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rows integer;
begin
  if p_samples is null or jsonb_typeof(p_samples) <> 'array' then
    raise exception 'p_samples must be a JSONB array, got %', coalesce(jsonb_typeof(p_samples), 'null');
  end if;

  with parsed as (
    select
      s->>'source_id'                        as source_id,
      coalesce(s->>'metric_type', 'custom')  as metric_type,
      s->>'metric_name'                      as metric_name,
      (s->>'value')::double precision        as value,
      s->>'unit'                             as unit,
      date_bin(p_bucket_width,
               coalesce((s->>'ts')::timestamptz, now()),
               timestamptz 'epoch')          as bucket_start
    from jsonb_array_elements(p_samples) as s
    where s->>'source_id'   is not null
      and s->>'metric_name' is not null
      and s->>'value'       is not null
  ),
  agg as (
    select
      source_id, metric_type, metric_name, bucket_start,
      min(unit)                                           as unit,
      count(*)::integer                                   as sample_count,
      min(value)                                          as min_value,
      max(value)                                          as max_value,
      avg(value)                                          as mean_value,
      percentile_cont(0.50) within group (order by value) as p50_value,
      percentile_cont(0.95) within group (order by value) as p95_value,
      percentile_cont(0.99) within group (order by value) as p99_value,
      coalesce(stddev_samp(value), 0)                     as stddev_value
    from parsed
    group by source_id, metric_type, metric_name, bucket_start
  )
  insert into public.metric_rollups (
    source_id, metric_type, metric_name, bucket_start, bucket_width,
    sample_count, min_value, max_value, mean_value,
    p50_value, p95_value, p99_value, stddev_value, unit
  )
  select
    source_id, metric_type, metric_name, bucket_start, p_bucket_width,
    sample_count, min_value, max_value, mean_value,
    p50_value, p95_value, p99_value, stddev_value, unit
  from agg;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_metric_anomalies(p_lookback interval DEFAULT '02:00:00'::interval, p_sigma numeric DEFAULT 3.0)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_opened integer := 0;
begin
  with candidate as (
    select
      r.source_id,
      r.metric_type,
      r.metric_name,
      r.bucket_start,
      r.p95_value,
      b.mean_value::double precision   as baseline_mean,
      b.stddev_value::double precision as baseline_stddev,
      case when coalesce(b.stddev_value, 0) > 0
           then abs(r.p95_value - b.mean_value::double precision) / b.stddev_value::double precision
           else 0
      end as sigma_distance
    from public.metric_rollups r
    join public.performance_baseline b
      on  b.system_id          = r.source_id
      and b.metric_type        = r.metric_type
      and b.metric_name        is not distinct from r.metric_name
      and b.baseline_timestamp = ((r.bucket_start at time zone 'UTC')::date - 1)
    where r.bucket_start > now() - p_lookback
  ),
  breaching as (
    select distinct on (source_id, metric_type, metric_name) *
    from candidate
    where sigma_distance >= p_sigma
    order by source_id, metric_type, metric_name, sigma_distance desc
  ),
  inserted as (
    insert into public.anomalies (
      anomaly_type, severity, affected_system, description,
      anomaly_value, threshold_value, deviation_percent, detected_at
    )
    select
      b.metric_type || '_deviation',
      case
        when b.sigma_distance >= p_sigma * 2   then 'critical'
        when b.sigma_distance >= p_sigma * 1.5 then 'high'
        else 'medium'
      end,
      b.source_id,
      format('%s %s at %s, %s sigma from baseline mean %s',
             b.metric_type, b.metric_name,
             round(b.p95_value::numeric, 2),
             round(b.sigma_distance::numeric, 1),
             round(b.baseline_mean::numeric, 2)),
      b.p95_value::numeric,
      b.baseline_mean::numeric,
      case when b.baseline_mean <> 0
           then round((((b.p95_value - b.baseline_mean) / abs(b.baseline_mean)) * 100)::numeric, 2)
      end,
      b.bucket_start
    from breaching b
    where not exists (
      select 1 from public.anomalies a
      where a.affected_system = b.source_id
        and a.anomaly_type    = b.metric_type || '_deviation'
        and a.status in ('open','investigating','acknowledged')
    )
    returning 1
  )
  select count(*)::integer into v_opened from inserted;

  return v_opened;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_baselines(p_for_date date DEFAULT (CURRENT_DATE - 1))
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rows integer;
begin
  insert into public.performance_baseline (
    metric_type, system_id, metric_name, baseline_timestamp,
    p50_value, p95_value, p99_value, min_value, max_value, mean_value,
    stddev_value, sample_count, is_current
  )
  select
    metric_type,
    source_id,
    metric_name,
    p_for_date,
    (percentile_cont(0.50) within group (order by mean_value))::numeric,
    (percentile_cont(0.95) within group (order by p95_value))::numeric,
    (percentile_cont(0.99) within group (order by p99_value))::numeric,
    min(min_value)::numeric,
    max(max_value)::numeric,
    avg(mean_value)::numeric,
    coalesce(stddev_samp(mean_value), 0)::numeric,
    sum(sample_count)::integer,
    true
  from public.metric_rollups
  where bucket_start >= p_for_date::timestamptz
    and bucket_start <  (p_for_date + 1)::timestamptz
  group by metric_type, source_id, metric_name
  on conflict (system_id, metric_type, metric_name, baseline_timestamp) do update set
    p50_value    = excluded.p50_value,
    p95_value    = excluded.p95_value,
    p99_value    = excluded.p99_value,
    min_value    = excluded.min_value,
    max_value    = excluded.max_value,
    mean_value   = excluded.mean_value,
    stddev_value = excluded.stddev_value,
    sample_count = excluded.sample_count,
    is_current   = true;

  get diagnostics v_rows = row_count;

  update public.performance_baseline b
  set is_current = false
  where b.baseline_timestamp < p_for_date
    and b.is_current;

  return v_rows;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_month_partitions(p_table regclass, p_months_ahead integer DEFAULT 2, p_months_behind integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_created integer := 0;
  v_offset  integer;
  v_start   date;
  v_end     date;
  v_parent  text := p_table::text;
  v_short   text := coalesce(nullif(split_part(v_parent, '.', 2), ''), v_parent);
  v_part    text;
begin
  for v_offset in -p_months_behind .. p_months_ahead loop
    v_start := (date_trunc('month', current_date) + (v_offset || ' months')::interval)::date;
    v_end   := (v_start + interval '1 month')::date;
    v_part  := format('%s_%s', v_short, to_char(v_start, 'YYYYMM'));

    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relname = v_part and n.nspname = 'public'
    ) then
      execute format(
        'create table public.%I partition of %s for values from (%L) to (%L)',
        v_part, v_parent, v_start, v_end
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$function$;

CREATE OR REPLACE FUNCTION public.drop_old_partitions(p_table regclass, p_keep_months integer DEFAULT 6)
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_dropped text[] := '{}';
  v_cutoff  date   := (date_trunc('month', current_date) - (p_keep_months || ' months')::interval)::date;
  v_short   text   := coalesce(nullif(split_part(p_table::text, '.', 2), ''), p_table::text);
  r         record;
  v_month   date;
begin
  for r in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    join pg_namespace n on n.oid = p.relnamespace
    where p.relname = v_short and n.nspname = 'public'
  loop
    begin
      v_month := to_date(right(r.relname, 6), 'YYYYMM');
    exception when others then
      continue;
    end;

    if v_month < v_cutoff then
      execute format('drop table if exists public.%I', r.relname);
      v_dropped := array_append(v_dropped, r.relname);
    end if;
  end loop;

  return v_dropped;
end;
$function$;


-- ============================================================================
-- === warnet_0006_ai_memory (20260730023628) ===
-- Assistant conversation/session model, plus pgvector-backed semantic
-- search over embeddings tied to @cf/baai/bge-base-en-v1.5 (768-dim, fixed
-- by CHECK — changing embedding model requires a migration).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project        TEXT NOT NULL DEFAULT 'warnet',
  label          TEXT,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active    TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_active ON public.ai_sessions USING btree (last_active DESC);

ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  tokens      INTEGER,
  model       TEXT,
  provider    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_check CHECK (role IN ('system','user','assistant','tool'))
);
COMMENT ON COLUMN public.ai_messages.provider IS 'workers-ai | openai | ollama. Recorded so a provider migration is auditable.';

CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON public.ai_messages USING btree (session_id, created_at);

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.embeddings (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  ref_id      TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '@cf/baai/bge-base-en-v1.5',
  dim         INTEGER NOT NULL DEFAULT 768,
  content     TEXT,
  vec         extensions.vector(768) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT embeddings_dim_check CHECK (dim = 768),
  CONSTRAINT embeddings_kind_ref_id_model_key UNIQUE (kind, ref_id, model)
);
COMMENT ON TABLE public.embeddings IS 'Fixed at 768 dims (bge-base-en-v1.5). Changing model requires a migration — see dim CHECK.';

CREATE INDEX IF NOT EXISTS idx_embeddings_kind ON public.embeddings USING btree (kind);
CREATE INDEX IF NOT EXISTS idx_embeddings_vec ON public.embeddings USING hnsw (vec extensions.vector_cosine_ops);

ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_embeddings(p_query vector, p_kind text DEFAULT NULL::text, p_limit integer DEFAULT 8, p_max_dist double precision DEFAULT 0.5)
 RETURNS TABLE(id bigint, kind text, ref_id text, content text, distance double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select e.id, e.kind, e.ref_id, e.content,
         (e.vec operator(extensions.<=>) p_query)::double precision as distance
  from public.embeddings e
  where (p_kind is null or e.kind = p_kind)
    and (e.vec operator(extensions.<=>) p_query) <= p_max_dist
  order by e.vec operator(extensions.<=>) p_query
  limit greatest(1, least(p_limit, 50));
$function$;

CREATE OR REPLACE FUNCTION public.embedding_budget()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'rows',         count(*),
    'table_bytes',  pg_total_relation_size('public.embeddings'),
    'table_pretty', pg_size_pretty(pg_total_relation_size('public.embeddings')),
    'pct_of_quota', round((pg_total_relation_size('public.embeddings')::numeric / (500 * 1024 * 1024)) * 100, 2)
  )
  from public.embeddings;
$function$;

CREATE OR REPLACE FUNCTION public.trim_ai_session(p_session_id uuid, p_keep integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_deleted integer;
begin
  delete from public.ai_messages
  where session_id = p_session_id
    and id not in (
      select id from public.ai_messages
      where session_id = p_session_id
      order by created_at desc
      limit p_keep
    );
  get diagnostics v_deleted = row_count;

  update public.ai_sessions
  set message_count = (select count(*) from public.ai_messages where session_id = p_session_id),
      last_active   = now()
  where id = p_session_id;

  return v_deleted;
end;
$function$;


-- ============================================================================
-- === warnet_0007_jobs_and_quota (20260730023737) ===
-- Storage-quota tracking and the pg_cron schedule that ties the functions
-- from earlier sections together.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quota_status (
  resource     TEXT PRIMARY KEY,
  used_bytes   BIGINT,
  limit_bytes  BIGINT,
  pct_used     NUMERIC,
  state        TEXT NOT NULL DEFAULT 'ok',
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quota_status_state_check CHECK (state IN ('ok','warn','critical','readonly'))
);
COMMENT ON TABLE public.quota_status IS 'Single source of truth for quota pressure. The Worker polls this and degrades before any billing threshold is crossed.';

ALTER TABLE public.quota_status ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.schema_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_meta ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.quota_watchdog(p_limit_bytes bigint DEFAULT NULL::bigint, p_warn_ratio numeric DEFAULT 0.80, p_crit_ratio numeric DEFAULT 0.92)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_used    bigint;
  v_limit   bigint;
  v_pct     numeric;
  v_state   text;
  v_dropped text[] := '{}';
  v_result  jsonb;
begin
  v_limit := coalesce(
    p_limit_bytes,
    (select value::bigint from public.schema_meta where key = 'size_quota_bytes'),
    524288000
  );

  select pg_database_size(current_database()) into v_used;
  v_pct := round((v_used::numeric / v_limit) * 100, 2);

  v_state := case
    when v_pct >= 100                then 'readonly'
    when v_pct >= p_crit_ratio * 100 then 'critical'
    when v_pct >= p_warn_ratio * 100 then 'warn'
    else 'ok'
  end;

  if v_state in ('critical','warn') then
    v_dropped := v_dropped || public.drop_old_partitions('public.threat_events',
                   case when v_state = 'critical' then 1 else 3 end);
    v_dropped := v_dropped || public.drop_old_partitions('public.metric_rollups',
                   case when v_state = 'critical' then 3 else 6 end);

    if v_state = 'critical' then
      perform public.trim_ai_session(s.id, 50)
      from public.ai_sessions s
      where s.message_count > 50;
    end if;
  end if;

  v_result := jsonb_build_object(
    'used_bytes',         v_used,
    'limit_bytes',        v_limit,
    'pct_used',           v_pct,
    'state',              v_state,
    'dropped_partitions', to_jsonb(v_dropped),
    'checked_at',         now()
  );

  insert into public.quota_status (resource, used_bytes, limit_bytes, pct_used, state, detail, checked_at)
  values ('supabase_db', v_used, v_limit, v_pct, v_state, v_result, now())
  on conflict (resource) do update set
    used_bytes  = excluded.used_bytes,
    limit_bytes = excluded.limit_bytes,
    pct_used    = excluded.pct_used,
    state       = excluded.state,
    detail      = excluded.detail,
    checked_at  = excluded.checked_at;

  if v_state in ('critical','readonly') then
    insert into public.anomalies (
      anomaly_type, severity, affected_system, description,
      anomaly_value, threshold_value, detected_at
    )
    select 'storage_quota', 'critical', 'supabase',
           format('Database at %s%% of the %s quota — read-only risk', v_pct, pg_size_pretty(v_limit)),
           v_used, v_limit, now()
    where not exists (
      select 1 from public.anomalies
      where anomaly_type = 'storage_quota'
        and status in ('open','investigating','acknowledged')
    );
  end if;

  return v_result;
end;
$function$;

-- Cron schedule (pg_cron). Wired here since it ties functions from every
-- earlier section together and its jobnames are literally "jobs".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warnet_quota_watchdog') THEN
    PERFORM cron.schedule('warnet_quota_watchdog', '*/15 * * * *',
      $sql$select public.quota_watchdog();$sql$);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warnet_partition_maintenance') THEN
    PERFORM cron.schedule('warnet_partition_maintenance', '20 2 * * *',
      $sql$select public.ensure_month_partitions('public.threat_events', 2, 1); select public.ensure_month_partitions('public.metric_rollups', 2, 1); select public.drop_old_partitions('public.threat_events', 6); select public.drop_old_partitions('public.metric_rollups', 12);$sql$);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warnet_refresh_baselines') THEN
    PERFORM cron.schedule('warnet_refresh_baselines', '40 2 * * *',
      $sql$select public.refresh_baselines();$sql$);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warnet_detect_anomalies') THEN
    PERFORM cron.schedule('warnet_detect_anomalies', '*/30 * * * *',
      $sql$select public.detect_metric_anomalies();$sql$);
  END IF;
END $$;


-- ============================================================================
-- === warnet_0008_seed_signatures (20260730023828) ===
-- Seed data only. `signatures.pattern` values have Python's `(?i)` inline
-- regex flag already stripped where the source was a real regex (JS-ready);
-- brute_force/csrf rows hold non-regex behavioral markers
-- (e.g. "attempts:threshold_5plus") rather than patterns.
-- ============================================================================

INSERT INTO public.schema_meta (key, value) VALUES
  ('schema_version', '1.0.0'),
  ('embedding_model', '@cf/baai/bge-base-en-v1.5'),
  ('embedding_dim', '768'),
  ('size_quota_bytes', '524288000'),
  ('size_warn_bytes', '419430400')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.adaptive_thresholds (attack_type, threshold, sample_count) VALUES
  ('brute_force', 0.75, 0),
  ('command_injection', 0.75, 0),
  ('csrf', 0.75, 0),
  ('data_exfiltration', 0.75, 0),
  ('ddos', 0.75, 0),
  ('path_traversal', 0.75, 0),
  ('privilege_escalation', 0.75, 0),
  ('sql_injection', 0.75, 0),
  ('xss', 0.75, 0),
  ('xxe', 0.75, 0)
ON CONFLICT (attack_type) DO NOTHING;

INSERT INTO public.signatures (id, attack_type, pattern, weight, confidence, occurrences, false_positives, source_projects) VALUES
  ('sig_brute_force_a1b2c3d4e5', 'brute_force', 'attempts:threshold_5plus', 0.85, 0.91, 20, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_brute_force_b2c3d4e5f6', 'brute_force', 'credential:randomized_pattern', 0.70, 0.75, 8, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_command_injection_a1b2c3d4e5', 'command_injection', ';\s*rm\s+-rf', 0.93, 0.95, 8, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_command_injection_b2c3d4e5f6', 'command_injection', '\|\s*cat\s+/etc/passwd', 0.90, 0.93, 6, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_command_injection_c3d4e5f6a7', 'command_injection', '\$\([^)]+\)', 0.82, 0.87, 5, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_command_injection_d4e5f6a7b8', 'command_injection', '`[^`]+`', 0.76, 0.82, 4, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_command_injection_e5f6a7b8c9', 'command_injection', '&&\s*sudo', 0.70, 0.76, 2, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_csrf_a1b2c3d4e5', 'csrf', 'csrf_token:missing', 0.78, 0.85, 10, 1, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_a1b2c3d4e5', 'data_exfiltration', 'transfer:size_exceeds_baseline', 0.90, 0.94, 45, 2, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_b2c3d4e5f6', 'data_exfiltration', 'mysqldump|pg_dump', 0.85, 0.90, 38, 1, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_c3d4e5f6a7', 'data_exfiltration', 'encoding:base64_large_block', 0.78, 0.84, 26, 1, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_d4e5f6a7b8', 'data_exfiltration', 'timing:slow_drip_transfer', 0.70, 0.77, 7, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_e5f6a7b8c9', 'data_exfiltration', 'destination:unrecognized_endpoint', 0.66, 0.73, 5, 1, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_f6a7b8c9d0', 'data_exfiltration', 'payload:compressed_unknown_type', 0.60, 0.68, 4, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_data_exfiltration_g7b8c9d0e1', 'data_exfiltration', 'volume:500mb_plus_single_request', 0.55, 0.63, 3, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_ddos_a1b2c3d4e5', 'ddos', 'rate:threshold_exceeded', 0.88, 0.92, 50, 1, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_ddos_b2c3d4e5f6', 'ddos', 'protocol:syn_flood', 0.80, 0.85, 13, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_path_traversal_a1b2c3d4e5', 'path_traversal', '\.\./', 0.90, 0.93, 14, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_path_traversal_b2c3d4e5f6', 'path_traversal', '%2e%2e%2f', 0.82, 0.87, 9, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_path_traversal_c3d4e5f6a7', 'path_traversal', '\.\.\\', 0.74, 0.80, 6, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_path_traversal_d4e5f6a7b8', 'path_traversal', '%252e%252e%252f', 0.65, 0.72, 3, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_privilege_escalation_a1b2c3d4e5', 'privilege_escalation', 'sudo\s+.*nopasswd', 0.88, 0.92, 8, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_privilege_escalation_b2c3d4e5f6', 'privilege_escalation', 'suid:binary_exploit', 0.80, 0.86, 12, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_privilege_escalation_c3d4e5f6a7', 'privilege_escalation', 'kernel:known_cve_pattern', 0.75, 0.81, 10, 2, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_sql_injection_a1b2c3d4e5', 'sql_injection', '(drop\s+table|--\s*$|;\s*drop)', 0.92, 0.94, 45, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_sql_injection_b2c3d4e5f6', 'sql_injection', '''\s*or\s*''1''\s*=\s*''1', 0.90, 0.93, 38, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_sql_injection_c3d4e5f6a7', 'sql_injection', 'union\s+select', 0.86, 0.90, 22, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_sql_injection_d4e5f6a7b8', 'sql_injection', 'admin''\s*--', 0.84, 0.88, 15, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_sql_injection_e5f6a7b8c9', 'sql_injection', 'waitfor\s+delay', 0.78, 0.83, 9, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_sql_injection_f6a7b8c9d0', 'sql_injection', 'and\s+sleep\(', 0.72, 0.78, 6, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_xss_a1b2c3d4e5', 'xss', '<script[^>]*>', 0.90, 0.93, 28, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_xss_b2c3d4e5f6', 'xss', 'on(error|load)\s*=', 0.86, 0.90, 19, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_xss_c3d4e5f6a7', 'xss', 'javascript:', 0.75, 0.80, 8, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_xxe_a1b2c3d4e5', 'xxe', '<!entity', 0.85, 0.90, 5, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb),
  ('sig_xxe_b2c3d4e5f6', 'xxe', '<!doctype[^>]+system', 0.72, 0.78, 4, 0, '["AI-Firewall-UKSCN1-Trial"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Note: the live rows above carry first_seen/last_seen = 2026-07-29 and
-- created_at/updated_at = 2026-07-30, i.e. earlier than this INSERT would
-- naturally produce (DEFAULT CURRENT_DATE / now()). Left on defaults here
-- since exact historical timestamps are not load-bearing for schema
-- reconstruction; update manually if byte-for-byte data parity is needed.


-- ============================================================================
-- === warnet_0009_fix_duplicate_anomaly_detection (20260730024013) ===
-- No live objects attributable to this migration in isolation — see the
-- warnet_0003_anomaly note above. This entry exists purely so the step
-- numbering stays traceable to the real migration history.
-- ============================================================================


-- ============================================================================
-- === unattributed: chat/session model ===
-- Live tables (chats, chat_members, messages, message_thread_summaries) that
-- do not obviously match any of the named warnet_000X migrations above by
-- content or naming. No source file exists to confirm which migration
-- introduced them; reconstructed here from live state and grouped together
-- for traceability rather than force-fit into an incorrect section.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE TABLE IF NOT EXISTS public.chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE TRIGGER chats_set_updated_at BEFORE UPDATE ON public.chats
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "authenticated members can create chats" ON public.chats
    FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- SECURITY FINDING (confirmed live via get_advisors, 2026-08-01, WARN level):
-- this INSERT policy's WITH CHECK is unconditionally `true` — fully
-- unrestricted for any authenticated user. `chats` itself carries no
-- ownership/sensitive columns (id/created_at/updated_at only; the real
-- access boundary lives on chat_members via `user_id = auth.uid()`), so this
-- is not a data-exposure path, but it is still the kind of accidental
-- blanket-allow the linter is right to flag. See the scope note at the top
-- of this file: migrations/003_security_hardening.sql in this repo already
-- claims to replace this policy with an `auth.uid() IS NOT NULL` check, but
-- that fix was verified NOT to be live at time of writing.

DO $$ BEGIN
  CREATE POLICY "chat members can view chats" ON public.chats
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chats.id AND cm.user_id = (SELECT auth.uid())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "members can update chats" ON public.chats
    FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chats.id AND cm.user_id = (SELECT auth.uid())
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chats.id AND cm.user_id = (SELECT auth.uid())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.chat_members (
  chat_id     UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id),
  CONSTRAINT chat_members_role_check CHECK (role IN ('member','admin'))
);

CREATE INDEX IF NOT EXISTS chat_members_user_idx ON public.chat_members USING btree (user_id);

ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users can view their chat memberships" ON public.chat_members
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "users can add themselves to chat" ON public.chat_members
    FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "users can update their membership" ON public.chat_members
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "users can remove their membership" ON public.chat_members
    FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_chat_created_at_idx ON public.messages USING btree (chat_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE TRIGGER messages_set_updated_at BEFORE UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat members can view messages" ON public.messages
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = messages.chat_id AND cm.user_id = (SELECT auth.uid())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "members can insert messages" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK (
      sender_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1 FROM chat_members cm
        WHERE cm.chat_id = messages.chat_id AND cm.user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "senders can update messages" ON public.messages
    FOR UPDATE TO authenticated
    USING (sender_id = (SELECT auth.uid()))
    WITH CHECK (sender_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "senders can delete messages" ON public.messages
    FOR DELETE TO authenticated USING (sender_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.message_thread_summaries (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id                UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  created_by             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary                TEXT NOT NULL,
  model                  TEXT,
  input_token_estimate   INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_thread_summaries_chat_id_created_by_key UNIQUE (chat_id, created_by)
);

ALTER TABLE public.message_thread_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "members can view summaries" ON public.message_thread_summaries
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = message_thread_summaries.chat_id AND cm.user_id = (SELECT auth.uid())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "members can create summaries" ON public.message_thread_summaries
    FOR INSERT TO authenticated
    WITH CHECK (
      created_by = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1 FROM chat_members cm
        WHERE cm.chat_id = message_thread_summaries.chat_id AND cm.user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "members can update their summaries" ON public.message_thread_summaries
    FOR UPDATE TO authenticated
    USING (created_by = (SELECT auth.uid()))
    WITH CHECK (created_by = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "members can delete their summaries" ON public.message_thread_summaries
    FOR DELETE TO authenticated USING (created_by = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- === cross-cutting: trigger added to a sql-anomaly-detection-repo table ===
-- `learned_patterns` itself is defined in sql-anomaly-detection-repo
-- (schema/solutions_table.sql) and is NOT redefined here. This trigger
-- function/trigger pair, however, is warnet-era live state layered on top of
-- that repo table and has no home in the repo's own migration files, so it
-- is reconstructed here rather than silently dropped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_learned_pattern_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_evidence numeric;
begin
  if new.times_applied > 0 then
    new.success_rate := round((new.times_successful::numeric / new.times_applied) * 100, 2);
    v_evidence := least(1.0, new.times_applied::numeric / 20);
    new.confidence_score := round(new.success_rate * v_evidence, 2);
  else
    new.success_rate     := 0;
    new.confidence_score := 0;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

DO $$ BEGIN
  CREATE TRIGGER trg_learned_pattern_stats
    BEFORE INSERT OR UPDATE OF times_applied, times_successful ON public.learned_patterns
    FOR EACH ROW EXECUTE FUNCTION public.refresh_learned_pattern_stats();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- End of reconstructed baseline.
-- ============================================================================
