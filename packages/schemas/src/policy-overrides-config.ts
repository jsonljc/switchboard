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

/**
 * Trust-level launch-posture override, stored in `AgentDeployment.governanceSettings`
 * (the JSON column) under the `trustLevelOverride` key. This is a deliberate POSTURE
 * decision — distinct from `listing.trustScore`, which measures *earned* confidence.
 *
 * When set, it lets an operator pin a deployment's runtime trust level (e.g. an SMB
 * launch deployment that should auto-allow its revenue-path actions from day one)
 * WITHOUT touching the global score-based trust ramp. Absent or invalid ⇒ `undefined`,
 * so the caller keeps its existing default. Validates against the three runtime trust
 * levels (mirrors `TrustLevel` in `@switchboard/core` skill-runtime governance — kept
 * as a local literal union here to preserve the schemas→core dependency direction).
 *
 * Note: this only changes whether a tool call auto-approves vs. parks for approval.
 * It has no effect on the deny-based compliance floor (banned-phrase / claim-classifier
 * / consent gates), which run independently of trust level.
 */
export const GOVERNANCE_TRUST_LEVELS = ["supervised", "guided", "autonomous"] as const;
export type GovernanceTrustLevel = (typeof GOVERNANCE_TRUST_LEVELS)[number];

export function resolveTrustLevelOverride(
  governanceSettings: unknown,
): GovernanceTrustLevel | undefined {
  if (!governanceSettings || typeof governanceSettings !== "object") return undefined;
  const raw = (governanceSettings as Record<string, unknown>).trustLevelOverride;
  return typeof raw === "string" && (GOVERNANCE_TRUST_LEVELS as readonly string[]).includes(raw)
    ? (raw as GovernanceTrustLevel)
    : undefined;
}

/**
 * Explicit per-deployment opt-in for the spend-approval autonomy lever, stored in
 * `AgentDeployment.governanceSettings` under the `spendAutonomy` key (boolean).
 *
 * This MUST be a separate, explicitly-set signal — NOT derived from the presence
 * of `spendApprovalThreshold`, which is a non-nullable Prisma column
 * (`Float @default(50)`) and is therefore ALWAYS populated. Without this flag, the
 * lever would silently treat the $50 schema default as an operator-chosen
 * auto-execute boundary the moment a deployment is `trustLevelOverride:"autonomous"`
 * (which the seed already ships for Alex/Riley) — an unchosen boundary, exactly the
 * "stored ≠ enforced safely" failure class. Defaulting `false` keeps the lever
 * dormant until an operator deliberately enables it. The threshold *value* still
 * comes from the `spendApprovalThreshold` column; this flag only controls whether
 * the lever is active at all.
 */
export function resolveSpendAutonomyEnabled(governanceSettings: unknown): boolean {
  if (!governanceSettings || typeof governanceSettings !== "object") return false;
  return (governanceSettings as Record<string, unknown>).spendAutonomy === true;
}
