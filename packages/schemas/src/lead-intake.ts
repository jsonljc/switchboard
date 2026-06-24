import { z } from "zod";

export const LeadSourceSchema = z.enum(["ctwa", "instant_form"]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

/**
 * Outcome of a `lead.intake` submission, surfaced on the workflow outputs so the
 * Meta-lead orchestrator greets + records an inquiry ONLY for a freshly created
 * Contact:
 *  - `created`              — a new Contact was upserted (first touch -> greet).
 *  - `reused`               — an A4 identity match folded this lead into an existing
 *                             Contact (a 2nd ad path for one corroborated person ->
 *                             do NOT greet/record again).
 *  - `idempotent_duplicate` — the same lead (idempotencyKey) was redelivered.
 * Consumers MUST treat any unrecognised/absent value as "not created" (fail closed:
 * never re-greet on uncertainty); that is why this is a strict enum.
 */
export const LeadIntakeOutcomeSchema = z.enum(["created", "reused", "idempotent_duplicate"]);
export type LeadIntakeOutcome = z.infer<typeof LeadIntakeOutcomeSchema>;

const ContactIdentifiersSchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    channel: z.enum(["whatsapp", "email", "sms"]).optional(),
    name: z.string().optional(),
  })
  .refine((v) => Boolean(v.phone || v.email), {
    message: "contact must include phone or email",
  });

export const LeadIntakeAttributionSchema = z.object({
  ctwa_clid: z.string().optional(),
  leadgen_id: z.string().optional(),
  referralUrl: z.string().optional(),
  sourceAdId: z.string().optional(),
  sourceAdsetId: z.string().optional(),
  sourceCampaignId: z.string().optional(),
  capturedAt: z.string().datetime(),
  raw: z.record(z.unknown()).optional(),
});

export const LeadIntakeSchema = z.object({
  source: LeadSourceSchema,
  organizationId: z.string(),
  deploymentId: z.string(),
  contact: ContactIdentifiersSchema,
  attribution: LeadIntakeAttributionSchema,
  idempotencyKey: z.string(),
});

export type LeadIntake = z.infer<typeof LeadIntakeSchema>;
