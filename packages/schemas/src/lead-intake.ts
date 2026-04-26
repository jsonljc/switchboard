import { z } from "zod";

export const LeadSourceSchema = z.enum(["ctwa", "instant_form"]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

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
