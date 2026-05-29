# Riley Wave B PR-1 — WorkTrace Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the dual-write infrastructure that lets `emitRecommendation` persist a canonical `WorkTrace` row alongside the existing `Recommendation` row, transactionally, with a new `ingressPath = "agent_recommendation_emission"` enum value. Zero cockpit UI changes; zero production-emitter wiring (production emitter wiring is intentionally out of scope — see §Scope note).

**Architecture:** A new core-layer interface `RecommendationEmissionMirror` exposes a single `recordEmission({ recommendationInsert, workTrace })` method that commits both writes atomically. Layer-4 (`packages/db`) implements it via `prisma.$transaction`. `emitRecommendation` accepts an optional `mirror` option; when present, it builds the WorkTrace alongside the existing PersistRecommendationInput and routes both through the mirror. When absent, falls back to the existing single-write path. The Prisma `WorkTrace.ingressPath` Postgres enum gains one new value (`"agent_recommendation_emission"`); no other schema changes.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Prisma 5 + PostgreSQL, Vitest, Zod. `.js` extensions in relative imports (per `CLAUDE.md`, except in `apps/dashboard`).

**Parent specs:**

- [`docs/superpowers/specs/2026-05-16-riley-wave-b-slicing-design.md`](../specs/2026-05-16-riley-wave-b-slicing-design.md) — Wave B slicing (PR-1..6 sequence + WorkTrace field mapping). **Authoritative.**
- [`docs/superpowers/specs/2026-05-14-riley-agent-infra-parity-design.md`](../specs/2026-05-14-riley-agent-infra-parity-design.md) — Wave B acceptance criteria.

> **The slicing spec is authoritative.** If anything in this implementation plan appears to expand PR-1's scope beyond the slicing spec — production emitter wiring, executor changes, cockpit UI work, learning-memory integration — the slicing spec wins and the conflicting text in this plan is wrong. Resolve in favor of the slicing spec and flag the discrepancy.

---

## Scope note — production emitter is NOT wired today

A pre-implementation audit found that the Riley `recommendation-sink` emitter is referenced **only inside `packages/ad-optimizer/`** (see `audit-runner.ts:188-200, 503-509`). `apps/api/src/bootstrap/inngest.ts` constructs `AuditRunner` without a `recommendationEmitter`, so the production cron path does NOT call `emitRecommendation` today. Consequence: no Riley `Recommendation` rows are written by production code; the cockpit reads from seed data.

**Implication for PR-1:**

- PR-1 ships the dual-write infrastructure and exercises it through tests + the existing test fixtures that DO call `emitRecommendation` directly (eight test sites in `apps/api` and `packages/core`).
- PR-1 does NOT wire the production emitter. That decision (when to enable Riley to start writing recommendations from production cron runs) is its own scope and warrants its own PR + review. Bundling it into PR-1 would conflate "infrastructure landing" with "production traffic enablement."
- The substrate-symmetry invariant in the slicing spec (acceptance criterion 7: WorkTrace count == Recommendation count for Riley emissions) holds trivially after PR-1 deploys (both counts remain 0 from production until a future wiring PR). The invariant is verified meaningfully by tests that DO call `emitRecommendation`.

This is consistent with how Alex's PR-3 sequence shipped — the substrate landed before the activating wiring.

---

## File Structure

**Files created:**

- `packages/core/src/recommendations/emission-mirror.ts` — `RecommendationEmissionMirror` interface + the WorkTrace-builder helper specific to Riley emissions.
- `packages/core/src/recommendations/__tests__/emission-mirror.test.ts` — interface contract tests (pure-function tests on the WorkTrace builder).
- `packages/core/src/recommendations/__tests__/emit-mirror.test.ts` — `emitRecommendation` dual-write integration tests (in-memory mirror).
- `packages/core/src/recommendations/in-memory-emission-mirror.ts` — in-memory `RecommendationEmissionMirror` implementation for tests + dev.
- `packages/db/src/stores/prisma-recommendation-emission-mirror.ts` — production Prisma mirror that opens `prisma.$transaction` and writes both rows.
- `packages/db/src/stores/__tests__/prisma-recommendation-emission-mirror.test.ts` — Prisma-mock-based unit tests (mirrors existing `prisma-workflow-store.test.ts` pattern; no real Postgres per `feedback_api_test_mocked_prisma`).

**Files modified:**

- `packages/core/src/recommendations/emit.ts` — accept `options?: { mirror?: RecommendationEmissionMirror; now?: () => Date }`; route through mirror when present.
- `packages/core/src/recommendations/index.ts` — export `RecommendationEmissionMirror`, `createInMemoryEmissionMirror`, `buildRileyEmissionWorkTrace`.
- `packages/core/src/platform/work-trace.ts` — extend `ingressPath` union with `"agent_recommendation_emission"`.
- `packages/schemas/src/work-trace.ts` (or wherever `WorkTraceIngressPathSchema` lives) — extend the Zod enum.
- `packages/db/prisma/schema.prisma` — extend the Postgres `WorkTraceIngressPath` enum with `agent_recommendation_emission`.
- `packages/db/prisma/migrations/<TIMESTAMP>_add_agent_recommendation_emission_ingress_path/migration.sql` — generated via `prisma migrate diff --from-empty --to-schema-datamodel --script` then trimmed to the single `ALTER TYPE` statement.
- `packages/db/src/index.ts` — export `PrismaRecommendationEmissionMirror`.

**Files explicitly NOT modified:**

- `apps/dashboard/**` — adapter boundary holds; cockpit unchanged.
- `apps/api/src/bootstrap/inngest.ts` — production wiring out of scope (see §Scope note).
- `packages/ad-optimizer/**` — emitter is injected from outside; ad-optimizer doesn't change.
- `packages/core/src/platform/work-trace-hash.ts` — v2 hash input already includes `ingressPath`; new enum value is purely additive.
- `packages/core/src/platform/types.ts` — reusing existing `mode = "pipeline"` and `outcome = "pending_approval" | "completed"`; no new enum values.

---

## Precondition checks

Before starting Task 1, verify:

```bash
cd ~/switchboard
git status --short    # working tree clean
git branch --show-current    # confirms working branch (e.g., feat/riley-wave-b-pr1)
git log --oneline -3
```

Verify the slicing-design spec is on `main`:

```bash
ls docs/superpowers/specs/2026-05-16-riley-wave-b-slicing-design.md
# Expected: file exists
```

Verify substrate references the plan depends on still exist:

```bash
grep -n "interface WorkTraceStore" packages/core/src/platform/work-trace-recorder.ts
grep -n "ingressPath" packages/core/src/platform/work-trace.ts
grep -n "ingressPath" packages/db/prisma/schema.prisma
grep -n "computeWorkTraceContentHash" packages/core/src/platform/work-trace-hash.ts
```

All four should return matches. If any is missing, the substrate has shifted since the plan was written — re-read the substrate and amend the plan before proceeding.

---

