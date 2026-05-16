# Circular Import Cleanup — packages/core

> Fix 11 circular import cycles in `packages/core/src` by extracting shared types (and one utility function) into leaf files.

## Context

A structural health audit on 2026-05-13 found 11 file-level circular import cycles in `packages/core`, clustered in 4 areas. Package-level layering is clean (zero violations), but these intra-package cycles create bundler warnings, make refactoring brittle, and signal tangled responsibilities.

## Behavior Guarantee

This PR is intended to be behavior-preserving. It changes import topology only: shared types and one utility function are moved into leaf modules, while runtime logic and public API behavior remain unchanged. No schema, data, or runtime changes are involved.

**Rollback:** Restore original import paths and move extracted symbols back to their source files. No schema, runtime, or data changes are involved, so rollback is a single revert commit.

## Scope

- **In scope:** 11 circular imports across 4 clusters in `packages/core/src`
- **Out of scope:** file size splits, barrel export reduction, test failures in `packages/db`

## Approach

Extract shared types into dedicated leaf files. Each cluster gets one new `*-types.ts` file that both sides import from, breaking the bidirectional edge. One cluster also requires moving a runtime utility function.

## Constraints

1. **New extraction files stay internal.** Do not expose them through the package root barrel (`packages/core/src/index.ts`) unless a future public API need appears.
2. **`inferCartridgeId` is the only runtime move.** Existing tests covering cartridge inference must continue to pass. If coverage is weak, add one small unit test around `inferCartridgeId` before moving it.
3. **`metrics-types.ts` is a near-leaf type module** with one type dependency on `metrics-buckets.ts` — not a pure leaf in the strictest sense, but acceptable because `metrics-buckets.ts` is itself a leaf.

## Implementation Order

1. Create new type/utility leaf files
2. Move symbol definitions into the new files
3. Update cycle-participating imports to point to the new files
4. Add compatibility re-exports in the original files
5. Run madge to confirm 0 cycles
6. Fix any remaining import edges
7. Run typecheck + tests

## Cluster 1: orchestrator/

**Cycles:**

- `lifecycle.ts` ↔ `execution-manager.ts` (runtime: `inferCartridgeId`, type: `ProposeResult`)
- `propose-pipeline.ts` → `lifecycle.ts` (type: `ProposeResult`)
- `propose-pipeline.ts` ↔ `plan-pipeline.ts` (runtime: `proposePlan`)
- `plan-pipeline.ts` → `lifecycle.ts` (type: `ProposeResult`)

**Fix:**

1. Create `orchestrator/orchestrator-types.ts` — move `ProposeResult` and `ApprovalResponse` from `lifecycle.ts`. Both are self-contained interfaces (depend only on `@switchboard/schemas` types).
2. Create `orchestrator/cartridge-utils.ts` — move `inferCartridgeId` from `lifecycle.ts`. Uses only an inline `import("../storage/interfaces.js").CartridgeRegistry` type — self-contained.
3. **Update consumer import paths** (not just re-export — madge follows re-exports as real edges, so re-exporting from `lifecycle.ts` does NOT break cycles):
   - `execution-manager.ts` → import `ProposeResult` from `./orchestrator-types.js`, `inferCartridgeId` from `./cartridge-utils.js` (removes its edge to `lifecycle.ts` entirely)
   - `propose-pipeline.ts` → import `ProposeResult` from `./orchestrator-types.js`
   - `plan-pipeline.ts` → import `ProposeResult` from `./orchestrator-types.js`
   - `runtime-orchestrator.ts` → import `ProposeResult`, `ApprovalResponse` from `./orchestrator-types.js`
