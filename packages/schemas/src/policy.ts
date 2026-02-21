import { z } from "zod";
import { RiskCategorySchema } from "./risk.js";
import { ApprovalRequirementSchema } from "./identity-spec.js";

export const PolicyConditionOperatorSchema = z.enum([
  "eq", "neq", "gt", "gte", "lt", "lte",
  "in", "not_in", "contains", "not_contains",
  "matches", "exists", "not_exists",
]);
export type PolicyConditionOperator = z.infer<typeof PolicyConditionOperatorSchema>;

export const PolicyConditionSchema = z.object({
  field: z.string(),
  operator: PolicyConditionOperatorSchema,
  value: z.unknown(),
});
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

export const PolicyCompositionSchema = z.enum(["AND", "OR", "NOT"]);
export type PolicyComposition = z.infer<typeof PolicyCompositionSchema>;

export const PolicyRuleSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    composition: PolicyCompositionSchema.optional(),
    conditions: z.array(PolicyConditionSchema).optional(),
    children: z.array(PolicyRuleSchema).optional(),
  })
);
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyEffectSchema = z.enum(["allow", "deny", "modify", "require_approval"]);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

export const PolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  organizationId: z.string().nullable(),
  cartridgeId: z.string().nullable(),
  priority: z.number().int(),
  active: z.boolean(),
  rule: PolicyRuleSchema,
  effect: PolicyEffectSchema,
  effectParams: z.record(z.string(), z.unknown()).optional(),
  approvalRequirement: ApprovalRequirementSchema.optional(),
  riskCategoryOverride: RiskCategorySchema.optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Policy = z.infer<typeof PolicySchema>;
