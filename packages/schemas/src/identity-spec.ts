import { z } from "zod";
import { GovernanceProfileSchema } from "./governance-profile.js";

export const ApprovalRequirementSchema = z.enum(["none", "standard", "elevated", "mandatory"]);
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const RiskToleranceSchema = z.object({
  none: ApprovalRequirementSchema,
  low: ApprovalRequirementSchema,
  medium: ApprovalRequirementSchema,
  high: ApprovalRequirementSchema,
  critical: ApprovalRequirementSchema,
});
export type RiskTolerance = z.infer<typeof RiskToleranceSchema>;

export const SpendLimitsSchema = z.object({
  daily: z.number().nonnegative().nullable(),
  weekly: z.number().nonnegative().nullable(),
  monthly: z.number().nonnegative().nullable(),
  perAction: z.number().nonnegative().nullable(),
});
export type SpendLimits = z.infer<typeof SpendLimitsSchema>;

export const IdentitySpecSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  organizationId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  riskTolerance: RiskToleranceSchema,
  globalSpendLimits: SpendLimitsSchema,
  cartridgeSpendLimits: z.record(z.string(), SpendLimitsSchema),
  forbiddenBehaviors: z.array(z.string()),
  trustBehaviors: z.array(z.string()),
  governanceProfile: GovernanceProfileSchema.optional(),
  delegatedApprovers: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type IdentitySpec = z.infer<typeof IdentitySpecSchema>;