## Task 1: Extend `ingressPath` enum in core types

**Files:**

- Modify: `packages/core/src/platform/work-trace.ts`

- [ ] **Step 1: Read the current `ingressPath` declaration**

```bash
grep -n "ingressPath" packages/core/src/platform/work-trace.ts
```

Expected: a union type field `ingressPath: "platform_ingress" | "store_recorded_operator_mutation"`.

- [ ] **Step 2: Extend the union with the new value**

In `packages/core/src/platform/work-trace.ts`, change:

```ts
ingressPath: "platform_ingress" | "store_recorded_operator_mutation";
```

to:

```ts
/**
 * Discriminator: how the row entered persistence.
 * - "platform_ingress": persisted by PlatformIngress.submit() after governance evaluation.
 * - "store_recorded_operator_mutation": persisted by a Store as an operator mutation;
 *   the row did NOT pass through PlatformIngress and matches none of the standard
 *   governance modes. See ConversationStateStore (packages/core/src/platform/
 *   conversation-state-store.ts) for the writer of this kind.
 * - "agent_recommendation_emission": persisted alongside a Recommendation row by an
 *   agent-side scheduled emission (see emitRecommendation when called with a mirror).
 *   These are advisory writes — they do NOT pass through PlatformIngress and do NOT
 *   execute a tool. The corresponding executor traces, when an operator approves,
 *   land separately as "platform_ingress" rows in Wave B PR-2.
 * Defaults to "platform_ingress" on existing rows via the DB column default.
 */
ingressPath: "platform_ingress" |
  "store_recorded_operator_mutation" |
  "agent_recommendation_emission";
```

(Replace the existing JSDoc block too — keep both old descriptions plus the new one.)

- [ ] **Step 3: Typecheck core**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/platform/work-trace.ts
git commit -m 'chore(core): extend WorkTrace ingressPath with agent_recommendation_emission'
```

---

## Task 2: Extend `ingressPath` Zod schema in @switchboard/schemas

**Files:**

- Modify: the file under `packages/schemas/src/` that exports the `WorkTraceIngressPath` Zod enum (locate via `grep -nl "store_recorded_operator_mutation" packages/schemas/src`).

- [ ] **Step 1: Locate the Zod enum**

```bash
grep -nl "store_recorded_operator_mutation" packages/schemas/src
```

Expected: one file (e.g., `packages/schemas/src/work-trace.ts`).

- [ ] **Step 2: Read the current Zod enum definition**

```bash
grep -n "ingressPath\|WorkTraceIngressPath" <the file from step 1>
```

- [ ] **Step 3: Add the new value to the Zod enum**

If the enum looks like:

```ts
export const WorkTraceIngressPathSchema = z.enum([
  "platform_ingress",
  "store_recorded_operator_mutation",
]);
```

Change to:

```ts
export const WorkTraceIngressPathSchema = z.enum([
  "platform_ingress",
  "store_recorded_operator_mutation",
  "agent_recommendation_emission",
]);
```

- [ ] **Step 4: Typecheck schemas**

```bash
pnpm --filter @switchboard/schemas typecheck
```

Expected: clean.

- [ ] **Step 5: Run the schemas test suite**

```bash
pnpm --filter @switchboard/schemas test
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/<the file>
git commit -m 'chore(schemas): extend WorkTraceIngressPath enum with agent_recommendation_emission'
```

---

## Task 3: Extend Prisma `WorkTraceIngressPath` enum + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<TIMESTAMP>_add_agent_recommendation_emission_ingress_path/migration.sql`

- [ ] **Step 1: Locate the Prisma enum**

```bash
grep -n "ingressPath\|WorkTraceIngressPath\|enum.*Ingress" packages/db/prisma/schema.prisma
```

- [ ] **Step 2: Add the new value to the Prisma enum**

In `packages/db/prisma/schema.prisma`, locate the `enum WorkTraceIngressPath { ... }` block (or the `@@map`-flavored equivalent — match the actual code you found in step 1) and add:

```prisma
enum WorkTraceIngressPath {
  platform_ingress
  store_recorded_operator_mutation
  agent_recommendation_emission
}
```

(Match the exact existing formatting and comments.)

- [ ] **Step 3: Generate the migration SQL via diff**

Per `feedback_prisma_migrate_dev_tty`, do NOT use `prisma migrate dev` — it blocks on TTY in agent sessions. Instead:

```bash
cd packages/db
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TIMESTAMP}_add_agent_recommendation_emission_ingress_path"
pnpm exec prisma migrate diff \
  --from-url "${DATABASE_URL}" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/${TIMESTAMP}_add_agent_recommendation_emission_ingress_path/migration.sql"
```

If `DATABASE_URL` is not set or Postgres is unavailable, use the empty-baseline form:

```bash
pnpm exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Then hand-trim the resulting SQL down to just the single `ALTER TYPE "WorkTraceIngressPath" ADD VALUE 'agent_recommendation_emission';` statement (delete every other statement — the empty-baseline diff regenerates the entire schema).

The final `migration.sql` file should contain only:

```sql
-- AlterEnum
ALTER TYPE "WorkTraceIngressPath" ADD VALUE 'agent_recommendation_emission';
```

- [ ] **Step 4: Verify drift check passes**

If a local Postgres is available (`DATABASE_URL` set + reachable):

```bash
cd ~/switchboard
pnpm db:check-drift
```

Expected: no drift (schema matches migration history).

If no local Postgres, skip drift check; CI will run it post-push.

- [ ] **Step 5: Regenerate Prisma client**

```bash
pnpm db:generate
```

Expected: clean. The new enum value should appear in the generated TypeScript client at `packages/db/node_modules/.prisma/client/index.d.ts`.

- [ ] **Step 6: Typecheck db**

```bash
pnpm --filter @switchboard/db typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m 'feat(db): extend WorkTraceIngressPath with agent_recommendation_emission'
```

---

## Task 4: Define `RecommendationEmissionMirror` interface + WorkTrace builder

**Files:**

- Create: `packages/core/src/recommendations/emission-mirror.ts`
- Test: `packages/core/src/recommendations/__tests__/emission-mirror.test.ts`

- [ ] **Step 1: Write the failing test for `buildRileyEmissionWorkTrace`**

Create `packages/core/src/recommendations/__tests__/emission-mirror.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRileyEmissionWorkTrace } from "../emission-mirror.js";
import type { PersistRecommendationInput } from "../types.js";

const baseInsert: PersistRecommendationInput = {
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.pause_adset",
  action: "pause",
  humanSummary: "Pause Cold Interests adset — CPL trending above target",
  confidence: 0.82,
  dollarsAtRisk: 240,
  riskLevel: "high",
  parameters: {
    cronId: "ad-optimizer-weekly-audit",
    __recommendation: {
      action: "pause",
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    },
  },
  targetEntities: { campaignId: "camp-1", adsetId: "as-1" },
  sourceWorkflow: "ad-optimizer.weekly_audit",
  surface: "queue",
  idempotencyKey: "deadbeef".repeat(4),
  undoableUntil: null,
  expiresAt: new Date("2026-05-23T00:00:00Z"),
};

