import { z } from "zod";
import { OpportunityStageSchema, PdpaJurisdictionSchema } from "@switchboard/schemas";

/**
 * Zod schemas for operator-direct intent parameters (Wave 2 Phase 1b).
 *
 * Co-located with API routes for Phase 1b. Will migrate to
 * `@switchboard/schemas` when Design A canonicalizes the operator-direct
 * intent catalog.
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * "Reference implementation pattern" → "Artifact 1 — Intent registration".
 */

export const TransitionOpportunityStageParametersSchema = z.object({
  id: z.string().min(1),
  stage: OpportunityStageSchema,
});

export type TransitionOpportunityStageParameters = z.infer<
  typeof TransitionOpportunityStageParametersSchema
>;

export const ActOnRecommendationParametersSchema = z.object({
  recommendationId: z.string().min(1),
  action: z.enum(["primary", "secondary", "dismiss", "confirm", "undo"]),
  note: z.string().optional(),
});

export type ActOnRecommendationParameters = z.infer<typeof ActOnRecommendationParametersSchema>;

export const ConfirmDisqualificationParametersSchema = z.object({
  conversationThreadId: z.string().min(1),
  operatorNote: z.string().optional(),
});

export type ConfirmDisqualificationParameters = z.infer<
  typeof ConfirmDisqualificationParametersSchema
>;

export const DismissDisqualificationParametersSchema = z.object({
  conversationThreadId: z.string().min(1),
  operatorNote: z.string().optional(),
});

export type DismissDisqualificationParameters = z.infer<
  typeof DismissDisqualificationParametersSchema
>;

// ---------------------------------------------------------------------------
// Phase 1b.4 — admin-consent operator intents
// ---------------------------------------------------------------------------

export const GrantConsentParametersSchema = z.object({
  contactId: z.string().min(1),
  jurisdiction: PdpaJurisdictionSchema,
  source: z.enum(["whatsapp_quick_reply", "ig_dm_reply", "web_form", "operator_recorded"]),
  grantedAt: z.string().datetime(),
  notes: z.string().optional(),
  actor: z.string().min(1),
});

export type GrantConsentParameters = z.infer<typeof GrantConsentParametersSchema>;

export const RevokeConsentParametersSchema = z.object({
  contactId: z.string().min(1),
  source: z.literal("operator_recorded_revocation"),
  revokedAt: z.string().datetime(),
  notes: z.string().optional(),
  actor: z.string().min(1),
});

export type RevokeConsentParameters = z.infer<typeof RevokeConsentParametersSchema>;

export const ClearConsentParametersSchema = z.object({
  contactId: z.string().min(1),
  notes: z.string().min(1),
  actor: z.string().min(1),
});

export type ClearConsentParameters = z.infer<typeof ClearConsentParametersSchema>;

export const RecordRevenueParametersSchema = z.object({
  contactId: z.string(),
  opportunityId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("SGD"),
  type: z.enum(["payment", "deposit", "invoice", "refund"]).default("payment"),
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
  externalReference: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

export type RecordRevenueParameters = z.infer<typeof RecordRevenueParametersSchema>;
