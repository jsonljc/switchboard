import type { QualificationSignals } from "@switchboard/schemas";
import type { TreatmentResolution } from "./treatment-resolver.js";

export type QualificationVerdict =
  | { verdict: "qualified"; serviceId: string }
  | { verdict: "unqualified"; reasons: QualificationFailureReason[] }
  | {
      verdict: "disqualifier_candidates_present";
      candidates: Array<{ type: string; evidence: string }>;
    };

export type QualificationFailureReason =
  | "treatment_unresolved"
  | "out_of_area"
  | "market_unknown"
  | "no_buying_intent"
  | "explicit_decline";

/**
 * Deterministic qualification rule (spec §5.1).
 *
 * Priority of verdicts:
 *  1. `disqualifier_candidates_present` — operator-actionable signal wins.
 *  2. `qualified` — all clauses pass.
 *  3. `unqualified` — at least one clause fails, with reason list.
 */
export function evaluateQualification(
  signals: QualificationSignals,
  treatment: TreatmentResolution,
): QualificationVerdict {
  if (signals.disqualifierCandidates.length > 0) {
    return {
      verdict: "disqualifier_candidates_present",
      candidates: signals.disqualifierCandidates,
    };
  }

  const reasons: QualificationFailureReason[] = [];
  if (!treatment.resolved) reasons.push("treatment_unresolved");
  if (signals.serviceableMarket === "out_of_area") reasons.push("out_of_area");
  if (signals.serviceableMarket === "unknown") reasons.push("market_unknown");
  if (signals.buyingIntent === "none") reasons.push("no_buying_intent");
  if (signals.explicitDecline) reasons.push("explicit_decline");

  if (reasons.length === 0 && treatment.resolved) {
    return { verdict: "qualified", serviceId: treatment.serviceId };
  }

  return { verdict: "unqualified", reasons };
}