describe("buildRileyEmissionWorkTrace", () => {
  it("maps the queue surface to outcome=pending_approval", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.outcome).toBe("pending_approval");
  });

  it("maps the shadow_action surface to outcome=completed", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, surface: "shadow_action" },
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.outcome).toBe("completed");
  });

  it("sets ingressPath to agent_recommendation_emission", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.ingressPath).toBe("agent_recommendation_emission");
  });

  it("uses pipeline mode and schedule trigger", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.mode).toBe("pipeline");
    expect(trace.trigger).toBe("schedule");
  });

  it("reuses the recommendation idempotencyKey", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.idempotencyKey).toBe(baseInsert.idempotencyKey);
  });

  it("maps riskLevel high → riskScore 0.8", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.riskScore).toBe(0.8);
  });

  it("maps riskLevel medium → riskScore 0.5", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, riskLevel: "medium" },
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.riskScore).toBe(0.5);
  });

  it("maps riskLevel low → riskScore 0.2", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, riskLevel: "low" },
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.riskScore).toBe(0.2);
  });

  it("uses governanceOutcome=require_approval for queue and execute for shadow_action", () => {
    const queue = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(queue.governanceOutcome).toBe("require_approval");

    const shadow = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, surface: "shadow_action" },
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(shadow.governanceOutcome).toBe("execute");
  });

  it("populates parameters with cronId, action, humanSummary, confidence, dollarsAtRisk", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.parameters).toMatchObject({
      cronId: "ad-optimizer-weekly-audit",
      action: "pause",
      humanSummary: "Pause Cold Interests adset — CPL trending above target",
      confidence: 0.82,
      dollarsAtRisk: 240,
    });
  });

  it("sets actor.type=service, actor.id=ad-optimizer", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.actor).toEqual({ type: "service", id: "ad-optimizer" });
  });

  it("sets requestedAt = governanceCompletedAt = completedAt = now", () => {
    const now = new Date("2026-05-16T12:00:00Z");
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.requestedAt).toBe(now.toISOString());
    expect(trace.governanceCompletedAt).toBe(now.toISOString());
    expect(trace.completedAt).toBe(now.toISOString());
  });

  it("sets durationMs to 0 (advisory emissions have no execution duration)", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.durationMs).toBe(0);
  });

  it("derives organizationId from insert.orgId", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.organizationId).toBe("org-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test --run emission-mirror.test
```

Expected: FAIL with module-not-found for `../emission-mirror.js`.

- [ ] **Step 3: Implement `buildRileyEmissionWorkTrace` + `RecommendationEmissionMirror` interface**

Create `packages/core/src/recommendations/emission-mirror.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { WorkTrace } from "../platform/work-trace.js";
import { WORK_TRACE_HASH_VERSION_LATEST } from "../platform/work-trace-hash.js";
import type { PersistRecommendationInput, Recommendation } from "./types.js";

/**
 * Mirror that performs the dual-write of a Recommendation row + a WorkTrace row
 * inside a single atomic unit. Layer-3 (core) does not know what kind of unit
 * (Prisma transaction, in-memory, etc.); the mirror implementation owns that.
 *
 * When provided to emitRecommendation, replaces the per-store insert path with
 * the mirror's recordEmission. When absent, emitRecommendation falls back to
 * the legacy single-store insert path.
 */
export interface RecommendationEmissionMirror {
  recordEmission(args: {
    recommendationInsert: PersistRecommendationInput;
    workTrace: WorkTrace;
  }): Promise<{ row: Recommendation; idempotent: boolean }>;
}

const RISK_LEVEL_TO_SCORE: Record<"low" | "medium" | "high", number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
};

export interface BuildRileyEmissionWorkTraceArgs {
  insert: PersistRecommendationInput;
  now: Date;
  cronId: string;
}

/**
 * Build the WorkTrace shape that mirrors a Riley recommendation emission.
 *
 * Field mapping (verbatim from Wave B slicing spec §Slice B-Wave-1):
 *   - mode: "pipeline" — ad-optimizer is a pipeline by architectural category
 *   - trigger: "schedule" — Riley emissions are cron-scheduled
 *   - outcome: "pending_approval" for queue surface, "completed" for shadow_action
 *   - governanceOutcome: "require_approval" for queue, "execute" for shadow_action
 *   - ingressPath: "agent_recommendation_emission"
 *   - hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST (v2; ingressPath is in v2 hash input)
 *   - actor: service / ad-optimizer
 *   - durationMs: 0 (no execution; emit is the terminal event)
 *   - idempotencyKey: shared with the Recommendation insert
 *   - completedAt = governanceCompletedAt = requestedAt = now
 */