4. Re-export `ProposeResult`, `ApprovalResponse`, and `inferCartridgeId` from `lifecycle.ts` for backward compat with test files and `execution-service.ts` (external consumers — they don't participate in the cycle, so re-export edges to them are safe).

**Why `ApprovalResponse` must also move:** `runtime-orchestrator.ts` imports both `ProposeResult` and `ApprovalResponse` from `lifecycle.ts`. If only `ProposeResult` moves, `runtime-orchestrator.ts` still has an edge back to `lifecycle.ts` via `ApprovalResponse`.

**Why two new files:** `ProposeResult`/`ApprovalResponse` are pure types. `inferCartridgeId` is a runtime function. Separating types from runtime keeps the leaf files focused.

**Not moved:** `ExecutionMode` and `EnqueueCallback` are dead exports (zero consumers) — left in place. `OrchestratorConfig` is only consumed within `lifecycle.ts` itself — no cycle involvement.

**Post-fix import graph (no cycles):**

```
orchestrator-types.ts (leaf: ProposeResult, ApprovalResponse)
cartridge-utils.ts    (leaf: inferCartridgeId)
     ↑        ↑             ↑
     |        |             |
lifecycle.ts (re-exports + imports ProposePipeline, ExecutionManager)
     ↓                 ↓
propose-pipeline.ts  execution-manager.ts
     ↓
plan-pipeline.ts
```

All edges from lifecycle.ts to propose-pipeline.ts/execution-manager.ts are one-directional (class imports). The reverse edges are gone.

## Cluster 2: skill-runtime/

**Cycles:**

- `types.ts` ↔ `governance.ts` (type-only both directions)

**Fix:**

1. Create `skill-runtime/governance-types.ts` — move `EffectCategory`, `GovernanceOutcome`, `TrustLevel`, `GovernanceDecision`, `GovernanceLogEntry`, `GovernanceTier` (deprecated alias for `EffectCategory`) from `governance.ts`. All are pure type/interface declarations with zero external deps — fully self-contained as a group.
2. Update `types.ts` to import the 5 types from `./governance-types.js` instead of `./governance.js` (this severs the cycle edge)
3. Update `governance.ts` to import its own types from `./governance-types.js` (needed by `GOVERNANCE_POLICY`, `getToolGovernanceDecision`, `mapDecisionToOutcome` which remain in `governance.ts`)
4. Re-export all 6 types from `governance.ts` so the 10 sibling files and 3 platform files that import directly from `governance.ts` continue to work without changes

**Consumers importing directly from `governance.ts`:** `batch-skill-handler.ts`, `batch-types.ts`, `skill-executor.ts`, `skill-runtime-policy-resolver.ts`, `governance.test.ts`, `hooks/governance-hook.ts`, `hooks/simulation-policy-hook.ts`, `tools/web-scanner.ts`, `effect-category.test.ts`, plus `platform/deployment-context.ts`, `platform/deployment-resolver.ts`, `platform/prisma-deployment-resolver.ts`. All continue to import from `governance.ts` via re-exports — no import path changes needed outside the cycle pair.

**Note:** `types.ts` ↔ `reinjection-filter.ts` was reported by madge but is not a real cycle — `reinjection-filter.ts` imports from `types.ts` but not vice versa.

## Cluster 3: channel-gateway/ (cross-module)

**Sub-cycle A:** `channel-gateway/types.ts` ↔ `handle-approval-response.ts` (type-only)

**Fix:** Move `HandleApprovalResponseConfig` interface from `handle-approval-response.ts` into `channel-gateway/types.ts` where it logically belongs. This requires adding 3 `import type` statements to `types.ts` for the interface's dependencies: `OperatorChannelBindingStore` (from `./operator-channel-binding-store.js`), `IdentityStore` (from `../storage/interfaces.js`), `RespondToApprovalDeps` (from `../approval/respond-to-approval.js`). Update `handle-approval-response.ts` to import `HandleApprovalResponseConfig` from `./types.js`. Update barrel `index.ts` line 21 to re-export from `./types.js` instead of `./handle-approval-response.js`.

**Sub-cycle B:** `channel-gateway/types.ts` → `consent/consent-service.ts` → `skill-runtime/hooks/deterministic-safety-gate.ts` → `channel-gateway/types.ts` (type-only triangle)

**Fix:**

1. Create `channel-gateway/conversation-status-types.ts` — move `ConversationStatusUpsertContext` from `channel-gateway/types.ts`
2. Update imports in `channel-gateway/types.ts` and `skill-runtime/hooks/deterministic-safety-gate.ts`

## Cluster 4: agent-home/

**Cycles:**

- `metrics.ts` ↔ `metrics-alex.ts` (runtime forward, type-only back)
- `metrics.ts` ↔ `metrics-riley.ts` (runtime forward, type-only back)

**Fix:**

1. Create `agent-home/metrics-types.ts` — move `MetricsSignalStore`, `MetricsViewModel`, `PerAgentBuilderInput`, `ProseSegment`, `SparkPoint`, `StatCell`, `DataFreshness`, `HeroMetric`, `MetricComparator` from `metrics.ts`. One external dep: `PerAgentBuilderInput` references `WeekContext` from `./metrics-buckets.js` — add that import to the new file.
2. Update `metrics-alex.ts` and `metrics-riley.ts` to import types from `./metrics-types.js` instead of `./metrics.js` (this severs the cycle edges)
3. Re-export all 9 types from `metrics.ts` so the barrel chain (`index.ts` → `metrics.ts`) and test files continue working without import path changes

## New Files Summary

| File                                           | Contents                                                                                                                                                      | External deps                           | Direct consumers                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator/orchestrator-types.ts`           | `ProposeResult`, `ApprovalResponse`                                                                                                                           | `@switchboard/schemas` types            | execution-manager, propose-pipeline, plan-pipeline, runtime-orchestrator (direct); lifecycle, test files, execution-service (via re-export) |
| `orchestrator/cartridge-utils.ts`              | `inferCartridgeId`                                                                                                                                            | inline `CartridgeRegistry` type         | execution-manager (direct); execution-service (via re-export from lifecycle)                                                                |
| `skill-runtime/governance-types.ts`            | `EffectCategory`, `GovernanceOutcome`, `TrustLevel`, `GovernanceDecision`, `GovernanceLogEntry`, `GovernanceTier`                                             | none                                    | types, governance (direct); 13 sibling/platform files (via re-export from governance)                                                       |
| `channel-gateway/conversation-status-types.ts` | `ConversationStatusUpsertContext`                                                                                                                             | none (2 string fields)                  | deterministic-safety-gate (direct); types, pre-input-gate, barrel (via re-export from types)                                                |
| `agent-home/metrics-types.ts`                  | `MetricsSignalStore`, `MetricsViewModel`, `PerAgentBuilderInput`, `ProseSegment`, `SparkPoint`, `StatCell`, `DataFreshness`, `HeroMetric`, `MetricComparator` | `WeekContext` from `metrics-buckets.ts` | metrics-alex, metrics-riley (direct); metrics, barrel, test files (via re-export from metrics)                                              |

## Re-export vs. Path Change Strategy

**Critical distinction:** Re-exporting from the original file does NOT break a cycle for madge — it follows re-export edges. To actually break a cycle, the consumer in the cycle must change its import path to the new leaf file. Re-exports exist only for backward compat with consumers OUTSIDE the cycle.

| Cluster           | Cycle consumers (must change import path)                                | External consumers (use re-export, no path change)      |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| orchestrator      | execution-manager, propose-pipeline, plan-pipeline, runtime-orchestrator | test files, execution-service, barrel                   |
| skill-runtime     | types.ts only                                                            | 13 sibling/platform files via governance.ts re-export   |
| channel-gateway A | types.ts (import deleted — symbol moves into it)                         | barrel re-export source changes to types.ts             |
| channel-gateway B | deterministic-safety-gate                                                | types.ts, pre-input-gate, barrel via types.ts re-export |
| agent-home        | metrics-alex, metrics-riley                                              | metrics.ts re-exports for barrel + test files           |

The barrel files (`index.ts`) continue to re-export through the same chain. The new leaf files are internal — they are not added to `packages/core/src/index.ts`.

## Verification

1. `npx madge --circular --extensions ts packages/core/src` → 0 cycles
2. `pnpm typecheck` → clean
3. `pnpm --filter @switchboard/core test` → no regressions

## PR Strategy

Single PR: `refactor(core): break 11 circular import cycles via type extraction`
