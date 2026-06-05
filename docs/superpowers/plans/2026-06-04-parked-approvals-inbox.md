# Parked Governed-Workflow Approvals in the Operator Inbox: Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface parked WorkUnit approvals (ApprovalLifecycle rows) in the dashboard Inbox with per-intent humanized cards, and make approve/reject drive the REAL ApprovalLifecycleService plus the real post-approval dispatch, executing exactly the approved frozen payload or exposing the failed execution for recovery.

**Architecture:** Spec v2: `docs/superpowers/specs/2026-06-04-parked-approvals-inbox-design.md`. Five sequentially-landed PRs: (1) core read model, (2) core+db action path, (3) api wiring, (4) dashboard, (5) integration proof. The three review blockers are addressed: dispatched payload = `ExecutableWorkUnit.frozenPayload.parameters` written onto the trace before `executeApproved` (with a mutation test); default risk contract fails closed (high / external / client-facing); dispatch failure transitions the lifecycle to `recovery_required`, which the feed surfaces as a Retry card driving the same respond leg with attempt-keyed dispatch idempotency.

**Tech Stack:** TypeScript ESM (`.js` relative imports everywhere EXCEPT apps/dashboard), Fastify, Prisma (mocked in tests; CI has no Postgres), Next.js 14 + TanStack Query, vitest.

**Gate per commit:** at least the touched-package test+typecheck slice; full `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check` before each PR push. Commitlint: lowercase subject first word. No em-dashes in copy.

**Identity rule (review #7):** `respondedBy` is server-derived from `principalIdFromAuth`; a differing body value is 403; body fallback only when `app.authDisabled === true`.

---

## PR-1: core read model

Branch: `feat/parked-approvals-core-read` off origin/main.

### Task 1: decision types + agent map

**Files:**

- Modify: `packages/core/src/decisions/types.ts`
- Modify: `packages/core/src/decisions/agent-key-resolver.ts`
- Modify: `packages/core/src/decisions/index.ts`
- Test: `packages/core/src/decisions/__tests__/agent-key-resolver.test.ts` (create or extend)

- [ ] **Step 1: Failing resolver test**

```ts
import { describe, it, expect } from "vitest";
import { resolveAgentKey } from "../agent-key-resolver.js";

describe("resolveAgentKey", () => {
  it("maps creative to mira (parked publish attribution)", () => {
    expect(resolveAgentKey("creative")).toBe("mira");
  });
  it("maps digital-ads to riley (parked cartridge ads attribution)", () => {
    expect(resolveAgentKey("digital-ads")).toBe("riley");
  });
});
```

- [ ] **Step 2:** `pnpm --filter @switchboard/core test -- agent-key-resolver` -> FAIL (both resolve "alex").

- [ ] **Step 3: Implement.** Add to `SOURCE_AGENT_TO_KEY`: `"digital-ads": "riley"`, `creative: "mira"`. In `types.ts`:

```ts
export type DecisionKind = "approval" | "handoff" | "workflow_approval";

/** Five-field risk contract (extracted so adapters and summarizers can name it). */
export interface RiskContract {
  riskLevel: "low" | "medium" | "high";
  externalEffect: boolean;
  financialEffect: boolean;
  clientFacing: boolean;
  requiresConfirmation: boolean;
}
```

Replace the inline `riskContract?: { ... }` in `Decision["meta"]` with `riskContract?: RiskContract;` (keep the doc comment) and add:

```ts
    /**
     * Workflow approvals only: the current ApprovalRevision bindingHash. The
     * client echoes it on approve so a patched/raced revision is refused.
     */
    bindingHash?: string;
    /** Workflow approvals only: approved but dispatch failed; primary action is Retry. */
    dispatchFailed?: boolean;
```

Export `RiskContract` from `decisions/index.ts`.

- [ ] **Step 4:** `pnpm --filter @switchboard/core test -- decisions && pnpm --filter @switchboard/core typecheck` -> PASS.
- [ ] **Step 5: Commit** `feat(core): workflow_approval decision kind, named risk contract, agent map entries`

### Task 2: urgency scorer

**Files:**

- Modify: `packages/core/src/decisions/urgency.ts`
- Modify: `packages/core/src/decisions/index.ts`
- Test: `packages/core/src/decisions/__tests__/urgency.test.ts` (create or extend)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { scoreParkedApproval } from "../urgency.js";

const HOUR = 3_600_000;

describe("scoreParkedApproval", () => {
  const now = Date.UTC(2026, 5, 4, 12, 0, 0);

  it("sits at the risk floor when expiry is far away", () => {
    expect(
      scoreParkedApproval({ expiresAt: new Date(now + 72 * HOUR), riskLevel: "medium" }, now),
    ).toBe(55);
    expect(
      scoreParkedApproval({ expiresAt: new Date(now + 72 * HOUR), riskLevel: "high" }, now),
    ).toBe(70);
    expect(
      scoreParkedApproval({ expiresAt: new Date(now + 72 * HOUR), riskLevel: "low" }, now),
    ).toBe(45);
  });

  it("ramps toward 100 inside the final 24h", () => {
    const at12h = scoreParkedApproval(
      { expiresAt: new Date(now + 12 * HOUR), riskLevel: "medium" },
      now,
    );
    expect(at12h).toBeGreaterThan(55);
    expect(at12h).toBeLessThan(100);
  });

  it("pins at 100 once expired", () => {
    expect(scoreParkedApproval({ expiresAt: new Date(now - HOUR), riskLevel: "low" }, now)).toBe(
      100,
    );
  });
});
```

- [ ] **Step 2:** run -> FAIL (not exported).
- [ ] **Step 3: Implement in `urgency.ts`:**

```ts
// Parked governed approvals block real work (the WorkUnit cannot run until a
// human responds), so they floor by risk and ramp to 100 as expiry approaches.
const PARKED_RISK_FLOOR: Record<"low" | "medium" | "high", number> = {
  low: 45,
  medium: 55,
  high: 70,
};

export interface ParkedApprovalLike {
  expiresAt: Date;
  riskLevel: "low" | "medium" | "high";
}

export function scoreParkedApproval(row: ParkedApprovalLike, nowMs = Date.now()): number {
  const floor = PARKED_RISK_FLOOR[row.riskLevel];
  const hoursUntilExpiry = (row.expiresAt.getTime() - nowMs) / 3_600_000;
  if (hoursUntilExpiry <= 0) return 100;
  if (hoursUntilExpiry >= 24) return floor;
  return Math.round(100 - (hoursUntilExpiry / 24) * (100 - floor));
}
```

Export both names from `decisions/index.ts`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(core): urgency scorer for parked workflow approvals`

### Task 3: `adaptParkedApproval` + degraded + recovery variants

**Files:**

- Create: `packages/core/src/decisions/adapters/parked-approval-adapter.ts`
- Test: `packages/core/src/decisions/adapters/__tests__/parked-approval-adapter.test.ts`
- Modify: `packages/core/src/decisions/index.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../../../platform/work-trace.js";
import {
  adaptParkedApproval,
  adaptDegradedParkedApproval,
  type ParkedApprovalSummarizer,
} from "../parked-approval-adapter.js";

function makeTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu-1",
    traceId: "trace-1",
    intent: "adoptimizer.recommendation.handoff",
    mode: "workflow",
    organizationId: "org_dev",
    actor: { id: "system", type: "system" },
    trigger: "internal",
    parameters: { campaignId: "camp-1", rationale: "CTR halved", apiToken: "sk-secret" },
    deploymentContext: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
    },
    governanceOutcome: "require_approval",
    riskScore: 0.4,
    matchedPolicies: [],
    outcome: "pending_approval",
    durationMs: 0,
    requestedAt: "2026-06-04T10:00:00.000Z",
    governanceCompletedAt: "2026-06-04T10:00:00.000Z",
    ingressPath: "platform_ingress",
    ...overrides,
  } as WorkTrace;
}

const lifecycle = {
  id: "lc-1",
  status: "pending" as const,
  organizationId: "org_dev",
  expiresAt: new Date("2026-06-07T10:00:00.000Z"),
  createdAt: new Date("2026-06-04T10:00:00.000Z"),
};
const revision = { bindingHash: "hash-abc" };

describe("adaptParkedApproval", () => {
  it("builds a rich default card with a redacted parameter preview", () => {
    const d = adaptParkedApproval(lifecycle, revision, makeTrace());
    expect(d.kind).toBe("workflow_approval");
    expect(d.id).toBe("workflow_approval:lc-1");
    expect(d.sourceRef).toEqual({ kind: "workflow_approval", sourceId: "lc-1" });
    expect(d.agentKey).toBe("riley");
    expect(d.humanSummary).toContain("adoptimizer.recommendation.handoff");
    expect(d.meta.bindingHash).toBe("hash-abc");
    expect(d.meta.slaDeadlineAt).toEqual(lifecycle.expiresAt);
    const flat = (d.presentation.dataLines as Array<string | string[]>)
      .map((l) => (Array.isArray(l) ? l.join(" ") : l))
      .join("\n");
    expect(flat).toContain("system"); // actor
    expect(flat).toContain("internal"); // trigger
    expect(flat).toContain("campaignId"); // parameter preview key
    expect(flat).toContain("camp-1"); // primitive value shown
    expect(flat).not.toContain("sk-secret"); // redacted by key pattern
    expect(flat).toContain("No bespoke summary");
  });

  it("defaults UNKNOWN intents to a closed-toward-caution risk contract (review 14C)", () => {
    const d = adaptParkedApproval(lifecycle, revision, makeTrace());
    expect(d.meta.riskContract).toEqual({
      riskLevel: "high",
      externalEffect: true,
      financialEffect: false,
      clientFacing: true,
      requiresConfirmation: true,
    });
    expect(d.urgencyScore).toBeGreaterThanOrEqual(70);
  });

  it("applies a summarizer's card and risk contract", () => {
    const summarizer: ParkedApprovalSummarizer = (ctx) => ({
      humanSummary: `Riley wants to brief Mira on ${String(ctx.parameters["campaignId"])}.`,
      dataLines: ["Evidence: 1000 clicks"],
      presentation: { primaryLabel: "Approve handoff" },
      riskContract: {
        riskLevel: "medium",
        externalEffect: false,
        financialEffect: false,
        clientFacing: false,
        requiresConfirmation: true,
      },
    });
    const d = adaptParkedApproval(lifecycle, revision, makeTrace(), summarizer);
    expect(d.humanSummary).toBe("Riley wants to brief Mira on camp-1.");
    expect(d.presentation.primaryLabel).toBe("Approve handoff");
    expect(d.presentation.dataLines).toEqual(["Evidence: 1000 clicks"]);
    expect(d.meta.riskContract?.riskLevel).toBe("medium");
  });

  it("falls through to the default card when the summarizer returns null", () => {
    const d = adaptParkedApproval(lifecycle, revision, makeTrace(), () => null);
    expect(d.humanSummary).toContain("needs your approval");
  });

  it("renders a recovery card for recovery_required lifecycles", () => {
    const d = adaptParkedApproval(
      { ...lifecycle, status: "recovery_required" },
      revision,
      makeTrace(),
      () => ({ humanSummary: "Riley wants to brief Mira on camp-1." }),
    );
    expect(d.humanSummary).toMatch(/^Approved, but it didn't run: /);
    expect(d.presentation.primaryLabel).toBe("Retry");
    expect(d.meta.dispatchFailed).toBe(true);
    expect(d.urgencyScore).toBe(100);
  });

  it("attributes creative traces to mira", () => {
    const d = adaptParkedApproval(
      lifecycle,
      revision,
      makeTrace({
        intent: "creative.job.publish",
        deploymentContext: {
          deploymentId: "dep-c",
          skillSlug: "creative",
          trustLevel: "guided",
          trustScore: 0,
        },
      }),
    );
    expect(d.agentKey).toBe("mira");
  });
});

describe("adaptDegradedParkedApproval", () => {
  it("renders an actionable degraded card instead of silently skipping (review #5)", () => {
    const d = adaptDegradedParkedApproval(lifecycle);
    expect(d.kind).toBe("workflow_approval");
    expect(d.sourceRef.sourceId).toBe("lc-1");
    expect(d.humanSummary).toContain("could not be fully loaded");
    expect(d.humanSummary).toContain("lc-1".slice(0, 8));
    expect(d.meta.riskContract?.riskLevel).toBe("high");
    expect(d.meta.bindingHash).toBeUndefined(); // approve impossible; reject still works
    expect(d.agentKey).toBe("alex");
  });
});
```

- [ ] **Step 2:** run -> FAIL (module not found).
- [ ] **Step 3: Implement `parked-approval-adapter.ts`:**

```ts
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { Decision, DecisionPresentation, RiskContract } from "../types.js";
import type { WorkTrace } from "../../platform/work-trace.js";
import { scoreParkedApproval } from "../urgency.js";
import { resolveAgentKey } from "../agent-key-resolver.js";

/** Subset of LifecycleRecord the adapter needs (keeps core decisions decoupled). */
export interface ParkedLifecycleLike {
  id: string;
  status: string;
  organizationId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface ParkedRevisionLike {
  bindingHash: string;
}

export interface ParkedApprovalContext {
  intent: string;
  parameters: Record<string, unknown>;
  actorId: string;
  organizationId: string;
}

export interface ParkedApprovalSummary {
  humanSummary: string;
  dataLines?: ReadonlyArray<string | string[]>;
  presentation?: Partial<
    Pick<DecisionPresentation, "primaryLabel" | "secondaryLabel" | "dismissLabel">
  >;
  riskContract?: RiskContract;
  contactName?: string;
}

/**
 * Per-intent humanizer. Lives with the workflow modules that own the parameter
 * shapes (apps/api); core only defines the contract. Return null to fall
 * through to the default card.
 */
export type ParkedApprovalSummarizer = (ctx: ParkedApprovalContext) => ParkedApprovalSummary | null;

// Review #2: unknown governed work fails CLOSED toward caution. It may be
// client-facing or external; under-warning is the wrong failure mode. Bespoke
// summarizers override with accurate contracts.
const DEFAULT_RISK: RiskContract = {
  riskLevel: "high",
  externalEffect: true,
  financialEffect: false,
  clientFacing: true,
  requiresConfirmation: true,
};

const SENSITIVE_KEY = /token|secret|key|password|phone|email|credential/i;
const PREVIEW_KEYS = 4;
const PREVIEW_VALUE_MAX = 60;

function parameterPreview(parameters: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(parameters).slice(0, PREVIEW_KEYS)) {
    if (SENSITIVE_KEY.test(key)) {
      lines.push(`${key}: [redacted]`);
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      const raw = String(value);
      lines.push(
        `${key}: ${raw.length > PREVIEW_VALUE_MAX ? `${raw.slice(0, PREVIEW_VALUE_MAX)}…` : raw}`,
      );
    } else {
      lines.push(`${key}: [${Array.isArray(value) ? "list" : "object"}]`);
    }
  }
  return lines;
}

export function adaptParkedApproval(
  lifecycle: ParkedLifecycleLike,
  revision: ParkedRevisionLike,
  trace: WorkTrace,
  summarizer?: ParkedApprovalSummarizer,
): Decision {
  const ctx: ParkedApprovalContext = {
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    actorId: trace.actor.id,
    organizationId: trace.organizationId,
  };
  const summary = summarizer?.(ctx) ?? null;

  const agentKey = resolveAgentKey(trace.deploymentContext?.skillSlug);
  const agentName = AGENT_REGISTRY[agentKey]?.displayName ?? agentKey;
  const riskContract = summary?.riskContract ?? DEFAULT_RISK;
  const recovery = lifecycle.status === "recovery_required";

  const baseSummary =
    summary?.humanSummary ?? `${agentName} needs your approval to run ${trace.intent}.`;
  const defaultLines: Array<string | string[]> = [
    `Action: ${trace.intent}`,
    `Requested by ${trace.actor.id} via ${trace.trigger}`,
    `Waiting since ${lifecycle.createdAt.toISOString().slice(0, 10)}, expires ${lifecycle.expiresAt.toISOString().slice(0, 10)}`,
    ...parameterPreview(ctx.parameters),
    "No bespoke summary for this action type yet.",
  ];

  const presentation: DecisionPresentation = {
    primaryLabel: recovery ? "Retry" : (summary?.presentation?.primaryLabel ?? "Approve"),
    secondaryLabel: summary?.presentation?.secondaryLabel ?? "Not now",
    dismissLabel: recovery ? "Not now" : (summary?.presentation?.dismissLabel ?? "Reject"),
    dataLines: summary?.dataLines ?? defaultLines,
  };

  return {
    id: `workflow_approval:${lifecycle.id}`,
    kind: "workflow_approval",
    orgId: trace.organizationId,
    agentKey,
    humanSummary: recovery ? `Approved, but it didn't run: ${baseSummary}` : baseSummary,
    presentation,
    urgencyScore: recovery
      ? 100
      : scoreParkedApproval({ expiresAt: lifecycle.expiresAt, riskLevel: riskContract.riskLevel }),
    createdAt: lifecycle.createdAt,
    threadHref: null,
    sourceRef: { kind: "workflow_approval", sourceId: lifecycle.id },
    meta: {
      ...(summary?.contactName ? { contactName: summary.contactName } : {}),
      slaDeadlineAt: lifecycle.expiresAt,
      riskLevel: riskContract.riskLevel,
      riskContract,
      bindingHash: revision.bindingHash,
      ...(recovery ? { dispatchFailed: true } : {}),
    },
  };
}

