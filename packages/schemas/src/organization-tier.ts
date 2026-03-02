import { z } from "zod";
import { GovernanceProfileSchema } from "./governance-profile.js";

export const OrganizationTierSchema = z.enum(["smb", "enterprise"]);
export type OrganizationTier = z.infer<typeof OrganizationTierSchema>;

export const SmbRoleSchema = z.enum(["owner", "member"]);
export type SmbRole = z.infer<typeof SmbRoleSchema>;

export const SmbOrgConfigSchema = z.object({
  tier: z.literal("smb"),
  governanceProfile: GovernanceProfileSchema,
  allowedActionTypes: z.array(z.string()).optional(),
  blockedActionTypes: z.array(z.string()).optional(),
  perActionSpendLimit: z.number().nonnegative().nullable(),
  dailySpendLimit: z.number().nonnegative().nullable(),
  ownerId: z.string(),
});
export type SmbOrgConfig = z.infer<typeof SmbOrgConfigSchema>;
