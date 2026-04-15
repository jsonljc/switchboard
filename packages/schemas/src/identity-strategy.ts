// packages/schemas/src/identity-strategy.ts
import { z } from "zod";

export const IdentityStrategy = z.enum([
  "platform_identity",
  "reference_conditioning",
  "fine_tuned_identity",
  "asset_reuse",
]);
export type IdentityStrategy = z.infer<typeof IdentityStrategy>;

export const IdentityPlanSchema = z.object({
  creatorId: z.string(),
  primaryStrategy: IdentityStrategy,
  fallbackChain: z.array(IdentityStrategy),
  constraints: z.object({
    maxIdentityDrift: z.number().min(0).max(1),
    lockHairState: z.boolean(),
    lockWardrobe: z.boolean(),
    requireExactReuse: z.boolean(),
  }),
});
export type IdentityPlan = z.infer<typeof IdentityPlanSchema>;
