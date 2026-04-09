import { z } from "zod";

export const PersonaTone = z.enum(["casual", "professional", "consultative"]);
export type PersonaTone = z.infer<typeof PersonaTone>;

export const AgentPersonaSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  businessName: z.string().min(1),
  businessType: z.string().min(1),
  productService: z.string().min(1),
  valueProposition: z.string().min(1),
  tone: PersonaTone,
  qualificationCriteria: z.record(z.unknown()),
  disqualificationCriteria: z.record(z.unknown()),
  bookingLink: z.string().url().nullable().default(null),
  escalationRules: z.record(z.unknown()),
  customInstructions: z.string().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentPersona = z.infer<typeof AgentPersonaSchema>;
