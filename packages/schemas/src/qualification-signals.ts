import { z } from "zod";

export const QualificationSignalsSchema = z.object({
  treatmentInterest: z.string().nullable(),
  preferredTimeWindow: z.string().nullable(),
  serviceableMarket: z.enum(["SG", "MY", "unknown", "out_of_area"]),
  buyingIntent: z.enum(["none", "soft", "strong"]),
  budgetAcknowledged: z.boolean().nullable(),
  explicitDecline: z.boolean(),
  disqualifierCandidates: z
    .array(
      z.object({
        type: z.enum(["out_of_area", "wrong_treatment", "age_gated", "not_real_lead"]),
        evidence: z.string().min(1).max(280),
      }),
    )
    .max(4),
});
export type QualificationSignals = z.infer<typeof QualificationSignalsSchema>;

export const QualificationSidecarValidationStatusSchema = z.enum([
  "ok",
  "multiple_blocks",
  "malformed_json",
  "schema_mismatch",
]);
export type QualificationSidecarValidationStatus = z.infer<
  typeof QualificationSidecarValidationStatusSchema
>;

/**
 * The shape persisted on `WorkTrace.qualificationSignals` (JSON-encoded TEXT).
 *
 * - `ok` carries the validated payload (consumed by lifecycle evaluator).
 * - `multiple_blocks` / `malformed_json` / `schema_mismatch` carry raw text for
 *   audit replay and a structured discriminant for analytics over sidecar quality.
 *
 * Operational queues MUST NOT scan this column — they query
 * `ConversationLifecycleSnapshot` / `ConversationLifecycleTransition` instead
 * (spec §4.4, §8.1).
 */
export const WorkTraceQualificationSignalsSchema = z.discriminatedUnion("validationStatus", [
  z.object({ validationStatus: z.literal("ok"), payload: QualificationSignalsSchema }),
  z.object({ validationStatus: z.literal("multiple_blocks"), raw: z.string() }),
  z.object({ validationStatus: z.literal("malformed_json"), raw: z.string() }),
  z.object({
    validationStatus: z.literal("schema_mismatch"),
    raw: z.string(),
    zodError: z.unknown(),
  }),
]);
export type WorkTraceQualificationSignals = z.infer<typeof WorkTraceQualificationSignalsSchema>;
