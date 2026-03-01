/**
 * Clinic-specific intent taxonomy and structured types.
 * The LLM classifier maps plain English to one of these intents,
 * then the pipeline routes to either read or write handling.
 */

export enum AllowedIntent {
  REPORT_PERFORMANCE = "report_performance",
  MORE_LEADS = "more_leads",
  REDUCE_COST = "reduce_cost",
  CHECK_STATUS = "check_status",
  PAUSE = "pause",
  RESUME = "resume",
  ADJUST_BUDGET = "adjust_budget",
  KILL_SWITCH = "kill_switch",
  REVERT = "revert",
  DIAGNOSE_FUNNEL = "diagnose_funnel",
  DIAGNOSE_PORTFOLIO = "diagnose_portfolio",
  FETCH_SNAPSHOT = "fetch_snapshot",
  ANALYZE_STRUCTURE = "analyze_structure",
  UNKNOWN = "unknown",
}

/** Intents that only read data — no governance pipeline needed. */
export const READ_INTENTS = new Set<AllowedIntent>([
  AllowedIntent.REPORT_PERFORMANCE,
  AllowedIntent.CHECK_STATUS,
  AllowedIntent.MORE_LEADS,
  AllowedIntent.REDUCE_COST,
]);

/** Intents that mutate state — go through full governance pipeline. */
export const WRITE_INTENTS = new Set<AllowedIntent>([
  AllowedIntent.PAUSE,
  AllowedIntent.RESUME,
  AllowedIntent.ADJUST_BUDGET,
  AllowedIntent.KILL_SWITCH,
  AllowedIntent.REVERT,
]);

/** Diagnostic intents — produce proposals (auto-approve via low risk) for audit logging. */
export const DIAGNOSTIC_INTENTS = new Set<AllowedIntent>([
  AllowedIntent.DIAGNOSE_FUNNEL,
  AllowedIntent.DIAGNOSE_PORTFOLIO,
  AllowedIntent.FETCH_SNAPSHOT,
  AllowedIntent.ANALYZE_STRUCTURE,
]);

/** Maps diagnostic intents to cartridge action types. */
export const DIAGNOSTIC_INTENT_TO_ACTION: Record<string, string> = {
  [AllowedIntent.DIAGNOSE_FUNNEL]: "digital-ads.funnel.diagnose",
  [AllowedIntent.DIAGNOSE_PORTFOLIO]: "digital-ads.portfolio.diagnose",
  [AllowedIntent.FETCH_SNAPSHOT]: "digital-ads.snapshot.fetch",
  [AllowedIntent.ANALYZE_STRUCTURE]: "digital-ads.structure.analyze",
};

/** Structured classification result produced by the LLM. */
export interface ClassifyResult {
  intent: AllowedIntent;
  confidence: number;
  slots: Record<string, unknown>;
  reasoning: string;
}

/** Lightweight descriptor attached to InterpreterResult for read intents. */
export interface ReadIntentDescriptor {
  intent: AllowedIntent;
  slots: Record<string, unknown>;
  confidence: number;
}

/** Clinic context injected into prompts for grounding. */
export interface ClinicContext {
  adAccountId: string;
  campaignNames?: string[];
  clinicName?: string;
}
