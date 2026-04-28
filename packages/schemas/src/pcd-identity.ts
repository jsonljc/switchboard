import { z } from "zod";

export const IdentityTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type IdentityTier = z.infer<typeof IdentityTierSchema>;
