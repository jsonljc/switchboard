# Circular Import Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all 11 file-level circular import cycles in `packages/core/src` by extracting shared types (and one utility function) into leaf files.

**Architecture:** Extract shared types into new `*-types.ts` leaf files per cluster. Cycle consumers change their import paths to the new files. Original files re-export for backward compat with external consumers.

**Tech Stack:** TypeScript, madge (circular import detection), pnpm/Turborepo

**Behavior guarantee:** This PR is behavior-preserving. It changes import topology only — runtime logic and public API remain unchanged. No schema, data, or runtime changes are involved.

**Rollback:** Restore original import paths and move extracted symbols back to their source files. Single revert commit — no migrations or data changes to undo.

**Constraints:**

- New extraction files stay internal — do not add them to `packages/core/src/index.ts`
- `inferCartridgeId` is the only runtime move — verify existing test coverage before relocation
- `metrics-types.ts` is a near-leaf type module (one type dep on `metrics-buckets.ts`), not a pure leaf

**Implementation order:** (1) create leaf files → (2) move symbols → (3) update cycle-participating imports → (4) add re-exports → (5) run madge → (6) fix remaining edges → (7) typecheck + tests

---

### Task 1: Create `orchestrator/orchestrator-types.ts`

**Files:**

- Create: `packages/core/src/orchestrator/orchestrator-types.ts`

- [ ] **Step 1: Create the leaf file with `ProposeResult` and `ApprovalResponse`**

```ts
// packages/core/src/orchestrator/orchestrator-types.ts
import type { ActionEnvelope, ApprovalRequest, DecisionTrace } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ApprovalState } from "../approval/state-machine.js";

export interface ProposeResult {
  envelope: ActionEnvelope;
  decisionTrace: DecisionTrace;
  approvalRequest: ApprovalRequest | null;
  denied: boolean;
  explanation: string;
  /** Set when observe mode or emergency override auto-approved the action. */
  governanceNote?: string;
}

export interface ApprovalResponse {
  envelope: ActionEnvelope;
  approvalState: ApprovalState;
  executionResult: ExecuteResult | null;
}
```

- [ ] **Step 2: Run typecheck to verify the new file compiles**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS (no errors in the new file)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/orchestrator/orchestrator-types.ts
git commit -m "refactor(core): add orchestrator-types.ts leaf file

Extract ProposeResult and ApprovalResponse interfaces into a
dependency-free leaf file to prepare for circular import cleanup."
```

---

### Task 2: Create `orchestrator/cartridge-utils.ts`

**Files:**

- Create: `packages/core/src/orchestrator/cartridge-utils.ts`

- [ ] **Step 1: Create the leaf file with `inferCartridgeId`**

```ts
// packages/core/src/orchestrator/cartridge-utils.ts
export function inferCartridgeId(
  actionType: string,
  registry?: import("../storage/interfaces.js").CartridgeRegistry,
): string | null {
  if (!registry) return null;

  const prefix = actionType.split(".")[0];
  if (!prefix) return null;

  for (const cartridgeId of registry.list()) {
    const cartridge = registry.get(cartridgeId);
    if (!cartridge) continue;

    const manifest = cartridge.manifest;
    if (manifest.actions) {
      for (const action of manifest.actions) {
        if (actionType === action.actionType) return cartridgeId;
        const actionPrefix = action.actionType.split(".")[0];
        if (actionPrefix && actionPrefix === prefix) return cartridgeId;
      }
    }
  }

  return null;
}
```

- [ ] **Step 2: Verify existing test coverage for `inferCartridgeId`**

Run: `grep -r "inferCartridgeId" packages/core/src/__tests__/ packages/core/src/orchestrator/__tests__/ --include="*.test.ts" -l`

If no test files found, add a minimal unit test before proceeding:

```ts
// packages/core/src/orchestrator/__tests__/cartridge-utils.test.ts
import { describe, it, expect } from "vitest";
import { inferCartridgeId } from "../cartridge-utils.js";

describe("inferCartridgeId", () => {
  it("returns null when no registry provided", () => {
    expect(inferCartridgeId("ads.create")).toBeNull();
  });
});
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/orchestrator/cartridge-utils.ts
git commit -m "refactor(core): add cartridge-utils.ts leaf file