/**
 * Review #5: a lifecycle whose trace or revision cannot be loaded must still
 * surface. Approve is impossible (no bindingHash is exposed); reject remains
 * possible. The caller logs the integrity failure.
 */
export function adaptDegradedParkedApproval(lifecycle: ParkedLifecycleLike): Decision {
  return {
    id: `workflow_approval:${lifecycle.id}`,
    kind: "workflow_approval",
    orgId: lifecycle.organizationId ?? "",
    agentKey: "alex",
    humanSummary: `An approval could not be fully loaded (id ${lifecycle.id.slice(0, 8)}). You can still reject it; approving needs the underlying work record.`,
    presentation: {
      primaryLabel: "Approve",
      secondaryLabel: "Not now",
      dismissLabel: "Reject",
      dataLines: [
        `Approval id: ${lifecycle.id}`,
        `Created ${lifecycle.createdAt.toISOString().slice(0, 10)}, expires ${lifecycle.expiresAt.toISOString().slice(0, 10)}`,
        "The underlying work record is missing. Contact support if this persists.",
      ],
    },
    urgencyScore: 90,
    createdAt: lifecycle.createdAt,
    threadHref: null,
    sourceRef: { kind: "workflow_approval", sourceId: lifecycle.id },
    meta: {
      slaDeadlineAt: lifecycle.expiresAt,
      riskLevel: "high",
      riskContract: DEFAULT_RISK,
    },
  };
}
```

Export all public names from `decisions/index.ts`.

- [ ] **Step 4:** PASS + `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core typecheck`.
- [ ] **Step 5: Commit** `feat(core): adaptParkedApproval with degraded and recovery variants`
- [ ] **Step 6: PR-1.** Full gate, push, `gh pr create` (title `feat(core): parked workflow approval read model`), `gh pr merge --squash --auto`. Wait for merge; `git fetch origin`.

---

## PR-2: core+db action path

Branch: `feat/parked-approvals-core-action` off updated origin/main.

### Task 4: store interface additions + `InMemoryLifecycleStore`

**Files:**

- Modify: `packages/core/src/approval/lifecycle-types.ts` (interface additions)
- Create: `packages/core/src/approval/in-memory-lifecycle-store.ts`
- Test: `packages/core/src/approval/__tests__/in-memory-lifecycle-store.test.ts`
- Modify: `packages/core/src/approval/index.ts`

- [ ] **Step 1: Interface additions** in `lifecycle-types.ts` (`ApprovalLifecycleStore`):

```ts
  /** Lifecycles whose dispatch failed after approval (status "recovery_required"). */
  listRecoveryRequiredLifecycles(organizationId?: string): Promise<LifecycleRecord[]>;
  /** Number of dispatch records ever created for one executable work unit. */
  countDispatchRecords(executableWorkUnitId: string): Promise<number>;
```

NOTE: this breaks `PrismaLifecycleStore`'s `implements` until Task 6 Step 4; core and db are in the same PR, so run the cross-package typecheck only after that step (per-package core tests run green meanwhile).

- [ ] **Step 2: Failing store test**

```ts
import { describe, it, expect } from "vitest";
import { InMemoryLifecycleStore } from "../in-memory-lifecycle-store.js";
import { StaleVersionError } from "../state-machine.js";

function input(env = "wu-1") {
  return {
    actionEnvelopeId: env,
    organizationId: "org_dev",
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { a: 1 },
      approvalScopeSnapshot: {},
      bindingHash: "h1",
      createdBy: "system",
    },
  };
}

describe("InMemoryLifecycleStore", () => {
  it("creates a lifecycle with revision and reads it back", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle, revision } = await store.createLifecycleWithRevision(input());
    expect(lifecycle.status).toBe("pending");
    expect(lifecycle.currentRevisionId).toBe(revision.id);
    expect(revision.revisionNumber).toBe(1);
    expect(await store.getLifecycleById(lifecycle.id)).toMatchObject({ id: lifecycle.id });
    expect(await store.getLifecycleByEnvelopeId("wu-1")).toMatchObject({ id: lifecycle.id });
    expect(await store.getCurrentRevision(lifecycle.id)).toMatchObject({ bindingHash: "h1" });
  });

  it("enforces optimistic version on status updates", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle } = await store.createLifecycleWithRevision(input());
    await expect(
      store.updateLifecycleStatus(lifecycle.id, "rejected", 99, "org_dev"),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const updated = await store.updateLifecycleStatus(lifecycle.id, "rejected", 1, "org_dev");
    expect(updated.status).toBe("rejected");
    expect(updated.version).toBe(2);
  });

  it("approveAndMaterialize flips status and pins the executable work unit", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle, revision } = await store.createLifecycleWithRevision(input());
    const { lifecycle: approved, workUnit } = await store.approveAndMaterialize(
      lifecycle.id,
      1,
      "org_dev",
      {
        lifecycleId: lifecycle.id,
        approvalRevisionId: revision.id,
        actionEnvelopeId: "wu-1",
        frozenPayload: { intent: "x" },
        frozenBinding: {},
        frozenExecutionPolicy: {},
        executableUntil: new Date(Date.now() + 3_600_000),
      },
    );
    expect(approved.status).toBe("approved");
    expect(approved.currentExecutableWorkUnitId).toBe(workUnit.id);
    expect(await store.getExecutableWorkUnit(workUnit.id)).toMatchObject({ id: workUnit.id });
  });

  it("rejects duplicate dispatch idempotency keys and counts records", async () => {
    const store = new InMemoryLifecycleStore();
    await store.createDispatchRecord({
      executableWorkUnitId: "ewu-1",
      attemptNumber: 1,
      idempotencyKey: "k1",
    });
    await expect(
      store.createDispatchRecord({
        executableWorkUnitId: "ewu-1",
        attemptNumber: 2,
        idempotencyKey: "k1",
      }),
    ).rejects.toThrow(/idempotency/i);
    await store.createDispatchRecord({
      executableWorkUnitId: "ewu-1",
      attemptNumber: 2,
      idempotencyKey: "k2",
    });
    expect(await store.countDispatchRecords("ewu-1")).toBe(2);
    expect(await store.countDispatchRecords("ewu-other")).toBe(0);
  });

  it("lists pending and recovery_required lifecycles scoped by org", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle: a } = await store.createLifecycleWithRevision(input("wu-a"));
    await store.createLifecycleWithRevision({ ...input("wu-b"), organizationId: "org_other" });
    expect(await store.listPendingLifecycles("org_dev")).toHaveLength(1);
    expect(await store.listPendingLifecycles()).toHaveLength(2);
    await store.updateLifecycleStatus(a.id, "recovery_required", 1, "org_dev");
    expect(await store.listPendingLifecycles("org_dev")).toHaveLength(0);
    expect(await store.listRecoveryRequiredLifecycles("org_dev")).toHaveLength(1);
    expect(await store.listRecoveryRequiredLifecycles("org_other")).toHaveLength(0);
  });
});
```

- [ ] **Step 3:** run -> FAIL. **Step 4: Implement.** Class docstring:

```ts
/**
 * In-memory ApprovalLifecycleStore. TEST/DEV SUPPORT ONLY: production wiring
 * constructs PrismaLifecycleStore exclusively (app.ts gates on prismaClient).
 * Mirrors PrismaLifecycleStore semantics: optimistic version on status updates
 * (StaleVersionError), unique dispatch idempotencyKey, atomic
 * approveAndMaterialize.
 */
