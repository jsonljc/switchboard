import { z } from "zod";

/**
 * GovernanceVerdict is the unified output-governance audit event shape.
 * Phase 1b-1+ guards (banned_phrase_scanner, escalation_trigger,
 * consent_gate, whatsapp_window, claim_classifier) emit one
 * GovernanceVerdict per output. Persisted to the WorkTrace audit log;
 * doubles as the test fixture format.
 *
 * Distinct from `GovernanceDecision` in
 * `@switchboard/core/skill-runtime/governance` which is a 3-tier
 * action-approval union — both layers of governance coexist.
 */

export const GovernanceVerdictActionSchema = z.enum([
  "allow",
  "rewrite",
  "block",
  "escalate",
  "template_required",
]);

export const GovernanceVerdictReasonSchema = z.enum([
  "allowed",
  "banned_phrase",
  "unsupported_claim",
  "medical_safety_trigger",
  "sensitive_inbound",
  "compliance_concern",
  "governance_unavailable",
  "outside_whatsapp_window",
  "consent_missing",
  "classifier_timeout",
  "classifier_error", // NEW (1b-2): API failure (not timeout)
  "unsupported_claim_rewritten", // NEW (1b-2): Layer 3 rewrote — claim sentence swapped
  "unsupported_claim_escalated", // NEW (1b-2): Layer 3 escalated — non-rewriteable type
  "claim_substantiation_stale", // NEW (1b-2): source existed but stale
  // Phase 1c additions
  "consent_pending",
  "consent_revoked",
  "disclosure_not_shown",
  "disclosure_version_outdated",
  "consent_cycle_reset",
  "jurisdiction_mismatch",
  // Phase 1c egress addition (send-time consent enforcement)
  "contact_resolution_missing", // egress visibility: sessionContactResolver returned null
]);

export const GovernanceVerdictSourceSchema = z.enum([
  "banned_phrase_scanner",
  "claim_classifier",
  "escalation_trigger",
  "consent_gate",
  "whatsapp_window",
]);

export const GovernanceVerdictSchema = z.object({
  action: GovernanceVerdictActionSchema,
  reasonCode: GovernanceVerdictReasonSchema,
  jurisdiction: z.enum(["SG", "MY"]),
  clinicType: z.enum(["medical", "nonMedical"]),
  sourceGuard: GovernanceVerdictSourceSchema,
  originalText: z.string().optional(),
  emittedText: z.string().optional(),
  auditLevel: z.enum(["info", "warning", "critical"]),
  decidedAt: z.string().datetime({
    message: "decidedAt must be ISO 8601 datetime string",
  }),
  conversationId: z.string().min(1),
  modelLatencyMs: z.number().int().nonnegative().optional(),
});

export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;
export type GovernanceVerdictAction = z.infer<typeof GovernanceVerdictActionSchema>;
export type GovernanceVerdictReason = z.infer<typeof GovernanceVerdictReasonSchema>;
export type GovernanceVerdictSource = z.infer<typeof GovernanceVerdictSourceSchema>;
