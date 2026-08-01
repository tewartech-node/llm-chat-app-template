import { Env } from "../../types";
import { executeConnectorAction } from "../../connectors/index";
import {
  Signature,
  loadSignatures,
  match,
  persistSignature,
  reinforce,
  signatureId,
} from "./signatures";

/**
 * Port of AI-Firewall-Defense-Framework/core/learning.py.
 *
 * Thresholds live in the `adaptive_thresholds` table, which migration 002
 * reshaped from one flat value per attack type into a (attack_type, level)
 * composite key — the four-level structure this engine actually needs.
 */

export type ThresholdLevel = "low" | "medium" | "high" | "critical";
export type Outcome = "blocked" | "missed" | "false_positive";

export const DEFAULT_THRESHOLDS: Record<ThresholdLevel, number> = {
  low: 0.3,
  medium: 0.5,
  high: 0.75,
  critical: 0.95,
};

const ADAPTATION_RATE = 0.15;

export type ThresholdMap = Record<string, Partial<Record<ThresholdLevel, number>>>;

export async function loadThresholds(env: Env): Promise<ThresholdMap> {
  const res = await executeConnectorAction(env, "supabase", "select", {
    table: "adaptive_thresholds",
    select: "attack_type,level,threshold",
    limit: 200,
  });
  const map: ThresholdMap = {};
  if (!res.success || !Array.isArray(res.data)) return map;
  for (const r of res.data as Record<string, unknown>[]) {
    const type = String(r.attack_type);
    (map[type] ??= {})[String(r.level) as ThresholdLevel] = Number(r.threshold);
  }
  return map;
}

export function thresholdFor(
  thresholds: ThresholdMap,
  attackType: string | null,
  level: ThresholdLevel,
): number {
  if (attackType && thresholds[attackType]?.[level] !== undefined) {
    return thresholds[attackType][level]!;
  }
  return DEFAULT_THRESHOLDS[level];
}

/**
 * The adaptation multiplier scales the raw threat score upward as the system
 * accumulates observations — the mechanism behind the trial's reported
 * confidence growth. Stored as a running count rather than recomputed, so it
 * survives isolate restarts.
 */
export async function adaptationMultiplier(env: Env): Promise<number> {
  const level = Number((await env.RATELIMIT.get("firewall:adaptation-level")) ?? "0");
  return 1 + level * 0.01;
}

async function bumpAdaptationLevel(env: Env): Promise<void> {
  const level = Number((await env.RATELIMIT.get("firewall:adaptation-level")) ?? "0") + 1;
  await env.RATELIMIT.put("firewall:adaptation-level", String(level));
}

/**
 * Nudges per-attack-type thresholds from a real outcome: up on a false
 * positive (be less trigger-happy), gently down on a confirmed block (this
 * attack type is worth catching earlier). Rates match the Python original.
 */
async function adaptThresholds(env: Env, attackType: string, outcome: Outcome): Promise<void> {
  if (outcome === "missed") return;

  const current = await loadThresholds(env);
  const forType = current[attackType] ?? { ...DEFAULT_THRESHOLDS };
  const delta = outcome === "false_positive" ? ADAPTATION_RATE * 0.1 : -(ADAPTATION_RATE * 0.02);

  const updates = (Object.keys(DEFAULT_THRESHOLDS) as ThresholdLevel[]).map((level) => {
    const base = forType[level] ?? DEFAULT_THRESHOLDS[level];
    const next = outcome === "false_positive" ? Math.min(0.99, base + delta) : Math.max(0.1, base + delta);
    return { attack_type: attackType, level, threshold: next, sample_count: 1 };
  });

  await executeConnectorAction(env, "supabase", "upsert", {
    table: "adaptive_thresholds",
    onConflict: "attack_type,level",
    rows: updates,
  });
}

export interface ObserveResult {
  signature: Signature;
  outcome: Outcome;
  confidenceBefore: number;
  confidenceAfter: number;
}

/**
 * The learning entry point. Called after a flagged request's true nature is
 * known. Without this being called, the firewall never improves — scoring
 * alone is static.
 */
export async function observe(
  env: Env,
  attackType: string,
  pattern: string,
  blocked: boolean,
  falsePositive = false,
): Promise<ObserveResult> {
  const signatures = await loadSignatures(env);
  const matched = match(signatures, pattern, attackType);
  const confidenceBefore = matched.reduce((b, s) => Math.max(b, s.confidence), 0);

  let sig: Signature;
  if (matched.length > 0) {
    // Common case: a known pattern gets stronger (or weaker, on a false
    // positive) from real exposure. Reinforce every signature that fired.
    const reinforced = matched.map((s) => reinforce(s, falsePositive));
    for (const r of reinforced) await persistSignature(env, r);
    sig = reinforced[reinforced.length - 1];
  } else {
    // Flagged but nothing matched — capture it as a new low-confidence
    // candidate so it can be caught by signature match next time.
    sig = {
      id: signatureId(attackType, pattern),
      attackType,
      pattern,
      weight: 0.3,
      confidence: 0.5,
      occurrences: 1,
      falsePositives: falsePositive ? 1 : 0,
    };
    await persistSignature(env, sig);
  }

  const outcome: Outcome = falsePositive ? "false_positive" : blocked ? "blocked" : "missed";
  await adaptThresholds(env, attackType, outcome);
  await bumpAdaptationLevel(env);

  // learning_deltas is the exportable record of what this run learned —
  // the table maps onto the Python SignatureDatabase.export_deltas() concept.
  await executeConnectorAction(env, "supabase", "insert", {
    table: "learning_deltas",
    rows: [
      {
        session_id: crypto.randomUUID(),
        sig_id: sig.id,
        delta: { outcome, confidence_before: confidenceBefore, confidence_after: sig.confidence },
      },
    ],
  });

  return { signature: sig, outcome, confidenceBefore, confidenceAfter: sig.confidence };
}