```

Implementation (full class):

```ts
import { randomUUID } from "node:crypto";
import type {
  ApprovalRevision,
  ApprovalLifecycleStatus,
  ExecutableWorkUnit,
  DispatchRecord,
} from "@switchboard/schemas";
import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
  CreateRevisionInput,
  MaterializeWorkUnitInput,
} from "./lifecycle-types.js";
import { StaleVersionError } from "./state-machine.js";

export class InMemoryLifecycleStore implements ApprovalLifecycleStore {
  private lifecycles = new Map<string, LifecycleRecord>();
  private revisions = new Map<string, ApprovalRevision>();
  private executables = new Map<string, ExecutableWorkUnit>();
  private dispatches = new Map<string, DispatchRecord>();

  async createLifecycleWithRevision(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }> {
    const now = new Date();
    const lifecycleId = randomUUID();
    const revision: ApprovalRevision = {
      id: randomUUID(),
      lifecycleId,
      revisionNumber: 1,
      parametersSnapshot: input.initialRevision.parametersSnapshot,
      approvalScopeSnapshot: input.initialRevision.approvalScopeSnapshot,
      bindingHash: input.initialRevision.bindingHash,
      rationale: null,
      supersedesRevisionId: null,
      createdBy: input.initialRevision.createdBy,
      createdAt: now,
    };
    const lifecycle: LifecycleRecord = {
      id: lifecycleId,
      actionEnvelopeId: input.actionEnvelopeId,
      organizationId: input.organizationId ?? null,
      status: "pending",
      currentRevisionId: revision.id,
      currentExecutableWorkUnitId: null,
      expiresAt: input.expiresAt,
      pausedSessionId: input.pausedSessionId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.lifecycles.set(lifecycleId, lifecycle);
    this.revisions.set(revision.id, revision);
    return { lifecycle: { ...lifecycle }, revision: { ...revision } };
  }

  async getLifecycleById(id: string): Promise<LifecycleRecord | null> {
    const lc = this.lifecycles.get(id);
    return lc ? { ...lc } : null;
  }

  async getLifecycleByEnvelopeId(envelopeId: string): Promise<LifecycleRecord | null> {
    for (const lc of this.lifecycles.values()) {
      if (lc.actionEnvelopeId === envelopeId) return { ...lc };
    }
    return null;
  }

  async getRevision(lifecycleId: string, revisionNumber: number): Promise<ApprovalRevision | null> {
    for (const rev of this.revisions.values()) {
      if (rev.lifecycleId === lifecycleId && rev.revisionNumber === revisionNumber)
        return { ...rev };
    }
    return null;
  }

  async getRevisionById(id: string): Promise<ApprovalRevision | null> {
    const rev = this.revisions.get(id);
    return rev ? { ...rev } : null;
  }

  async getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null> {
    const lc = this.lifecycles.get(lifecycleId);
    if (!lc?.currentRevisionId) return null;
    return this.getRevisionById(lc.currentRevisionId);
  }

  async createRevision(input: CreateRevisionInput): Promise<ApprovalRevision> {
    let max = 0;
    for (const rev of this.revisions.values()) {
      if (rev.lifecycleId === input.lifecycleId) max = Math.max(max, rev.revisionNumber);
    }
    const revision: ApprovalRevision = {
      id: randomUUID(),
      lifecycleId: input.lifecycleId,
      revisionNumber: max + 1,
      parametersSnapshot: input.parametersSnapshot,
      approvalScopeSnapshot: input.approvalScopeSnapshot,
      bindingHash: input.bindingHash,
      rationale: input.rationale ?? null,
      supersedesRevisionId: input.supersedesRevisionId ?? null,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    this.revisions.set(revision.id, revision);
    const lc = this.lifecycles.get(input.lifecycleId);
    if (lc) {
      this.lifecycles.set(lc.id, { ...lc, currentRevisionId: revision.id, updatedAt: new Date() });
    }
    return { ...revision };
  }

  async updateLifecycleStatus(
    id: string,
    status: ApprovalLifecycleStatus,
    expectedVersion: number,
    _organizationId: string | null,
    updates?: { currentRevisionId?: string; currentExecutableWorkUnitId?: string },
  ): Promise<LifecycleRecord> {
    const lc = this.lifecycles.get(id);
    if (!lc || lc.version !== expectedVersion) {
      throw new StaleVersionError(id, expectedVersion, lc?.version ?? -1);
    }
    const next: LifecycleRecord = {
      ...lc,
      status,
      version: expectedVersion + 1,
      updatedAt: new Date(),
      ...(updates?.currentRevisionId ? { currentRevisionId: updates.currentRevisionId } : {}),
      ...(updates?.currentExecutableWorkUnitId
        ? { currentExecutableWorkUnitId: updates.currentExecutableWorkUnitId }
        : {}),
    };
    this.lifecycles.set(id, next);
    return { ...next };
  }

  async materializeWorkUnit(input: MaterializeWorkUnitInput): Promise<ExecutableWorkUnit> {
    const workUnit: ExecutableWorkUnit = {
      id: randomUUID(),
      lifecycleId: input.lifecycleId,
      approvalRevisionId: input.approvalRevisionId,
      actionEnvelopeId: input.actionEnvelopeId,
      frozenPayload: input.frozenPayload,
      frozenBinding: input.frozenBinding,
      frozenExecutionPolicy: input.frozenExecutionPolicy,
      executableUntil: input.executableUntil,
      createdAt: new Date(),
    };
    this.executables.set(workUnit.id, workUnit);
    return { ...workUnit };
  }

  async approveAndMaterialize(
    lifecycleId: string,
    expectedVersion: number,
    organizationId: string | null,
    materializeInput: MaterializeWorkUnitInput,
  ): Promise<{ lifecycle: LifecycleRecord; workUnit: ExecutableWorkUnit }> {
    const workUnit = await this.materializeWorkUnit(materializeInput);
    const lifecycle = await this.updateLifecycleStatus(
      lifecycleId,
      "approved",
      expectedVersion,
      organizationId,
      { currentExecutableWorkUnitId: workUnit.id },
    );
    return { lifecycle, workUnit };
  }

  async getExecutableWorkUnit(id: string): Promise<ExecutableWorkUnit | null> {
    const wu = this.executables.get(id);
    return wu ? { ...wu } : null;
  }

  async createDispatchRecord(input: {
    executableWorkUnitId: string;
    attemptNumber: number;
    idempotencyKey: string;
  }): Promise<DispatchRecord> {
    for (const rec of this.dispatches.values()) {
      if (rec.idempotencyKey === input.idempotencyKey) {
        throw new Error(`Duplicate dispatch idempotencyKey: ${input.idempotencyKey}`);
      }
    }
    const record: DispatchRecord = {
      id: randomUUID(),
      executableWorkUnitId: input.executableWorkUnitId,
      attemptNumber: input.attemptNumber,
      idempotencyKey: input.idempotencyKey,
      state: "dispatching",
      dispatchedAt: new Date(),
      completedAt: null,
      outcome: null,
      errorMessage: null,
      durationMs: null,
    };
    this.dispatches.set(record.id, record);
    return { ...record };
  }

  async updateDispatchRecord(
    id: string,
    updates: {
      state: string;
      outcome?: string | null;
      errorMessage?: string | null;
      completedAt?: Date;
      durationMs?: number;
    },
  ): Promise<DispatchRecord> {
    const rec = this.dispatches.get(id);
    if (!rec) throw new Error(`Dispatch record not found: ${id}`);
    const next: DispatchRecord = {
      ...rec,
      state: updates.state as DispatchRecord["state"],
      outcome: updates.outcome ?? rec.outcome,
      errorMessage: updates.errorMessage ?? rec.errorMessage,
      completedAt: updates.completedAt ?? rec.completedAt,
      durationMs: updates.durationMs ?? rec.durationMs,
    };
    this.dispatches.set(id, next);
    return { ...next };
  }

  async listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    return [...this.lifecycles.values()]
      .filter((lc) => lc.status === "pending")
      .filter((lc) => (organizationId ? lc.organizationId === organizationId : true))
      .map((lc) => ({ ...lc }));
  }

  async listExpiredPendingLifecycles(now?: Date): Promise<LifecycleRecord[]> {
    const cutoff = now ?? new Date();
    return [...this.lifecycles.values()]
      .filter((lc) => lc.status === "pending" && lc.expiresAt <= cutoff)
      .map((lc) => ({ ...lc }));
  }

  async listRecoveryRequiredLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    return [...this.lifecycles.values()]
      .filter((lc) => lc.status === "recovery_required")
      .filter((lc) => (organizationId ? lc.organizationId === organizationId : true))
      .map((lc) => ({ ...lc }));
  }

  async countDispatchRecords(executableWorkUnitId: string): Promise<number> {
    return [...this.dispatches.values()].filter(
      (r) => r.executableWorkUnitId === executableWorkUnitId,
    ).length;
  }

  /** Test observability: every dispatch record created so far. */
  listDispatchRecords(): DispatchRecord[] {
    return [...this.dispatches.values()].map((r) => ({ ...r }));
  }
}
```

Match the `DispatchRecord` schema's nullable fields exactly (check `packages/schemas/src/approval-lifecycle.ts`). Export from `approval/index.ts`: `export { InMemoryLifecycleStore } from "./in-memory-lifecycle-store.js";`

- [ ] **Step 5:** store tests PASS. **Step 6: Commit** `feat(core): in-memory lifecycle store + recovery/count store interface`

### Task 5: service passthroughs + `prepareDispatch` attempt support

**Files:**

- Modify: `packages/core/src/approval/lifecycle-service.ts`

- [ ] **Step 1: Add to `ApprovalLifecycleService`:**

```ts
  async getLifecycleById(id: string): Promise<LifecycleRecord | null> {
    return this.store.getLifecycleById(id);
  }

  async getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null> {
    return this.store.getCurrentRevision(lifecycleId);
  }

  async countDispatchAttempts(executableWorkUnitId: string): Promise<number> {
    return this.store.countDispatchRecords(executableWorkUnitId);
  }

  /** Version-checked status transition (used by the dispatch-recovery path). */
  async transitionStatus(
    lifecycle: LifecycleRecord,
    status: ApprovalLifecycleStatus,
  ): Promise<LifecycleRecord> {
    return this.store.updateLifecycleStatus(
      lifecycle.id,
      status,
      lifecycle.version,
      lifecycle.organizationId,
    );
  }

  /**
   * Pending (expiry-filtered) plus recovery_required (approved, dispatch
   * failed; expiry no longer applies): everything an operator can act on.
   */
  async listOperatorActionableLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    const [pending, recovery] = await Promise.all([
      this.listPendingLifecycles(organizationId),
      this.store.listRecoveryRequiredLifecycles(organizationId),
    ]);
    return [...pending, ...recovery];
  }
```

(Import `ApprovalLifecycleStatus` type from `@switchboard/schemas`.) Widen `prepareDispatch` params with `attemptNumber?: number` (default 1), passing it to `createDispatchRecord` (replace the hardcoded `attemptNumber: 1`).

- [ ] **Step 2:** `pnpm --filter @switchboard/core test -- lifecycle-service` stays green.
- [ ] **Step 3: Commit** `feat(core): lifecycle service reads + attempt-aware dispatch preparation`

### Task 6: `respondToParkedLifecycle` (payload authority, recovery, retry, structured errors) + db store methods

**Files:**

- Create: `packages/core/src/approval/respond-to-parked-lifecycle.ts`
- Test: `packages/core/src/approval/__tests__/respond-to-parked-lifecycle.test.ts`
- Modify: `packages/core/src/approval/index.ts`
- Modify: `packages/db/src/storage/prisma-lifecycle-store.ts`
- Test: `packages/db/src/storage/__tests__/prisma-lifecycle-store.test.ts`

- [ ] **Step 1: Failing respond test.** Harness: `makeTrace(workUnitId, params?)` (WorkTrace literal as in Task 3's test, parameters defaulting `{ campaignId: "camp-1" }`), `makeTraceStore(traces)` (Map-backed, merge-on-update, integrity ok), `park(workUnitId?, bindingHash?, params?)` seeding trace + `createLifecycleWithRevision` with `parametersSnapshot = params`, `okResult()` returning a full ExecuteResult literal (`success: true, summary: "ok", externalRefs: {}, rollbackAvailable: false, partialFailures: [], durationMs: 5, undoRecipe: null`), `deps()` bundling `{ lifecycleService, workTraceStore, platformLifecycle: { executeApproved }, auditLedger: ledger, logger }`. Cases:

```ts
it("approve drives approveLifecycle, trace approval fields, dispatch record, executeApproved", async () => {
  const lc = await park();
  const result = await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash: "h1",
  });
  expect(result.approvalState.status).toBe("approved");
  expect(result.executionResult?.success).toBe(true);
  expect(executeApproved).toHaveBeenCalledWith("wu-1");
  expect((await store.getLifecycleById(lc.id))?.status).toBe("approved");
  const trace = traces.get("wu-1");
  expect(trace?.approvalOutcome).toBe("approved");
  expect(trace?.approvalRespondedBy).toBe("operator_jane");
  const dispatches = store.listDispatchRecords();
  expect(dispatches).toHaveLength(1);
  expect(dispatches[0]?.state).toBe("succeeded");
  expect(dispatches[0]?.idempotencyKey).toContain("attempt-1");
  expect(ledger.record).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: "action.approved" }),
  );
});