Extract inferCartridgeId into a dependency-free leaf file to
prepare for circular import cleanup."
```

---

### Task 3: Rewire orchestrator consumers and update `lifecycle.ts`

**Files:**

- Modify: `packages/core/src/orchestrator/lifecycle.ts`
- Modify: `packages/core/src/orchestrator/execution-manager.ts`
- Modify: `packages/core/src/orchestrator/propose-pipeline.ts`
- Modify: `packages/core/src/orchestrator/plan-pipeline.ts`
- Modify: `packages/core/src/orchestrator/runtime-orchestrator.ts`
- Modify: `packages/core/src/orchestrator/index.ts`

- [ ] **Step 1: Update `lifecycle.ts` — remove moved symbols, add re-exports**

Remove the `ProposeResult` interface (lines 57-65), `ApprovalResponse` interface (lines 67-71), and `inferCartridgeId` function (lines 233-259) from `lifecycle.ts`.

Add re-exports at the top of the file (after the existing imports):

```ts
// Re-export for backward compat with external consumers (test files, execution-service)
export type { ProposeResult, ApprovalResponse } from "./orchestrator-types.js";
export { inferCartridgeId } from "./cartridge-utils.js";
```

Also remove these now-unnecessary imports from `lifecycle.ts` (they were only needed by the moved symbols):

- `ApprovalRequest` from `@switchboard/schemas` (only used by `ProposeResult`)
- `DecisionTrace` from `@switchboard/schemas` (only used by `ProposeResult`)
- `ApprovalState` from `../approval/state-machine.js` (only used by `ApprovalResponse`)

Keep `ActionEnvelope` — it is still used by `LifecycleOrchestrator`.
Keep `ExecuteResult` — it is still used by `LifecycleOrchestrator`.

- [ ] **Step 2: Update `execution-manager.ts` — change import paths**

Replace lines 17-18:

```ts
import type { ProposeResult } from "./lifecycle.js";
import { inferCartridgeId } from "./lifecycle.js";
```

With:

```ts
import type { ProposeResult } from "./orchestrator-types.js";
import { inferCartridgeId } from "./cartridge-utils.js";
```

- [ ] **Step 3: Update `propose-pipeline.ts` — change import path**

Replace line 34:

```ts
import type { ProposeResult } from "./lifecycle.js";
```

With:

```ts
import type { ProposeResult } from "./orchestrator-types.js";
```

- [ ] **Step 4: Update `plan-pipeline.ts` — change import path**

Replace line 16:

```ts
import type { ProposeResult } from "./lifecycle.js";
```

With:

```ts
import type { ProposeResult } from "./orchestrator-types.js";
```

- [ ] **Step 5: Update `runtime-orchestrator.ts` — change import path**

Replace line 2:

```ts
import type { ProposeResult, ApprovalResponse } from "./lifecycle.js";
```

With:

```ts
import type { ProposeResult, ApprovalResponse } from "./orchestrator-types.js";
```

- [ ] **Step 6: Update barrel `index.ts` — source re-exports from new files**

Replace lines 1-2:

```ts
export { LifecycleOrchestrator, inferCartridgeId } from "./lifecycle.js";
export type { OrchestratorConfig, ProposeResult, ApprovalResponse } from "./lifecycle.js";
```

With:

```ts
export { LifecycleOrchestrator } from "./lifecycle.js";
export type { OrchestratorConfig } from "./lifecycle.js";
export type { ProposeResult, ApprovalResponse } from "./orchestrator-types.js";
export { inferCartridgeId } from "./cartridge-utils.js";
```

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Run core tests**

Run: `pnpm --filter @switchboard/core test`
Expected: All tests pass (no behavioral changes)

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/orchestrator/lifecycle.ts packages/core/src/orchestrator/execution-manager.ts packages/core/src/orchestrator/propose-pipeline.ts packages/core/src/orchestrator/plan-pipeline.ts packages/core/src/orchestrator/runtime-orchestrator.ts packages/core/src/orchestrator/index.ts
git commit -m "refactor(core): rewire orchestrator imports to break circular deps

Cycle consumers now import ProposeResult/ApprovalResponse from
orchestrator-types.ts and inferCartridgeId from cartridge-utils.ts.
lifecycle.ts re-exports for backward compat with external consumers."
```

---

### Task 4: Create `skill-runtime/governance-types.ts`

**Files:**

- Create: `packages/core/src/skill-runtime/governance-types.ts`

- [ ] **Step 1: Create the leaf file with all 6 governance types**

