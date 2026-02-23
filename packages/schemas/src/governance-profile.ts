import { z } from "zod";

export const GovernanceProfileSchema = z.enum([
  "observe",
  "guarded",
  "strict",
  "locked",
]);
export type GovernanceProfile = z.infer<typeof GovernanceProfileSchema>;
