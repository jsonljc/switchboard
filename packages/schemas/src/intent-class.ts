import { z } from "zod";

export const IntentClassSchema = z.enum([
  "appointment-confirm",
  "appointment-reminder",
  "aftercare-checkin",
  "re-engagement-offer",
  "consult-followup",
  // First-touch greeting to a brand-new Meta lead. A business-initiated first
  // message that MUST ride a pre-approved Marketing-category template (Meta hard-
  // rejects an unapproved one) gated through evaluateProactiveSendEligibility.
  "first-touch-greeting",
]);
export type IntentClass = z.infer<typeof IntentClassSchema>;

export const TemplateCategorySchema = z.enum(["utility", "marketing", "authentication"]);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
