import { ConnectorName } from "../connectors/types";

/** A single connector call the planner wants to make. */
export interface PlanStep {
  connector: ConnectorName;
  action: string;
  params: Record<string, unknown>;
  /** Why the planner chose this step — recorded in agent_actions.decision. */
  rationale: string;
}

export interface Plan {
  task: string;
  steps: PlanStep[];
  /** Planner's own confidence, 0-1. Low confidence biases toward the larger model. */
  confidence: number;
  /** Estimated cost in Workers AI neurons + connector calls, for budget enforcement. */
  estimatedCost: number;
}

export type GuardrailDecision = "allow" | "block" | "needs_confirmation";

export interface GuardrailVerdict {
  decision: GuardrailDecision;
  /** Human-readable justification — always logged, shown in the dashboard. */
  reason: string;
  /** Which rule fired, for auditing and for tuning the rules later. */
  rule?: string;
  /** True when the step is outside the declared scope (§5). Alert-only: does not block. */
  scopeDrift?: boolean;
}

export interface StepResult {
  step: PlanStep;
  success: boolean;
  data?: unknown;
  error?: string;
  verdict: GuardrailVerdict;
}

export interface TaskOutcome {
  task: string;
  plan: Plan | null;
  results: StepResult[];
  success: boolean;
  /** Set when the whole task was refused before any step ran. */
  refusedReason?: string;
}

export interface TaskOptions {
  /** Caller-supplied confirmation for destructive steps. */
  confirmed?: boolean;
  /** Plan and validate, but never execute. Used for the dry-run rollout mode. */
  dryRun?: boolean;
  /** Who or what submitted this task — 'api' | 'chat' | 'email' | 'cron' | 'webhook'. */
  source?: string;
  /** Identifier of the submitter, when known. Recorded as agent_actions.approved_by. */
  actor?: string;
}

/**
 * A learned pattern, backed by the existing `learned_patterns` table
 * (reused rather than duplicated — see plan §2.3). `pattern_domain`
 * discriminates agent-domain rows from the pre-existing anomaly rows.
 */
export interface LearnedPattern {
  id?: number;
  patternName: string;
  patternDescription: string;
  triggerConditions: Record<string, unknown>;
  confidenceScore: number;
  timesApplied: number;
  timesSuccessful: number;
}
