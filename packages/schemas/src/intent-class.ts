import { z } from "zod";

export const IntentClassSchema = z.enum([
  "appointment-confirm",
  "appointment-reminder",
  "aftercare-checkin",
  "re-engagement-offer",
  "consult-followup",
]);
export type IntentClass = z.infer<typeof IntentClassSchema>;

export const TemplateCategorySchema = z.enum(["utility", "marketing", "authentication"]);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
