# F-08: `AgentDeployment.trustLevel` / `spendApprovalThreshold` columns are stored but never the enforcement axis (gate reads `governanceSettings` JSON, no product writer)

- **Severity:** decay
- **Journey/step:** inventory
- **Verdict:** ILLUSION
- **Location:** columns `packages/db/prisma/schema.prisma:1137` (`trustLevel @default("observe")`), `:1138` (`spendApprovalThreshold @default(50)`); live gate `packages/core/src/platform/governance/governance-gate.ts:93,181`, `packages/core/src/platform/governance/spend-approval-threshold.ts:47-52`; resolver `packages/core/src/platform/prisma-deployment-resolver.ts:133-134` (verified against main on 2026-06-07)
- **Evidence:**
  - The gate's trust posture comes from `governanceSettings.trustLevelOverride` (JSON), not the column: `prisma-deployment-resolver.ts:133` `trustLevelOverride: resolveTrustLevelOverride(row.governanceSettings)`; `governance-gate.ts:93` `workUnit.deployment?.trustLevelOverride ? {...trustLevel: override} : DEFAULT_CARTRIDGE_CONSTRAINTS`.
  - The spend lever is doubly gated on JSON, not the column: `spend-approval-threshold.ts:47` `if (ctx.trustLevelOverride !== "autonomous") return decision;` and `:52` `if (ctx.spendAutonomyEnabled !== true) return decision;` — and `:14` documents the `spendApprovalThreshold` column is "non-nullable / always at its $50 default — so its presence cannot mean opted in."
  - No product writer of the JSON keys: grep for `trustLevelOverride|spendAutonomy|governanceSettings` writes across `apps/api/src`, `apps/dashboard/src`, `scripts`, `packages/db` returns only resolver READS, seed/test fixtures, and `onboard.ts:105` (`governanceSettings: { startingAutonomy: "supervised" }`) / `marketplace.ts:236` (operator-supplied passthrough) — none write `trustLevelOverride` or `spendAutonomy` for a self-serve pilot org.
  - Fresh-org deployment `apps/api/src/lib/ensure-alex-listing.ts:43-58` creates the AgentDeployment with NO `governanceSettings` ⇒ `{}` ⇒ both keys undefined ⇒ gate uses safe defaults (parking). The columns sit at `observe`/`$50` and are never consulted by the gate.
  - The dashboard "autonomy" hits (`operator-character.tsx`, `settings/identity/page.tsx`) are a character-animation prop (`"sometimes"`), not a governance control.

## What was exercised

Read the schema columns, the governance gate, the spend post-processor, and the deployment resolver. Grepped for any product writer of `governanceSettings.trustLevelOverride` / `spendAutonomy`. Read the fresh-org deployment creator and confirmed it leaves `governanceSettings` empty. Confirmed the dashboard autonomy references are cosmetic.

## What happened vs expected

Expected: the `trustLevel` / `spendApprovalThreshold` columns on a deployment are the knobs that relax human-in-the-loop. Observed: they are stored but inert — the live gate reads `governanceSettings.trustLevelOverride` and `.spendAutonomy` (JSON), which no product surface writes. The columns present an enforcement illusion. The safe default (supervised, park) still holds, so this is not a safety hole on the pilot — but the autonomy controls a future UI might bind to are not the enforcement axis.

## Suggested fix scope

Either (a) make the columns the enforcement axis (have the resolver read `row.trustLevel` / `row.spendApprovalThreshold` and drop the JSON duplication), or (b) document that `governanceSettings` JSON is canonical and ensure any future autonomy UI writes those keys. Pin with a test that an autonomy change written by the intended producer actually moves the gate decision.
