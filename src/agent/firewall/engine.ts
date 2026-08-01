import { Env } from "../../types";
import { executeConnectorAction } from "../../connectors/index";
import { Signature, bestScore, loadSignatures, match } from "./signatures";
import { ThresholdLevel, ThresholdMap, adaptationMultiplier, loadThresholds, thresholdFor } from "./learning";

/**
 * Port of AI-Firewall-Defense-Framework/core/engine.py.
 *
 * Deterministic by construction — the UKSCN1 trial's core.py used
 * random.random() in its scoring path, which is fine for generating pentest
 * variety but wrong for a production scorer whose verdicts must be
 * reproducible and auditable. The Framework's engine has no randomness and
 * that property is preserved here.
 */

export type ThreatLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DefenseAction = "allow" | "block" | "throttle" | "isolate" | "challenge" | "log";

export interface ThreatResult {
  threatScore: number;
  threatLevel: ThreatLevel;
  confidence: number;
  action: DefenseAction;
  attackType: string | null;
  matchedSignatures: number;
  analysisMs: number;
}

export interface RequestContext {
  source?: string;
  sourceHits?: number;
  unusualHeader?: boolean;
  suspiciousTiming?: boolean;
  attempts?: number;
  /** True for POST/PUT/PATCH/DELETE. Required before a missing CSRF token
   *  means anything — see the csrf_token marker in signatures.ts. */
  stateChanging?: boolean;
  csrfToken?: string | null;
  requestsPerMinute?: number;
}

/** Repeat-offender heuristic. Carries a request that matched no signature. */
function behaviouralScore(ctx: RequestContext): number {
  if (!ctx.source) return 0;
  return Math.min(1, (ctx.sourceHits ?? 0) * 0.1);
}

/** Oversized payloads and suspicious metadata. */
function anomalyScore(text: string, ctx: RequestContext): number {
  let score = 0;
  if (text.length > 10000) score += 0.3;
  if (ctx.unusualHeader) score += 0.3;
  if (ctx.suspiciousTiming) score += 0.4;
  return Math.min(1, score);
}

export function classify(score: number, attackType: string | null, thresholds: ThresholdMap): ThreatLevel {
  const at = (level: ThresholdLevel) => thresholdFor(thresholds, attackType, level);
  if (score >= at("critical")) return "CRITICAL";
  if (score >= at("high")) return "HIGH";
  if (score >= at("medium")) return "MEDIUM";
  return "LOW";
}

export function selectAction(level: ThreatLevel, confidence: number): DefenseAction {
  if (level === "CRITICAL") return "isolate";
  if (level === "HIGH") return confidence > 0.8 ? "block" : "challenge";
  if (level === "MEDIUM") return "throttle";
  return "allow";
}

/**
 * The scoring core, with no I/O. Kept separate from analyze() so the
 * block-rate and false-positive claims can actually be verified against the
 * pentest corpus without standing up a database — a claim you can't test
 * cheaply is a claim that quietly rots.
 */
export function scoreRequest(
  signatures: Signature[],
  text: string,
  thresholds: ThresholdMap,
  adaptationMultiplier: number,
  attackType?: string,
  ctx: RequestContext = {},
): ThreatResult {
  const started = Date.now();
  const matches = match(signatures, text, attackType, ctx as Record<string, unknown>);
  const signatureScore = bestScore(matches);

  const raw = signatureScore + behaviouralScore(ctx) * 0.3 + anomalyScore(text, ctx) * 0.2;
  const threatScore = Math.min(1, raw * adaptationMultiplier);

  const detectedType = attackType ?? (matches.length ? matches[0].attackType : null);
  const threatLevel = classify(threatScore, detectedType, thresholds);

  return {
    threatScore,
    threatLevel,
    confidence: signatureScore,
    action: selectAction(threatLevel, signatureScore),
    attackType: detectedType,
    matchedSignatures: matches.length,
    analysisMs: Date.now() - started,
  };
}

/**
 * Scores one request.
 *
 * A known signature is the primary signal and can drive the score to
 * CRITICAL on its own — a confirmed SQLi pattern shouldn't need
 * corroborating behaviour to be blocked. Behavioural and anomaly scores act
 * as boosters, and are what carry a request matching NO known signature
 * toward MEDIUM/HIGH purely on suspicious behaviour, which is how a
 * not-yet-learned attack still gets caught.
 */
export async function analyze(
  env: Env,
  text: string,
  attackType?: string,
  ctx: RequestContext = {},
): Promise<ThreatResult> {
  const [signatures, thresholds, multiplier] = await Promise.all([
    loadSignatures(env),
    loadThresholds(env),
    adaptationMultiplier(env),
  ]);
  return scoreRequest(signatures, text, thresholds, multiplier, attackType, ctx);
}

/**
 * Persists a verdict. Fire-and-forget from the request path — recording a
 * threat must never add latency to blocking it.
 *
 * HIGH and CRITICAL verdicts also land in `anomalies`, which the live schema
 * already describes as "a unified anomaly log for both system-health and
 * security findings, keyed by anomaly_type".
 */
export async function recordThreat(env: Env, result: ThreatResult, text: string): Promise<void> {
  await executeConnectorAction(env, "supabase", "insert", {
    table: "threat_events",
    rows: [
      {
        threat_level: result.threatLevel,
        threat_score: result.threatScore,
        confidence: result.confidence,
        action: result.action,
        attack_type: result.attackType,
        matched_signatures: result.matchedSignatures,
        occurred_at: new Date().toISOString(),
      },
    ],
  });

  if (result.threatLevel === "HIGH" || result.threatLevel === "CRITICAL") {
    await executeConnectorAction(env, "supabase", "insert", {
      table: "anomalies",
      rows: [
        {
          anomaly_type: result.attackType ?? "unknown_threat",
          severity: result.threatLevel === "CRITICAL" ? "critical" : "high",
          anomaly_value: result.threatScore,
          affected_system: "warnetech-server-worker",
          affected_component: "firewall",
          description: `${result.action} — ${result.matchedSignatures} signature(s) matched: ${text.slice(0, 200)}`,
        },
      ],
    });
  }
}
