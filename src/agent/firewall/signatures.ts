import { Env } from "../../types";
import { executeConnectorAction } from "../../connectors/index";

/**
 * Port of AI-Firewall-Defense-Framework/core/signatures.py.
 *
 * Two changes the Python original doesn't need:
 *
 * 1. Persistence is Supabase (canonical) + D1 (hot-path cache), not a JSON
 *    file on local disk — a Worker has no disk, and the block path must not
 *    depend on Supabase being reachable (plan §3.3).
 * 2. Not every stored `pattern` is a regex. The live table contains
 *    behavioural markers such as "attempts:threshold_5plus" and
 *    "csrf_token:missing", which are valid regexes that would silently never
 *    match real traffic. Python's `except re.error` fallback doesn't catch
 *    this because they don't raise — they just quietly fail. So marker
 *    patterns are detected by shape and evaluated against context instead.
 */

export interface Signature {
  id: string;
  attackType: string;
  pattern: string;
  weight: number;
  confidence: number;
  occurrences: number;
  falsePositives: number;
}

/** `key:value` with no regex metacharacters — a behavioural marker, not a pattern. */
const MARKER_SHAPE = /^[a-z_]+:[a-z0-9_]+$/i;

export function isBehaviouralMarker(pattern: string): boolean {
  return MARKER_SHAPE.test(pattern);
}

/**
 * Evaluates a marker against request context rather than text. Unknown
 * markers return false — an unrecognised marker must never imply a match,
 * or an unmapped signature would fire on every request.
 */
function markerMatches(pattern: string, context: Record<string, unknown>): boolean {
  const [key, value] = pattern.split(":");
  switch (key) {
    case "attempts": {
      const threshold = Number(/(\d+)/.exec(value)?.[1] ?? NaN);
      if (Number.isNaN(threshold)) return false;
      return Number(context.attempts ?? 0) >= threshold;
    }
    case "csrf_token":
      return value === "missing" ? context.csrfToken === undefined || context.csrfToken === null : false;
    case "rate":
      return Number(context.requestsPerMinute ?? 0) >= Number(/(\d+)/.exec(value)?.[1] ?? Infinity);
    default:
      return false;
  }
}

export function signatureMatches(
  sig: Signature,
  text: string,
  context: Record<string, unknown> = {},
): boolean {
  if (isBehaviouralMarker(sig.pattern)) return markerMatches(sig.pattern, context);
  try {
    // Live patterns already have Python's inline (?i) stripped; JS expresses
    // case-insensitivity as a flag instead.
    return new RegExp(sig.pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(sig.pattern.toLowerCase());
  }
}

function rowToSignature(r: Record<string, unknown>): Signature {
  return {
    id: String(r.id),
    attackType: String(r.attack_type),
    pattern: String(r.pattern),
    weight: Number(r.weight ?? 0.3),
    confidence: Number(r.confidence ?? 0.5),
    occurrences: Number(r.occurrences ?? 1),
    falsePositives: Number(r.false_positives ?? 0),
  };
}

/**
 * Loads signatures for scoring. Reads the D1 cache first so a Supabase
 * outage cannot fail requests open; falls back to Supabase only if the
 * cache is empty (cold start after a cache rebuild).
 */
export async function loadSignatures(env: Env): Promise<Signature[]> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, attack_type, pattern, weight, confidence, occurrences, false_positives FROM signature_cache",
    ).all<Record<string, unknown>>();
    if (results.length) return results.map(rowToSignature);
  } catch {
    // Cache table may not exist yet on a fresh database — fall through.
  }

  const res = await executeConnectorAction(env, "supabase", "select", {
    table: "signatures",
    select: "id,attack_type,pattern,weight,confidence,occurrences,false_positives",
    limit: 1000,
  });
  if (!res.success || !Array.isArray(res.data)) return [];
  return (res.data as Record<string, unknown>[]).map(rowToSignature);
}