it("approve dispatches the APPROVED revision payload, not stale trace params (review 14A)", async () => {
  const lc = await park("wu-1", "h1", { campaignId: "approved" });
  traces.set("wu-1", { ...traces.get("wu-1")!, parameters: { campaignId: "old" } });
  let dispatchedParams: Record<string, unknown> | undefined;
  executeApproved.mockImplementation(async (workUnitId: string) => {
    dispatchedParams = traces.get(workUnitId)?.parameters; // what executeAfterApproval would read
    return okResult();
  });
  await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash: "h1",
  });
  expect(dispatchedParams).toEqual({ campaignId: "approved" });
});

it("reject drives rejectLifecycle and marks the trace failed", async () => {
  const lc = await park();
  const result = await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "reject",
    respondedBy: "operator_jane",
  });
  expect(result.approvalState.status).toBe("rejected");
  expect(result.executionResult).toBeNull();
  expect(executeApproved).not.toHaveBeenCalled();
  expect((await store.getLifecycleById(lc.id))?.status).toBe("rejected");
  expect(traces.get("wu-1")?.outcome).toBe("failed");
  expect(traces.get("wu-1")?.approvalOutcome).toBe("rejected");
  expect(ledger.record).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: "action.rejected" }),
  );
});

it("reject tolerates a missing trace (degraded card remains rejectable)", async () => {
  const lc = await park();
  traces.delete("wu-1");
  const result = await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "reject",
    respondedBy: "operator_jane",
  });
  expect(result.approvalState.status).toBe("rejected");
});

it("refuses a stale binding hash without mutating state", async () => {
  const lc = await park();
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "wrong",
    }),
  ).rejects.toThrow(/stale/i);
  expect((await store.getLifecycleById(lc.id))?.status).toBe("pending");
  expect(executeApproved).not.toHaveBeenCalled();
});

it("refuses an already-responded lifecycle", async () => {
  const lc = await park();
  await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "reject",
    respondedBy: "operator_jane",
  });
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    }),
  ).rejects.toBeInstanceOf(ParkedLifecycleAlreadyRespondedError);
});

it("expires an overdue lifecycle instead of responding", async () => {
  traces.set("wu-old", makeTrace("wu-old"));
  const { lifecycle } = await store.createLifecycleWithRevision({
    actionEnvelopeId: "wu-old",
    organizationId: "org_dev",
    expiresAt: new Date(Date.now() - 1000),
    initialRevision: {
      parametersSnapshot: {},
      approvalScopeSnapshot: {},
      bindingHash: "h1",
      createdBy: "system",
    },
  });
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: lifecycle.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    }),
  ).rejects.toBeInstanceOf(ParkedLifecycleExpiredError);
  expect((await store.getLifecycleById(lifecycle.id))?.status).toBe("expired");
});

it("blocks self-approval (originator from the trace)", async () => {
  const lc = await park();
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "system",
      bindingHash: "h1",
    }),
  ).rejects.toThrow(/self-approval/i);
});

it("404s an unknown lifecycle", async () => {
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: "nope",
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    }),
  ).rejects.toBeInstanceOf(ParkedLifecycleNotFoundError);
});

it("transitions to recovery_required when executeApproved THROWS (review 14B)", async () => {
  executeApproved.mockRejectedValueOnce(new Error("mode blew up"));
  const lc = await park();
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash: "h1",
    }),
  ).rejects.toThrow("mode blew up");
  expect((await store.getLifecycleById(lc.id))?.status).toBe("recovery_required");
  expect(store.listDispatchRecords()[0]?.state).toBe("failed");
});

it("transitions to recovery_required when dispatch returns success:false (review 14B)", async () => {
  executeApproved.mockResolvedValueOnce({
    ...okResult(),
    success: false,
    summary: "handler failed",
  });
  const lc = await park();
  const result = await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash: "h1",
  });
  expect(result.executionResult?.success).toBe(false);
  expect((await store.getLifecycleById(lc.id))?.status).toBe("recovery_required");
  expect(store.listDispatchRecords()[0]?.state).toBe("failed");
});

it("RETRY: approve on recovery_required re-dispatches with attempt 2 and recovers", async () => {
  executeApproved.mockResolvedValueOnce({
    ...okResult(),
    success: false,
    summary: "first failure",
  });
  const lc = await park();
  await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash: "h1",
  });
  expect((await store.getLifecycleById(lc.id))?.status).toBe("recovery_required");

  const result = await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash: "h1",
  });
  expect(result.executionResult?.success).toBe(true);
  expect((await store.getLifecycleById(lc.id))?.status).toBe("approved");
  const records = store.listDispatchRecords();
  expect(records).toHaveLength(2);
  expect(records[1]?.attemptNumber).toBe(2);
  expect(records[1]?.state).toBe("succeeded");
  expect(records[1]?.idempotencyKey).toContain("attempt-2");
});

it("RETRY: reject on recovery_required is refused (already approved)", async () => {
  executeApproved.mockResolvedValueOnce({
    ...okResult(),
    success: false,
    summary: "first failure",
  });
  const lc = await park();
  await respondToParkedLifecycle(deps(), {
    lifecycleId: lc.id,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash: "h1",
  });
  await expect(
    respondToParkedLifecycle(deps(), {
      lifecycleId: lc.id,
      action: "reject",
      respondedBy: "operator_jane",
    }),
  ).rejects.toBeInstanceOf(ParkedLifecycleAlreadyRespondedError);
});
```

- [ ] **Step 2:** run -> FAIL (module not found).

- [ ] **Step 3: Implement `respond-to-parked-lifecycle.ts`.** Module docstring states the spec 4.1/4.2 contract: respond-to-approval.ts handles approvals WITH a legacy row; this module is the single respond path for lifecycle-only parked units; the dispatched payload IS `ExecutableWorkUnit.frozenPayload.parameters`, written onto the WorkTrace (canonical persistence, legacy-patch precedent) BEFORE `executeApproved(actionEnvelopeId)`, which dispatches FROM the trace; the DispatchRecord is keyed by ExecutableWorkUnit.id with deterministic `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`.

```ts
import type { ExecuteResult, ApprovalLifecycleStatus } from "@switchboard/schemas";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";
import type { LifecycleRecord } from "./lifecycle-types.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { WorkUnit } from "../platform/work-unit.js";
import type { AuditLedger } from "../audit/ledger.js";

export class ParkedLifecycleNotFoundError extends Error {
  readonly code = "not_found";
  constructor(lifecycleId: string) {
    super(`Lifecycle not found: ${lifecycleId}`);
    this.name = "ParkedLifecycleNotFoundError";
  }
}

export class ParkedLifecycleAlreadyRespondedError extends Error {
  readonly code = "already_responded";
  constructor(lifecycleId: string, status: string) {
    super(`Lifecycle ${lifecycleId} has already been responded to (status: ${status})`);
    this.name = "ParkedLifecycleAlreadyRespondedError";
  }
}

export class ParkedLifecycleExpiredError extends Error {
  readonly code = "expired";
  constructor(lifecycleId: string) {
    super(`Lifecycle ${lifecycleId} has expired`);
    this.name = "ParkedLifecycleExpiredError";
  }
}

export interface ExecuteApprovedLike {
  executeApproved(workUnitId: string): Promise<ExecuteResult>;
}

export interface RespondToParkedLifecycleDeps {
  lifecycleService: ApprovalLifecycleService;
  workTraceStore: WorkTraceStore;
  platformLifecycle: ExecuteApprovedLike;
  auditLedger?: AuditLedger;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
  selfApprovalAllowed?: boolean;
}

export interface RespondToParkedLifecycleParams {
  lifecycleId: string;
  action: "approve" | "reject";
  respondedBy: string;
  bindingHash?: string;
  /** Optional operator note; recorded in the audit ledger snapshot. */
  note?: string;
}

export interface ParkedApprovalState {
  status: "approved" | "rejected";
  respondedBy: string;
  respondedAt: string;
  lifecycleId: string;
}

export interface RespondToParkedLifecycleResult {
  approvalState: ParkedApprovalState;
  executionResult: ExecuteResult | null;
}

export async function respondToParkedLifecycle(
  deps: RespondToParkedLifecycleDeps,
  params: RespondToParkedLifecycleParams,
): Promise<RespondToParkedLifecycleResult> {
  const { lifecycleService, workTraceStore, auditLedger } = deps;

  const lifecycle = await lifecycleService.getLifecycleById(params.lifecycleId);
  if (!lifecycle) throw new ParkedLifecycleNotFoundError(params.lifecycleId);

  if (lifecycle.status === "recovery_required") {
    if (params.action !== "approve") {
      throw new ParkedLifecycleAlreadyRespondedError(lifecycle.id, lifecycle.status);
    }
    return retryDispatch(deps, params, lifecycle);
  }
  if (lifecycle.status !== "pending") {
    throw new ParkedLifecycleAlreadyRespondedError(lifecycle.id, lifecycle.status);
  }
  if (lifecycle.expiresAt <= new Date()) {
    await lifecycleService.expireLifecycle(lifecycle.id);
    throw new ParkedLifecycleExpiredError(lifecycle.id);
  }

  const traceResult = await workTraceStore.getByWorkUnitId(lifecycle.actionEnvelopeId);
  const trace = traceResult?.trace ?? null;
  const respondedAt = new Date().toISOString();

  if (params.action === "reject") {
    // rejectLifecycle tolerates a missing trace, so a degraded card stays rejectable.
    await lifecycleService.rejectLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: params.respondedBy,
      traceStore: workTraceStore,
      auditLedger,
    });
    await recordLedger(auditLedger, "action.rejected", params, lifecycle, trace);
    return {
      approvalState: {
        status: "rejected",
        respondedBy: params.respondedBy,
        respondedAt,
        lifecycleId: lifecycle.id,
      },
      executionResult: null,
    };
  }

  // --- approve ---
  if (!trace) {
    throw new Error(
      `WorkTrace not found for parked lifecycle ${lifecycle.id} (workUnit ${lifecycle.actionEnvelopeId})`,
    );
  }
  assertNotSelfApproval(deps, params, trace);
  if (!params.bindingHash) throw new Error("bindingHash is required to approve");

  const workUnit = workUnitFromTrace(trace);
  const { lifecycle: approved, executableWorkUnit } = await lifecycleService.approveLifecycle({
    lifecycleId: lifecycle.id,
    respondedBy: params.respondedBy,
    clientBindingHash: params.bindingHash,
    workUnit,
    actionEnvelopeId: lifecycle.actionEnvelopeId,
    constraints: (trace.governanceConstraints as unknown as Record<string, unknown>) ?? {},
  });

  // Payload authority (spec 4.1): the trace MUST carry the approved frozen
  // payload before dispatch: executeAfterApproval dispatches from the trace.
  const frozenParameters =
    (executableWorkUnit.frozenPayload["parameters"] as Record<string, unknown> | undefined) ??
    workUnit.parameters;
  const traceUpdate = await workTraceStore.update(
    lifecycle.actionEnvelopeId,
    {
      parameters: frozenParameters,
      approvalOutcome: "approved",
      approvalRespondedBy: params.respondedBy,
      approvalRespondedAt: respondedAt,
    },
    {
      caller: "respond_to_parked_lifecycle",
      organizationId: lifecycle.organizationId ?? undefined,
    },
  );
  if (!traceUpdate.ok) {
    throw new Error(`WorkTrace update rejected before dispatch: ${traceUpdate.reason}`);
  }

  const executionResult = await runDispatch(
    deps,
    approved,
    executableWorkUnit.id,
    executableWorkUnit.approvalRevisionId,
  );

  await recordLedger(auditLedger, "action.approved", params, lifecycle, trace);
  deps.logger.info(
    {
      lifecycleId: lifecycle.id,
      workUnitId: lifecycle.actionEnvelopeId,
      success: executionResult.success,
    },
    "Parked lifecycle approved and dispatched",
  );

  return {
    approvalState: {
      status: "approved",
      respondedBy: params.respondedBy,
      respondedAt,
      lifecycleId: lifecycle.id,
    },
    executionResult,
  };
}

