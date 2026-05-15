import { z } from "zod";

/**
 * Per-deployment governance policy overrides. Unlike persona/outcome-patterns/
 * ad-optimizer (which live INSIDE AgentDeployment.inputConfig), these fields
 * are top-level Prisma columns on AgentDeployment itself:
 * circuitBreakerThreshold, maxWritesPerHour, allowedModelTiers,
 * spendApprovalThreshold. The accessor takes the raw row (or any object
 * exposing those keys) and produces a typed overrides object, or undefined
 * when no field is set.
 *
 * Byte-compatible with the legacy `extractPolicyOverrides` in
 * `packages/core/src/platform/prisma-deployment-resolver.ts:37-61`:
 * - includes a field only when its raw value is a number (or, for
 *   `allowedModelTiers`, a non-empty array)
 * - returns `undefined` when no field qualifies (so the caller can omit
 *   the property entirely from DeploymentResolverResult)
 */
export const DeploymentPolicyOverridesSchema = z.object({
  circuitBreakerThreshold: z.number().optional(),
  maxWritesPerHour: z.number().optional(),
  allowedModelTiers: z.array(z.string()).optional(),
  spendApprovalThreshold: z.number().optional(),
});

export type DeploymentPolicyOverridesConfig = z.infer<typeof DeploymentPolicyOverridesSchema>;

export function resolvePolicyOverrides(
  row: Record<string, unknown> | null | undefined,
): DeploymentPolicyOverridesConfig | undefined {
  if (!row || typeof row !== "object") return undefined;

  const overrides: DeploymentPolicyOverridesConfig = {};
  let hasAny = false;

  if (typeof row.circuitBreakerThreshold === "number") {
    overrides.circuitBreakerThreshold = row.circuitBreakerThreshold;
    hasAny = true;
  }
  if (typeof row.maxWritesPerHour === "number") {
    overrides.maxWritesPerHour = row.maxWritesPerHour;
    hasAny = true;
  }
  if (Array.isArray(row.allowedModelTiers) && row.allowedModelTiers.length > 0) {
    overrides.allowedModelTiers = row.allowedModelTiers as string[];
    hasAny = true;
  }
  if (typeof row.spendApprovalThreshold === "number") {
    overrides.spendApprovalThreshold = row.spendApprovalThreshold;
    hasAny = true;
  }

  return hasAny ? overrides : undefined;
}
