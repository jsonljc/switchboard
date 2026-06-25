import type {
  GovernanceVerdictAction,
  GovernanceVerdictReason,
  GovernanceVerdictSource,
} from "@switchboard/schemas";

export type EnforceAction = "block" | "rewrite" | "escalate" | "template" | "none";

/**
 * Derives the action enforce WOULD have taken for a verdict.
 *
 * Two cases, in order:
 *  1. The verdict already carries a real enforce action. The WhatsApp gate records
 *     its true action ("block" / "template_required") even in observe (it only gates
 *     the response MUTATION on enforce), and any enforce-mode verdict records the real
 *     action. These map directly.
 *  2. The verdict carries action "allow" — the observe telemetry of the deterministic,
 *     price, claim, and consent gates. Here the would-be action is derived from
 *     (sourceGuard, reasonCode), mirroring each hook's enforce path: deterministic/price
 *     block; claim rewrites or escalates per reason; consent blocks ONLY a revoked-contact
 *     race (the disclosure path never blocks).
 *
 * This is the single source of truth for "what enforce would have done".
 */
export function deriveEnforceAction(
  sourceGuard: GovernanceVerdictSource,
  reasonCode: GovernanceVerdictReason,
  action: GovernanceVerdictAction,
): EnforceAction {
  // Case 1: a real enforce action is already on the verdict.
  switch (action) {
    case "block":
      return "block";
    case "rewrite":
      return "rewrite";
    case "escalate":
      return "escalate";
    case "template_required":
      return "template";
    case "allow":
      break; // Case 2: observe telemetry — derive from (sourceGuard, reasonCode) below.
  }

  switch (sourceGuard) {
    case "banned_phrase_scanner":
    case "price_gate":
      return "block";
    case "claim_classifier":
      if (reasonCode === "unsupported_claim_rewritten") return "rewrite";
      // Every other reason the classifier emits is an escalate in enforce:
      //  - unsupported_claim_escalated (ESCALATE_ONLY / credentials / no-template)
      //  - classifier_timeout / classifier_error (both return kind:"escalate" — a flaky
      //    classifier escalates to a human under enforce, the key handoff-storm signal)
      //  - claim_substantiation_stale: emitted by BOTH the credentials/escalate path AND
      //    the rewriteable/rewrite path. reasonCode alone cannot disambiguate and the
      //    aggregation drops emittedText, so a stale-rewrite verdict is conservatively
      //    counted as escalate (the larger action). Total would-act stays correct; only
      //    the escalate/rewrite split carries a known minor skew for this one reason. A
      //    precise split would need the classifier to emit distinct reason codes.
      if (
        reasonCode === "unsupported_claim_escalated" ||
        reasonCode === "unsupported_claim" ||
        reasonCode === "claim_substantiation_stale" ||
        reasonCode === "classifier_timeout" ||
        reasonCode === "classifier_error"
      ) {
        return "escalate";
      }
      return "none";
    case "consent_gate":
      // Enforce blocks ONLY a revoked-contact race; the disclosure path never blocks.
      return reasonCode === "consent_revoked" ? "block" : "none";
    case "whatsapp_window":
      // In observe the WhatsApp gate stores action "allow" only for an inside-window reply
      // (reasonCode "allowed"); its block/template verdicts carry a real action (Case 1).
      return "none";
    default:
      return "none";
  }
}