async function retryDispatch(
  deps: RespondToParkedLifecycleDeps,
  params: RespondToParkedLifecycleParams,
  lifecycle: LifecycleRecord,
): Promise<RespondToParkedLifecycleResult> {
  if (!params.bindingHash) throw new Error("bindingHash is required to approve");
  const revision = await deps.lifecycleService.getCurrentRevision(lifecycle.id);
  if (!revision || revision.bindingHash !== params.bindingHash) {
    throw new Error("Stale binding: client binding hash does not match current revision");
  }
  const traceResult = await deps.workTraceStore.getByWorkUnitId(lifecycle.actionEnvelopeId);
  if (!traceResult?.trace) {
    throw new Error(`WorkTrace not found for parked lifecycle ${lifecycle.id}`);
  }
  assertNotSelfApproval(deps, params, traceResult.trace);
  if (!lifecycle.currentExecutableWorkUnitId) {
    throw new Error(`Lifecycle ${lifecycle.id} has no executable work unit to retry`);
  }
  // Admission stays strict: only "approved" dispatches. Version-checked, so a
  // raced double-retry loses here (StaleVersionError -> 409 at the route).
  const approved = await deps.lifecycleService.transitionStatus(lifecycle, "approved");
  const executionResult = await runDispatch(
    deps,
    approved,
    lifecycle.currentExecutableWorkUnitId,
    revision.id,
  );
  await recordLedger(deps.auditLedger, "action.approved", params, lifecycle, traceResult.trace);
  return {
    approvalState: {
      status: "approved",
      respondedBy: params.respondedBy,
      respondedAt: new Date().toISOString(),
      lifecycleId: lifecycle.id,
    },
    executionResult,
  };
}