```ts
// packages/core/src/skill-runtime/governance-types.ts
export type EffectCategory =
  | "read"
  | "propose"
  | "simulate"
  | "write"
  | "external_send"
  | "external_mutation"
  | "irreversible";

/** @deprecated Use `EffectCategory` instead. Kept as alias during migration. */
export type GovernanceTier = EffectCategory;

export type TrustLevel = "supervised" | "guided" | "autonomous";
export type GovernanceDecision = "auto-approve" | "require-approval" | "deny";
export type GovernanceOutcome = "auto-approved" | "require-approval" | "denied";

export interface GovernanceLogEntry {
  operationId: string;
  tier: EffectCategory;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill-runtime/governance-types.ts
git commit -m "refactor(core): add governance-types.ts leaf file

Extract EffectCategory, GovernanceTier, TrustLevel, GovernanceDecision,
GovernanceOutcome, GovernanceLogEntry into a dependency-free leaf file."
```

---

### Task 5: Rewire skill-runtime `types.ts` and `governance.ts`

**Files:**

- Modify: `packages/core/src/skill-runtime/governance.ts`
- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/index.ts`

- [ ] **Step 1: Update `governance.ts` — replace definitions with imports + re-exports**

Replace lines 1-17 and lines 78-85 of `governance.ts`. The new file should be:

```ts
// packages/core/src/skill-runtime/governance.ts
import type { SkillToolOperation } from "./types.js";
import type {
  EffectCategory,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
} from "./governance-types.js";

// Re-export all types so existing consumers of governance.ts don't break
export type {
  EffectCategory,
  GovernanceTier,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
  GovernanceLogEntry,
} from "./governance-types.js";

export const GOVERNANCE_POLICY: Record<EffectCategory, Record<TrustLevel, GovernanceDecision>> = {
  read: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  propose: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  simulate: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  write: {
    supervised: "require-approval",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  external_send: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "auto-approve",
  },
  external_mutation: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "auto-approve",
  },
  irreversible: {
    supervised: "deny",
    guided: "require-approval",
    autonomous: "require-approval",
  },
};

export function getToolGovernanceDecision(
  op: SkillToolOperation,
  trustLevel: TrustLevel,
): GovernanceDecision {
  if (op.governanceOverride?.[trustLevel]) {
    return op.governanceOverride[trustLevel]!;
  }
  return GOVERNANCE_POLICY[op.effectCategory][trustLevel];
}

