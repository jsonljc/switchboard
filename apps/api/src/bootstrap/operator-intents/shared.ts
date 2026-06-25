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
export const RECORD_REVENUE_INTENT = "operator.record_revenue";
export const RECORD_ATTENDANCE_INTENT = "booking.record_attendance";
export const RECONCILE_BOOKING_INTENT = "receipt.reconcile_booking";
export const DELIVER_WEEKLY_REPORT_INTENT = "ledger.deliver_weekly_report";
export const ERASE_CONTACT_INTENT = "operator.erase_contact";
export const MEMORY_WRITE_INTENT = "memory.write";
export const GOVERNANCE_SET_GATE_MODE_INTENT = "governance.set_gate_mode";

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
  // F3: payment.record_verified is a service-only intent whose `verified` verdict
  // is anchored to a server-side PSP fetch-back — never the caller's `provider`.
  PAYMENT_FORBIDDEN_ACTOR: "PAYMENT_FORBIDDEN_ACTOR",
  PAYMENT_NOT_VERIFIED: "PAYMENT_NOT_VERIFIED",
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  // receipt.reconcile_booking: flag/resolve hit a booking with no persisted ReceiptedBooking row,
  // or a resolve_exception targeted a code outside the v1-supported set.
  RECEIPTED_BOOKING_NOT_ISSUED: "RECEIPTED_BOOKING_NOT_ISSUED",
  RECONCILE_UNSUPPORTED_CODE: "RECONCILE_UNSUPPORTED_CODE",
  // ledger.deliver_weekly_report: no verified owner recipients resolved, so nothing was sent;
  // or the email send leg failed / was not configured.
  WEEKLY_REPORT_NO_RECIPIENTS: "WEEKLY_REPORT_NO_RECIPIENTS",
  WEEKLY_REPORT_DELIVERY_FAILED: "WEEKLY_REPORT_DELIVERY_FAILED",
  // operator.erase_contact: no contact with that id exists under the authenticated org. The
  // org-scoped existence check is the fail-closed cross-tenant guard — a contact in another org
  // reads as not-found here, so an operator can only erase a contact their org owns.
  CONTACT_NOT_FOUND: "CONTACT_NOT_FOUND",
  // governance.set_gate_mode: the safety REFUSE — an enforce flip was attempted for a gate
  // whose producer is empty (would over-block legitimate replies). Rollback to observe/off is
  // never refused. DEPLOYMENT_NOT_FOUND / GOVERNANCE_CONFIG_INVALID surface the writer's guards.
  GATE_NOT_ENFORCE_READY: "GATE_NOT_ENFORCE_READY",
  DEPLOYMENT_NOT_FOUND: "DEPLOYMENT_NOT_FOUND",
  GOVERNANCE_CONFIG_INVALID: "GOVERNANCE_CONFIG_INVALID",
} as const;
