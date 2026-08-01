-- Applied to tewartech-project-supabase (dcepcfnnqiwccbnnsdcq) 2026-08-01
-- via mcp__Supabase__apply_migration, name "firewall_thresholds".
--
-- adaptive_thresholds currently has one flat threshold per attack_type (PK on
-- attack_type alone, all 10 rows seeded at 0.75, sample_count 0 -- never
-- actually learned from). The ported LearningEngine needs four levels
-- (low/medium/high/critical) per attack_type, matching the Python
-- per_type_thresholds structure. Existing rows are preserved as the 'high'
-- tier (0.75 was the single historical value); low/medium/critical are
-- backfilled at the Python defaults (0.30/0.50/0.95).

ALTER TABLE adaptive_thresholds DROP CONSTRAINT adaptive_thresholds_pkey;
ALTER TABLE adaptive_thresholds ADD COLUMN IF NOT EXISTS level VARCHAR(10);
UPDATE adaptive_thresholds SET level = 'high' WHERE level IS NULL;
ALTER TABLE adaptive_thresholds ALTER COLUMN level SET NOT NULL;
ALTER TABLE adaptive_thresholds ADD CONSTRAINT adaptive_thresholds_level_check
  CHECK (level IN ('low', 'medium', 'high', 'critical'));
ALTER TABLE adaptive_thresholds ADD CONSTRAINT adaptive_thresholds_type_level_key
  PRIMARY KEY (attack_type, level);

INSERT INTO adaptive_thresholds (attack_type, level, threshold, sample_count)
SELECT attack_type, lvl.level, lvl.default_threshold, 0
FROM (SELECT DISTINCT attack_type FROM adaptive_thresholds) t
CROSS JOIN (VALUES ('low', 0.30), ('medium', 0.50), ('critical', 0.95)) AS lvl(level, default_threshold)
ON CONFLICT (attack_type, level) DO NOTHING;