export function buildRileyEmissionWorkTrace(args: BuildRileyEmissionWorkTraceArgs): WorkTrace {
  const { insert, now, cronId } = args;
  const nowIso = now.toISOString();
  const isoQueue = insert.surface === "queue";
  return {
    workUnitId: randomUUID(),
    traceId: randomUUID(),
    intent: insert.intent,
    mode: "pipeline",
    organizationId: insert.orgId,
    actor: { type: "service", id: "ad-optimizer" },
    trigger: "schedule",
    idempotencyKey: insert.idempotencyKey,
    parameters: {
      cronId,
      action: insert.action,
      humanSummary: insert.humanSummary,
      confidence: insert.confidence,
      dollarsAtRisk: insert.dollarsAtRisk,
      sourceWorkflow: insert.sourceWorkflow ?? null,
      targetEntities: insert.targetEntities ?? null,
    },
    governanceOutcome: isoQueue ? "require_approval" : "execute",
    riskScore: RISK_LEVEL_TO_SCORE[insert.riskLevel],
    matchedPolicies: [],
    outcome: isoQueue ? "pending_approval" : "completed",
    durationMs: 0,
    requestedAt: nowIso,
    governanceCompletedAt: nowIso,
    completedAt: nowIso,
    ingressPath: "agent_recommendation_emission",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test --run emission-mirror.test
```

Expected: PASS — all 14 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recommendations/emission-mirror.ts packages/core/src/recommendations/__tests__/emission-mirror.test.ts
git commit -m 'feat(core): add RecommendationEmissionMirror interface + Riley WorkTrace builder'
```

---

## Task 5: Implement in-memory mirror

**Files:**

- Create: `packages/core/src/recommendations/in-memory-emission-mirror.ts`
- Test: extend the test file from Task 4 with mirror-implementation cases.

- [ ] **Step 1: Add a failing test for the in-memory mirror**

Append to `packages/core/src/recommendations/__tests__/emission-mirror.test.ts`:

```ts
import { createInMemoryEmissionMirror } from "../in-memory-emission-mirror.js";
import { createInMemoryRecommendationStore } from "../in-memory-store.js";

describe("createInMemoryEmissionMirror", () => {
  it("records both the recommendation and the work trace on a fresh emission", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: Array<{ workUnitId: string; idempotencyKey?: string }> = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const wt = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    const result = await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    expect(result.idempotent).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.idempotencyKey).toBe(baseInsert.idempotencyKey);
  });

  it("returns idempotent=true and writes nothing new on duplicate idempotencyKey", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: Array<{ workUnitId: string; idempotencyKey?: string }> = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const wt = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });
    await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });
    const second = await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    expect(second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1); // no duplicate trace
  });

  it("rolls back the recommendation when the trace recorder throws", async () => {
    const store = createInMemoryRecommendationStore();
    const mirror = createInMemoryEmissionMirror({
      store,
      traces: [],
      onTracePersist: () => {
        throw new Error("simulated trace persist failure");
      },
    });
    const wt = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: new Date("2026-05-16T12:00:00Z"),
      cronId: "ad-optimizer-weekly-audit",
    });

    await expect(
      mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt }),
    ).rejects.toThrow(/simulated trace persist failure/);

    expect(store.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test --run emission-mirror.test
```

Expected: FAIL with module-not-found for `../in-memory-emission-mirror.js`.

- [ ] **Step 3: Implement the in-memory mirror**

Create `packages/core/src/recommendations/in-memory-emission-mirror.ts`:

```ts
import type { RecommendationStore } from "./interfaces.js";
import type { Recommendation, PersistRecommendationInput } from "./types.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { RecommendationEmissionMirror } from "./emission-mirror.js";

interface CapturedTrace {
  workUnitId: string;
  idempotencyKey?: string;
  trace: WorkTrace;
}

export interface CreateInMemoryEmissionMirrorOptions {
  store: RecommendationStore;
  traces: CapturedTrace[];
  onTracePersist?: (trace: WorkTrace) => void;
}

/**
 * In-memory mirror used by tests + dev. Simulates atomic dual-write by:
 *   1. Inserting the recommendation first.
 *   2. Capturing the work trace, optionally invoking onTracePersist (used to
 *      simulate persist failures).
 *   3. If onTracePersist throws, rolling back the recommendation insert.
 *
 * Idempotency: when the recommendation insert reports idempotent=true (existing
 * row found), the trace is NOT captured a second time.
 */
export function createInMemoryEmissionMirror(
  opts: CreateInMemoryEmissionMirrorOptions,
): RecommendationEmissionMirror {
  return {
    async recordEmission({ recommendationInsert, workTrace }) {
      const inserted = await opts.store.insert(recommendationInsert);
      if (inserted.idempotent) {
        return inserted;
      }
      try {
        opts.onTracePersist?.(workTrace);
      } catch (err) {
        // Roll back the recommendation insert by deleting from the in-memory store's
        // internal arrays. The in-memory store exposes rows + byKey for testability.
        const exposed = opts.store as RecommendationStore & {
          rows?: Recommendation[];
          byKey?: Map<string, Recommendation>;
        };
        if (exposed.rows) {
          const idx = exposed.rows.findIndex((r) => r.id === inserted.row.id);
          if (idx >= 0) exposed.rows.splice(idx, 1);
        }
        if (exposed.byKey) exposed.byKey.delete(recommendationInsert.idempotencyKey);
        throw err;
      }
      opts.traces.push({
        workUnitId: workTrace.workUnitId,
        idempotencyKey: workTrace.idempotencyKey,
        trace: workTrace,
      });
      return inserted;
    },
  };
}

export type { CapturedTrace };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test --run emission-mirror.test
```

Expected: PASS — both task-4 cases (14) and task-5 cases (3) green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recommendations/in-memory-emission-mirror.ts packages/core/src/recommendations/__tests__/emission-mirror.test.ts
git commit -m 'feat(core): in-memory RecommendationEmissionMirror with rollback semantics'
```

---

## Task 6: Wire `emitRecommendation` to use the mirror when provided

**Files:**

- Modify: `packages/core/src/recommendations/emit.ts`
- Test: `packages/core/src/recommendations/__tests__/emit-mirror.test.ts` (new file)

- [ ] **Step 1: Write the failing integration test**

Create `packages/core/src/recommendations/__tests__/emit-mirror.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitRecommendation } from "../emit.js";
import { createInMemoryRecommendationStore } from "../in-memory-store.js";
import { createInMemoryEmissionMirror, type CapturedTrace } from "../in-memory-emission-mirror.js";
import type { RecommendationInput } from "../types.js";

const baseInput = (overrides: Partial<RecommendationInput> = {}): RecommendationInput => ({
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.pause_adset",
  action: "pause",
  humanSummary: "Pause Cold Interests adset",
  confidence: 0.82,
  dollarsAtRisk: 240,
  riskLevel: "high",
  parameters: { cronId: "ad-optimizer-weekly-audit" },
  presentation: {
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
  },
  targetEntities: { campaignId: "c-1" },
  ...overrides,
});

describe("emitRecommendation with mirror", () => {
  it("writes both Recommendation and WorkTrace when mirror is provided", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const result = await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: () => new Date("2026-05-16T12:00:00Z"),
    });

    expect(result.surface).toBe("queue");
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.idempotencyKey).toBe(store.rows[0]?.id ? expect.any(String) : undefined);
    expect(traces[0]?.trace.ingressPath).toBe("agent_recommendation_emission");
    expect(traces[0]?.trace.organizationId).toBe("org-1");
    expect(traces[0]?.trace.intent).toBe("recommendation.pause_adset");
  });

  it("idempotent: a re-emit produces neither a duplicate Recommendation nor a duplicate WorkTrace", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: () => new Date("2026-05-16T12:00:00Z"),
    });
    const second = await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: () => new Date("2026-05-16T12:00:00Z"),
    });

    expect(second.surface).toBe("queue");
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
  });

  it("rolls back the Recommendation when the WorkTrace persist fails", async () => {
    const store = createInMemoryRecommendationStore();
    const mirror = createInMemoryEmissionMirror({
      store,
      traces: [],
      onTracePersist: () => {
        throw new Error("trace persist boom");
      },
    });

    await expect(
      emitRecommendation(store, baseInput(), {
        mirror,
        cronId: "ad-optimizer-weekly-audit",
        now: () => new Date("2026-05-16T12:00:00Z"),
      }),
    ).rejects.toThrow(/trace persist boom/);

    expect(store.rows).toHaveLength(0);
  });

  it("falls back to single-write when no mirror is provided (back-compat)", async () => {
    const store = createInMemoryRecommendationStore();
    const result = await emitRecommendation(store, baseInput());
    expect(result.surface).toBe("queue");
    expect(store.rows).toHaveLength(1);
  });

  it("shadow_action surface produces a WorkTrace with outcome=completed", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    // Low-confidence + low-dollarsAtRisk routes to shadow_action per the existing router.
    await emitRecommendation(store, baseInput({ confidence: 0.6, dollarsAtRisk: 5 }), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: () => new Date("2026-05-16T12:00:00Z"),
    });

    expect(traces[0]?.trace.outcome).toBe("completed");
    expect(traces[0]?.trace.governanceOutcome).toBe("execute");
  });

  it("dropped surface (router returns dropped) writes neither a Recommendation nor a WorkTrace", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    // Confidence low enough to route to dropped per the existing router.
    const result = await emitRecommendation(
      store,
      baseInput({ confidence: 0.3, dollarsAtRisk: 5 }),
      {
        mirror,
        cronId: "ad-optimizer-weekly-audit",
        now: () => new Date("2026-05-16T12:00:00Z"),
      },
    );

    expect(result.surface).toBe("dropped");
    expect(store.rows).toHaveLength(0);
    expect(traces).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test --run emit-mirror.test
```

Expected: FAIL — `emitRecommendation` does not yet accept the third options parameter.

- [ ] **Step 3: Modify `emitRecommendation` to support the mirror**

Open `packages/core/src/recommendations/emit.ts` and replace the entire file:

```ts
import { createHash } from "node:crypto";
import { RecommendationInputSchema } from "@switchboard/schemas";
import { routeRecommendation } from "./router.js";
import { buildRileyEmissionWorkTrace } from "./emission-mirror.js";
import type { RecommendationStore } from "./interfaces.js";
import type { RecommendationEmissionMirror } from "./emission-mirror.js";
import type { RecommendationInput, EmitResult } from "./types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function dayBucket(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function computeIdempotencyKey(input: RecommendationInput, now: Date): string {
  const targets = input.targetEntities ?? {};
  const targetSig = Object.keys(targets)
    .sort()
    .map((k) => `${k}=${String((targets as Record<string, unknown>)[k])}`)
    .join("|");
  const raw = [input.orgId, input.intent, targetSig, dayBucket(now)].join("::");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export interface EmitRecommendationOptions {
  /**
   * When provided, every emission performs an atomic dual-write of the
   * Recommendation row + a WorkTrace mirror row. When absent, only the
   * Recommendation row is written (back-compat for callers that have not yet
   * adopted the mirror). See packages/core/src/recommendations/emission-mirror.ts.
   */
  mirror?: RecommendationEmissionMirror;
  /**
   * Cron identifier captured into the mirrored WorkTrace's parameters.cronId
   * field. Required when `mirror` is provided so the WorkTrace records its
   * emission origin. Ignored when `mirror` is absent.
   */
  cronId?: string;
  /**
   * Clock injection point. Defaults to `() => new Date()`.
   */
  now?: () => Date;
}

export async function emitRecommendation(
  store: RecommendationStore,
  input: RecommendationInput,
  options: EmitRecommendationOptions = {},
): Promise<EmitResult> {
  // Validate.
  const validated = RecommendationInputSchema.parse(input);

  // Route.
  const surface = routeRecommendation({
    confidence: validated.confidence,
    dollarsAtRisk: validated.dollarsAtRisk,
    action: validated.action,
  });

  if (surface === "dropped") {
    return { surface: "dropped", id: null, idempotent: false };
  }

  const nowFn = options.now ?? (() => new Date());
  const now = nowFn();
  const idempotencyKey = computeIdempotencyKey(validated, now);
  const expiresAt = validated.expiresAt ?? new Date(now.getTime() + ONE_DAY_MS);
  const undoableUntil = surface === "shadow_action" ? new Date(now.getTime() + ONE_DAY_MS) : null;

  // Strip `presentation` from the spread — it lives inside parameters.__recommendation.
  // Stash `action` alongside it so the read-back can reconstruct the domain action
  // without adding a column.
  const { presentation, parameters: rawParameters, ...rest } = validated;
  const parameters: Record<string, unknown> = {
    ...rawParameters,
    __recommendation: {
      action: validated.action,
      presentation,
    },
  };

  const persistInput = {
    orgId: rest.orgId,
    agentKey: rest.agentKey,
    intent: rest.intent,
    action: rest.action,
    humanSummary: rest.humanSummary,
    confidence: rest.confidence,
    dollarsAtRisk: rest.dollarsAtRisk,
    riskLevel: rest.riskLevel,
    parameters,
    targetEntities: rest.targetEntities,
    sourceWorkflow: rest.sourceWorkflow,
    surface,
    idempotencyKey,
    undoableUntil,
    expiresAt,
  };

  if (options.mirror) {
    if (!options.cronId) {
      throw new Error(
        "emitRecommendation: options.cronId is required when options.mirror is provided",
      );
    }
    const workTrace = buildRileyEmissionWorkTrace({
      insert: persistInput,
      now,
      cronId: options.cronId,
    });
    const { row, idempotent } = await options.mirror.recordEmission({
      recommendationInsert: persistInput,
      workTrace,
    });
    return { surface, id: row.id, idempotent };
  }

  // Back-compat path: single-store insert, no WorkTrace mirror.
  const { row, idempotent } = await store.insert(persistInput);
  return { surface, id: row.id, idempotent };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test --run emit-mirror.test
```

Expected: PASS — all 6 cases.

- [ ] **Step 5: Run the existing emit + act tests to confirm back-compat**

```bash
pnpm --filter @switchboard/core test --run emit.test
pnpm --filter @switchboard/core test --run act.test
```

Expected: PASS — existing test cases continue to pass without modification (they call `emitRecommendation(store, input)` without the third parameter).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/recommendations/emit.ts packages/core/src/recommendations/__tests__/emit-mirror.test.ts
git commit -m 'feat(core): emitRecommendation supports optional mirror for dual-write'
```

---

## Task 7: Re-export the mirror types + factories from `@switchboard/core`

**Files:**

- Modify: `packages/core/src/recommendations/index.ts`

- [ ] **Step 1: Open the index file**

```bash
cat packages/core/src/recommendations/index.ts
```

- [ ] **Step 2: Add the new exports**

Append to `packages/core/src/recommendations/index.ts`:

```ts
export {
  buildRileyEmissionWorkTrace,
  type RecommendationEmissionMirror,
  type BuildRileyEmissionWorkTraceArgs,
} from "./emission-mirror.js";
export { createInMemoryEmissionMirror, type CapturedTrace } from "./in-memory-emission-mirror.js";
export type { EmitRecommendationOptions } from "./emit.js";
```

- [ ] **Step 3: Typecheck core**

```bash
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/recommendations/index.ts
git commit -m 'chore(core): re-export RecommendationEmissionMirror types + helpers'
```

---

## Task 8: Implement the Prisma mirror

**Files:**

- Create: `packages/db/src/stores/prisma-recommendation-emission-mirror.ts`
- Test: `packages/db/src/stores/__tests__/prisma-recommendation-emission-mirror.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/stores/__tests__/prisma-recommendation-emission-mirror.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PrismaRecommendationEmissionMirror } from "../prisma-recommendation-emission-mirror.js";
import type { PersistRecommendationInput } from "@switchboard/core";
import { buildRileyEmissionWorkTrace } from "@switchboard/core";

const baseInsert: PersistRecommendationInput = {
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.pause_adset",
  action: "pause",
  humanSummary: "Pause Cold Interests adset",
  confidence: 0.82,
  dollarsAtRisk: 240,
  riskLevel: "high",
  parameters: { cronId: "ad-optimizer-weekly-audit" },
  targetEntities: { campaignId: "camp-1" },
  sourceWorkflow: "ad-optimizer.weekly_audit",
  surface: "queue",
  idempotencyKey: "deadbeef".repeat(4),
  undoableUntil: null,
  expiresAt: new Date("2026-05-23T00:00:00Z"),
};

const wt = buildRileyEmissionWorkTrace({
  insert: baseInsert,
  now: new Date("2026-05-16T12:00:00Z"),
  cronId: "ad-optimizer-weekly-audit",
});

function makeMockPrisma(opts: {
  recCreate?: () => Promise<unknown>;
  workTraceCreate?: () => Promise<unknown>;
  recFindUnique?: () => Promise<unknown>;
}) {
  const tx = {
    pendingActionRecord: {
      create: vi.fn(
        opts.recCreate ??
          (async () => ({
            id: "rec-1",
            organizationId: baseInsert.orgId,
            sourceAgent: baseInsert.agentKey,
            intent: baseInsert.intent,
            humanSummary: baseInsert.humanSummary,
            confidence: baseInsert.confidence,
            dollarsAtRisk: baseInsert.dollarsAtRisk,
            riskLevel: baseInsert.riskLevel,
            surface: baseInsert.surface,
            status: "pending",
            parameters: { __recommendation: { action: baseInsert.action } },
            targetEntities: baseInsert.targetEntities,
            sourceWorkflow: baseInsert.sourceWorkflow,
            resolvedBy: null,
            resolvedAt: null,
            createdAt: new Date("2026-05-16T12:00:00Z"),
            expiresAt: baseInsert.expiresAt,
            undoableUntil: baseInsert.undoableUntil,
          })),
      ),
      findUnique: vi.fn(opts.recFindUnique ?? (async () => null)),
    },
    workTrace: {
      create: vi.fn(opts.workTraceCreate ?? (async () => ({}))),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

describe("PrismaRecommendationEmissionMirror", () => {
  it("writes the recommendation + work trace inside one $transaction", async () => {
    const { prisma, tx } = makeMockPrisma({});
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    const result = await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.pendingActionRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.workTrace.create).toHaveBeenCalledTimes(1);
    expect(result.idempotent).toBe(false);
  });

  it("returns idempotent=true and skips the work-trace insert on duplicate idempotencyKey", async () => {
    const { prisma, tx } = makeMockPrisma({
      recCreate: async () => {
        const err = new Error("unique constraint") as Error & { code: string };
        err.code = "P2002";
        throw err;
      },
      recFindUnique: async () => ({
        id: "rec-existing",
        organizationId: baseInsert.orgId,
        sourceAgent: baseInsert.agentKey,
        intent: baseInsert.intent,
        humanSummary: baseInsert.humanSummary,
        confidence: baseInsert.confidence,
        dollarsAtRisk: baseInsert.dollarsAtRisk,
        riskLevel: baseInsert.riskLevel,
        surface: baseInsert.surface,
        status: "pending",
        parameters: { __recommendation: { action: baseInsert.action } },
        targetEntities: baseInsert.targetEntities,
        sourceWorkflow: baseInsert.sourceWorkflow,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date("2026-05-15T00:00:00Z"),
        expiresAt: baseInsert.expiresAt,
        undoableUntil: baseInsert.undoableUntil,
      }),
    });
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    const result = await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    expect(result.idempotent).toBe(true);
    expect(result.row.id).toBe("rec-existing");
    expect(tx.workTrace.create).not.toHaveBeenCalled();
  });

  it("propagates errors from the work-trace insert (caller-owned transaction will roll back)", async () => {
    const { prisma } = makeMockPrisma({
      workTraceCreate: async () => {
        throw new Error("simulated workTrace.create failure");
      },
    });
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    await expect(
      mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt }),
    ).rejects.toThrow(/simulated workTrace.create failure/);
  });

  it("includes ingressPath, mode, outcome, and contentHash on the work-trace create payload", async () => {
    const { prisma, tx } = makeMockPrisma({});
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    const call = (tx.workTrace.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.ingressPath).toBe("agent_recommendation_emission");
    expect(call.data.mode).toBe("pipeline");
    expect(call.data.outcome).toBe("pending_approval");
    expect(call.data.contentHash).toEqual(expect.any(String));
    expect(call.data.idempotencyKey).toBe(baseInsert.idempotencyKey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test --run prisma-recommendation-emission-mirror
```

Expected: FAIL — module-not-found.

- [ ] **Step 3: Implement the Prisma mirror**

Create `packages/db/src/stores/prisma-recommendation-emission-mirror.ts`:

```ts
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  computeWorkTraceContentHash,
  WORK_TRACE_HASH_VERSION_LATEST,
  type RecommendationEmissionMirror,
  type PersistRecommendationInput,
  type Recommendation,
  type WorkTrace,
} from "@switchboard/core";

interface RecommendationRowFromPrisma {
  id: string;
  organizationId: string;
  sourceAgent: string;
  intent: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: string;
  surface: string;
  status: string;
  parameters: unknown;
  targetEntities: unknown;
  sourceWorkflow: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  undoableUntil: Date | null;
}

interface RecommendationParams {
  __recommendation?: { action?: string; note?: string | null; presentation?: unknown };
  [key: string]: unknown;
}

function rowToRecommendation(row: RecommendationRowFromPrisma): Recommendation {
  const params = (row.parameters ?? {}) as RecommendationParams;
  const meta = params.__recommendation ?? {};
  return {
    id: row.id,
    orgId: row.organizationId,
    agentKey: row.sourceAgent as Recommendation["agentKey"],
    intent: row.intent,
    action: meta.action ?? "",
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    dollarsAtRisk: row.dollarsAtRisk,
    riskLevel: row.riskLevel as Recommendation["riskLevel"],
    surface: row.surface as Recommendation["surface"],
    status: row.status as Recommendation["status"],
    parameters: params,
    targetEntities: (row.targetEntities ?? null) as Record<string, unknown> | null,
    sourceAgent: row.sourceAgent,
    sourceWorkflow: row.sourceWorkflow,
    actedBy: row.resolvedBy,
    actedAt: row.resolvedAt,
    note: meta.note ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    undoableUntil: row.undoableUntil,
  };
}

/**
 * Production mirror: opens prisma.$transaction, creates the PendingActionRecord
 * row + the WorkTrace row inside the same transaction. Either both commit or
 * both roll back.
 *
 * Idempotency: when PendingActionRecord.create raises P2002 (unique constraint
 * violation on idempotencyKey), the existing recommendation row is fetched and
 * returned; the WorkTrace insert is intentionally skipped to preserve substrate
 * symmetry (one Recommendation == one WorkTrace per idempotencyKey).
 */
export class PrismaRecommendationEmissionMirror implements RecommendationEmissionMirror {
  constructor(private readonly prisma: PrismaClient) {}

  async recordEmission(args: {
    recommendationInsert: PersistRecommendationInput;
    workTrace: WorkTrace;
  }): Promise<{ row: Recommendation; idempotent: boolean }> {
    const { recommendationInsert: input, workTrace } = args;
    const traceVersion = 1;
    const hashInputVersion = workTrace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
    const contentHash = computeWorkTraceContentHash(workTrace, traceVersion);

    return this.prisma.$transaction(async (tx) => {
      let recommendationRow: RecommendationRowFromPrisma;
      let idempotent = false;
      try {
        recommendationRow = await tx.pendingActionRecord.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            status: "pending",
            intent: input.intent,
            targetEntities: (input.targetEntities ?? {}) as object,
            parameters: input.parameters as object,
            humanSummary: input.humanSummary,
            confidence: input.confidence,
            riskLevel: input.riskLevel,
            dollarsAtRisk: input.dollarsAtRisk,
            requiredCapabilities: [],
            dryRunSupported: false,
            approvalRequired: "operator",
            sourceAgent: input.agentKey,
            sourceWorkflow: input.sourceWorkflow ?? null,
            organizationId: input.orgId,
            surface: input.surface,
            undoableUntil: input.undoableUntil,
            expiresAt: input.expiresAt,
          },
        });
      } catch (err: unknown) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
          const existing = await tx.pendingActionRecord.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (!existing) {
            throw new Error(
              `idempotencyKey collision raised P2002 but findUnique returned null for ${input.idempotencyKey}`,
            );
          }
          return { row: rowToRecommendation(existing), idempotent: true };
        }
        throw err;
      }

      // Insert the WorkTrace row inside the same transaction. If this throws,
      // the entire transaction rolls back including the PendingActionRecord row.
      await tx.workTrace.create({
        data: this.buildWorkTraceCreateData(workTrace, {
          traceVersion,
          contentHash,
          hashInputVersion,
        }),
      });

      return { row: rowToRecommendation(recommendationRow), idempotent };
    });
  }

  private buildWorkTraceCreateData(
    trace: WorkTrace,
    opts: { traceVersion: number; contentHash: string; hashInputVersion: number },
  ): Prisma.WorkTraceUncheckedCreateInput {
    return {
      workUnitId: trace.workUnitId,
      traceId: trace.traceId,
      parentWorkUnitId: trace.parentWorkUnitId ?? null,
      intent: trace.intent,
      mode: trace.mode,
      organizationId: trace.organizationId,
      actorId: trace.actor.id,
      actorType: trace.actor.type,
      trigger: trace.trigger,
      parameters: trace.parameters ? JSON.stringify(trace.parameters) : null,
      deploymentContext: trace.deploymentContext ? JSON.stringify(trace.deploymentContext) : null,
      governanceOutcome: trace.governanceOutcome,
      riskScore: trace.riskScore,
      matchedPolicies: JSON.stringify(trace.matchedPolicies),
      governanceConstraints: trace.governanceConstraints
        ? JSON.stringify(trace.governanceConstraints)
        : null,
      approvalId: trace.approvalId ?? null,
      approvalOutcome: trace.approvalOutcome ?? null,
      approvalRespondedBy: trace.approvalRespondedBy ?? null,
      approvalRespondedAt: trace.approvalRespondedAt ? new Date(trace.approvalRespondedAt) : null,
      outcome: trace.outcome,
      durationMs: trace.durationMs,
      errorCode: trace.error?.code ?? null,
      errorMessage: trace.error?.message ?? null,
      executionSummary: trace.executionSummary ?? null,
      executionOutputs: trace.executionOutputs ? JSON.stringify(trace.executionOutputs) : null,
      injectedPatternIds: trace.injectedPatternIds ?? [],
      modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
      qualificationSignals: trace.qualificationSignals
        ? JSON.stringify(trace.qualificationSignals)
        : null,
      requestedAt: new Date(trace.requestedAt),
      governanceCompletedAt: new Date(trace.governanceCompletedAt),
      executionStartedAt: trace.executionStartedAt ? new Date(trace.executionStartedAt) : null,
      idempotencyKey: trace.idempotencyKey ?? null,
      completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
      contentHash: opts.contentHash,
      traceVersion: opts.traceVersion,
      ingressPath: trace.ingressPath,
      hashInputVersion: opts.hashInputVersion,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/db test --run prisma-recommendation-emission-mirror
```

Expected: PASS — all 4 cases.

- [ ] **Step 5: Add the export**

Append to `packages/db/src/index.ts`:

```ts
export { PrismaRecommendationEmissionMirror } from "./stores/prisma-recommendation-emission-mirror.js";
```

- [ ] **Step 6: Typecheck + build db**

```bash
pnpm --filter @switchboard/db typecheck
pnpm --filter @switchboard/db build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stores/prisma-recommendation-emission-mirror.ts packages/db/src/stores/__tests__/prisma-recommendation-emission-mirror.test.ts packages/db/src/index.ts
git commit -m 'feat(db): PrismaRecommendationEmissionMirror — atomic Recommendation + WorkTrace'
```

---

## Task 9: Verify integrity test pin (v1, v2, v2-with-new-ingressPath)

**Files:**

- Modify: `packages/db/src/stores/__tests__/prisma-recommendation-emission-mirror.test.ts` (add a contentHash verification scenario)

- [ ] **Step 1: Add a contentHash verification test case**

Append to `prisma-recommendation-emission-mirror.test.ts`:

```ts
import { computeWorkTraceContentHash, verifyWorkTraceIntegrity } from "@switchboard/core";

describe("PrismaRecommendationEmissionMirror — integrity invariants", () => {
  it("the WorkTrace contentHash recomputes to the same value (round-trip verify)", async () => {
    const { prisma, tx } = makeMockPrisma({});
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    const writtenData = (tx.workTrace.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .data as Record<string, unknown>;
    const expectedHash = computeWorkTraceContentHash(wt, 1);
    expect(writtenData.contentHash).toBe(expectedHash);

    // Reconstruct the trace as the read path would and re-verify.
    const reconstructed: typeof wt = {
      ...wt,
      contentHash: writtenData.contentHash as string,
      traceVersion: writtenData.traceVersion as number,
    };
    const verdict = verifyWorkTraceIntegrity(reconstructed);
    expect(verdict).toBe("verified");
  });
});
```

- [ ] **Step 2: Run the new test**

```bash
pnpm --filter @switchboard/db test --run prisma-recommendation-emission-mirror
```

Expected: PASS — 5 cases total now.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/__tests__/prisma-recommendation-emission-mirror.test.ts
git commit -m 'test(db): pin WorkTrace contentHash round-trip on Riley emission mirror'
```

---

## Task 10: Full-workspace verification

- [ ] **Step 1: Run `pnpm reset` to ensure clean lower-layer artifacts**

```bash
pnpm reset
```

Expected: clean rebuild of schemas → core → db.

- [ ] **Step 2: Run typecheck across the whole workspace**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 4: Run the test suite**

```bash
pnpm test
```

Expected: pass. Note: per `feedback_db_integrity_tests_pg_advisory_lock`, `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` are pre-existing flakes. If they fail, run them on `main` to confirm they fail there too. If yes, ignore. If no, the PR introduced a regression — fix before continuing.

- [ ] **Step 5: Run the dashboard build (per `feedback_dashboard_build_not_in_ci`)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: clean. PR-1 makes no dashboard changes; this catches accidental layer leaks.

- [ ] **Step 6: Run the cockpit grep smoke check from Wave A**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: zero matches in `components/cockpit/**`. The Riley adapter files under `lib/cockpit/riley/**` already match — those are exempt.

- [ ] **Step 7: Verify dashboard cockpit is byte-identical to main**

```bash
git diff main -- apps/dashboard/src/components/cockpit/ apps/dashboard/src/lib/cockpit/riley/
```

Expected: no output (zero diff).

- [ ] **Step 8: Run drift check if Postgres is available**

```bash
pnpm db:check-drift
```

Expected: clean.

---

## Task 11: Open the implementation PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/riley-wave-b-pr1
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(riley-wave-b): PR-1 — WorkTrace mirror infrastructure (no production wiring)" --body "$(cat <<'EOF'
## Summary

Wave B PR-1 ships the dual-write infrastructure that lets emitRecommendation persist a canonical WorkTrace row alongside the existing Recommendation row, transactionally. New ingressPath enum value `agent_recommendation_emission`. Existing mode (`pipeline`) and outcome (`pending_approval` / `completed`) values reused — no new ExecutionModeName / WorkOutcome migrations.

Production emitter wiring is **out of scope** for PR-1 — see implementation plan §Scope note. The Riley recommendation-sink emitter is not wired in production today; bundling that decision into PR-1 would conflate infrastructure landing with production traffic enablement.

## Adapter-boundary check

- Zero changes to apps/dashboard.
- Zero changes to packages/ad-optimizer (emitter is injected from outside).
- Cockpit components / hooks / adapters byte-identical to main.

## What changes

- `packages/core/src/recommendations/emission-mirror.ts` — RecommendationEmissionMirror interface + Riley WorkTrace builder
- `packages/core/src/recommendations/in-memory-emission-mirror.ts` — in-memory mirror with rollback
- `packages/core/src/recommendations/emit.ts` — accepts optional mirror; back-compat preserved
- `packages/db/src/stores/prisma-recommendation-emission-mirror.ts` — production mirror via prisma.\$transaction
- `packages/core/src/platform/work-trace.ts` — extend ingressPath union
- `packages/schemas/src/work-trace.ts` — extend Zod enum
- `packages/db/prisma/schema.prisma` + new migration — extend Postgres enum

## Test plan

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test` clean (modulo pre-existing pg_advisory_xact_lock flake; reproduce on main if it fires)
- [ ] `pnpm --filter @switchboard/dashboard build` clean
- [ ] `pnpm db:check-drift` clean
- [ ] Cockpit visual smoke: /riley renders identically vs main

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Enable auto-merge**

```bash
gh pr merge --auto --squash
```

- [ ] **Step 4: Watch CI**

```bash
gh pr checks
```

If CI fails, diagnose and fix before re-pushing. Per `feedback_auto_merge_captures_head_early`, disable auto-merge before pushing late fixes:

```bash
gh pr merge --disable-auto
# fix the issue, commit, push
gh pr merge --auto --squash
```

---

## Self-review checklist

- [ ] **Spec coverage:** every acceptance criterion in the slicing spec §Slice B-Wave-1 maps to a task or task-group:
  - AC 1 (dual-write) → Task 4 + 6 + 8
  - AC 2 (idempotency) → Task 6 (test case 2) + Task 8 (test case 2)
  - AC 3 (ingressPath value) → Task 1 + 2 + 3
  - AC 4 (mode pipeline + outcome pending_approval/completed) → Task 4 (tests pin both surfaces)
  - AC 5 (idempotencyKey shared) → Task 4 (test) + Task 6 (test)
  - AC 6 (11 action variants) → covered by Task 6's mirror integration tests via the existing routing logic; the 11-variant catalog lives in the recommendation engine and is exercised by the engine's own tests, not duplicated here
  - AC 7 (substrate-symmetry) → semantic invariant; verifiable in production once emitter is wired. PR-1 verifies via test counts (one Recommendation == one WorkTrace per emission).
  - AC 8 (contentHash) → Task 9
  - AC 9 (v1/v2 verification preserved) → existing work-trace-hash tests continue to pass; Task 10 step 4 catches regressions
  - AC 10 (cockpit unchanged) → Task 10 step 7
  - AC 11 (grep smoke) → Task 10 step 6
  - AC 12 (back-compat) → Task 6 (test case 4)
  - AC 13 + 14 (rollback both directions) → Task 6 (test case 3) + Task 8 (test case 3)
  - AC 15 (typecheck/lint/test/dashboard build) → Task 10 steps 2-5
  - AC 16 (test coverage list) → Tasks 4 + 6 + 8 + 9 collectively cover the list
- [ ] **Placeholder scan:** no TBD / TODO / "implement later" / vague-handwave language in any task.
- [ ] **Type consistency:** the `RecommendationEmissionMirror` interface defined in Task 4 is the same one consumed in Tasks 6, 7, 8. The `buildRileyEmissionWorkTrace` helper signature is consistent across Tasks 4 and 6. The `CapturedTrace` type is defined in Task 5 and re-exported in Task 7.
- [ ] **No reference to anything not defined:** every test fixture and import path used in later tasks is created in earlier tasks.

---

## Open items resolved by this plan

- ✅ **`RecommendationStore.insert` tx parameter:** not needed. The Prisma mirror in Task 8 calls `tx.pendingActionRecord.create` directly inside `prisma.$transaction`. Layer-3 stays clean — `RecommendationStore` interface unchanged.
- ✅ **Production wiring sites:** none in this PR. See §Scope note.
- ✅ **WorkTrace test mocks:** Tests use mocked Prisma per `feedback_api_test_mocked_prisma`, not the integrity-test pattern (which is pre-existing-flaky per `feedback_db_integrity_tests_pg_advisory_lock`).
- ✅ **`deploymentId` resolution:** PR-1 omits `deploymentId` from the WorkTrace. The Riley `recommendation-sink` doesn't pass deploymentId to `emitRecommendation` today, and adding the field is a separate scope decision (PR-2 will need it for executor-side traces). PR-1's WorkTrace rows have `deploymentId = null`.
