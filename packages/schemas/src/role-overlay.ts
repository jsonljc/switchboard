import { z } from "zod";
import { RiskToleranceSchema, SpendLimitsSchema } from "./identity-spec.js";

export const OverlayModeSchema = z.enum(["restrict", "extend"]);
export type OverlayMode = z.infer<typeof OverlayModeSchema>;

export const RoleOverlaySchema = z.object({
  id: z.string(),
  identitySpecId: z.string(),
  name: z.string(),
  description: z.string(),
  mode: OverlayModeSchema,
  priority: z.number().int().nonnegative(),
  active: z.boolean(),
  conditions: z.object({
    timeWindows: z.array(z.object({
      dayOfWeek: z.array(z.number().int().min(0).max(6)),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
      timezone: z.string(),
    })).optional(),
    cartridgeIds: z.array(z.string()).optional(),
    riskCategories: z.array(z.string()).optional(),
  }),
  overrides: z.object({
    riskTolerance: RiskToleranceSchema.optional(),
    spendLimits: SpendLimitsSchema.optional(),
    additionalForbiddenBehaviors: z.array(z.string()).optional(),
    removeTrustBehaviors: z.array(z.string()).optional(),
  }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RoleOverlay = z.infer<typeof RoleOverlaySchema>;