export function match(
  signatures: Signature[],
  text: string,
  attackType?: string,
  context: Record<string, unknown> = {},
): Signature[] {
  const candidates = attackType ? signatures.filter((s) => s.attackType === attackType) : signatures;
  return candidates.filter((s) => signatureMatches(s, text, context));
}

export function bestScore(matches: Signature[]): number {
  return matches.reduce((best, s) => Math.max(best, s.confidence), 0);
}

/**
 * The reinforcement curve from the Python original, unchanged: weight grows
 * asymptotically toward 0.95 on a true positive and drops by a flat 0.05 on
 * a false positive, then confidence is weight discounted by the observed
 * false-positive rate.
 */
export function reinforce(sig: Signature, falsePositive: boolean): Signature {
  const occurrences = sig.occurrences + 1;
  const falsePositives = sig.falsePositives + (falsePositive ? 1 : 0);
  const weight = falsePositive
    ? Math.max(0.1, sig.weight - 0.05)
    : Math.min(0.95, sig.weight + (0.95 - sig.weight) * 0.08);
  const fpRate = falsePositives / occurrences;
  const confidence = Math.max(0.1, Math.min(0.98, weight * (1 - fpRate)));
  return { ...sig, occurrences, falsePositives, weight, confidence };
}

export async function persistSignature(env: Env, sig: Signature): Promise<void> {
  await executeConnectorAction(env, "supabase", "upsert", {
    table: "signatures",
    onConflict: "id",
    rows: [
      {
        id: sig.id,
        attack_type: sig.attackType,
        pattern: sig.pattern,
        weight: sig.weight,
        confidence: sig.confidence,
        occurrences: sig.occurrences,
        false_positives: sig.falsePositives,
        last_seen: new Date().toISOString().slice(0, 10),
      },
    ],
  });

  // Keep the hot-path cache in step. Best-effort: a cache write failure must
  // not fail the request that triggered the learning.
  await env.DB.prepare(
    `INSERT INTO signature_cache (id, attack_type, pattern, weight, confidence, occurrences, false_positives)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       weight = excluded.weight,
       confidence = excluded.confidence,
       occurrences = excluded.occurrences,
       false_positives = excluded.false_positives`,
  )
    .bind(sig.id, sig.attackType, sig.pattern, sig.weight, sig.confidence, sig.occurrences, sig.falsePositives)
    .run()
    .catch((e) => console.error("signature_cache write failed:", e));
}

/** SHA-1-free id derivation — Workers WebCrypto is async, and a stable
 *  non-cryptographic hash is sufficient for a de-duplication key. */
export function signatureId(attackType: string, pattern: string): string {
  let hash = 0;
  for (let i = 0; i < pattern.length; i++) {
    hash = (hash << 5) - hash + pattern.charCodeAt(i);
    hash |= 0;
  }
  return `sig_${attackType}_${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

/** Rebuilds the D1 hot-path cache from Supabase. Called by the cron job. */
export async function refreshCache(env: Env): Promise<number> {
  const res = await executeConnectorAction(env, "supabase", "select", {
    table: "signatures",
    select: "id,attack_type,pattern,weight,confidence,occurrences,false_positives",
    limit: 1000,
  });
  if (!res.success || !Array.isArray(res.data)) return 0;

  const rows = (res.data as Record<string, unknown>[]).map(rowToSignature);
  const statements = rows.map((s) =>
    env.DB.prepare(
      `INSERT INTO signature_cache (id, attack_type, pattern, weight, confidence, occurrences, false_positives)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         weight = excluded.weight, confidence = excluded.confidence,
         occurrences = excluded.occurrences, false_positives = excluded.false_positives`,
    ).bind(s.id, s.attackType, s.pattern, s.weight, s.confidence, s.occurrences, s.falsePositives),
  );
  if (statements.length) await env.DB.batch(statements);
  return rows.length;
}