async function runDispatch(
  deps: RespondToParkedLifecycleDeps,
  lifecycle: LifecycleRecord,
  executableWorkUnitId: string,
  revisionId: string,
): Promise<ExecuteResult> {
  const { lifecycleService, platformLifecycle } = deps;
  const attemptNumber = (await lifecycleService.countDispatchAttempts(executableWorkUnitId)) + 1;
  const { dispatchRecord } = await lifecycleService.prepareDispatch({
    lifecycleId: lifecycle.id,
    executableWorkUnitId,
    idempotencyKey: `lifecycle-dispatch:${lifecycle.id}:${revisionId}:attempt-${attemptNumber}`,
    attemptNumber,
  });

  const startedAt = Date.now();
  let executionResult: ExecuteResult;
  try {
    // CONTRACT (spec 4.2): executeApproved takes the ORIGINAL WorkUnit id and
    // dispatches from the WorkTrace, which now carries the frozen payload (4.1).
    executionResult = await platformLifecycle.executeApproved(lifecycle.actionEnvelopeId);
  } catch (err) {
    await lifecycleService.recordDispatchOutcome({
      dispatchRecordId: dispatchRecord.id,
      state: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    await markRecoveryRequired(deps, lifecycle.id);
    throw err;
  }
  await lifecycleService.recordDispatchOutcome({
    dispatchRecordId: dispatchRecord.id,
    state: executionResult.success ? "succeeded" : "failed",
    outcome: executionResult.summary,
    ...(executionResult.success ? {} : { errorMessage: executionResult.summary }),
    durationMs: Date.now() - startedAt,
  });
  if (!executionResult.success) {
    await markRecoveryRequired(deps, lifecycle.id);
  }
  return executionResult;
}

/**
 * Review #3: an approved action whose dispatch failed must come BACK to the
 * operator (as a Retry card), never vanish into logs.
 */
async function markRecoveryRequired(
  deps: RespondToParkedLifecycleDeps,
  lifecycleId: string,
): Promise<void> {
  const fresh = await deps.lifecycleService.getLifecycleById(lifecycleId);
  if (!fresh || fresh.status !== "approved") return;
  try {
    await deps.lifecycleService.transitionStatus(fresh, "recovery_required");
  } catch (err) {
    deps.logger.error(
      { lifecycleId, err: err instanceof Error ? err.message : String(err) },
      "Failed to mark lifecycle recovery_required",
    );
  }
}

function assertNotSelfApproval(
  deps: RespondToParkedLifecycleDeps,
  params: RespondToParkedLifecycleParams,
  trace: WorkTrace,
): void {
  if (deps.selfApprovalAllowed) return;
  if (trace.actor.id === params.respondedBy) {
    throw new Error("Self-approval is not permitted");
  }
}

function workUnitFromTrace(trace: WorkTrace): WorkUnit {
  return {
    id: trace.workUnitId,
    requestedAt: trace.requestedAt,
    organizationId: trace.organizationId,
    actor: trace.actor,
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    deployment: trace.deploymentContext ?? {
      deploymentId: trace.deploymentId ?? "unresolved",
      skillSlug: trace.intent.split(".")[0] ?? "unknown",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: trace.mode,
    idempotencyKey: trace.idempotencyKey,
    parentWorkUnitId: trace.parentWorkUnitId,
    traceId: trace.traceId,
    trigger: trace.trigger,
    priority: "normal",
  };
}

async function recordLedger(
  ledger: AuditLedger | undefined,
  eventType: "action.approved" | "action.rejected",
  params: RespondToParkedLifecycleParams,
  lifecycle: LifecycleRecord,
  trace: WorkTrace | null,
): Promise<void> {
  if (!ledger) return;
  await ledger.record({
    eventType,
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "action",
    entityId: lifecycle.actionEnvelopeId,
    riskCategory: "medium",
    summary: `${eventType === "action.approved" ? "Parked action approved" : "Parked action rejected"} by ${params.respondedBy}`,
    snapshot: {
      lifecycleId: lifecycle.id,
      intent: trace?.intent ?? "unknown",
      ...(params.note ? { note: params.note } : {}),
    },
    envelopeId: lifecycle.actionEnvelopeId,
    traceId: trace?.traceId,
  });
}
```

Check `AuditLedger.record`'s exact input type and adjust field names if needed. Export all public names from `approval/index.ts`. Also verify `DispatchAdmissionError` is exported from the barrel (the route needs it in PR-3); if not, add it.

- [ ] **Step 4: db store methods** (`prisma-lifecycle-store.ts`):

```ts
  async listRecoveryRequiredLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    const rows = await this.prisma.approvalLifecycle.findMany({
      where: { status: "recovery_required", ...(organizationId ? { organizationId } : {}) },
    });
    return rows.map(toLifecycleRecord);
  }

  async countDispatchRecords(executableWorkUnitId: string): Promise<number> {
    return this.prisma.dispatchRecord.count({ where: { executableWorkUnitId } });
  }
```

Extend `prisma-lifecycle-store.test.ts` with two mocked-Prisma cases mirroring the file's existing style (assert where-clauses and mapped results).

- [ ] **Step 5:** `pnpm --filter @switchboard/core test -- respond-to-parked-lifecycle` PASS; `pnpm --filter @switchboard/db test -- prisma-lifecycle-store` PASS; cross-package `pnpm typecheck` PASS. Check `wc -l` on respond-to-parked-lifecycle.ts (target < 400).
- [ ] **Step 6: Commit** `feat(core,db): respondToParkedLifecycle with frozen-payload authority and dispatch recovery`
- [ ] **Step 7: PR-2.** Full gate, push, PR `feat(core,db): lifecycle-native approval respond path with dispatch recovery`, squash auto-merge, wait, fetch.

---

## PR-3: api wiring

Branch: `feat/parked-approvals-api` off updated origin/main.

### Task 7: summarizer cards

**Files:**

- Create: `apps/api/src/services/workflows/parked-approval-cards.ts`
- Test: `apps/api/src/services/workflows/__tests__/parked-approval-cards.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { summarizeParkedIntent } from "../parked-approval-cards.js";

describe("summarizeParkedIntent", () => {
  it("humanizes the Riley -> Mira handoff with rationale, campaign, evidence, brief", () => {
    const s = summarizeParkedIntent({
      intent: "adoptimizer.recommendation.handoff",
      organizationId: "org_dev",
      actorId: "system",
      parameters: {
        recommendationId: "rec_1",
        actionType: "refresh_creative",
        campaignId: "camp-42",
        rationale: "CTR halved while frequency climbed.",
        evidence: { clicks: 1000, conversions: 50, days: 7 },
        learningPhaseActive: false,
        brief: { productDescription: "Hydrafacial promo", targetAudience: "Local adults 25-45" },
      },
    });
    expect(s).not.toBeNull();
    expect(s!.humanSummary).toContain("camp-42");
    expect(s!.humanSummary).toContain("CTR halved");
    expect(s!.humanSummary).toMatch(/Riley/);
    expect(s!.humanSummary).toMatch(/Mira/);
    const flat = (s!.dataLines ?? []).map((l) => (Array.isArray(l) ? l.join(" ") : l)).join("\n");
    expect(flat).toContain("1000 clicks");
    expect(flat).toContain("Hydrafacial promo");
    expect(flat).toContain("Local adults 25-45");
    expect(s!.presentation?.primaryLabel).toBe("Approve handoff");
    expect(s!.riskContract).toMatchObject({ riskLevel: "medium", requiresConfirmation: true });
  });

  it("humanizes creative.job.publish as a paused no-spend Meta draft (review #9)", () => {
    const s = summarizeParkedIntent({
      intent: "creative.job.publish",
      organizationId: "org_dev",
      actorId: "user_1",
      parameters: { jobId: "job_9" },
    });
    expect(s).not.toBeNull();
    expect(s!.humanSummary).toContain("job_9");
    expect(s!.humanSummary.toLowerCase()).toContain("paused");
    expect(s!.humanSummary).toContain("will not spend");
    expect(s!.riskContract).toEqual({
      riskLevel: "high",
      externalEffect: true,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    });
  });

  it("returns null for intents without a bespoke card (default card upstream)", () => {
    expect(
      summarizeParkedIntent({
        intent: "conversation.reminder.send",
        organizationId: "org_dev",
        actorId: "system",
        parameters: {},
      }),
    ).toBeNull();
  });

  it("does not throw on malformed parameters (defensive reads)", () => {
    const s = summarizeParkedIntent({
      intent: "adoptimizer.recommendation.handoff",
      organizationId: "org_dev",
      actorId: "system",
      parameters: { campaignId: 42 },
    });
    expect(s).not.toBeNull();
    expect(typeof s!.humanSummary).toBe("string");
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement:**

```ts
import type {
  ParkedApprovalContext,
  ParkedApprovalSummarizer,
  ParkedApprovalSummary,
} from "@switchboard/core";

// Per-intent operator cards for parked governed-workflow approvals. Lives next
// to the workflow modules that own these parameter shapes (see
// recommendation-handoff-request.ts, creative-publish-workflow.ts). Reads are
// defensive: a malformed parameter never breaks the feed, it just degrades the
// copy. Intents without an entry get the adapter's default card (which fails
// closed toward caution).

function str(params: Record<string, unknown>, key: string): string | null {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function obj(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const handoffCard: ParkedApprovalSummarizer = ({ parameters }) => {
  const campaignId = str(parameters, "campaignId") ?? "an active campaign";
  const rationale = str(parameters, "rationale");
  const evidence = obj(parameters, "evidence");
  const brief = obj(parameters, "brief");
  const clicks = num(evidence, "clicks");
  const conversions = num(evidence, "conversions");
  const days = num(evidence, "days");

  const dataLines: Array<string | string[]> = [];
  if (clicks !== null && conversions !== null && days !== null) {
    dataLines.push(`Evidence: ${clicks} clicks, ${conversions} conversions over ${days} days`);
  }
  const product = str(brief, "productDescription");
  if (product) dataLines.push(`Brief: ${product}`);
  const audience = str(brief, "targetAudience");
  if (audience) dataLines.push(`Audience: ${audience}`);
  if (parameters["learningPhaseActive"] === true) {
    dataLines.push("Campaign is still in its learning phase");
  }

  return {
    humanSummary: rationale
      ? `Riley wants to brief Mira to refresh creative on campaign ${campaignId}: ${rationale}`
      : `Riley wants to brief Mira to refresh creative on campaign ${campaignId}.`,
    dataLines,
    presentation: { primaryLabel: "Approve handoff" },
    riskContract: {
      riskLevel: "medium",
      externalEffect: false,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    },
  };
};

const publishCard: ParkedApprovalSummarizer = ({ parameters }) => {
  const jobId = str(parameters, "jobId") ?? "a kept creative";
  return {
    humanSummary: `Mira wants to publish creative ${jobId} to Meta as a paused draft package. It will not spend until you activate it in Meta.`,
    dataLines: [
      "Publishes a PAUSED draft to the connected Meta ad account",
      "No spend until you activate it in Meta",
    ],
    presentation: { primaryLabel: "Approve publish" },
    riskContract: {
      riskLevel: "high",
      externalEffect: true,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    },
  };
};

const PARKED_INTENT_CARDS: Record<string, ParkedApprovalSummarizer> = {
  "adoptimizer.recommendation.handoff": handoffCard,
  "creative.job.publish": publishCard,
};

/** Single summarizer handed to adaptParkedApproval; null falls through to the default card. */
export function summarizeParkedIntent(ctx: ParkedApprovalContext): ParkedApprovalSummary | null {
  const card = PARKED_INTENT_CARDS[ctx.intent];
  return card ? card(ctx) : null;
}
```

- [ ] **Step 4:** PASS. **Commit** `feat(api): per-intent operator cards for parked workflow approvals`

### Task 8: decisions feed leg (sort-before-cap, degraded, recovery)

**Files:**

- Modify: `apps/api/src/routes/decisions.ts`
- Modify: `apps/api/src/__tests__/test-server.ts`
- Test: `apps/api/src/__tests__/api-decisions-parked.test.ts`

- [ ] **Step 1: test-server opt-in.** Add to `BuildTestServerOptions`:

```ts
  /**
   * Wire an in-memory ApprovalLifecycleService into PlatformIngress + app.
   * Opt-in so the legacy route-owned approval path (dev-no-DB production shape)
   * keeps its own coverage in api-approvals.test.ts.
   */
  lifecycle?: boolean;
```

In `buildTestServer`, before the `new PlatformIngress({...})`:

```ts
let lifecycleService: import("@switchboard/core").ApprovalLifecycleService | null = null;
if (options.lifecycle) {
  const { ApprovalLifecycleService, InMemoryLifecycleStore } = await import("@switchboard/core");
  lifecycleService = new ApprovalLifecycleService({ store: new InMemoryLifecycleStore() });
}
```

Pass `lifecycleService: lifecycleService ?? undefined` into the `PlatformIngress` config; after `app.decorate("workTraceStore", workTraceStore)` add `app.decorate("lifecycleService", lifecycleService);`.

- [ ] **Step 2: Failing feed test.** Helper `parkOne()` (propose `digital-ads.campaign.pause` as api-approvals.test.ts does, expecting `PENDING_APPROVAL`) and `makeBulkTrace(wu)` (minimal WorkTrace literal, organizationId "default"). Cases:

```ts
it("surfaces a parked lifecycle as a workflow_approval decision with bindingHash", async () => {
  const approval = await parkOne();
  const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const card = body.decisions.find(
    (d: { kind: string; sourceRef: { sourceId: string } }) =>
      d.kind === "workflow_approval" && d.sourceRef.sourceId === approval.id,
  );
  expect(card).toBeDefined();
  expect(card.meta.bindingHash).toBe(approval.bindingHash);
  expect(card.humanSummary).toContain("digital-ads.campaign.pause");
  expect(body.counts.approval).toBeGreaterThanOrEqual(1);
});

it("keeps the feed working when lifecycleService is absent", async () => {
  const bare = await buildTestServer();
  const res = await bare.app.inject({ method: "GET", url: "/api/dashboard/decisions" });
  expect(res.statusCode).toBe(200);
  expect(res.json().decisions).toEqual([]);
  await bare.app.close();
});

it("sorts by expiry BEFORE capping so urgent approvals are never hidden (review #6)", async () => {
  const svc = app.lifecycleService!;
  for (let i = 0; i < 27; i++) {
    const wu = `wu-bulk-${i}`;
    await app.workTraceStore!.persist(makeBulkTrace(wu));
    await svc.createGatedLifecycle({
      actionEnvelopeId: wu,
      organizationId: "default",
      expiresAt: new Date(Date.now() + (i === 26 ? 1 : 48 + i) * 3_600_000),
      initialRevision: {
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: `h-${i}`,
        createdBy: "system",
      },
    });
  }
  const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
  const cards = res
    .json()
    .decisions.filter((d: { kind: string }) => d.kind === "workflow_approval");
  expect(cards).toHaveLength(25);
  const urgent = cards.find(
    (c: { meta: { bindingHash?: string } }) => c.meta.bindingHash === "h-26",
  );
  expect(urgent).toBeDefined();
});

it("renders a degraded card when the trace is missing instead of skipping (review #5)", async () => {
  const svc = app.lifecycleService!;
  await svc.createGatedLifecycle({
    actionEnvelopeId: "wu-traceless",
    organizationId: "default",
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: {},
      approvalScopeSnapshot: {},
      bindingHash: "h-x",
      createdBy: "system",
    },
  });
  const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
  const card = res
    .json()
    .decisions.find((d: { humanSummary: string }) =>
      d.humanSummary.includes("could not be fully loaded"),
    );
  expect(card).toBeDefined();
});
```

NOTE on attribution: the propose path resolves the deployment via `resolveAuthoritativeDeployment(null)`; inspect what `deploymentContext.skillSlug` lands on the trace and assert the matching agentKey (riley if "digital-ads"); do not weaken bindingHash/humanSummary assertions.

- [ ] **Step 3:** FAIL. **Step 4: Implement.** Imports: `adaptParkedApproval, adaptDegradedParkedApproval` (from `@switchboard/core`), `summarizeParkedIntent` (relative `.js`). Helper:

```ts
const PARKED_FEED_CAP = 25;

async function listParkedApprovals(app: FastifyInstance, orgId: string): Promise<Decision[]> {
  if (!app.lifecycleService || !app.workTraceStore) return [];
  const actionable = await app.lifecycleService.listOperatorActionableLifecycles(orgId);
  // Review #6: sort by expiry BEFORE capping; never hide the most urgent.
  actionable.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  if (actionable.length > PARKED_FEED_CAP) {
    app.log.warn(
      {
        orgId,
        actionable: actionable.length,
        hidden: actionable.length - PARKED_FEED_CAP,
        cap: PARKED_FEED_CAP,
      },
      "Parked approval feed truncated",
    );
  }
  const decisions: Decision[] = [];
  for (const lifecycle of actionable.slice(0, PARKED_FEED_CAP)) {
    const [traceResult, revision] = await Promise.all([
      app.workTraceStore.getByWorkUnitId(lifecycle.actionEnvelopeId),
      app.lifecycleService.getCurrentRevision(lifecycle.id),
    ]);
    if (!traceResult?.trace || !revision) {
      // Review #5: governed work must never silently vanish from the operator.
      app.log.error(
        { lifecycleId: lifecycle.id, hasTrace: !!traceResult, hasRevision: !!revision },
        "Parked lifecycle integrity failure: rendering degraded card",
      );
      decisions.push(adaptDegradedParkedApproval(lifecycle));
      continue;
    }
    decisions.push(
      adaptParkedApproval(lifecycle, revision, traceResult.trace, summarizeParkedIntent),
    );
  }
  return decisions;
}
```

Fold into `listDecisions`'s `Promise.all` as a third leg; `decisions = [...recs.map(...), ...handoffs.map(...), ...parked]`; counts:

```ts
const counts = {
  total: filtered.length,
  approval: filtered.filter((d) => d.kind === "approval" || d.kind === "workflow_approval").length,
  handoff: filtered.filter((d) => d.kind === "handoff").length,
};
```

- [ ] **Step 5:** new + existing decisions tests PASS. **Commit** `feat(api): surface parked lifecycle approvals in the decisions feed`

### Task 9: respond route fallback + schema + deprecation

**Files:**

- Modify: `apps/api/src/validation.ts`
- Modify: `apps/api/src/routes/approvals.ts`
- Test: `apps/api/src/__tests__/api-approvals-lifecycle.test.ts`

- [ ] **Step 1: Failing route test** (`buildTestServer({ lifecycle: true })` + riskTolerance override + `parkOne()` helper as Task 8). Cases:

```ts
it("approves a lifecycle-parked unit and executes the real dispatch", async () => {
  const { workUnitId, approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "approve", respondedBy: "reviewer_1", bindingHash: approval.bindingHash },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.approvalState.status).toBe("approved");
  expect(body.executionResult.success).toBe(true);
  const traceResult = await app.workTraceStore!.getByWorkUnitId(workUnitId);
  expect(traceResult?.trace.outcome).toBe("completed");
  expect(traceResult?.trace.approvalOutcome).toBe("approved");
  expect(traceResult?.trace.approvalRespondedBy).toBe("reviewer_1");
  const feed = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
  expect(
    feed
      .json()
      .decisions.find(
        (d: { sourceRef: { sourceId: string } }) => d.sourceRef.sourceId === approval.id,
      ),
  ).toBeUndefined();
});

it("rejects a lifecycle-parked unit (no dispatch, trace failed)", async () => {
  const { workUnitId, approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "reject", respondedBy: "reviewer_1" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().approvalState.status).toBe("rejected");
  expect(res.json().executionResult).toBeNull();
  const traceResult = await app.workTraceStore!.getByWorkUnitId(workUnitId);
  expect(traceResult?.trace.outcome).toBe("failed");
  expect(traceResult?.trace.approvalOutcome).toBe("rejected");
});

it("refuses a stale bindingHash with 400 stale_binding", async () => {
  const { approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "approve", respondedBy: "reviewer_1", bindingHash: "wrong" },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe("stale_binding");
  expect(res.json().error.toLowerCase()).toContain("stale");
});

it("409s a second response with already_responded", async () => {
  const { approval } = await parkOne();
  await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "reject", respondedBy: "reviewer_1" },
  });
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "approve", respondedBy: "reviewer_1", bindingHash: approval.bindingHash },
  });
  expect(res.statusCode).toBe(409);
  expect(res.json().code).toBe("already_responded");
});

it("403s when the authenticated principal mismatches respondedBy", async () => {
  const { approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    headers: { "x-principal-id": "user_a" },
    payload: { action: "approve", respondedBy: "user_b", bindingHash: approval.bindingHash },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json().code).toBe("principal_mismatch");
});

it("derives respondedBy from the authenticated principal", async () => {
  const { workUnitId, approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    headers: { "x-principal-id": "reviewer_9" },
    payload: { action: "approve", bindingHash: approval.bindingHash },
  });
  expect(res.statusCode).toBe(200);
  const traceResult = await app.workTraceStore!.getByWorkUnitId(workUnitId);
  expect(traceResult?.trace.approvalRespondedBy).toBe("reviewer_9");
});

it("blocks the originator from approving their own action", async () => {
  const { approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "approve", respondedBy: "default", bindingHash: approval.bindingHash },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe("self_approval");
});

it("404s an unknown id (neither approval row nor lifecycle)", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/approvals/totally-unknown/respond",
    payload: { action: "approve", respondedBy: "r", bindingHash: "h" },
  });
  expect(res.statusCode).toBe(404);
});

it("400s patch on the lifecycle-native leg", async () => {
  const { approval } = await parkOne();
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: {
      action: "patch",
      respondedBy: "reviewer_1",
      bindingHash: approval.bindingHash,
      patchValue: { campaignId: "x" },
    },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe("patch_unsupported");
});

it("emits success:false (200) and a Retry card when dispatch fails post-approval", async () => {
  const { approval } = await parkOne();
  const spy = vi.spyOn(app.platformLifecycle, "executeApproved").mockResolvedValueOnce({
    success: false,
    summary: "boom",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
  });
  const res = await app.inject({
    method: "POST",
    url: `/api/approvals/${approval.id}/respond`,
    payload: { action: "approve", respondedBy: "reviewer_1", bindingHash: approval.bindingHash },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().executionResult.success).toBe(false);
  const feed = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
  const retry = feed
    .json()
    .decisions.find(
      (d: { sourceRef: { sourceId: string } }) => d.sourceRef.sourceId === approval.id,
    );
  expect(retry).toBeDefined();
  expect(retry.presentation.primaryLabel).toBe("Retry");
  expect(retry.meta.dispatchFailed).toBe(true);
  spy.mockRestore();
});
```

(The REAL dispatch-failure path is integration-covered in PR-5; the spy here pins the route + recovery read-model contract.)

- [ ] **Step 2:** FAIL (first test 404s). **Step 3: Implement.**

`validation.ts`:

```ts
export const ApprovalRespondBodySchema = z.object({
  action: z.enum(["approve", "reject", "patch"]),
  /**
   * Optional since the lifecycle-native leg: the route derives the responder
   * from the authenticated principal. When both are present they must match
   * (403 otherwise). Body fallback only when auth is disabled (dev/test).
   */
  respondedBy: z.string().min(1).max(500).optional(),
  /** Optional operator note recorded in the audit ledger snapshot. */
  note: z.string().max(2000).optional(),
  patchValue: z
    .record(z.string().max(200), z.unknown())
    .refine((obj) => JSON.stringify(obj).length <= 100_000, {
      message: "patchValue must be ≤ 100 KB when serialized",
    })
    .optional(),
  bindingHash: z.string().max(500).optional(),
});
```

`approvals.ts` respond handler, immediately after body parse (review #7; replaces the old in-place principal check, and the legacy `respondToApproval` call passes this derived `respondedBy`):

```ts
const authPrincipal = request.principalIdFromAuth;
let respondedBy: string;
if (authPrincipal) {
  if (body.respondedBy && body.respondedBy !== authPrincipal) {
    return reply.code(403).send({
      error: `Forbidden: authenticated principal '${authPrincipal}' cannot respond as '${body.respondedBy}'`,
      code: "principal_mismatch",
      statusCode: 403,
    });
  }
  respondedBy = authPrincipal;
} else if (app.authDisabled === true) {
  respondedBy = body.respondedBy ?? "default";
} else {
  return reply.code(403).send({
    error: "Forbidden: authenticated request has no principal binding",
    code: "no_principal",
    statusCode: 403,
  });
}
```

Replace the 404 branch:

```ts
const approval = await app.storageContext.approvals.getById(id);
if (!approval) {
  return respondViaParkedLifecycle(app, request, reply, {
    lifecycleId: id,
    action: body.action,
    respondedBy,
    bindingHash: body.bindingHash,
    note: body.note,
    selfApprovalAllowed,
  });
}
```

Module-scope helper (imports: `respondToParkedLifecycle`, the three Parked errors, `DispatchAdmissionError`, `StaleVersionError` from `@switchboard/core`; `FastifyInstance/FastifyRequest/FastifyReply` types):

```ts
async function respondViaParkedLifecycle(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    lifecycleId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash?: string;
    note?: string;
    selfApprovalAllowed: boolean;
  },
) {
  if (!app.lifecycleService || !app.workTraceStore) {
    return reply
      .code(404)
      .send({ error: "Approval not found", code: "not_found", statusCode: 404 });
  }
  const lifecycle = await app.lifecycleService.getLifecycleById(input.lifecycleId);
  if (!lifecycle) {
    return reply
      .code(404)
      .send({ error: "Approval not found", code: "not_found", statusCode: 404 });
  }
  if (!assertOrgAccess(request, lifecycle.organizationId, reply)) return;
  if (input.action === "patch") {
    return reply.code(400).send({
      error: "patch is not supported for lifecycle-native approvals",
      code: "patch_unsupported",
      statusCode: 400,
    });
  }
  if (input.action === "approve" && !input.bindingHash) {
    return reply.code(400).send({
      error: "bindingHash is required for approve actions",
      code: "binding_hash_required",
      statusCode: 400,
    });
  }
  try {
    const result = await respondToParkedLifecycle(
      {
        lifecycleService: app.lifecycleService,
        workTraceStore: app.workTraceStore,
        platformLifecycle: app.platformLifecycle,
        auditLedger: app.auditLedger,
        logger: app.log,
        selfApprovalAllowed: input.selfApprovalAllowed,
      },
      {
        lifecycleId: input.lifecycleId,
        action: input.action,
        respondedBy: input.respondedBy,
        bindingHash: input.bindingHash,
        note: input.note,
      },
    );
    return reply.code(200).send({
      envelope: null,
      approvalState: result.approvalState,
      executionResult: result.executionResult,
    });
  } catch (err) {
    if (err instanceof ParkedLifecycleNotFoundError) {
      return reply
        .code(404)
        .send({ error: "Approval not found", code: "not_found", statusCode: 404 });
    }
    if (err instanceof ParkedLifecycleAlreadyRespondedError) {
      return reply.code(409).send({
        error: sanitizeErrorMessage(err, 409),
        code: "already_responded",
        statusCode: 409,
      });
    }
    if (err instanceof ParkedLifecycleExpiredError) {
      return reply
        .code(409)
        .send({ error: sanitizeErrorMessage(err, 409), code: "expired", statusCode: 409 });
    }
    if (err instanceof StaleVersionError) {
      return reply.code(409).send({
        error: "Conflict: approval is being responded to concurrently",
        code: "conflict",
        statusCode: 409,
      });
    }
    if (err instanceof DispatchAdmissionError) {
      return reply
        .code(409)
        .send({ error: sanitizeErrorMessage(err, 409), code: "admission_failed", statusCode: 409 });
    }
    const message = err instanceof Error ? err.message : "Approval response failed";
    const code = /stale binding/i.test(message)
      ? "stale_binding"
      : /self-approval/i.test(message)
        ? "self_approval"
        : "respond_failed";
    return reply.code(400).send({ error: sanitizeErrorMessage(err, 400), code, statusCode: 400 });
  }
}
```

Verify `sanitizeErrorMessage` preserves these messages (check `error-sanitizer.ts`; if it redacts, return raw `err.message` for the typed errors). Add the DEPRECATED comment + OpenAPI description prefix on `GET /pending` (review #8):

```ts
// DEPRECATED (2026-06-04): reads the legacy in-memory ApprovalStore, which is
// EMPTY for lifecycle-parked units (production). The operator surface for
// parked approvals is the decisions feed (GET /api/dashboard/decisions).
// Kept for the dev-no-DB legacy path until migrated to
// lifecycleService.listPendingLifecycles() or retired.
```

- [ ] **Step 4:** new suite PASS; legacy `api-approvals.test.ts` PASS unchanged (runs without `lifecycle: true`). `wc -l apps/api/src/routes/approvals.ts` (target < 400).
- [ ] **Step 5: Commit** `feat(api): lifecycle-native respond leg with structured errors and recovery surfacing`
- [ ] **PR-3.** Full gate, push, PR, squash auto-merge, wait, fetch.

---

## PR-4: dashboard

Branch: `feat/parked-approvals-dashboard` off updated origin/main. Dashboard imports OMIT `.js`.

### Task 10: types + client + hook

**Files:**

- Modify: `apps/dashboard/src/lib/decisions/types.ts`
- Modify: `apps/dashboard/src/lib/api-client/governance.ts`
- Create: `apps/dashboard/src/hooks/use-workflow-approval-action.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-workflow-approval-action.test.tsx`

- [ ] **Step 1: Types.** `DecisionKind` + `"workflow_approval"`; meta additions:

```ts
    /** Workflow approvals only: revision bindingHash echoed back on approve. */
    bindingHash?: string;
    /** Workflow approvals only: approved but dispatch failed; primary action is Retry. */
    dispatchFailed?: boolean;
```

`governance.ts` `respondToApproval` body type:

```ts
    body: {
      action: string;
      respondedBy?: string;
      bindingHash?: string;
      note?: string;
      patchValue?: unknown;
    },
```

- [ ] **Step 2: Failing hook test.** Mirror the wrapper/session-mock setup of `use-review-decision.test.tsx` (read it first). Cases: approve POSTs `{approvalId, action:"approve", bindingHash, note}` and NO respondedBy key; reject POSTs `{approvalId, action:"reject"}`; 409 body `{code:"already_responded"}` -> resolves `{silent:true}`; 400 body `{code:"stale_binding"}` -> resolves `{staleBinding:true}`; 400 body `{error:"stale approval", code:"respond_failed"}` -> rejects with "stale approval"; `approve("")` rejects locally and `fetch` is NOT called.

- [ ] **Step 3:** FAIL. **Step 4: Implement:**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

interface RespondInput {
  action: "approve" | "reject";
  bindingHash?: string;
  note?: string;
}

export interface WorkflowApprovalSettled {
  silent?: boolean;
  staleBinding?: boolean;
  body?: unknown;
}

/**
 * Approve/reject a parked governed-workflow approval (an ApprovalLifecycle id)
 * through the dashboard approvals proxy -> POST /api/approvals/:id/respond.
 * respondedBy is NEVER sent: the API derives it from the authenticated
 * principal (review #7). Error handling branches on the API's structured code:
 *  - already_responded | expired -> silent success (someone settled it; refetch clears)
 *  - stale_binding -> staleBinding flag (caller shows "This approval changed. Refreshing.")
 *  - anything else -> thrown Error with the server message
 */
export function useWorkflowApprovalAction(lifecycleId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const invalidate = () => {
    if (keys) {
      void queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
      void queryClient.invalidateQueries({ queryKey: keys.audit.all() });
    }
  };

  const respond = useMutation({
    mutationFn: async (input: RespondInput): Promise<WorkflowApprovalSettled | unknown> => {
      if (input.action === "approve" && !input.bindingHash) {
        throw new Error(
          "This approval is missing its integrity record and cannot be approved from here.",
        );
      }
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: lifecycleId,
          action: input.action,
          ...(input.bindingHash !== undefined ? { bindingHash: input.bindingHash } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        }),
      });
      if (res.ok) return res.json();
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (body.code === "already_responded" || body.code === "expired") {
        return { silent: true, body };
      }
      if (body.code === "stale_binding") {
        invalidate();
        return { staleBinding: true, body };
      }
      throw new Error(body.error ?? `Approval action failed (HTTP ${res.status})`);
    },
    onSuccess: invalidate,
  });

  return {
    approve: (bindingHash: string, note?: string) =>
      respond.mutateAsync({ action: "approve", bindingHash, note }),
    reject: (note?: string) => respond.mutateAsync({ action: "reject", note }),
    isPending: respond.isPending,
    error: respond.error,
  };
}
```

(Check `keys.audit.all()` exists in `lib/query-keys.ts`; drop that invalidation if absent. NOTE: the dashboard proxy forwards `{ approvalId, ...rest }` body via `client.respondToApproval` already; no proxy change needed.)

- [ ] **Step 5:** PASS. **Commit** `feat(dashboard): workflow approval action hook + decision type widening`

### Task 11: inbox item + screen + sheet wiring

**Files:**

- Create: `apps/dashboard/src/components/inbox/inbox-workflow-approval-item.tsx`
- Modify: `apps/dashboard/src/components/inbox/inbox-screen.tsx`
- Test: `apps/dashboard/src/components/inbox/__tests__/inbox-workflow-approval-item.test.tsx`
- Test: extend `apps/dashboard/src/components/inbox/__tests__/inbox-screen.test.tsx`

- [ ] **Step 1: Failing item test** (mirror inbox-decision-item.test.tsx setup):

```tsx
const decision: Decision = {
  id: "workflow_approval:lc-1",
  kind: "workflow_approval",
  agentKey: "riley",
  humanSummary: "Riley wants to brief Mira to refresh creative on campaign camp-1: CTR halved.",
  presentation: {
    primaryLabel: "Approve handoff",
    secondaryLabel: "Not now",
    dismissLabel: "Reject",
    dataLines: ["Evidence: 1000 clicks, 50 conversions over 7 days"],
  },
  urgencyScore: 55,
  createdAt: new Date().toISOString(),
  threadHref: null,
  sourceRef: { kind: "workflow_approval", sourceId: "lc-1" },
  meta: {
    bindingHash: "hash-1",
    riskLevel: "medium",
    riskContract: {
      riskLevel: "medium",
      externalEffect: false,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    },
  },
};

it("renders the humanized card and opens detail on tap", () => {
  const onOpenDetail = vi.fn();
  render(<InboxWorkflowApprovalItem decision={decision} onOpenDetail={onOpenDetail} />);
  expect(screen.getByText(/Riley wants to brief Mira/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Riley wants to brief Mira/));
  expect(onOpenDetail).toHaveBeenCalledWith(decision);
});

it("never exposes a swipe-approve zone (requiresConfirmation contract)", () => {
  render(<InboxWorkflowApprovalItem decision={decision} onOpenDetail={vi.fn()} />);
  expect(screen.getByText("Tap to review")).toBeInTheDocument();
  expect(screen.queryByText("Send")).not.toBeInTheDocument();
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement the wrapper:**

```tsx
"use client";

import { InboxDecisionCard } from "@/components/inbox/inbox-decision-card";
import type { Decision } from "@/lib/decisions/types";
import type { AgentKey } from "@switchboard/schemas";

export interface InboxWorkflowApprovalItemProps {
  decision: Decision;
  onOpenDetail: (decision: Decision) => void;
  onOpenAgent?: (agentKey: AgentKey) => void;
}

/**
 * Queue row for a parked governed-workflow approval. Unlike recommendation
 * approvals there is NO swipe-commit path: approve needs the bindingHash +
 * confirm flow in the detail sheet, and "skip" has no server meaning for a
 * blocking governed approval. Every gesture routes to the detail sheet (the
 * conservative riskContract already blocks swipe-approve; routing onApprove /
 * onSkip to detail is defense in depth, and swipe-left must never fire the
 * recommendation responder with a lifecycle id).
 */
export function InboxWorkflowApprovalItem({
  decision,
  onOpenDetail,
  onOpenAgent,
}: InboxWorkflowApprovalItemProps) {
  const openDetail = () => onOpenDetail(decision);
  return (
    <InboxDecisionCard
      decision={decision}
      onApprove={openDetail}
      onSkip={openDetail}
      onOpenDetail={openDetail}
      onTakeOver={openDetail}
      onOpenAgent={onOpenAgent}
    />
  );
}
```

- [ ] **Step 4: Screen wiring.** Add `WorkflowApprovalDetailItem` below `ApprovalDetailItem` in `inbox-screen.tsx` (import `useWorkflowApprovalAction` from `@/hooks/use-workflow-approval-action`, `InboxWorkflowApprovalItem` from `@/components/inbox/inbox-workflow-approval-item`):

```tsx
function WorkflowApprovalDetailItem({ decision, onClose }: ApprovalDetailItemProps) {
  const { toast } = useToast();
  const action = useWorkflowApprovalAction(decision.sourceRef.sourceId);
  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;
  const retrying = decision.meta.dispatchFailed === true;

  const handleCommit = (note?: string) => {
    if (action.isPending) return;
    const bindingHash = decision.meta.bindingHash;
    if (!bindingHash) {
      toast({
        title: "Can't approve from here",
        description: "This approval is missing its integrity record. You can still reject it.",
      });
      return;
    }
    void action
      .approve(bindingHash, note)
      .then((result: unknown) => {
        onClose();
        if (result && typeof result === "object" && "silent" in result) return;
        if (result && typeof result === "object" && "staleBinding" in result) {
          toast({ title: "This approval changed.", description: "Refreshing the inbox." });
          return;
        }
        const ok =
          result && typeof result === "object" && "executionResult" in result
            ? (result as { executionResult?: { success?: boolean } }).executionResult?.success !==
              false
            : true;
        toast(
          ok
            ? { title: retrying ? "Retried" : "Approved", description: `${agentName} is on it.` }
            : {
                title: "Approved, but it didn't run",
                description: "It's back in your inbox with a Retry.",
              },
        );
      })
      .catch((err: unknown) => {
        toast({
          title: "Couldn't approve",
          description: err instanceof Error ? err.message : "Try again from the inbox.",
        });
      });
  };

  const handleReject = () => {
    if (action.isPending) return;
    void action
      .reject()
      .then(() => {
        onClose();
        toast({ title: "Rejected", description: `${agentName} won't run this.` });
      })
      .catch((err: unknown) => {
        toast({
          title: "Couldn't reject",
          description: err instanceof Error ? err.message : "Try again from the inbox.",
        });
      });
  };

  return (
    <ApprovalDetailSheet
      decision={decision}
      onClose={onClose}
      onCommit={handleCommit}
      onSecondary={onClose}
      onDismiss={handleReject}
    />
  );
}
```

Queue map branch:

```tsx
{
  decisions.map((d) =>
    d.kind === "workflow_approval" ? (
      <InboxWorkflowApprovalItem
        key={d.id}
        decision={d}
        onOpenDetail={(dec) => setOpen({ decision: dec, kind: dec.kind })}
        onOpenAgent={setPanelAgent}
      />
    ) : (
      <InboxDecisionItem
        key={d.id}
        decision={d}
        onOpenDetail={(dec) => setOpen({ decision: dec, kind: dec.kind })}
        onOpenAgent={setPanelAgent}
      />
    ),
  );
}
```

Detail layer:

```tsx
{
  open?.kind === "workflow_approval" && (
    <WorkflowApprovalDetailItem decision={open.decision} onClose={() => setOpen(null)} />
  );
}
```

- [ ] **Step 5: Extend `inbox-screen.test.tsx`** (follow its existing feed/fetch mocking): a `workflow_approval` decision renders; opening it and confirming approve POSTs `/api/dashboard/approvals` with `bindingHash: "hash-1"` (requiresConfirmation forces the confirm step); "Reject" POSTs `action: "reject"`; a `dispatchFailed: true` decision shows primary label "Retry"; a missing-bindingHash decision shows the "Can't approve from here" toast and fires NO fetch.

- [ ] **Step 6:** `pnpm --filter dashboard test -- inbox && pnpm --filter dashboard test -- use-workflow-approval-action && pnpm --filter dashboard build` (build catches import-extension mistakes vitest hides).
- [ ] **Step 7: Commit** `feat(dashboard): parked workflow approvals operable from the inbox`
- [ ] **PR-4.** Full gate, push, PR, squash auto-merge, wait, fetch.

---

## PR-5: integration proof

Branch: `test/parked-approvals-integration` off updated origin/main.

### Task 12: harness extraction + approval-loop test

**Files:**

- Create: `apps/api/src/__tests__/recommendation-handoff-harness.ts`
- Modify: `apps/api/src/__tests__/recommendation-handoff-cron-full-loop.test.ts`
- Test: `apps/api/src/__tests__/recommendation-handoff-approval-loop.test.ts`

- [ ] **Step 1: Extract the harness** (byte-equivalent logic) into `recommendation-handoff-harness.ts`, exporting: `ORG`, deployment/listing ids, `systemSpec`, `allowPolicy`, `approvalPolicy`, `inMemoryTraceStore`, `deploymentResolver`, `handoffRegistration`, `creativeDraftRegistration`, `CreativeJobRow`, `buildCreativeStores`, `FullLoopHarness`, `buildHarness`, insight/crm/synthetic helpers, `step`, `ParkedHandoff`, `buildCronDeps`, `readerFor`. Changes while extracting:
  - `buildHarness(policies, opts?: { lifecycleService?: ApprovalLifecycleService })` threads `lifecycleService` into the `PlatformIngress` config.
  - The harness object additionally exposes `traceStore` (capture the `inMemoryTraceStore()` instance) and `breakHandoffHandlerOnce()`: wraps the registered handoff handler in a delegate whose FIRST `execute` returns `{ outcome: "failed", summary: "synthetic dispatch failure", outputs: {}, mode: "workflow", durationMs: 0, traceId: workUnit.traceId, workUnitId: workUnit.id, error: { code: "SYNTHETIC", message: "synthetic dispatch failure" } }` then delegates thereafter (match the `ExecutionResult` shape `WorkflowMode` returns; verify against `execution-result.ts`).
  - The full-loop test imports everything from `./recommendation-handoff-harness.js`; its three tests stay verbatim.

Run: `pnpm --filter api test -- recommendation-handoff-cron-full-loop` -> PASS (pure extraction).
Commit: `refactor(api): extract recommendation-handoff full-loop harness for reuse`

- [ ] **Step 2: Failing approval-loop test** (`recommendation-handoff-approval-loop.test.ts`). Header comment: closes the loop #861 left open: the parked handoff is approved through the REAL ApprovalLifecycleService + respondToParkedLifecycle + REAL PlatformLifecycle.executeApproved over the REAL ExecutionModeRegistry; no hand-called handler. `buildLifecycleWorld()`:

```ts
function buildLifecycleWorld() {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const harness = buildHarness([allowPolicy(), approvalPolicy()], { lifecycleService });
  const storage = createInMemoryStorage();
  const ledger = new AuditLedger(new InMemoryLedgerStorage());
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry: harness.modeRegistry,
    traceStore: harness.traceStore,
    ledger,
    trustAdapter: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
  });
  const logger = { info: () => {}, error: () => {} };
  const deps = () => ({
    lifecycleService,
    workTraceStore: harness.traceStore,
    platformLifecycle,
    auditLedger: ledger,
    logger,
  });
  return { store, lifecycleService, harness, platformLifecycle, ledger, logger, deps };
}
```

(Verify `createInMemoryStorage`, `AuditLedger`, `InMemoryLedgerStorage` import names against how test-server.ts imports them; `PlatformLifecycle` from `@switchboard/core/platform`.) Tests:

1. **Happy path:** `executeWeeklyAudit` -> exactly one parked submit with `lifecycleId` + `bindingHash` on the response; feed-leg composition (`adaptParkedApproval(lifecycle, revision, trace, summarizeParkedIntent)`) yields kind `workflow_approval`, agentKey `riley`, humanSummary containing `camp-1` and matching `/Riley wants to brief Mira/`, `meta.bindingHash === bindingHash`; `respondToParkedLifecycle` approve (respondedBy `operator_jane`) -> `executionResult.success === true`, `harness.jobs` length 1, job surfaces via `readerFor(harness.jobs).read(ORG, ...)` with title `synthesizeCreativeBrief(null).productDescription`, trace outcome `completed` + approvalOutcome `approved`, lifecycle `approved`, exactly one DispatchRecord `succeeded`.
2. **Reject:** no job, lifecycle `rejected`, trace `failed`.
3. **Dispatch failure -> Retry (review #3):** `breakHandoffHandlerOnce()`; first approve -> `executionResult.success === false`, lifecycle `recovery_required`, 0 jobs; the feed card composed from the same adapters has primaryLabel `Retry` + `meta.dispatchFailed === true`; second approve (same respond leg) -> success true, 1 job, lifecycle `approved`, two DispatchRecords with attemptNumbers 1 and 2, second `succeeded`.
4. **Self-approval:** respondedBy `system` -> rejects with /self-approval/i.

- [ ] **Step 3:** make it PASS (only harness/wiring fixes; product code shipped in PR-1..3).

- [ ] **Step 4: Mutation checks (load-bearing proof).** Temporarily break each, confirm the named assertion FAILS, restore:
  1. Harness: rename the registered handler key `"adoptimizer.recommendation.handoff"` -> append `"_X"` (expect: approve's success assertion fails with WORKFLOW_NOT_REGISTERED-driven failure).
  2. Core (local edit, not committed): skip the `executeApproved` call in `runDispatch` (expect: jobs length 0).
  3. Cards: drop the campaign id from the handoff summary (expect: humanSummary assertion fails).
  4. Core (local edit): skip the frozen-parameters trace write (expect: PR-2's revision-authority unit test fails: run `pnpm --filter @switchboard/core test -- respond-to-parked-lifecycle`).

- [ ] **Step 5: Commit** `test(api): full-loop proof for parked handoff surfacing, real approve, dispatch recovery`
- [ ] **PR-5.** Full gate, push, PR, squash auto-merge, wait, fetch.

---

## Docs PR (precedes PR-1)

Branch `docs/parked-approvals-spec` off origin/main carrying ONLY the spec + this plan; squash auto-merge. The implementation worktree rebases after it lands (taking main's copy on add/add).

## Final teardown

After PR-5 merges: confirm each squash is an ancestor of origin/main (`git merge-base --is-ancestor <sha> origin/main`), `git fetch origin main:main`, `git worktree remove` + prune, delete local AND remote branches (all five + docs). Final report per the brief.

## Self-review notes

- Review blockers mapped: #1/#4 -> Task 6 frozen-payload trace write + 14A test + spec 4.1/4.2 contract comment; #2 -> Task 3 DEFAULT_RISK + 14C test; #3 -> Tasks 6 (recovery transition + retry), 8 (feed lists recovery), 9 (route 200-with-failure + Retry card test), 11 (Retry UX), 12 (integration failure leg) + 14B tests; #5 -> degraded card Tasks 3/8; #6 -> sort-before-cap Task 8; #7 -> identity derivation Task 9 + hook never sends respondedBy Task 10; #8 -> deprecation Task 9; #9 -> publish risk/copy Task 7; #10 -> rich default card Task 3; #11 -> structured codes Tasks 9/10; #12 -> five sequential PRs; #13 -> docstring Task 4; #14A/B/C -> Tasks 6/6+9+12/3.
- Type consistency: `transitionStatus`/`countDispatchAttempts`/`listOperatorActionableLifecycles` (Task 5) used in Tasks 6/8; `listRecoveryRequiredLifecycles`/`countDispatchRecords` (Task 4 interface) implemented Task 4 (memory) + Task 6 (prisma); `dispatchFailed` meta Tasks 1/3/9/10/11/12; attempt-keyed idempotency Tasks 6/12; `ParkedLifecycleLike.status` Tasks 3/6.
