import { z } from "zod";
import { RiskCategorySchema } from "./risk.js";
import { ApprovalRequirementSchema } from "./identity-spec.js";

export const UndoRecipeSchema = z.object({
  originalActionId: z.string(),
  originalEnvelopeId: z.string(),
  reverseActionType: z.string(),
  reverseParameters: z.record(z.string(), z.unknown()),
  undoExpiresAt: z.coerce.date(),
  undoRiskCategory: RiskCategorySchema,
  undoApprovalRequired: ApprovalRequirementSchema,
});
export type UndoRecipe = z.infer<typeof UndoRecipeSchema>;
