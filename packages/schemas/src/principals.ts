import { z } from "zod";

export const PrincipalTypeSchema = z.enum(["user", "agent", "service_account", "system"]);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const PrincipalRoleSchema = z.enum(["requester", "approver", "operator", "admin"]);
export type PrincipalRole = z.infer<typeof PrincipalRoleSchema>;

export const PrincipalSchema = z.object({
  id: z.string(),
  type: PrincipalTypeSchema,
  name: z.string(),
  organizationId: z.string().nullable(),
  roles: z.array(PrincipalRoleSchema),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const DelegationRuleSchema = z.object({
  id: z.string(),
  grantor: z.string(),
  grantee: z.string(),
  scope: z.string(),
  expiresAt: z.coerce.date().nullable(),
});
export type DelegationRule = z.infer<typeof DelegationRuleSchema>;
