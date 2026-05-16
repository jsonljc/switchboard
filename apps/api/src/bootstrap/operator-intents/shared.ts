// apps/api/src/bootstrap/operator-intents/shared.ts
// ---------------------------------------------------------------------------
// Shared symbols for the operator-direct intent surface (Wave 2 Phase 1b).
//
// Imports from this file:
//   - Per-domain handler files (./opportunity.ts, ./recommendation.ts, etc.)
//   - The barrel + bootstrap entry (../operator-intents.ts)
//   - API routes that need the intent string or error code literal
//
// See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
// Amendment 2 for the architectural framing.
// ---------------------------------------------------------------------------

export const TRANSITION_OPPORTUNITY_STAGE_INTENT = "operator.transition_opportunity_stage";
export const ACT_ON_RECOMMENDATION_INTENT = "operator.act_on_recommendation";
export const CONFIRM_DISQUALIFICATION_INTENT = "operator.confirm_disqualification";
export const DISMISS_DISQUALIFICATION_INTENT = "operator.dismiss_disqualification";
export const GRANT_CONSENT_INTENT = "operator.grant_consent";
export const REVOKE_CONSENT_INTENT = "operator.revoke_consent";
export const CLEAR_CONSENT_INTENT = "operator.clear_consent";

/**
 * Sentinel deployment ID used for admin-consent verdict context. The admin
 * endpoint is not a real deployment; this literal preserves the audit-trail
 * tagging that pre-dated the ingress migration (Phase 1b.4).
 *
 * TODO(Phase 3A / Design A): once the Mutating Route Contract formalizes the
 * route→deployment mapping, replace this with `workUnit.deployment.deploymentId`
 * so admin actions inherit the real ingress-resolved deployment instead of a
 * special-case constant. This is a forward-compatibility note, not a current
 * bug — the sentinel is correct today.
 */
export const ADMIN_CONSENT_DEPLOYMENT_ID = "system:admin-endpoint";

/**
 * Error codes returned by operator-mutation handlers. Routes and handlers
 * share these literals so a rename on one side is a compile error on the
 * other. Future Phase 1b/1c intents extend this object.
 */
export const OPERATOR_INTENT_ERROR_CODES = {
  OPPORTUNITY_NOT_FOUND: "OPPORTUNITY_NOT_FOUND",
  RECOMMENDATION_NOT_FOUND: "RECOMMENDATION_NOT_FOUND",
  RECOMMENDATION_INVALID_ACTION: "RECOMMENDATION_INVALID_ACTION",
  DISQUALIFICATION_NOT_FOUND: "DISQUALIFICATION_NOT_FOUND",
  DISQUALIFICATION_CONFLICT: "DISQUALIFICATION_CONFLICT",
  DISQUALIFICATION_HOOK_THROW: "DISQUALIFICATION_HOOK_THROW",
  CONSENT_NOT_FOUND: "CONSENT_NOT_FOUND",
  CONSENT_INVALID_JURISDICTION: "CONSENT_INVALID_JURISDICTION",
  CONSENT_REVOKED_CANNOT_REGRANT: "CONSENT_REVOKED_CANNOT_REGRANT",
  CONSENT_OPERATION_FAILED: "CONSENT_OPERATION_FAILED",
} as const;