export function mapDecisionToOutcome(decision: GovernanceDecision): GovernanceOutcome {
  switch (decision) {
    case "auto-approve":
      return "auto-approved";
    case "require-approval":
      return "require-approval";
    case "deny":
      return "denied";
  }
}
```

- [ ] **Step 2: Update `types.ts` — change import source**

Replace lines 1-7:

```ts
import type {
  EffectCategory,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance.js";
```

With:

```ts
import type {
  EffectCategory,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance-types.js";
```

- [ ] **Step 3: Update barrel `index.ts` — source governance types from leaf file**

Replace lines 111-118:

```ts
export type {
  EffectCategory,
  GovernanceTier,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
  GovernanceLogEntry,
} from "./governance.js";
```

With:

```ts
export type {
  EffectCategory,
  GovernanceTier,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
  GovernanceLogEntry,
} from "./governance-types.js";
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run core tests**

Run: `pnpm --filter @switchboard/core test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/governance.ts packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/index.ts
git commit -m "refactor(core): rewire skill-runtime imports to break governance cycle

types.ts and barrel now import governance types from governance-types.ts.
governance.ts re-exports all 6 types for backward compat with 13 consumers."
```

---

### Task 6: Fix channel-gateway Sub-cycle A — move `HandleApprovalResponseConfig` into `types.ts`

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/handle-approval-response.ts`
- Modify: `packages/core/src/channel-gateway/index.ts`

- [ ] **Step 1: Add `HandleApprovalResponseConfig` and its deps to `types.ts`**

Add three new import statements after the existing imports in `types.ts` (after line 13):

```ts
import type { OperatorChannelBindingStore } from "./operator-channel-binding-store.js";
import type { IdentityStore } from "../storage/interfaces.js";
import type { RespondToApprovalDeps } from "../approval/respond-to-approval.js";
```

Remove the import of `HandleApprovalResponseConfig` from `types.ts` line 5:

```ts
import type { HandleApprovalResponseConfig } from "./handle-approval-response.js";
```

Add the interface definition in `types.ts` (before `ChannelGatewayConfig`, e.g. before line 64):

```ts
export interface HandleApprovalResponseConfig {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
}
```

- [ ] **Step 2: Update `handle-approval-response.ts` — import from `types.ts` instead of defining locally**

Remove the interface definition (lines 57-61):

```ts
export interface HandleApprovalResponseConfig {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
}
```

Add an import from `./types.js` (add to the existing import on line 4):

Replace line 4:

```ts
import type { ReplySink } from "./types.js";
```

With:

```ts
import type { ReplySink, HandleApprovalResponseConfig } from "./types.js";
```

Remove the now-unused import of `OperatorChannelBindingStore` on line 6 (it was only used by the interface):

```ts
import type { OperatorChannelBindingStore } from "./operator-channel-binding-store.js";
```

Remove `IdentityStore` from the import on line 2 (keep `ApprovalStore`):

```ts
import type { ApprovalStore } from "../storage/interfaces.js";
```

Remove the `RespondToApprovalDeps` type import from lines 7-10 (keep the value import `respondToApproval` on line 11):

```ts
import type {
  RespondToApprovalDeps,
  RespondToApprovalResult,
} from "../approval/respond-to-approval.js";
```

Becomes:

```ts
import type { RespondToApprovalResult } from "../approval/respond-to-approval.js";
```

- [ ] **Step 3: Update barrel `index.ts` — re-export from `types.ts` instead**

Replace line 21:

```ts
export type { HandleApprovalResponseConfig } from "./handle-approval-response.js";
```

With:

```ts
export type { HandleApprovalResponseConfig } from "./types.js";
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/handle-approval-response.ts packages/core/src/channel-gateway/index.ts
git commit -m "refactor(core): move HandleApprovalResponseConfig into channel-gateway/types.ts

Breaks the types.ts <-> handle-approval-response.ts cycle by
co-locating the config interface with the types it belongs with."
```

---

### Task 7: Fix channel-gateway Sub-cycle B — extract `ConversationStatusUpsertContext`

**Files:**

- Create: `packages/core/src/channel-gateway/conversation-status-types.ts`
- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts`

- [ ] **Step 1: Create the leaf file**

```ts
// packages/core/src/channel-gateway/conversation-status-types.ts
export interface ConversationStatusUpsertContext {
  channel: string;
  principalId: string;
}
```

- [ ] **Step 2: Update `channel-gateway/types.ts` — replace definition with import + re-export**

Remove the `ConversationStatusUpsertContext` interface definition (lines 29-42 — the comment block and interface) and replace with:

```ts
export type { ConversationStatusUpsertContext } from "./conversation-status-types.js";
```

Keep the rest of `types.ts` unchanged. `GatewayConversationStatusSetter` (line 56) references `ConversationStatusUpsertContext` which is now imported via the re-export — TypeScript resolves this correctly.

- [ ] **Step 3: Update `deterministic-safety-gate.ts` — import from leaf file**

Replace line 15:

```ts
import type { ConversationStatusUpsertContext } from "../../channel-gateway/types.js";
```

With:

```ts
import type { ConversationStatusUpsertContext } from "../../channel-gateway/conversation-status-types.js";
```

Line 18 (`export type { ConversationStatusUpsertContext };`) remains unchanged.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-gateway/conversation-status-types.ts packages/core/src/channel-gateway/types.ts packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts
git commit -m "refactor(core): extract ConversationStatusUpsertContext to break cross-module cycle

Breaks the types.ts -> consent-service -> deterministic-safety-gate ->
types.ts triangle by routing the gate's import through a leaf file."
```

---

### Task 8: Create `agent-home/metrics-types.ts`

**Files:**

- Create: `packages/core/src/agent-home/metrics-types.ts`

- [ ] **Step 1: Create the near-leaf type module with all 9 metric types**

One type dependency: `WeekContext` from `metrics-buckets.ts` (itself a leaf).

```ts
// packages/core/src/agent-home/metrics-types.ts
import type { WeekContext } from "./metrics-buckets.js";

export interface ProseSegment {
  kind: "text" | "accent";
  text: string;
}

export interface MetricComparator {
  window: "week";
  value: number;
}

export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | {
      kind: "revenue-attributed";
      value: number;
      currency: string;
      comparator: MetricComparator;
    };

export interface SparkPoint {
  label: string;
  value: number;
  isProjection?: boolean;
}

export interface StatCell {
  label: string;
  display: string;
  rawValue: number | null;
  unit: "count" | "percent" | "currency";
  unavailable?: boolean;
}

export interface DataFreshness {
  generatedAt: string;
  window: "week";
  dataSource: "live" | "fixture";
  unavailableSources?: readonly string[];
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string;
}

export interface MetricsSignalStore {
  countBookingsCreated(input: {
    orgId: string;
    excludeStatuses: readonly string[];
    from: Date;
    to: Date;
  }): Promise<number>;

  countConversionsByType(input: {
    orgId: string;
    type: string;
    from: Date;
    to: Date;
  }): Promise<number>;
}

export interface PerAgentBuilderInput {
  orgId: string;
  week: WeekContext;
  store: MetricsSignalStore;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent-home/metrics-types.ts
git commit -m "refactor(core): add metrics-types.ts near-leaf type module

Extract 9 metric interfaces with one type dep (WeekContext from
metrics-buckets) to prepare for cycle cleanup."
```

---

### Task 9: Rewire agent-home metrics consumers

**Files:**

- Modify: `packages/core/src/agent-home/metrics.ts`
- Modify: `packages/core/src/agent-home/metrics-alex.ts`
- Modify: `packages/core/src/agent-home/metrics-riley.ts`
- Modify: `packages/core/src/agent-home/index.ts`

- [ ] **Step 1: Update `metrics.ts` — replace definitions with re-exports**

Replace lines 1-85 of `metrics.ts` with:

```ts
import type { AgentHomeKey } from "./agent-key.js";
import { buildWeekContext } from "./metrics-buckets.js";
import { buildAlexMetricsViewModel } from "./metrics-alex.js";
import { buildRileyMetricsViewModel } from "./metrics-riley.js";

// Re-export all types so barrel and test files continue working
export type {
  ProseSegment,
  MetricComparator,
  HeroMetric,
  SparkPoint,
  StatCell,
  DataFreshness,
  MetricsViewModel,
  MetricsSignalStore,
  PerAgentBuilderInput,
} from "./metrics-types.js";

import type { MetricsSignalStore, MetricsViewModel } from "./metrics-types.js";

export interface ProjectMetricsInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string;
  store: MetricsSignalStore;
}

export async function projectMetrics(input: ProjectMetricsInput): Promise<MetricsViewModel> {
  const week = buildWeekContext(input.now, input.timezone);
  if (input.agentKey === "alex") {
    return buildAlexMetricsViewModel({ orgId: input.orgId, week, store: input.store });
  }
  return buildRileyMetricsViewModel({ orgId: input.orgId, week, store: input.store });
}
```

- [ ] **Step 2: Update `metrics-alex.ts` — change import source**

Replace lines 1-8:

```ts
import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics.js";
```

With:

```ts
import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics-types.js";
```

- [ ] **Step 3: Update `metrics-riley.ts` — change import source**

Replace lines 1-8:

```ts
import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics.js";
```

With:

```ts
import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics-types.js";
```

- [ ] **Step 4: Update barrel `index.ts` — source metric types from leaf file**

Replace lines 46-56:

```ts
// Metrics (PR-S5)
export {
  projectMetrics,
  type ProjectMetricsInput,
  type MetricsSignalStore,
  type MetricsViewModel,
  type HeroMetric,
  type MetricComparator,
  type SparkPoint,
  type StatCell,
} from "./metrics.js";
```

With:

```ts
// Metrics (PR-S5)
export { projectMetrics, type ProjectMetricsInput } from "./metrics.js";
export type {
  MetricsSignalStore,
  MetricsViewModel,
  HeroMetric,
  MetricComparator,
  SparkPoint,
  StatCell,
} from "./metrics-types.js";
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Run core tests**

Run: `pnpm --filter @switchboard/core test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agent-home/metrics.ts packages/core/src/agent-home/metrics-alex.ts packages/core/src/agent-home/metrics-riley.ts packages/core/src/agent-home/index.ts
git commit -m "refactor(core): rewire agent-home metrics imports to break circular deps

metrics-alex and metrics-riley now import types from metrics-types.ts.
metrics.ts re-exports all 9 types for backward compat with barrel and tests."
```

---

### Task 10: Full verification — zero cycles, clean typecheck, passing tests

**Files:**

- None (verification only)

- [ ] **Step 1: Install madge if needed**

Run: `npx madge --version`
If not found: `npm install -g madge`

- [ ] **Step 2: Run madge circular import check**

Run: `npx madge --circular --extensions ts packages/core/src`
Expected: `No circular dependency found!` (0 cycles)

If cycles remain, the output will list them — fix before proceeding.

- [ ] **Step 3: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 4: Run core tests**

Run: `pnpm --filter @switchboard/core test`
Expected: All tests pass

- [ ] **Step 5: Run full test suite (informational — db failures are pre-existing)**

Run: `pnpm test`
Expected: Only pre-existing `@switchboard/db` failures (17 tests). No new failures.

- [ ] **Step 6: Final commit if any fixups were needed**

If Steps 2-5 required fixes, commit them:

```bash
git add -u packages/core/src/
git commit -m "refactor(core): fixups from circular import verification"
```
