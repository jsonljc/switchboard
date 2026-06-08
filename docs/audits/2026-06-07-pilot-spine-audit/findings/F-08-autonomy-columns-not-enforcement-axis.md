# F-08: `AgentDeployment.trustLevel` / `spendApprovalThreshold` columns are stored but inert in practice — `governanceSettings` JSON gates are never opened by any product writer

- **Severity:** decay
- **Journey/step:** inventory
- **Verdict:** ILLUSION
- **Location:** columns `packages/db/prisma/schema.prisma:1137` (`trustLevel @default("observe")`), `:1138` (`spendApprovalThreshold @default(50)`); live gate `packages/core/src/platform/governance/governance-gate.ts:93,181`, `packages/core/src/platform/governance/spend-approval-threshold.ts:47-52`; resolver `packages/core/src/platform/prisma-deployment-resolver.ts:133-137`; dead-code reader `packages/core/src/skill-runtime/skill-runtime-policy-resolver.ts:22` (verified against main on 2026-06-07)
- **Evidence:**
  - The gate's trust posture comes from `governanceSettings.trustLevelOverride` (JSON), not the column: `prisma-deployment-resolver.ts:133` `trustLevelOverride: resolveTrustLevelOverride(row.governanceSettings)`; `governance-gate.ts:93` `workUnit.deployment?.trustLevelOverride ? {...trustLevel: override} : DEFAULT_CARTRIDGE_CONSTRAINTS`.
  - `spendApprovalThreshold` IS read from the column — `resolvePolicyOverrides` at `packages/schemas/src/policy-overrides-config.ts:48` reads `row.spendApprovalThreshold` into `policyOverrides`, and `governance-gate.ts:181` passes it to `applySpendApprovalThreshold`. However the spend post-processor is doubly gated behind the JSON fields first: `spend-approval-threshold.ts:47` `if (ctx.trustLevelOverride !== "autonomous") return decision;` and `:52` `if (ctx.spendAutonomyEnabled !== true) return decision;`. Since no product writer ever sets `governanceSettings.trustLevelOverride="autonomous"` or `spendAutonomy=true`, the column value is read but permanently unreachable — the guard returns early before reaching the threshold comparison.
  - No product writer of the JSON gate keys: grep for `trustLevelOverride|spendAutonomy|governanceSettings` writes across `apps/api/src`, `apps/dashboard/src`, `scripts`, `packages/db` returns only resolver READS, seed/test fixtures, and `onboard.ts:105` (`governanceSettings: { startingAutonomy: "supervised" }`) / `marketplace.ts:236` (operator-supplied passthrough) — none write `trustLevelOverride` or `spendAutonomy` for a self-serve pilot org.
  - `trustLevel` column's only reader outside tests is `SkillRuntimePolicyResolver.ts:22`, which reads `deployment.trustLevel` directly — but `SkillRuntimePolicyResolver` is never instantiated in any production path (no `new SkillRuntimePolicyResolver()` outside test files). Dead code.
  - Fresh-org deployment `apps/api/src/lib/ensure-alex-listing.ts:43-58` creates the AgentDeployment with NO `governanceSettings` ⇒ `{}` ⇒ both JSON keys undefined ⇒ gate uses safe defaults (parking). The columns sit at `observe`/`$50` and enforcement never reaches them.
  - The dashboard "autonomy" hits (`operator-character.tsx`, `settings/identity/page.tsx`) are a character-animation prop (`"sometimes"`), not a governance control.

## What was exercised

Read the schema columns, the governance gate, the spend post-processor, and the deployment resolver. Traced `resolvePolicyOverrides` (schemas package) to confirm `spendApprovalThreshold` is read from the column but gated behind JSON preconditions. Confirmed `SkillRuntimePolicyResolver` reads `trustLevel` but is never instantiated in production code. Grepped for any product writer of `governanceSettings.trustLevelOverride` / `spendAutonomy`. Read the fresh-org deployment creator and confirmed it leaves `governanceSettings` empty.

## What happened vs expected

Expected: the `trustLevel` / `spendApprovalThreshold` columns on a deployment are the knobs that relax human-in-the-loop. Observed: the columns are inert in practice because the `governanceSettings` JSON gates (`trustLevelOverride`, `spendAutonomy`) are never opened by any product writer. `spendApprovalThreshold` is read by the resolver and passed to the gate, but is unreachable — the spend post-processor returns early before the threshold comparison is ever evaluated. `trustLevel`'s only reader (`SkillRuntimePolicyResolver`) is dead code, never instantiated. The columns present an enforcement illusion. The safe default (supervised, park) still holds, so this is not a safety hole on the pilot.

## Suggested fix scope

Either (a) make the columns the enforcement axis (have the resolver read `row.trustLevel` / `row.spendApprovalThreshold` and drop the JSON duplication), or (b) document that `governanceSettings` JSON is canonical and ensure any future autonomy UI writes those keys. Pin with a test that an autonomy change written by the intended producer actually moves the gate decision.
