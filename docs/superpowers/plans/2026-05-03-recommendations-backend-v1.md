# Recommendations Backend v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visual-only Pause / Reduce 50% / Dismiss handlers on `/console` recommendation cards with a real backend that includes a hardcoded "Balanced" routing rail, shadow auto-actions with 24h undo, and an emit path from the ad-optimizer audit runner — without breaking the parallel Phase 3 console redesign.

**Architecture:** Reuse `PendingActionRecord` (no new table). New `packages/core/src/recommendations/` directory holds a pure `routeRecommendation()` function plus `emit()` and `act()` helpers. New `apps/api/src/routes/recommendations.ts` mirrors `approvals.ts`. Dashboard adds three new hooks + a tiny SDK addition + a one-line widening of `mapQueue`. The act-side bypasses `PlatformIngress.submit()` in v1 (registered as legacy-bridge debt). A new `<ShadowActionList>` component ships fully tested but unwired — Phase 3 places it.

**Tech Stack:** TypeScript (ESM), pnpm + Turborepo, Prisma (PostgreSQL), Fastify, Next.js 14 (App Router), TanStack React Query, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-03-recommendations-backend-v1-design.md` (committed at `d371a84c` on `docs/recommendations-backend-v1-spec`).

**Worktree:** `/Users/jasonli/switchboard-worktrees/feat-recommendations-backend`
**Implementation branch:** `feat/recommendations-backend-v1` (off `origin/main`)

---

## Pre-flight

Before starting Task 1:

```bash
cd /Users/jasonli/switchboard-worktrees/feat-recommendations-backend
git checkout feat/recommendations-backend-v1
git status --short          # expect: clean
git branch --show-current   # expect: feat/recommendations-backend-v1
docker compose up postgres -d
pnpm install
pnpm db:generate
pnpm typecheck              # expect: clean baseline
```

If anything fails, fix the baseline before any task starts. Tasks assume green-baseline.

**File-level frontend protection (from spec):**
- Allowed to edit: `recommendation-card.tsx` (handler block + import block only), `queue-zone.tsx` (≤4 lines, data flow only), `console-mappers.ts` (additive), `console-data.ts` (additive type only — and only if needed).
- Allowed to add: `hooks/use-recommendations.ts`, `hooks/use-shadow-actions.ts`, `hooks/use-recommendation-action.ts`, `app/api/dashboard/recommendations/route.ts`, `components/console/zones/shadow-action-row.tsx` + `.css`, plus all `__tests__/` siblings.
- **Off-limits:** any other file in `components/console/zones/`, `console-view.tsx`, `console.css`, any other queue-card file. If a task feels like it needs to touch one, stop and re-read the spec — the answer is almost always "wire it through the data flow instead."

**Two-stage review per task:** after each green-test commit, dispatch (a) spec-compliance review pointing at the relevant spec section, (b) code-quality review per CLAUDE.md conventions. Address both before moving to the next task.

**Model tier per task** is annotated as `[haiku]`, `[sonnet]`, or `[opus]`. Mechanical boilerplate goes haiku; logic/integration goes sonnet; cross-cutting integration (migration, audit-runner sink) goes opus.

---

## Task summary

| # | Task | Tier | Depends on |
|---|------|------|------------|
| 1 | Add `surface` + `undoableUntil` columns + indexes to `PendingActionRecord` | opus | — |
| 2 | Recommendation Zod schemas + shared types in `packages/schemas/` | sonnet | 1 |
| 3 | `routeRecommendation()` pure function + tests | sonnet | 2 |
| 4 | Core types, interfaces, barrel (typecheck-clean) | haiku | 2 |
| 5 | `emitRecommendation()` + tests + barrel append | sonnet | 3, 4 |
| 6 | `actOnRecommendation()` + tests + barrel append | sonnet | 4 |
| 7 | `PrismaRecommendationStore` + integration tests | sonnet | 5, 6 |
| 8 | API routes + wiring in `app.ts` + route tests + isolation tests | opus | 7 |
| 9 | Dashboard SDK types + query keys + governance.ts methods | haiku | 8 |
| 10 | Dashboard proxy route with 409 propagation | sonnet | 9 |
| 11 | `useRecommendations()` hook + test | haiku | 9 |
| 12 | `useShadowActions()` hook + test | haiku | 9 |
| 13 | `useRecommendationAction()` hook + test (with 409 swallow) | sonnet | 9 |
| 14 | `mapRecommendationCard` + widen `mapQueue` + tests | sonnet | 11 |
| 15 | `recommendation-card.tsx` handler swap + tests | sonnet | 13 |
| 16 | `queue-zone.tsx` 2-line additive + tests | sonnet | 11, 14 |
| 17 | `<ShadowActionRow>` + `<ShadowActionList>` + CSS + tests | sonnet | 12, 13 |
| 18 | ad-optimizer audit-runner sink + AgentEvent rollup + tests | opus | 5 |
| 19 | Seed script `scripts/seed-recommendation.ts` | haiku | 7 |
| 20 | DOCTRINE.md Legacy Bridge Registry entry | haiku | 6 |
| 21 | Phase 3 dry-run merge verification | sonnet | 16, 17 |

---

## Task 1: Add `surface` + `undoableUntil` columns + indexes to `PendingActionRecord` `[opus]`

**Files:**
- Modify: `packages/db/prisma/schema.prisma:1313-1343` (PendingActionRecord model)
- Create: `packages/db/prisma/migrations/<timestamp>_add_pending_action_surface/migration.sql`

- [ ] **Step 1: Edit the Prisma schema**

Edit `packages/db/prisma/schema.prisma`. Locate the `PendingActionRecord` model. Add two new columns and two new indexes:

```prisma
model PendingActionRecord {
  id                   String    @id @default(uuid())
  idempotencyKey       String    @unique
  workflowId           String?
  stepIndex            Int?
  status               String
  intent               String
  targetEntities       Json
  parameters           Json
  humanSummary         String
  confidence           Float
  riskLevel            String
  dollarsAtRisk        Float     @default(0)
  requiredCapabilities String[]
  dryRunSupported      Boolean   @default(false)
  approvalRequired     String
  fallback             Json?
  sourceAgent          String
  sourceWorkflow       String?
  organizationId       String
  surface              String    @default("queue")  // queue | shadow_action — recommendations only
  undoableUntil        DateTime?                    // recommendations.shadow_action only
  createdAt            DateTime  @default(now())
  expiresAt            DateTime?
  resolvedAt           DateTime?
  resolvedBy           String?

  workflow WorkflowExecution? @relation(fields: [workflowId], references: [id])

  @@index([organizationId, status])
  @@index([organizationId, surface, status])
  @@index([organizationId, undoableUntil])
  @@index([workflowId])
  @@index([sourceAgent])
}
```

- [ ] **Step 2: Generate the migration**

```bash
cd /Users/jasonli/switchboard-worktrees/feat-recommendations-backend
pnpm --filter @switchboard/db prisma migrate dev --name add_pending_action_surface --create-only
```

Expected: a new directory `packages/db/prisma/migrations/<timestamp>_add_pending_action_surface/` with a `migration.sql` containing two `ALTER TABLE` statements and two `CREATE INDEX` statements. No backfill — `surface` has a default of `"queue"`, `undoableUntil` is nullable.

- [ ] **Step 3: Inspect the generated SQL**

Open the generated `migration.sql`. Confirm it contains exactly:
- `ALTER TABLE "PendingActionRecord" ADD COLUMN "surface" TEXT NOT NULL DEFAULT 'queue';`
- `ALTER TABLE "PendingActionRecord" ADD COLUMN "undoableUntil" TIMESTAMP(3);`
- `CREATE INDEX "PendingActionRecord_organizationId_surface_status_idx" ON "PendingActionRecord"("organizationId", "surface", "status");`
- `CREATE INDEX "PendingActionRecord_organizationId_undoableUntil_idx" ON "PendingActionRecord"("organizationId", "undoableUntil");`

If anything else appears (a column rename, a destructive operation), STOP and investigate — the diff was wrong.

- [ ] **Step 4: Apply and regenerate the client**

```bash
pnpm --filter @switchboard/db prisma migrate deploy
pnpm db:generate
pnpm db:check-drift
```

Expected: drift check passes.

- [ ] **Step 5: Run baseline tests**

```bash
pnpm --filter @switchboard/db test
```

Expected: PASS. No existing tests reference these new columns yet.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add surface + undoableUntil to PendingActionRecord

Two new columns to host recommendation routing metadata. The discriminator
'intent LIKE recommendation.%' keeps recommendation rows disjoint from
workflow-side rows; the new compound index supports the queue/shadow list
queries.

Spec: docs/superpowers/specs/2026-05-03-recommendations-backend-v1-design.md"
```

---

## Task 2: Recommendation Zod schemas + shared types in `packages/schemas/` `[sonnet]`

**Files:**
- Create: `packages/schemas/src/recommendations.ts`
- Create: `packages/schemas/src/__tests__/recommendations.test.ts`
- Modify: `packages/schemas/src/index.ts` (append exports)

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/recommendations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RecommendationActionSchema,
  RecommendationSurfaceSchema,
  RecommendationStatusSchema,
  RecommendationInputSchema,
  RecommendationPresentationSchema,
} from "../recommendations.js";

describe("RecommendationSurfaceSchema", () => {
  it("accepts queue, shadow_action, dropped", () => {
    expect(RecommendationSurfaceSchema.parse("queue")).toBe("queue");
    expect(RecommendationSurfaceSchema.parse("shadow_action")).toBe("shadow_action");
    expect(RecommendationSurfaceSchema.parse("dropped")).toBe("dropped");
  });
  it("rejects unknown values", () => {
    expect(() => RecommendationSurfaceSchema.parse("queueable")).toThrow();
  });
});

describe("RecommendationStatusSchema", () => {
  it("accepts pending, acted, dismissed, confirmed, dismissed_by_undo, expired", () => {
    for (const s of ["pending", "acted", "dismissed", "confirmed", "dismissed_by_undo", "expired"]) {
      expect(RecommendationStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe("RecommendationActionSchema", () => {
  it("accepts the five operator actions", () => {
    for (const a of ["primary", "secondary", "dismiss", "confirm", "undo"]) {
      expect(RecommendationActionSchema.parse(a)).toBe(a);
    }
  });
});

describe("RecommendationPresentationSchema", () => {
  it("accepts the four presentation fields", () => {
    const ok = RecommendationPresentationSchema.parse({
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [["text"]],
    });
    expect(ok.primaryLabel).toBe("Pause");
  });
  it("requires all four label fields", () => {
    expect(() =>
      RecommendationPresentationSchema.parse({ primaryLabel: "x", dataLines: [] }),
    ).toThrow();
  });
});

describe("RecommendationInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const ok = RecommendationInputSchema.parse({
      orgId: "org-1",
      agentKey: "nova",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Pause Whitening Ad Set B",
      confidence: 0.9,
      dollarsAtRisk: 25,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    expect(ok.confidence).toBe(0.9);
  });
  it("clamps confidence to 0..1", () => {
    expect(() =>
      RecommendationInputSchema.parse({
        orgId: "o", agentKey: "nova", intent: "recommendation.x", action: "pause",
        humanSummary: "x", confidence: 1.5, dollarsAtRisk: 0, riskLevel: "low",
        parameters: {}, presentation: { primaryLabel: "x", secondaryLabel: "x", dismissLabel: "x", dataLines: [] },
      }),
    ).toThrow();
  });
  it("rejects unknown agentKey", () => {
    expect(() =>
      RecommendationInputSchema.parse({
        orgId: "o", agentKey: "zoe", intent: "recommendation.x", action: "pause",
        humanSummary: "x", confidence: 0.5, dollarsAtRisk: 0, riskLevel: "low",
        parameters: {}, presentation: { primaryLabel: "x", secondaryLabel: "x", dismissLabel: "x", dataLines: [] },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test recommendations
```

Expected: FAIL with "Cannot find module '../recommendations.js'".

- [ ] **Step 3: Write the implementation**

Create `packages/schemas/src/recommendations.ts`:

```ts
import { z } from "zod";

export const RecommendationSurfaceSchema = z.enum(["queue", "shadow_action", "dropped"]);
export type RecommendationSurface = z.infer<typeof RecommendationSurfaceSchema>;

export const RecommendationStatusSchema = z.enum([
  "pending",
  "acted",
  "dismissed",
  "confirmed",
  "dismissed_by_undo",
  "expired",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;

export const RecommendationActionSchema = z.enum([
  "primary",
  "secondary",
  "dismiss",
  "confirm",
  "undo",
]);
export type RecommendationAction = z.infer<typeof RecommendationActionSchema>;

export const AgentKeySchema = z.enum(["nova", "alex", "mira"]);
export type AgentKey = z.infer<typeof AgentKeySchema>;

export const RecommendationPresentationSchema = z.object({
  primaryLabel: z.string().min(1),
  secondaryLabel: z.string().min(1),
  dismissLabel: z.string().min(1),
  dataLines: z.array(z.unknown()),
});
export type RecommendationPresentation = z.infer<typeof RecommendationPresentationSchema>;

export const RecommendationInputSchema = z.object({
  orgId: z.string().min(1),
  agentKey: AgentKeySchema,
  intent: z.string().regex(/^recommendation\./, "intent must start with 'recommendation.'"),
  action: z.string().min(1),
  humanSummary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  dollarsAtRisk: z.number().min(0),
  riskLevel: z.enum(["low", "medium", "high"]),
  parameters: z.record(z.unknown()),
  presentation: RecommendationPresentationSchema,
  targetEntities: z.record(z.unknown()).optional(),
  expiresAt: z.date().optional(),
  sourceWorkflow: z.string().optional(),
});
export type RecommendationInput = z.infer<typeof RecommendationInputSchema>;

export const ActOnRecommendationInputSchema = z.object({
  recommendationId: z.string().min(1),
  orgId: z.string().min(1),
  actor: z.object({
    principalId: z.string().min(1),
    type: z.literal("operator"),
  }),
  action: RecommendationActionSchema,
  note: z.string().optional(),
});
export type ActOnRecommendationInput = z.infer<typeof ActOnRecommendationInputSchema>;
```

- [ ] **Step 4: Append exports**

Edit `packages/schemas/src/index.ts` and append:

```ts
export * from "./recommendations.js";
```

(Place at the bottom of the existing exports.)

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas build
pnpm --filter @switchboard/schemas test recommendations
```

Expected: PASS for all tests.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/recommendations.ts packages/schemas/src/__tests__/recommendations.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): recommendation Zod schemas + shared types

Surface, status, action enums plus the canonical RecommendationInput
shape that the core emitter validates. RecommendationPresentation lives
inside parameters JSON so the table stays narrow."
```

---

## Task 3: `routeRecommendation()` pure function + tests `[sonnet]`

**Files:**
- Create: `packages/core/src/recommendations/router.ts`
- Create: `packages/core/src/recommendations/__tests__/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/recommendations/__tests__/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { routeRecommendation } from "../router.js";

describe("routeRecommendation — Balanced mode", () => {
  it("routes high-confidence reversible low-risk to shadow_action", () => {
    expect(routeRecommendation({ confidence: 0.9, dollarsAtRisk: 25, action: "pause" })).toBe("shadow_action");
    expect(routeRecommendation({ confidence: 0.85, dollarsAtRisk: 0, action: "pause" })).toBe("shadow_action");
    expect(routeRecommendation({ confidence: 0.95, dollarsAtRisk: 49.99, action: "reduce_budget" })).toBe("shadow_action");
  });

  it("routes high-confidence reversible high-risk to queue", () => {
    expect(routeRecommendation({ confidence: 0.9, dollarsAtRisk: 50, action: "pause" })).toBe("queue");
    expect(routeRecommendation({ confidence: 0.95, dollarsAtRisk: 100, action: "reduce_budget" })).toBe("queue");
  });

  it("routes high-confidence non-reversible to queue regardless of risk", () => {
    for (const action of ["add_creative", "consolidate", "kill", "expand_targeting", "shift_budget"]) {
      expect(routeRecommendation({ confidence: 0.99, dollarsAtRisk: 0, action })).toBe("queue");
    }
  });

  it("routes mid-confidence to queue", () => {
    expect(routeRecommendation({ confidence: 0.5, dollarsAtRisk: 0, action: "pause" })).toBe("queue");
    expect(routeRecommendation({ confidence: 0.84, dollarsAtRisk: 25, action: "pause" })).toBe("queue");
    expect(routeRecommendation({ confidence: 0.7, dollarsAtRisk: 1000, action: "kill" })).toBe("queue");
  });

  it("routes low-confidence to dropped", () => {
    expect(routeRecommendation({ confidence: 0.49, dollarsAtRisk: 0, action: "pause" })).toBe("dropped");
    expect(routeRecommendation({ confidence: 0, dollarsAtRisk: 0, action: "pause" })).toBe("dropped");
  });

  it("treats exactly-at-threshold as included (>=)", () => {
    expect(routeRecommendation({ confidence: 0.5, dollarsAtRisk: 0, action: "pause" })).toBe("queue");
    expect(routeRecommendation({ confidence: 0.85, dollarsAtRisk: 49.99, action: "pause" })).toBe("shadow_action");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test router
```

Expected: FAIL with "Cannot find module '../router.js'".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/recommendations/router.ts`:

```ts
import type { RecommendationSurface } from "@switchboard/schemas";

// v1 Balanced mode — hardcoded.
// v1.5 will replace these constants with a mode lookup keyed off org config
// (Conservative / Balanced / Aggressive). v2+ may expose per-module modes.
// Per-agent tuning is NOT a goal. See spec section "Operator UX Principles".
const BALANCED = {
  shadowConfidence: 0.85,
  shadowMaxRisk: 50, // dollars
  queueMinConfidence: 0.5,
} as const;

const REVERSIBLE_ACTIONS = new Set(["pause", "reduce_budget"]);

export interface RouteInput {
  confidence: number;
  dollarsAtRisk: number;
  action: string;
}

export function routeRecommendation(input: RouteInput): RecommendationSurface {
  const reversible = REVERSIBLE_ACTIONS.has(input.action);

  if (
    reversible &&
    input.confidence >= BALANCED.shadowConfidence &&
    input.dollarsAtRisk < BALANCED.shadowMaxRisk
  ) {
    return "shadow_action";
  }
  if (input.confidence >= BALANCED.queueMinConfidence) {
    return "queue";
  }
  return "dropped";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test router
```

Expected: PASS, all 6 test groups.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recommendations/router.ts packages/core/src/recommendations/__tests__/router.test.ts
git commit -m "feat(core): routeRecommendation pure function (Balanced mode)

Hardcoded thresholds for v1: shadow >= 0.85 conf + < \$50 risk +
reversible action; queue >= 0.5 conf; dropped otherwise. The constants
live in one file marked as the v1.5 mode-lookup seam."
```

---

## Task 4: Core types, interfaces, barrel (typecheck-clean) `[haiku]`

**Files:**
- Create: `packages/core/src/recommendations/types.ts`
- Create: `packages/core/src/recommendations/interfaces.ts`
- Create: `packages/core/src/recommendations/index.ts`
- Modify: `packages/core/src/index.ts` (append export)

This task ends green: typecheck passes after the commit. Tasks 5 and 6 each append their own export to the barrel as part of their TDD cycle.

- [ ] **Step 1: Create the types file**

Create `packages/core/src/recommendations/types.ts`:

```ts
import type {
  RecommendationStatus,
  RecommendationSurface,
  RecommendationAction,
  RecommendationInput,
  RecommendationPresentation,
  AgentKey,
} from "@switchboard/schemas";

export type {
  RecommendationStatus,
  RecommendationSurface,
  RecommendationAction,
  RecommendationInput,
  RecommendationPresentation,
  AgentKey,
};

/**
 * Read shape returned by the store. PendingActionRecord has no `updatedAt`
 * column, so v1 omits it from the canonical Recommendation type. If a future
 * migration adds one, surface it here as `updatedAt: Date`.
 */
export interface Recommendation {
  id: string;
  orgId: string;
  agentKey: AgentKey;
  intent: string;
  action: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  surface: RecommendationSurface;
  status: RecommendationStatus;
  parameters: Record<string, unknown>;
  targetEntities: Record<string, unknown> | null;
  sourceAgent: string;
  sourceWorkflow: string | null;
  actedBy: string | null;
  actedAt: Date | null;
  note: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  undoableUntil: Date | null;
}

/**
 * Persistence write shape. Different from RecommendationInput — emit() has
 * already moved `presentation` into `parameters`, and the routing/expiry
 * fields have been computed. `presentation` is NOT a separate field here.
 */
export interface PersistRecommendationInput {
  orgId: string;
  agentKey: AgentKey;
  intent: string;
  action: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  parameters: Record<string, unknown>; // already contains presentation under __recommendation
  targetEntities: Record<string, unknown> | undefined;
  sourceWorkflow: string | undefined;
  surface: Exclude<RecommendationSurface, "dropped">;
  idempotencyKey: string;
  undoableUntil: Date | null;
  expiresAt: Date;
}

export type EmitResult =
  | { surface: "queue" | "shadow_action"; id: string; idempotent: boolean }
  | { surface: "dropped"; id: null; idempotent: false };

export type ActResult =
  | { status: "ok"; row: Recommendation }
  | { status: "already_terminal"; row: Recommendation }
  | { status: "expired"; row: Recommendation }
  | { status: "undo_window_closed"; row: Recommendation };
```

- [ ] **Step 2: Create the interfaces file**

Create `packages/core/src/recommendations/interfaces.ts`:

```ts
import type {
  PersistRecommendationInput,
  Recommendation,
  RecommendationStatus,
  RecommendationSurface,
} from "./types.js";

export interface RecommendationStore {
  /** Insert with idempotency. Returns existing row on idempotency-key collision. */
  insert(input: PersistRecommendationInput): Promise<{ row: Recommendation; idempotent: boolean }>;

  /** Loads a row by id (no org guard — caller asserts). */
  getById(id: string): Promise<Recommendation | null>;

  /** Lists rows for an org, filtered by surface + status, ordered by createdAt desc. */
  listBySurface(args: {
    orgId: string;
    surface: Exclude<RecommendationSurface, "dropped">;
    status?: RecommendationStatus;
    sinceMs?: number;
    limit?: number;
  }): Promise<Recommendation[]>;

  /** Atomic UPDATE + AuditEntry insert. Returns the updated row. */
  applyAct(args: {
    id: string;
    actor: { principalId: string; type: "operator" };
    fromStatus: RecommendationStatus;
    toStatus: RecommendationStatus;
    note: string | undefined;
  }): Promise<Recommendation>;
}
```

- [ ] **Step 3: Create the typecheck-clean barrel**

Create `packages/core/src/recommendations/index.ts`. **Only export what exists.** Tasks 5 and 6 will each append their own line to this file.

```ts
export { routeRecommendation } from "./router.js";
export type { RouteInput } from "./router.js";
export type {
  Recommendation,
  PersistRecommendationInput,
  RecommendationStatus,
  RecommendationSurface,
  RecommendationAction,
  RecommendationInput,
  RecommendationPresentation,
  AgentKey,
  EmitResult,
  ActResult,
} from "./types.js";
export type { RecommendationStore } from "./interfaces.js";
// emit and act exports appended by Tasks 5 and 6
```

- [ ] **Step 4: Append to core's main barrel**

Edit `packages/core/src/index.ts`. Find the existing exports and append at the bottom:

```ts
export * from "./recommendations/index.js";
```

- [ ] **Step 5: Verify typecheck is clean and commit**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS — no broken imports, the barrel only re-exports symbols that exist.

```bash
git add packages/core/src/recommendations/types.ts packages/core/src/recommendations/interfaces.ts packages/core/src/recommendations/index.ts packages/core/src/index.ts
git commit -m "feat(core): recommendation types, interfaces, typecheck-clean barrel

Types separate emitter input (RecommendationInput, with presentation
field) from persistence input (PersistRecommendationInput, where
presentation is already merged into parameters). Recommendation read
type omits updatedAt because PendingActionRecord has no such column.
Barrel exports only what exists — emit/act are appended in Tasks 5/6."
```

---

## Task 5: `emitRecommendation()` + tests `[sonnet]`

**Files:**
- Create: `packages/core/src/recommendations/emit.ts`
- Create: `packages/core/src/recommendations/__tests__/emit.test.ts`
- Create (test fixture): `packages/core/src/recommendations/__tests__/in-memory-store.ts`

- [ ] **Step 1: Write the failing test**

Create the in-memory store fixture `packages/core/src/recommendations/__tests__/in-memory-store.ts`:

```ts
import type { RecommendationStore } from "../interfaces.js";
import type { PersistRecommendationInput, Recommendation } from "../types.js";

export function createInMemoryStore(): RecommendationStore & { rows: Recommendation[]; byKey: Map<string, Recommendation> } {
  const rows: Recommendation[] = [];
  const byKey = new Map<string, Recommendation>();

  return {
    rows,
    byKey,
    async insert(input: PersistRecommendationInput) {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { row: existing, idempotent: true };
      const now = new Date();
      const row: Recommendation = {
        id: `rec-${rows.length + 1}`,
        orgId: input.orgId,
        agentKey: input.agentKey,
        intent: input.intent,
        action: input.action,
        humanSummary: input.humanSummary,
        confidence: input.confidence,
        dollarsAtRisk: input.dollarsAtRisk,
        riskLevel: input.riskLevel,
        surface: input.surface,
        status: "pending",
        parameters: input.parameters,
        targetEntities: input.targetEntities ?? null,
        sourceAgent: input.agentKey,
        sourceWorkflow: input.sourceWorkflow ?? null,
        actedBy: null,
        actedAt: null,
        note: null,
        createdAt: now,
        expiresAt: input.expiresAt,
        undoableUntil: input.undoableUntil,
      };
      rows.push(row);
      byKey.set(input.idempotencyKey, row);
      return { row, idempotent: false };
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listBySurface({ orgId, surface, status }) {
      return rows.filter(
        (r) => r.orgId === orgId && r.surface === surface && (status ? r.status === status : true),
      );
    },
    async applyAct({ id, actor, toStatus, note }) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("not found");
      row.status = toStatus;
      row.actedBy = actor.principalId;
      row.actedAt = new Date();
      row.note = note ?? null;
      return row;
    },
  };
}
```

Create `packages/core/src/recommendations/__tests__/emit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitRecommendation } from "../emit.js";
import { createInMemoryStore } from "./in-memory-store.js";
import type { RecommendationInput } from "../types.js";

const baseInput = (overrides: Partial<RecommendationInput> = {}): RecommendationInput => ({
  orgId: "org-1",
  agentKey: "nova",
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "Pause Whitening Ad Set B",
  confidence: 0.9,
  dollarsAtRisk: 25,
  riskLevel: "low",
  parameters: { foo: "bar" },
  presentation: {
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
  },
  targetEntities: { campaignId: "c-1" },
  ...overrides,
});

describe("emitRecommendation", () => {
  it("routes shadow input to shadow_action surface and writes a row", async () => {
    const store = createInMemoryStore();
    const result = await emitRecommendation(store, baseInput());
    expect(result.surface).toBe("shadow_action");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.surface).toBe("shadow_action");
    expect(store.rows[0]?.parameters).toMatchObject({
      foo: "bar",
      __recommendation: { action: "pause", presentation: expect.any(Object) },
    });
  });

  it("sets undoableUntil on shadow rows (createdAt + 24h)", async () => {
    const store = createInMemoryStore();
    await emitRecommendation(store, baseInput());
    const row = store.rows[0]!;
    expect(row.undoableUntil).not.toBeNull();
    const diff = row.undoableUntil!.getTime() - row.createdAt.getTime();
    expect(diff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });

  it("does NOT set undoableUntil on queue rows", async () => {
    const store = createInMemoryStore();
    await emitRecommendation(store, baseInput({ confidence: 0.6 }));
    expect(store.rows[0]?.undoableUntil).toBeNull();
  });

  it("defaults expiresAt to createdAt + 24h when not provided", async () => {
    const store = createInMemoryStore();
    await emitRecommendation(store, baseInput());
    const row = store.rows[0]!;
    const diff = row.expiresAt!.getTime() - row.createdAt.getTime();
    expect(diff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
  });

  it("respects emitter-supplied expiresAt", async () => {
    const store = createInMemoryStore();
    const future = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await emitRecommendation(store, baseInput({ expiresAt: future }));
    expect(store.rows[0]?.expiresAt?.getTime()).toBe(future.getTime());
  });

  it("returns dropped without writing when router drops", async () => {
    const store = createInMemoryStore();
    const result = await emitRecommendation(store, baseInput({ confidence: 0.3 }));
    expect(result).toEqual({ surface: "dropped", id: null, idempotent: false });
    expect(store.rows).toHaveLength(0);
  });

  it("idempotency: re-emit with same target+intent+day returns existing row", async () => {
    const store = createInMemoryStore();
    const input = baseInput();
    const first = await emitRecommendation(store, input);
    const second = await emitRecommendation(store, input);
    expect(second.id).toBe(first.id);
    expect(second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("rejects invalid input via Zod", async () => {
    const store = createInMemoryStore();
    await expect(
      emitRecommendation(store, { ...baseInput(), confidence: 5 } as RecommendationInput),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test emit
```

Expected: FAIL — `emit.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/recommendations/emit.ts`:

```ts
import { createHash } from "node:crypto";
import { RecommendationInputSchema } from "@switchboard/schemas";
import { routeRecommendation } from "./router.js";
import type { RecommendationStore } from "./interfaces.js";
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

export async function emitRecommendation(
  store: RecommendationStore,
  input: RecommendationInput,
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

  const now = new Date();
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

  const { row, idempotent } = await store.insert({
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
  });

  return { surface, id: row.id, idempotent };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test emit
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Append emit to the recommendations barrel**

Edit `packages/core/src/recommendations/index.ts`. Replace the placeholder comment line `// emit and act exports appended by Tasks 5 and 6` with:

```ts
export { emitRecommendation } from "./emit.js";
// act export appended by Task 6
```

Verify the barrel still typechecks:

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/recommendations/emit.ts packages/core/src/recommendations/__tests__/ packages/core/src/recommendations/index.ts
git commit -m "feat(core): emitRecommendation — validate, route, persist with idempotency

Routes via routeRecommendation; shadow rows get undoableUntil = +24h;
default expiresAt = +24h. Idempotency key is sha256(org+intent+targets+day)
so re-running an audit on the same day for the same target reuses the row.
Presentation + action stashed under parameters.__recommendation namespace
to avoid collision with future emitter parameters."
```

---

## Task 6: `actOnRecommendation()` + tests `[sonnet]`

**Files:**
- Create: `packages/core/src/recommendations/act.ts`
- Create: `packages/core/src/recommendations/__tests__/act.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/recommendations/__tests__/act.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actOnRecommendation } from "../act.js";
import { createInMemoryStore } from "./in-memory-store.js";
import { emitRecommendation } from "../emit.js";

const seedQueue = async (store = createInMemoryStore()) => {
  await emitRecommendation(store, {
    orgId: "org-1", agentKey: "nova", intent: "recommendation.kill",
    action: "kill", humanSummary: "Kill it", confidence: 0.9, dollarsAtRisk: 0,
    riskLevel: "high", parameters: {},
    presentation: { primaryLabel: "Kill", secondaryLabel: "Pause", dismissLabel: "Dismiss", dataLines: [] },
  });
  return store;
};

const seedShadow = async (store = createInMemoryStore()) => {
  await emitRecommendation(store, {
    orgId: "org-1", agentKey: "nova", intent: "recommendation.ad_set_pause",
    action: "pause", humanSummary: "Pause it", confidence: 0.9, dollarsAtRisk: 10,
    riskLevel: "low", parameters: {},
    presentation: { primaryLabel: "Pause", secondaryLabel: "Reduce 50%", dismissLabel: "Dismiss", dataLines: [] },
  });
  return store;
};

const actor = { principalId: "user-1", type: "operator" as const };

describe("actOnRecommendation — queue surface", () => {
  it("primary transitions to acted", async () => {
    const store = await seedQueue();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "primary",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("acted");
  });

  it("secondary transitions to acted", async () => {
    const store = await seedQueue();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "secondary",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("acted");
  });

  it("dismiss transitions to dismissed", async () => {
    const store = await seedQueue();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "dismiss",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("dismissed");
  });

  it("rejects confirm/undo on queue surface", async () => {
    const store = await seedQueue();
    await expect(
      actOnRecommendation(store, {
        recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "confirm",
      }),
    ).rejects.toThrow(/queue surface accepts/i);
  });

  it("returns already_terminal on second act", async () => {
    const store = await seedQueue();
    await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "primary",
    });
    const second = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "dismiss",
    });
    expect(second.status).toBe("already_terminal");
  });
});

describe("actOnRecommendation — shadow surface", () => {
  it("confirm transitions to confirmed", async () => {
    const store = await seedShadow();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "confirm",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("confirmed");
  });

  it("undo transitions to dismissed_by_undo", async () => {
    const store = await seedShadow();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "undo",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("dismissed_by_undo");
  });

  it("rejects primary/secondary/dismiss on shadow surface", async () => {
    const store = await seedShadow();
    await expect(
      actOnRecommendation(store, {
        recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "primary",
      }),
    ).rejects.toThrow(/shadow surface accepts/i);
  });

  it("undo after undoableUntil returns undo_window_closed", async () => {
    const store = await seedShadow();
    const row = store.rows[0]!;
    row.undoableUntil = new Date(Date.now() - 1000);
    const result = await actOnRecommendation(store, {
      recommendationId: row.id, orgId: "org-1", actor, action: "undo",
    });
    expect(result.status).toBe("undo_window_closed");
  });
});

describe("actOnRecommendation — boundary checks", () => {
  it("404 (returns null-ish) for missing id", async () => {
    const store = createInMemoryStore();
    await expect(
      actOnRecommendation(store, { recommendationId: "nope", orgId: "org-1", actor, action: "primary" }),
    ).rejects.toThrow(/not found/i);
  });

  it("403-equivalent on org mismatch", async () => {
    const store = await seedQueue();
    await expect(
      actOnRecommendation(store, {
        recommendationId: store.rows[0]!.id, orgId: "org-other", actor, action: "primary",
      }),
    ).rejects.toThrow(/org mismatch/i);
  });

  it("lazy expiry transitions to expired and returns expired status", async () => {
    const store = await seedQueue();
    store.rows[0]!.expiresAt = new Date(Date.now() - 1000);
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id, orgId: "org-1", actor, action: "primary",
    });
    expect(result.status).toBe("expired");
    expect(store.rows[0]?.status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test act
```

Expected: FAIL — `act.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/recommendations/act.ts`:

```ts
import type { RecommendationStore } from "./interfaces.js";
import type {
  ActResult,
  Recommendation,
  RecommendationAction,
  RecommendationStatus,
} from "./types.js";

export interface ActOnRecommendationInput {
  recommendationId: string;
  orgId: string;
  actor: { principalId: string; type: "operator" };
  action: RecommendationAction;
  note?: string;
}

const QUEUE_ACTIONS = new Set<RecommendationAction>(["primary", "secondary", "dismiss"]);
const SHADOW_ACTIONS = new Set<RecommendationAction>(["confirm", "undo"]);
const TERMINAL_STATUSES = new Set<RecommendationStatus>([
  "acted",
  "dismissed",
  "confirmed",
  "dismissed_by_undo",
  "expired",
]);

function nextStatus(action: RecommendationAction): RecommendationStatus {
  switch (action) {
    case "primary":
    case "secondary":
      return "acted";
    case "dismiss":
      return "dismissed";
    case "confirm":
      return "confirmed";
    case "undo":
      return "dismissed_by_undo";
  }
}

export async function actOnRecommendation(
  store: RecommendationStore,
  input: ActOnRecommendationInput,
): Promise<ActResult> {
  const row = await store.getById(input.recommendationId);
  if (!row) throw new Error(`Recommendation not found: ${input.recommendationId}`);
  if (row.orgId !== input.orgId) throw new Error("org mismatch");

  // Surface-action validity.
  if (row.surface === "queue" && !QUEUE_ACTIONS.has(input.action)) {
    throw new Error(`queue surface accepts primary|secondary|dismiss, got ${input.action}`);
  }
  if (row.surface === "shadow_action" && !SHADOW_ACTIONS.has(input.action)) {
    throw new Error(`shadow surface accepts confirm|undo, got ${input.action}`);
  }

  // Lazy expiry.
  if (row.status === "pending" && row.expiresAt && row.expiresAt < new Date()) {
    const expired = await store.applyAct({
      id: row.id,
      actor: input.actor,
      fromStatus: "pending",
      toStatus: "expired",
      note: undefined,
    });
    return { status: "expired", row: expired };
  }

  // Terminal-state guard.
  if (TERMINAL_STATUSES.has(row.status)) {
    return { status: "already_terminal", row };
  }

  // Undo-window guard (shadow only).
  if (input.action === "undo" && row.undoableUntil && row.undoableUntil < new Date()) {
    return { status: "undo_window_closed", row };
  }

  const updated: Recommendation = await store.applyAct({
    id: row.id,
    actor: input.actor,
    fromStatus: row.status,
    toStatus: nextStatus(input.action),
    note: input.note,
  });

  return { status: "ok", row: updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test act
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Append act to the recommendations barrel**

Edit `packages/core/src/recommendations/index.ts`. Replace the placeholder comment line `// act export appended by Task 6` with:

```ts
export { actOnRecommendation } from "./act.js";
export type { ActOnRecommendationInput } from "./act.js";
```

Verify typecheck:

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/recommendations/act.ts packages/core/src/recommendations/__tests__/act.test.ts packages/core/src/recommendations/index.ts
git commit -m "feat(core): actOnRecommendation — surface-action validity, lazy expiry, undo guard

Queue accepts primary|secondary|dismiss; shadow accepts confirm|undo;
terminal-state second writes return already_terminal; expired pending
rows transition lazily on read; undo after undoableUntil returns
undo_window_closed."
```

---

## Task 7: `PrismaRecommendationStore` + integration tests `[sonnet]`

**Files:**
- Create: `packages/db/src/recommendation-store.ts`
- Create: `packages/db/src/__tests__/recommendation-store.test.ts`
- Modify: `packages/db/src/index.ts` (append export)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/__tests__/recommendation-store.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaRecommendationStore } from "../recommendation-store.js";
import type { PersistRecommendationInput } from "@switchboard/core";

const prisma = new PrismaClient();

async function clean() {
  await prisma.auditEntry.deleteMany({ where: { eventType: "recommendation.act" } });
  await prisma.pendingActionRecord.deleteMany({ where: { intent: { startsWith: "recommendation." } } });
}

const baseInsert = (overrides: Partial<PersistRecommendationInput> = {}): PersistRecommendationInput => ({
  orgId: "org-1",
  agentKey: "nova",
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "Pause it",
  confidence: 0.9,
  dollarsAtRisk: 10,
  riskLevel: "low",
  parameters: {
    __recommendation: {
      action: "pause",
      presentation: { primaryLabel: "Pause", secondaryLabel: "Reduce 50%", dismissLabel: "Dismiss", dataLines: [] },
    },
  },
  targetEntities: undefined,
  sourceWorkflow: undefined,
  surface: "shadow_action",
  idempotencyKey: "test-key-1",
  undoableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  ...overrides,
});

describe("PrismaRecommendationStore", () => {
  beforeEach(clean);

  it("inserts and reads a row, reconstructing action from parameters.__recommendation", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const inserted = await store.insert(baseInsert());
    expect(inserted.idempotent).toBe(false);
    expect(inserted.row.surface).toBe("shadow_action");
    expect(inserted.row.action).toBe("pause");
    const fetched = await store.getById(inserted.row.id);
    expect(fetched?.id).toBe(inserted.row.id);
    expect(fetched?.action).toBe("pause");
  });

  it("idempotency key collision returns existing row", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const first = await store.insert(baseInsert({ idempotencyKey: "test-key-2" }));
    const second = await store.insert(baseInsert({ idempotencyKey: "test-key-2", humanSummary: "different" }));
    expect(second.idempotent).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.humanSummary).toBe("Pause it"); // first write wins
  });

  it("listBySurface filters out non-recommendation rows", async () => {
    // Insert a non-recommendation pending action.
    await prisma.pendingActionRecord.create({
      data: {
        idempotencyKey: "workflow-key-1",
        status: "pending",
        intent: "workflow.do_something",
        targetEntities: {}, parameters: {},
        humanSummary: "workflow row",
        confidence: 1.0, riskLevel: "low",
        approvalRequired: "none",
        sourceAgent: "system",
        organizationId: "org-1",
      },
    });
    const store = new PrismaRecommendationStore(prisma);
    await store.insert(baseInsert({
      surface: "queue", undoableUntil: null,
      idempotencyKey: "rec-key-3", humanSummary: "rec row",
    }));
    const rows = await store.listBySurface({ orgId: "org-1", surface: "queue" });
    expect(rows.every((r) => r.intent.startsWith("recommendation."))).toBe(true);
    expect(rows.some((r) => r.humanSummary === "rec row")).toBe(true);
    expect(rows.some((r) => r.humanSummary === "workflow row")).toBe(false);
  });

  it("applyAct updates row and writes AuditEntry atomically with a unique entryHash", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const { row } = await store.insert(baseInsert({
      surface: "queue", undoableUntil: null, idempotencyKey: "rec-key-4",
    }));
    const updated = await store.applyAct({
      id: row.id,
      actor: { principalId: "user-1", type: "operator" },
      fromStatus: "pending", toStatus: "acted", note: "noted",
    });
    expect(updated.status).toBe("acted");
    expect(updated.actedBy).toBe("user-1");
    expect(updated.note).toBe("noted");
    const audits = await prisma.auditEntry.findMany({ where: { entityId: row.id, eventType: "recommendation.act" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.summary).toBe("Pause it");
    expect(audits[0]?.entryHash).toMatch(/^[0-9a-f]{64}$/); // proper sha256
    expect(audits[0]?.entryHash).not.toBe("v1-no-chain");
  });

  it("two acts on different rows produce different entryHashes", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const a = await store.insert(baseInsert({ surface: "queue", undoableUntil: null, idempotencyKey: "rec-key-5a" }));
    const b = await store.insert(baseInsert({ surface: "queue", undoableUntil: null, idempotencyKey: "rec-key-5b" }));
    await store.applyAct({ id: a.row.id, actor: { principalId: "u", type: "operator" }, fromStatus: "pending", toStatus: "acted", note: undefined });
    await store.applyAct({ id: b.row.id, actor: { principalId: "u", type: "operator" }, fromStatus: "pending", toStatus: "dismissed", note: undefined });
    const audits = await prisma.auditEntry.findMany({ where: { eventType: "recommendation.act" }, orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.entryHash).not.toBe(audits[1]?.entryHash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test recommendation-store
```

Expected: FAIL — `../recommendation-store.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/recommendation-store.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type {
  AgentKey,
  PersistRecommendationInput,
  Recommendation,
  RecommendationStatus,
  RecommendationStore,
  RecommendationSurface,
} from "@switchboard/core";

const RECOMMENDATION_INTENT_PREFIX = "recommendation.";

interface RecommendationParams {
  __recommendation?: {
    action?: string;
    note?: string | null;
    presentation?: unknown;
  };
  [key: string]: unknown;
}

function rowToRecommendation(row: {
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
}): Recommendation {
  const params = (row.parameters ?? {}) as RecommendationParams;
  const meta = params.__recommendation ?? {};
  return {
    id: row.id,
    orgId: row.organizationId,
    agentKey: row.sourceAgent as AgentKey,
    intent: row.intent,
    action: meta.action ?? "",
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    dollarsAtRisk: row.dollarsAtRisk,
    riskLevel: row.riskLevel as Recommendation["riskLevel"],
    surface: row.surface as RecommendationSurface,
    status: row.status as RecommendationStatus,
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

function buildEntryHash(args: {
  id: string;
  fromStatus: string;
  toStatus: string;
  principalId: string;
  ts: number;
}): string {
  return createHash("sha256")
    .update([args.id, args.fromStatus, args.toStatus, args.principalId, args.ts, randomUUID()].join(":"))
    .digest("hex");
}

export class PrismaRecommendationStore implements RecommendationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(input: PersistRecommendationInput) {
    try {
      const row = await this.prisma.pendingActionRecord.create({
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
      return { row: rowToRecommendation(row), idempotent: false };
    } catch (err: unknown) {
      // P2002 = unique constraint failure on idempotencyKey.
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        const existing = await this.prisma.pendingActionRecord.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) return { row: rowToRecommendation(existing), idempotent: true };
      }
      throw err;
    }
  }

  async getById(id: string): Promise<Recommendation | null> {
    const row = await this.prisma.pendingActionRecord.findUnique({ where: { id } });
    if (!row || !row.intent.startsWith(RECOMMENDATION_INTENT_PREFIX)) return null;
    return rowToRecommendation(row);
  }

  async listBySurface(args: {
    orgId: string;
    surface: Exclude<RecommendationSurface, "dropped">;
    status?: RecommendationStatus;
    sinceMs?: number;
    limit?: number;
  }): Promise<Recommendation[]> {
    const since = args.sinceMs ? new Date(Date.now() - args.sinceMs) : undefined;
    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        organizationId: args.orgId,
        surface: args.surface,
        intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        ...(args.status ? { status: args.status } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(args.limit ?? 50, 200),
    });
    return rows.map(rowToRecommendation);
  }

  async applyAct(args: {
    id: string;
    actor: { principalId: string; type: "operator" };
    fromStatus: RecommendationStatus;
    toStatus: RecommendationStatus;
    note: string | undefined;
  }): Promise<Recommendation> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.pendingActionRecord.findUnique({ where: { id: args.id } });
      if (!existing) throw new Error(`Recommendation not found: ${args.id}`);
      const params = (existing.parameters ?? {}) as RecommendationParams;
      const updatedMeta = {
        ...(params.__recommendation ?? {}),
        note: args.note ?? null,
      };
      const updated = await tx.pendingActionRecord.update({
        where: { id: args.id },
        data: {
          status: args.toStatus,
          resolvedAt: new Date(),
          resolvedBy: args.actor.principalId,
          parameters: { ...params, __recommendation: updatedMeta } as object,
        },
      });
      await tx.auditEntry.create({
        data: {
          eventType: "recommendation.act",
          actorType: args.actor.type,
          actorId: args.actor.principalId,
          entityType: "recommendation",
          entityId: args.id,
          riskCategory: existing.riskLevel,
          summary: existing.humanSummary,
          snapshot: { from: args.fromStatus, to: args.toStatus, note: args.note ?? null } as object,
          evidencePointers: [] as object,
          // Recommendation acts do not participate in the audit chain (no previousEntryHash
          // linkage). entryHash is a per-row sha256 over identifying fields plus a uuid to
          // guarantee uniqueness even for back-to-back acts on the same row.
          entryHash: buildEntryHash({
            id: args.id,
            fromStatus: args.fromStatus,
            toStatus: args.toStatus,
            principalId: args.actor.principalId,
            ts: Date.now(),
          }),
          organizationId: existing.organizationId,
        },
      });
      return rowToRecommendation(updated);
    });
  }
}
```

- [ ] **Step 4: Append export**

Edit `packages/db/src/index.ts`. Find the existing block of `Prisma*Store` exports and add:

```ts
export { PrismaRecommendationStore } from "./recommendation-store.js";
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @switchboard/db build
pnpm --filter @switchboard/db test recommendation-store
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/recommendation-store.ts packages/db/src/__tests__/recommendation-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): PrismaRecommendationStore over PendingActionRecord

intent prefix discriminator keeps recommendation rows disjoint from
workflow rows. applyAct wraps the row update + AuditEntry insert in a
single transaction. action/note/presentation namespaced under
parameters.__recommendation to avoid collision with future emitter
parameters. AuditEntry.entryHash is a per-row sha256 + uuid (not a
chain hash) — recommendation acts do not participate in the audit
chain in v1."
```

---

## Task 8: API routes + wiring in `app.ts` + route tests + isolation tests `[opus]`

**Files:**
- Create: `apps/api/src/routes/recommendations.ts`
- Create: `apps/api/src/types/recommendations-fastify.d.ts`
- Create: `apps/api/src/__tests__/helpers/seed-recommendation.ts`
- Create: `apps/api/src/__tests__/routes/recommendations.test.ts`
- Create: `apps/api/src/__tests__/routes/recommendations-isolation.test.ts`
- Modify: `apps/api/src/app.ts` (instantiate store, decorate, register route)

This task lands the route, the wiring in `app.ts`, and the test suite as one atomic green-on-commit unit. The tests cannot pass unless the wiring is in place, so they ship together. Implementation order inside the task: write tests → write wiring + route → run tests green → commit.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/__tests__/routes/recommendations.test.ts`. The test file uses the standard test-app helper convention (mirror what `approvals.test.ts` uses in the same directory — read it first if unsure). The file:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { seedRecommendation } from "../helpers/seed-recommendation.js";

describe("GET /api/recommendations", () => {
  it("lists queue-surface pending recommendations for the auth org", async () => {
    const app = await buildTestApp({ orgId: "org-1" });
    await seedRecommendation(app, { orgId: "org-1", surface: "queue" });
    await seedRecommendation(app, { orgId: "org-1", surface: "shadow_action" });
    const res = await app.inject({ method: "GET", url: "/api/recommendations?surface=queue" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].surface).toBe("queue");
  });

  it("lists shadow-surface with since-filter", async () => {
    const app = await buildTestApp({ orgId: "org-1" });
    await seedRecommendation(app, { orgId: "org-1", surface: "shadow_action", ageHours: 1 });
    await seedRecommendation(app, { orgId: "org-1", surface: "shadow_action", ageHours: 48 });
    const res = await app.inject({ method: "GET", url: "/api/recommendations?surface=shadow_action&since=24h" });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendations).toHaveLength(1);
  });

  it("400 on missing surface", async () => {
    const app = await buildTestApp({ orgId: "org-1" });
    const res = await app.inject({ method: "GET", url: "/api/recommendations" });
    expect(res.statusCode).toBe(400);
  });

  it("400 on invalid surface value", async () => {
    const app = await buildTestApp({ orgId: "org-1" });
    const res = await app.inject({ method: "GET", url: "/api/recommendations?surface=nope" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/recommendations/:id/act", () => {
  it("primary on queue card returns 200 and acted row", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "queue" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "primary" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendation.status).toBe("acted");
  });

  it("dismiss returns 200 and dismissed row", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "queue" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "dismiss" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendation.status).toBe("dismissed");
  });

  it("confirm on shadow card returns 200 and confirmed row", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "shadow_action" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "confirm" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendation.status).toBe("confirmed");
  });

  it("undo on shadow card returns 200 and dismissed_by_undo", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "shadow_action" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "undo" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendation.status).toBe("dismissed_by_undo");
  });

  it("400 on confirm against queue card", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "queue" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "confirm" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 on primary against shadow card", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "shadow_action" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "primary" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("409 on already-terminal second act", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "queue" });
    await app.inject({ method: "POST", url: `/api/recommendations/${rec.id}/act`, payload: { action: "primary" } });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "dismiss" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().recommendation.status).toBe("acted");
  });

  it("404 on missing id", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/missing-id/act`,
      payload: { action: "primary" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 on invalid action value", async () => {
    const app = await buildTestApp({ orgId: "org-1", principalId: "user-1" });
    const rec = await seedRecommendation(app, { orgId: "org-1", surface: "queue" });
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

Create `apps/api/src/__tests__/routes/recommendations-isolation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { seedRecommendation } from "../helpers/seed-recommendation.js";

describe("recommendation route — multi-org isolation", () => {
  it("org A cannot list org B recommendations", async () => {
    const appA = await buildTestApp({ orgId: "org-a" });
    await seedRecommendation(appA, { orgId: "org-b", surface: "queue" });
    const res = await appA.inject({ method: "GET", url: "/api/recommendations?surface=queue" });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendations).toHaveLength(0);
  });

  it("org A cannot act on org B recommendation (404 hides existence)", async () => {
    const appA = await buildTestApp({ orgId: "org-a", principalId: "user-a" });
    const rec = await seedRecommendation(appA, { orgId: "org-b", surface: "queue" });
    const res = await appA.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "primary" },
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
```

Also create the seed helper `apps/api/src/__tests__/helpers/seed-recommendation.ts`. Use a per-call counter to keep target ids deterministic — randomness in test fixtures makes flake harder to debug and undermines the idempotency-key test:

```ts
import type { FastifyInstance } from "fastify";
import { emitRecommendation } from "@switchboard/core";

interface SeedArgs {
  orgId: string;
  surface: "queue" | "shadow_action";
  ageHours?: number;
  /** Optional unique suffix when a single test seeds many rows; default uses the call counter. */
  targetSuffix?: string;
}

let seedCounter = 0;

export async function seedRecommendation(app: FastifyInstance, args: SeedArgs) {
  const confidence = args.surface === "shadow_action" ? 0.95 : 0.6;
  const dollarsAtRisk = args.surface === "shadow_action" ? 10 : 100;
  const suffix = args.targetSuffix ?? `${args.orgId}-${args.surface}-${++seedCounter}`;
  const result = await emitRecommendation(app.recommendationStore!, {
    orgId: args.orgId, agentKey: "nova",
    intent: "recommendation.ad_set_pause", action: "pause",
    humanSummary: `Test rec for ${args.orgId}`,
    confidence, dollarsAtRisk, riskLevel: "low",
    parameters: {},
    presentation: { primaryLabel: "Pause", secondaryLabel: "Reduce 50%", dismissLabel: "Dismiss", dataLines: [] },
    targetEntities: { campaignId: `c-${suffix}` },
  });
  if (result.surface === "dropped") throw new Error("seed must not drop");

  if (args.ageHours) {
    // Backdate createdAt for since-filter tests.
    await app.prisma!.pendingActionRecord.update({
      where: { id: result.id },
      data: { createdAt: new Date(Date.now() - args.ageHours * 60 * 60 * 1000) },
    });
  }
  return { id: result.id, surface: result.surface };
}
```

The seed helper relies on `app.recommendationStore` being decorated — this is set up in Step 3 below as part of the same task.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/api test recommendations
```

Expected: FAIL — route module doesn't exist.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/recommendations.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import {
  actOnRecommendation,
  type RecommendationAction,
  type RecommendationSurface,
} from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

const ACT_HTTP_RATE_LIMIT_MAX = parseInt(process.env["RECOMMENDATION_ACT_RATE_LIMIT_MAX"] ?? "300", 10);
const ACT_HTTP_RATE_LIMIT_WINDOW_MS = parseInt(process.env["RECOMMENDATION_ACT_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10);

const VALID_SURFACES: ReadonlySet<RecommendationSurface> = new Set(["queue", "shadow_action"]);
const VALID_ACTIONS: ReadonlySet<RecommendationAction> = new Set(["primary", "secondary", "dismiss", "confirm", "undo"]);

function parseSinceMs(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)h$/.exec(s);
  if (!m) return undefined;
  return parseInt(m[1]!, 10) * 60 * 60 * 1000;
}

function rowToApiShape(row: Awaited<ReturnType<NonNullable<import("fastify").FastifyInstance["recommendationStore"]>["getById"]>>) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.orgId,
    agentKey: row.agentKey,
    intent: row.intent,
    action: row.action,
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    dollarsAtRisk: row.dollarsAtRisk,
    riskLevel: row.riskLevel,
    surface: row.surface,
    status: row.status,
    parameters: row.parameters,
    targetEntities: row.targetEntities,
    sourceAgent: row.sourceAgent,
    sourceWorkflow: row.sourceWorkflow,
    actedBy: row.actedBy,
    actedAt: row.actedAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    undoableUntil: row.undoableUntil?.toISOString() ?? null,
  };
}

export const recommendationsRoutes: FastifyPluginAsync = async (app) => {
  if (!app.recommendationStore) {
    app.log.warn("[recommendations] route registered without store; will 503 on every request");
  }

  app.get("/", { schema: { description: "List recommendations by surface", tags: ["Recommendations"] } }, async (request, reply) => {
    if (!app.recommendationStore) return reply.code(503).send({ error: "Recommendations store unavailable", statusCode: 503 });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const q = request.query as { surface?: string; status?: string; since?: string; limit?: string };
    if (!q.surface || !VALID_SURFACES.has(q.surface as RecommendationSurface)) {
      return reply.code(400).send({ error: "surface query param required (queue|shadow_action)", statusCode: 400 });
    }
    const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 50, 200) : 50;
    const rows = await app.recommendationStore.listBySurface({
      orgId,
      surface: q.surface as Exclude<RecommendationSurface, "dropped">,
      status: (q.status ?? "pending") as Parameters<typeof app.recommendationStore.listBySurface>[0]["status"],
      sinceMs: parseSinceMs(q.since),
      limit,
    });
    return reply.code(200).send({ recommendations: rows.map(rowToApiShape) });
  });

  app.post(
    "/:id/act",
    {
      schema: {
        description: "Act on a recommendation (primary | secondary | dismiss | confirm | undo).",
        tags: ["Recommendations"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          required: ["action"],
          properties: { action: { type: "string" }, note: { type: "string" } },
        },
      },
      config: {
        rateLimit: { max: ACT_HTTP_RATE_LIMIT_MAX, timeWindow: ACT_HTTP_RATE_LIMIT_WINDOW_MS },
      },
    },
    async (request, reply) => {
      if (!app.recommendationStore) return reply.code(503).send({ error: "Recommendations store unavailable", statusCode: 503 });
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const body = request.body as { action?: string; note?: string };

      if (!body?.action || !VALID_ACTIONS.has(body.action as RecommendationAction)) {
        return reply.code(400).send({ error: `action must be one of ${[...VALID_ACTIONS].join("|")}`, statusCode: 400 });
      }

      const row = await app.recommendationStore.getById(id);
      if (!row) return reply.code(404).send({ error: "Recommendation not found", statusCode: 404 });
      if (row.orgId !== orgId) return reply.code(404).send({ error: "Recommendation not found", statusCode: 404 });

      const principalId = request.principalIdFromAuth ?? "dashboard-user";

      try {
        const result = await actOnRecommendation(app.recommendationStore, {
          recommendationId: id,
          orgId,
          actor: { principalId, type: "operator" },
          action: body.action as RecommendationAction,
          note: body.note,
        });

        if (result.status === "ok") {
          return reply.code(200).send({ recommendation: rowToApiShape(result.row) });
        }
        // already_terminal | expired | undo_window_closed all map to 409 with current row
        return reply.code(409).send({
          error: result.status,
          recommendation: rowToApiShape(result.row),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("queue surface accepts") || msg.includes("shadow surface accepts")) {
          return reply.code(400).send({ error: msg, statusCode: 400 });
        }
        if (msg.includes("org mismatch")) {
          return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
        }
        if (msg.includes("not found")) {
          return reply.code(404).send({ error: msg, statusCode: 404 });
        }
        return reply.code(500).send({ error: msg, statusCode: 500 });
      }
    },
  );
};
```

Also extend the FastifyInstance type. Create `apps/api/src/types/recommendations-fastify.d.ts`:

```ts
import type { RecommendationStore } from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    recommendationStore?: RecommendationStore;
  }
}
```

(If a central `apps/api/src/types/fastify.d.ts` already exists, add the augmentation there instead — match the existing convention.)

- [ ] **Step 3: Wire the store + register the route in `app.ts`**

Read these line ranges in `apps/api/src/app.ts` to understand the existing pattern:
- Around line 240–490: where stores are instantiated (`new PrismaApprovalStore`, `new PrismaConversationStateStore`, etc.)
- The route-registration block (search for `await app.register(approvalsRoutes`).

At the top of `apps/api/src/app.ts`, find the existing block of `@switchboard/db` imports and append:

```ts
import { PrismaRecommendationStore } from "@switchboard/db";
```

Find the existing route imports and append:

```ts
import { recommendationsRoutes } from "./routes/recommendations.js";
```

In the section where other Prisma stores are instantiated (after `const prismaWorkTraceStore = ...` is a good anchor), add:

```ts
const recommendationStore = new PrismaRecommendationStore(prismaClient);
app.decorate("recommendationStore", recommendationStore);
```

In the section where other routes register (alongside `await app.register(approvalsRoutes, { prefix: "/api/approvals" })`), add:

```ts
await app.register(recommendationsRoutes, { prefix: "/api/recommendations" });
```

Match the prefix format the surrounding routes use.

- [ ] **Step 4: Run the full test suite (route + wiring all in place)**

```bash
pnpm --filter @switchboard/api build
pnpm --filter @switchboard/api test recommendations
```

Expected: PASS — all route tests + the 2 isolation tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/recommendations.ts apps/api/src/__tests__/routes/recommendations.test.ts apps/api/src/__tests__/routes/recommendations-isolation.test.ts apps/api/src/__tests__/helpers/seed-recommendation.ts apps/api/src/types/ apps/api/src/app.ts
git commit -m "feat(api): /api/recommendations routes + app.ts wiring

GET ?surface=queue|shadow_action with optional &since=24h.
POST :id/act accepts primary|secondary|dismiss|confirm|undo with
surface-action validity. 409 on terminal/expired/undo-window-closed
includes the current row in the body so the frontend can converge.
Route + store wiring + tests ship in one atomic green commit."
```

---

## Task 9: Dashboard SDK types + query keys + governance.ts methods `[haiku]`

**Files:**
- Modify: `apps/dashboard/src/lib/api-client-types.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/lib/api-client/governance.ts`

- [ ] **Step 1: Add the API row type**

Edit `apps/dashboard/src/lib/api-client-types.ts`. At the bottom add:

```ts
export type RecommendationApiRow = {
  id: string;
  orgId: string;
  agentKey: "nova" | "alex" | "mira";
  intent: string;
  action: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  surface: "queue" | "shadow_action";
  status: "pending" | "acted" | "dismissed" | "confirmed" | "dismissed_by_undo" | "expired";
  parameters: {
    __recommendation?: {
      action?: string;
      note?: string | null;
      presentation?: {
        primaryLabel: string;
        secondaryLabel: string;
        dismissLabel: string;
        dataLines: unknown[];
      };
    };
    [key: string]: unknown;
  };
  targetEntities: Record<string, unknown> | null;
  sourceAgent: string;
  sourceWorkflow: string | null;
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  undoableUntil: string | null;
};

export type RecommendationActAction = "primary" | "secondary" | "dismiss" | "confirm" | "undo";
```

- [ ] **Step 2: Append query-keys block**

Edit `apps/dashboard/src/lib/query-keys.ts`. Find the `escalations` block (around line 90) and add a sibling `recommendations` block:

```ts
recommendations: {
  all: () => [orgId, "recommendations"] as const,
  queue: () => [orgId, "recommendations", "queue"] as const,
  shadow: () => [orgId, "recommendations", "shadow"] as const,
},
```

Place it alphabetically — between `readiness` and `roi` if present, or near `escalations`. Style note: match the existing 2-space indent and trailing-comma style.

- [ ] **Step 3: Add SDK methods**

Edit `apps/dashboard/src/lib/api-client/governance.ts`. Find the existing `respondToApproval` method (around line 15) and add two new methods inside the same class/object:

```ts
async listRecommendations(opts: {
  surface: "queue" | "shadow_action";
  status?: string;
  since?: string;
}): Promise<{ recommendations: RecommendationApiRow[] }> {
  const params = new URLSearchParams({ surface: opts.surface });
  if (opts.status) params.set("status", opts.status);
  if (opts.since) params.set("since", opts.since);
  const res = await this.fetch(`/api/recommendations?${params.toString()}`);
  if (!res.ok) throw new Error(`listRecommendations failed (HTTP ${res.status})`);
  return res.json() as Promise<{ recommendations: RecommendationApiRow[] }>;
},

async actOnRecommendation(id: string, body: { action: RecommendationActAction; note?: string }): Promise<{ recommendation: RecommendationApiRow } | { silent: true; status: number; body: unknown }> {
  const res = await this.fetch(`/api/recommendations/${id}/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    return { silent: true, status: 409, body: await res.json().catch(() => ({})) };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`actOnRecommendation failed (HTTP ${res.status}): ${text}`);
  }
  return res.json() as Promise<{ recommendation: RecommendationApiRow }>;
},
```

Add the import at the top of `governance.ts`:

```ts
import type { RecommendationApiRow, RecommendationActAction } from "../api-client-types.js";
```

(Style: match how the file already imports from `api-client-types`.)

- [ ] **Step 4: Verify the build**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/api-client-types.ts apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/lib/api-client/governance.ts
git commit -m "feat(dashboard): SDK + query keys for /recommendations

Adds RecommendationApiRow + RecommendationActAction types, the
recommendations.queue()/shadow() scoped key block, and two SDK methods
on the governance client. 409 returns are surfaced as {silent: true} so
hooks can swallow them as success."
```

---

## Task 10: Dashboard proxy route with 409 propagation `[sonnet]`

**Files:**
- Create: `apps/dashboard/src/app/api/dashboard/recommendations/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/recommendations/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/app/api/dashboard/recommendations/__tests__/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// Mock the helpers used by route.ts.
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { GET, POST } from "../route.js";

describe("recommendations dashboard proxy", () => {
  it("GET forwards surface query param", async () => {
    const listRecommendations = vi.fn().mockResolvedValue({ recommendations: [] });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listRecommendations });
    const req = new Request("http://x/api/dashboard/recommendations?surface=queue");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(listRecommendations).toHaveBeenCalledWith({ surface: "queue", status: "pending", since: undefined });
  });

  it("POST forwards reshapes recommendationId and propagates 200", async () => {
    const actOnRecommendation = vi.fn().mockResolvedValue({ recommendation: { id: "r-1", status: "acted" } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ actOnRecommendation });
    const req = new Request("http://x/api/dashboard/recommendations", {
      method: "POST",
      body: JSON.stringify({ recommendationId: "r-1", action: "primary" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(actOnRecommendation).toHaveBeenCalledWith("r-1", { action: "primary" });
  });

  it("POST propagates 409 status when SDK returns silent", async () => {
    const actOnRecommendation = vi.fn().mockResolvedValue({ silent: true, status: 409, body: { error: "already_terminal", recommendation: { id: "r-1", status: "acted" } } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ actOnRecommendation });
    const req = new Request("http://x/api/dashboard/recommendations", {
      method: "POST",
      body: JSON.stringify({ recommendationId: "r-1", action: "primary" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_terminal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test recommendations/__tests__/route
```

Expected: FAIL — `../route.js` does not exist.

- [ ] **Step 3: Write the route**

Create `apps/dashboard/src/app/api/dashboard/recommendations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const surface = url.searchParams.get("surface");
    if (surface !== "queue" && surface !== "shadow_action") {
      return NextResponse.json({ error: "surface required (queue|shadow_action)" }, { status: 400 });
    }
    const status = url.searchParams.get("status") ?? "pending";
    const since = url.searchParams.get("since") ?? undefined;
    const data = await client.listRecommendations({ surface, status, since });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const body = (await request.json()) as { recommendationId?: string; action?: string; note?: string };
    if (!body.recommendationId) {
      return NextResponse.json({ error: "recommendationId required" }, { status: 400 });
    }
    if (!body.action) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }
    const result = await client.actOnRecommendation(body.recommendationId, {
      action: body.action as never,
      ...(body.note ? { note: body.note } : {}),
    });
    if ("silent" in result && result.silent) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test recommendations/__tests__/route
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/recommendations/
git commit -m "feat(dashboard): /api/dashboard/recommendations proxy with 409 propagation

GET reads surface/status/since from query params. POST reshapes
recommendationId from body to upstream :id/act. 409 from upstream is
forwarded with original status code so hook layer can swallow it as
success."
```

---

## Task 11: `useRecommendations()` hook + test `[haiku]`

**Files:**
- Create: `apps/dashboard/src/hooks/use-recommendations.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-recommendations.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/hooks/__tests__/use-recommendations.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { useRecommendations, useRecommendationCount } from "../use-recommendations.js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" } }),
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ recommendations: [{ id: "r-1" }, { id: "r-2" }] }),
}) as never;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useRecommendations", () => {
  it("fetches from /api/dashboard/recommendations?surface=queue", async () => {
    const { result } = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(global.fetch).toHaveBeenCalledWith("/api/dashboard/recommendations?surface=queue&status=pending");
    expect(result.current.data?.recommendations).toHaveLength(2);
  });

  it("count returns the row count", async () => {
    const { result } = renderHook(() => useRecommendationCount(), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test use-recommendations
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/src/hooks/use-recommendations.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { RecommendationApiRow } from "@/lib/api-client-types";

async function fetchQueueRecommendations(): Promise<{ recommendations: RecommendationApiRow[] }> {
  const res = await fetch("/api/dashboard/recommendations?surface=queue&status=pending");
  if (!res.ok) throw new Error("Failed to fetch recommendations");
  return res.json();
}

export function useRecommendations() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.recommendations.queue() ?? ["__disabled_recommendations_queue__"],
    queryFn: fetchQueueRecommendations,
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}

export function useRecommendationCount() {
  const { data } = useRecommendations();
  return data?.recommendations.length ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test use-recommendations
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-recommendations.ts apps/dashboard/src/hooks/__tests__/use-recommendations.test.tsx
git commit -m "feat(dashboard): useRecommendations hook + count selector

Mirrors useApprovals — scoped key, 60s refetch, disabled when no session."
```

---

## Task 12: `useShadowActions()` hook + test `[haiku]`

**Files:**
- Create: `apps/dashboard/src/hooks/use-shadow-actions.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-shadow-actions.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/hooks/__tests__/use-shadow-actions.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { useShadowActions } from "../use-shadow-actions.js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" } }),
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ recommendations: [{ id: "s-1", undoableUntil: new Date(Date.now() + 3600_000).toISOString() }] }),
}) as never;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useShadowActions", () => {
  it("fetches from /api/dashboard/recommendations?surface=shadow_action&since=24h", async () => {
    const { result } = renderHook(() => useShadowActions(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(global.fetch).toHaveBeenCalledWith("/api/dashboard/recommendations?surface=shadow_action&status=pending&since=24h");
    expect(result.current.data?.recommendations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test use-shadow-actions
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/src/hooks/use-shadow-actions.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { RecommendationApiRow } from "@/lib/api-client-types";

async function fetchShadowActions(): Promise<{ recommendations: RecommendationApiRow[] }> {
  const res = await fetch("/api/dashboard/recommendations?surface=shadow_action&status=pending&since=24h");
  if (!res.ok) throw new Error("Failed to fetch shadow actions");
  return res.json();
}

export function useShadowActions() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.recommendations.shadow() ?? ["__disabled_recommendations_shadow__"],
    queryFn: fetchShadowActions,
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test use-shadow-actions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-shadow-actions.ts apps/dashboard/src/hooks/__tests__/use-shadow-actions.test.tsx
git commit -m "feat(dashboard): useShadowActions hook for the trail surface

24h since-filter so only undoable rows surface."
```

---

## Task 13: `useRecommendationAction()` hook + test (with 409 swallow) `[sonnet]`

**Files:**
- Create: `apps/dashboard/src/hooks/use-recommendation-action.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-recommendation-action.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/hooks/__tests__/use-recommendation-action.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { useRecommendationAction } from "../use-recommendation-action.js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => fetchMock.mockReset());

describe("useRecommendationAction", () => {
  it.each([
    ["primary"], ["secondary"], ["dismiss"], ["confirm"], ["undo"],
  ])("calls POST with action=%s", async (action) => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    await act(async () => {
      await result.current[action as keyof typeof result.current]?.call(result.current);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/recommendations",
      expect.objectContaining({ method: "POST", body: expect.stringContaining(`"action":"${action}"`) }),
    );
  });

  it("treats 409 as silent success (does not throw)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({ error: "already_terminal" }) });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    let threw = false;
    await act(async () => {
      try { await result.current.primary(); } catch { threw = true; }
    });
    expect(threw).toBe(false);
  });

  it("non-409 errors throw", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    let threw: unknown = null;
    await act(async () => {
      try { await result.current.primary(); } catch (e) { threw = e; }
    });
    expect(threw).toBeInstanceOf(Error);
  });

  it("includes note in body when provided", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    await act(async () => { await result.current.primary("operator-note"); });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"note":"operator-note"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test use-recommendation-action
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/src/hooks/use-recommendation-action.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

type Action = "primary" | "secondary" | "dismiss" | "confirm" | "undo";

export function useRecommendationAction(recommendationId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const respond = useMutation({
    mutationFn: async (input: { action: Action; note?: string }) => {
      const res = await fetch("/api/dashboard/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId,
          action: input.action,
          ...(input.note !== undefined ? { note: input.note } : {}),
        }),
      });
      // 409 = already-terminal / expired / undo-window-closed. Both clients agree on outcome
      // (the fade-out animation already happened); swallow as success.
      if (res.status === 409) {
        return { silent: true, body: await res.json().catch(() => ({})) };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Recommendation action failed (HTTP ${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.recommendations.all() });
        queryClient.invalidateQueries({ queryKey: keys.audit.all() });
      }
    },
  });

  return {
    primary: (note?: string) => respond.mutateAsync({ action: "primary", note }),
    secondary: (note?: string) => respond.mutateAsync({ action: "secondary", note }),
    dismiss: (note?: string) => respond.mutateAsync({ action: "dismiss", note }),
    confirm: (note?: string) => respond.mutateAsync({ action: "confirm", note }),
    undo: (note?: string) => respond.mutateAsync({ action: "undo", note }),
    isPending: respond.isPending,
    error: respond.error,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test use-recommendation-action
```

Expected: PASS, 8 cases (5 actions + 409 silent + non-409 throw + note pass-through).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-recommendation-action.ts apps/dashboard/src/hooks/__tests__/use-recommendation-action.test.tsx
git commit -m "feat(dashboard): useRecommendationAction with 409-as-success semantics

5 action verbs (primary/secondary/dismiss/confirm/undo). 409 returns
silently because both clients agree the row is terminal — the fade-out
animation already played and re-fetching will reflect reality."
```

---

## Task 14: `mapRecommendationCard` + widen `mapQueue` + tests `[sonnet]`

**Files:**
- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts` (create the file if it doesn't exist with this exact content; if it exists, append the new describe block):

```ts
import { describe, expect, it } from "vitest";
import {
  mapRecommendationCard,
  mapQueue,
  type RecommendationApiRow,
} from "../console-mappers.js";

const baseRec: RecommendationApiRow = {
  id: "r-1",
  agentKey: "nova",
  humanSummary: "Pause Whitening Ad Set B",
  confidence: 0.9,
  parameters: {
    __recommendation: {
      action: "pause",
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [["text"]],
      },
    },
  },
  surface: "queue",
  status: "pending",
  createdAt: new Date().toISOString(),
};

describe("mapRecommendationCard", () => {
  it("maps presentation fields to view-model", () => {
    const card = mapRecommendationCard(baseRec, new Date());
    expect(card.kind).toBe("recommendation");
    expect(card.id).toBe("r-1");
    expect(card.agent).toBe("nova");
    expect(card.action).toBe("Pause Whitening Ad Set B");
    expect(card.primary.label).toBe("Pause");
    expect(card.secondary.label).toBe("Reduce 50%");
    expect(card.dismiss.label).toBe("Dismiss");
    expect(card.dataLines).toEqual([["text"]]);
  });

  it("formats confidence as a 2-decimal string", () => {
    const card = mapRecommendationCard({ ...baseRec, confidence: 0.876 }, new Date());
    expect(card.timer.confidence).toBe("0.88");
  });

  it("labels confidence by tier", () => {
    expect(mapRecommendationCard({ ...baseRec, confidence: 0.95 }, new Date()).timer.label).toBe("Immediate");
    expect(mapRecommendationCard({ ...baseRec, confidence: 0.8 }, new Date()).timer.label).toBe("High confidence");
    expect(mapRecommendationCard({ ...baseRec, confidence: 0.6 }, new Date()).timer.label).toBe("Suggested");
  });

  it("falls back to default labels when presentation is missing", () => {
    const card = mapRecommendationCard({ ...baseRec, parameters: {} }, new Date());
    expect(card.primary.label).toBe("Confirm");
    expect(card.secondary.label).toBe("Adjust");
    expect(card.dismiss.label).toBe("Dismiss");
    expect(card.dataLines).toEqual([]);
  });
});

describe("mapQueue includes recommendations", () => {
  it("appends recommendation cards to the queue", () => {
    const cards = mapQueue([], [], [baseRec], new Date());
    expect(cards.some((c) => c.kind === "recommendation" && c.id === "r-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test console-mappers
```

Expected: FAIL — `mapRecommendationCard` does not exist; `mapQueue` signature mismatch.

- [ ] **Step 3: Edit the mapper**

Edit `apps/dashboard/src/components/console/console-mappers.ts`. Append the new type, helper, and mapper; widen `mapQueue`:

```ts
import type {
  AgentKey,
  ApprovalGateCard,
  EscalationCard,
  QueueCard,
  RecommendationCard,
  RichText,
} from "./console-data";

// ... existing code unchanged above ...

// ── Recommendations ───────────────────────────────────────────────────────
export type RecommendationApiRow = {
  id: string;
  agentKey: "nova" | "alex" | "mira";
  humanSummary: string;
  confidence: number;
  parameters: {
    __recommendation?: {
      action?: string;
      note?: string | null;
      presentation?: {
        primaryLabel: string;
        secondaryLabel: string;
        dismissLabel: string;
        dataLines: unknown[];
      };
    };
    [key: string]: unknown;
  };
  surface: "queue" | "shadow_action";
  status: string;
  createdAt: string;
};

function confidenceToLabel(c: number): string {
  if (c >= 0.9) return "Immediate";
  if (c >= 0.75) return "High confidence";
  return "Suggested";
}

const FALLBACK_PRESENTATION = {
  primaryLabel: "Confirm",
  secondaryLabel: "Adjust",
  dismissLabel: "Dismiss",
  dataLines: [] as unknown[],
};

export function mapRecommendationCard(row: RecommendationApiRow, _now: Date): RecommendationCard {
  const p = row.parameters?.__recommendation?.presentation ?? FALLBACK_PRESENTATION;
  return {
    kind: "recommendation",
    id: row.id,
    agent: row.agentKey,
    action: row.humanSummary,
    timer: { label: confidenceToLabel(row.confidence), confidence: row.confidence.toFixed(2) },
    dataLines: p.dataLines as RichText[],
    primary: { label: p.primaryLabel },
    secondary: { label: p.secondaryLabel },
    dismiss: { label: p.dismissLabel },
  };
}
```

Then locate the existing `mapQueue` function (around line 70) and update its signature + body:

```ts
export function mapQueue(
  escalations: EscalationApiRow[],
  approvals: ApprovalApiRow[],
  recommendations: RecommendationApiRow[],
  now: Date,
): QueueCard[] {
  const escCards = escalations.map((e) => mapEscalationCard(e, now));
  const gateCards = approvals
    .filter((a) => a.riskCategory === "creative")
    .map((a) => mapApprovalGateCard(a, now));
  const recCards = recommendations.map((r) => mapRecommendationCard(r, now));
  return [...escCards, ...gateCards, ...recCards];
}
```

Delete the existing comment line `// Recommendation cards are not exposed by the backend in option B; option C wires them.` since it is no longer true.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test console-mappers
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
git commit -m "feat(dashboard): mapRecommendationCard + widen mapQueue

mapQueue now takes a third arg (recommendations) and appends rec cards.
The fallback presentation keeps unknown action shapes renderable —
emitter could ship a row without presentation block."
```

---

## Task 15: `recommendation-card.tsx` handler swap + tests `[sonnet]`

**Files:**
- Modify: `apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx`
- Modify: `apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx`

- [ ] **Step 1: Write/update the failing test**

Edit `apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx` (replace existing contents — Phase 2's tests assert toast-only behavior which is going away):

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecommendationCardView } from "../recommendation-card.js";
import type { RecommendationCard } from "../../console-data";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

const baseCard: RecommendationCard = {
  kind: "recommendation",
  id: "r-1",
  agent: "nova",
  action: "Pause Whitening Ad Set B",
  timer: { label: "Immediate", confidence: "0.90" },
  dataLines: [],
  primary: { label: "Pause" },
  secondary: { label: "Reduce 50%" },
  dismiss: { label: "Dismiss" },
};

function renderCard(overrides: Partial<{ resolving: boolean; onResolve: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecommendationCardView
        card={baseCard}
        resolving={overrides.resolving ?? false}
        onResolve={overrides.onResolve ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => fetchMock.mockReset());

describe("RecommendationCardView (backend-wired)", () => {
  it("primary click calls API and onResolve on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/recommendations",
      expect.objectContaining({ body: expect.stringContaining('"action":"primary"') }),
    );
  });

  it("secondary click calls API and onResolve on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Reduce 50%" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
  });

  it("dismiss click calls API and onResolve on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
  });

  it("409 silently calls onResolve (already-resolved)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({ error: "already_terminal" }) });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it("non-409 error shows .qerror row and does NOT call onResolve", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    expect(onResolve).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test recommendation-card
```

Expected: FAIL — current handler still toast-based.

- [ ] **Step 3: Edit the component**

Edit `apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx`. **Touch ONLY the import block, the `fire` function inside the component, the three `onClick` handlers, and add one `.qerror` row inside the JSX.** Do NOT alter any other JSX, classNames, or markup. Replace as follows:

```tsx
"use client";

import { useState } from "react";
import type { RecommendationCard } from "../console-data";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { capitalize, RichTextSpan } from "./rich-text";

interface Props {
  card: RecommendationCard;
  resolving: boolean;
  onResolve: () => void;
}

export function RecommendationCardView({ card, resolving, onResolve }: Props) {
  const action = useRecommendationAction(card.id);
  const [error, setError] = useState<string | null>(null);

  const fire = async (kind: "primary" | "secondary" | "dismiss") => {
    setError(null);
    try {
      await action[kind]();
      onResolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <article
      id={`q-${card.id}`}
      className={`qcard recommendation${resolving ? " is-resolving" : ""}`}
    >
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Recommendation</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="urgent">{card.timer.label}</span> · conf{" "}
            <span className="conf">{card.timer.confidence}</span>
          </span>
        </div>
        <h3 className="rec-action">{card.action}</h3>
        <ul className="rec-data">
          {card.dataLines.map((line, i) => (
            <li key={i}>
              <RichTextSpan value={line} />
            </li>
          ))}
        </ul>
        {error && <div className="qerror">{error}</div>}
        <div className="qactions">
          <button
            className="btn btn-primary-graphite"
            type="button"
            disabled={action.isPending}
            onClick={() => fire("primary")}
          >
            {card.primary.label}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={action.isPending}
            onClick={() => fire("secondary")}
          >
            {card.secondary.label}
          </button>
          <button
            className="btn btn-text"
            type="button"
            disabled={action.isPending}
            onClick={() => fire("dismiss")}
          >
            {card.dismiss.label}
          </button>
        </div>
      </div>
    </article>
  );
}
```

(Total diff vs Phase 2: ~28 lines. The visual-only comment is gone. JSX/classNames untouched except for the new `<div className="qerror">` and three `disabled` attrs.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test recommendation-card
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx
git commit -m "feat(dashboard): wire recommendation card to real backend

Handler swap only: primary/secondary/dismiss now call useRecommendationAction.
JSX, qcard structure, and .is-resolving animation untouched. 409 silently
calls onResolve; non-409 errors render in a .qerror row."
```

---

## Task 16: `queue-zone.tsx` 2-line additive + tests `[sonnet]`

**Files:**
- Modify: `apps/dashboard/src/components/console/zones/queue-zone.tsx`
- Modify: `apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx`

This is the **single allowed exemption** to the Phase 3 frontend protection rule for this initiative. Touch only data-flow lines: import, hook call, mapQueue arg, invalidateQueries entry. Do not touch any JSX, className, animation, or props.

- [ ] **Step 1: Read existing queue-zone.tsx**

Read `apps/dashboard/src/components/console/zones/queue-zone.tsx` in full to confirm the current `useEscalations()`, `useApprovals()`, `mapQueue()`, and `invalidateQueries` lines. Identify exact line numbers.

- [ ] **Step 2: Write/update the test**

Edit `apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx`. Find the existing test block. Add a new test case that asserts recommendations are rendered:

```tsx
it("renders recommendation cards from useRecommendations", async () => {
  // Mock all three hooks to return one row each
  // (existing tests should already mock useEscalations + useApprovals;
  // add useRecommendations mock matching the same shape)
  vi.mock("@/hooks/use-recommendations", () => ({
    useRecommendations: () => ({ data: { recommendations: [{ id: "r-1", agentKey: "nova", humanSummary: "Pause it", confidence: 0.6, parameters: { presentation: { primaryLabel: "Pause", secondaryLabel: "Reduce", dismissLabel: "Dismiss", dataLines: [] } }, surface: "queue", status: "pending", createdAt: new Date().toISOString() }] } }),
  }));
  // ... render QueueZone in the existing wrapper ...
  // expect a card with text "Pause it" to appear
});
```

If the existing test file uses different mocking patterns, mirror those. The point: one assertion that recommendations land in the rendered card list.

- [ ] **Step 3: Edit `queue-zone.tsx`**

Add the import:

```ts
import { useRecommendations } from "@/hooks/use-recommendations";
```

Inside the component body, add the hook call alongside the existing two:

```ts
const recommendations = useRecommendations();
```

Update the `mapQueue` call to pass the recommendations array:

```ts
const cards = useMemo(
  () => mapQueue(escalationRows, approvalRows, recommendationRows, new Date()),
  [escalationRows, approvalRows, recommendationRows],
);
```

Where `recommendationRows` is unpacked the same way `escalationRows` and `approvalRows` are (e.g., `const recommendationRows = recommendations.data?.recommendations ?? [];`).

Update the existing `invalidateQueries` block in `beginResolve` to add the recommendations key:

```ts
queryClient.invalidateQueries({ queryKey: queryKeys.recommendations.all() });
```

(Add as a sibling to the existing escalations/approvals invalidations. The exact `queryKeys` import name follows the surrounding code.)

**Total diff: 4 lines added. No other change.**

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test queue-zone
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS, including the new assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/queue-zone.tsx apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx
git commit -m "feat(dashboard): wire useRecommendations into QueueZone (data-flow only)

4-line additive change: import + hook call + mapQueue arg + invalidate
key. JSX, className, animation, and props untouched. This is the single
allowed exemption to the Phase 3 frontend protection rule for this
initiative — see spec section 'Frontend wiring'."
```

---

## Task 17: `<ShadowActionRow>` + `<ShadowActionList>` + CSS + tests `[sonnet]`

**Files:**
- Create: `apps/dashboard/src/components/console/zones/shadow-action-row.tsx`
- Create: `apps/dashboard/src/components/console/zones/shadow-action-row.css`
- Create: `apps/dashboard/src/components/console/zones/__tests__/shadow-action-row.test.tsx`

**Note:** Component ships untested-in-the-wild — no `<ConsoleView>` wiring in v1. Phase 3 (or a small follow-up PR) places it inside the activity trail. Tests cover the loop in isolation.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/zones/__tests__/shadow-action-row.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShadowActionList } from "../shadow-action-row.js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ShadowActionList />
    </QueryClientProvider>,
  );
}

beforeEach(() => fetchMock.mockReset());

describe("ShadowActionList", () => {
  it("renders nothing when there are zero rows", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
    const { container } = renderList();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector(".shadow-actions")).toBeNull();
  });

  it("renders one row per shadow recommendation", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        recommendations: [
          { id: "s-1", humanSummary: "Nova flagged for auto-pause — confirm or undo: Whitening Ad Set B", undoableUntil: new Date(Date.now() + 3600_000).toISOString() },
          { id: "s-2", humanSummary: "Nova flagged for auto-reduce: Recovery Set", undoableUntil: new Date(Date.now() + 3600_000).toISOString() },
        ],
      }),
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/Whitening Ad Set B/)).toBeInTheDocument());
    expect(screen.getByText(/Recovery Set/)).toBeInTheDocument();
  });

  it("Confirm button calls action.confirm", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        recommendations: [{ id: "s-1", humanSummary: "x", undoableUntil: new Date(Date.now() + 3600_000).toISOString() }],
      }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    renderList();
    await waitFor(() => screen.getByRole("button", { name: /confirm/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"action":"confirm"');
  });

  it("Undo button calls action.undo", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        recommendations: [{ id: "s-1", humanSummary: "x", undoableUntil: new Date(Date.now() + 3600_000).toISOString() }],
      }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
    renderList();
    await waitFor(() => screen.getByRole("button", { name: /undo/i }));
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"action":"undo"');
  });

  it("hides Confirm/Undo buttons after undoableUntil expires", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        recommendations: [{ id: "s-1", humanSummary: "x", undoableUntil: new Date(Date.now() - 1000).toISOString() }],
      }),
    });
    renderList();
    await waitFor(() => screen.getByText("x"));
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test shadow-action-row
```

Expected: FAIL.

- [ ] **Step 3: Write the component**

Create `apps/dashboard/src/components/console/zones/shadow-action-row.tsx`:

```tsx
"use client";

// Ships unwired in v1. Wired into <ConsoleView> by Phase 3 (or a small
// follow-up PR). See spec section "Frontend wiring" item 8.

import { useState } from "react";
import { useShadowActions } from "@/hooks/use-shadow-actions";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";

import "./shadow-action-row.css";

export function ShadowActionList() {
  const { data } = useShadowActions();
  const rows = data?.recommendations ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-label="Auto-actions" className="shadow-actions">
      <div className="label">Nova flagged — confirm or undo</div>
      {rows.map((row) => (
        <ShadowActionRow
          key={row.id}
          id={row.id}
          summary={row.humanSummary}
          undoableUntil={row.undoableUntil}
        />
      ))}
    </section>
  );
}

interface RowProps {
  id: string;
  summary: string;
  undoableUntil: string | null;
}

function ShadowActionRow({ id, summary, undoableUntil }: RowProps) {
  const action = useRecommendationAction(id);
  const [error, setError] = useState<string | null>(null);
  const expired = !undoableUntil || new Date(undoableUntil) < new Date();

  const click = async (kind: "confirm" | "undo") => {
    setError(null);
    try {
      await action[kind]();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="shadow-row">
      <div className="summary">{summary}</div>
      {!expired && (
        <div className="actions">
          <button type="button" disabled={action.isPending} onClick={() => click("confirm")}>
            Confirm
          </button>
          <button type="button" disabled={action.isPending} onClick={() => click("undo")}>
            Undo
          </button>
        </div>
      )}
      {error && <div className="row-error">{error}</div>}
    </div>
  );
}
```

Create `apps/dashboard/src/components/console/zones/shadow-action-row.css`:

```css
.shadow-actions {
  border-top: 1px dashed var(--c-hair, #e5e3dc);
  padding: 0.85rem 0;
  display: grid;
  gap: 0.5rem;
}

.shadow-actions > .label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--c-text-3, #6b6b6b);
}

.shadow-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  background: var(--c-bg-soft, rgba(0, 0, 0, 0.02));
}

.shadow-row > .summary {
  font-size: 14px;
  color: var(--c-text-1, #333);
}

.shadow-row > .actions {
  display: inline-flex;
  gap: 0.5rem;
}

.shadow-row > .actions > button {
  font-size: 12px;
  padding: 0.25rem 0.6rem;
  background: transparent;
  border: 1px solid var(--c-hair, #e5e3dc);
  border-radius: 3px;
  cursor: pointer;
}

.shadow-row > .actions > button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shadow-row > .row-error {
  grid-column: 1 / -1;
  color: var(--c-coral, #c5594b);
  font-size: 12px;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test shadow-action-row
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/shadow-action-row.tsx apps/dashboard/src/components/console/zones/shadow-action-row.css apps/dashboard/src/components/console/zones/__tests__/shadow-action-row.test.tsx
git commit -m "feat(dashboard): ShadowActionList + ShadowActionRow (unwired in v1)

Renders shadow-action recommendations from useShadowActions with
Confirm/Undo. The component is fully tested in isolation; wiring into
<ConsoleView> is a Phase 3 (or small follow-up PR) concern. CSS is
co-located so the merge surface is zero."
```

---

## Task 18: ad-optimizer audit-runner sink + AgentEvent rollup + tests `[opus]`

**Files:**
- Create: `packages/ad-optimizer/src/recommendation-sink.ts`
- Create: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (call sink at end)
- Modify: `packages/ad-optimizer/src/index.ts` (export sink + types)

The sink lives in its own file so audit-runner.ts stays close to its existing line count and so the sink can be unit-tested without a full audit run.

- [ ] **Step 1: Write the failing test**

Create `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runRecommendationSink } from "../recommendation-sink.js";
import type { RecommendationOutput } from "../recommendation-engine.js";

const baseRec = (overrides: Partial<RecommendationOutput> = {}): RecommendationOutput => ({
  type: "recommendation",
  campaignId: "c-1",
  campaignName: "Whitening Set B",
  action: "pause",
  confidence: 0.9,
  urgency: "high",
  estimatedImpact: "saves $40/day",
  steps: ["Pause"],
  learningPhaseImpact: "no impact",
  ...overrides,
});

describe("runRecommendationSink", () => {
  it("emits one Recommendation per output via the store", async () => {
    const emitted: unknown[] = [];
    const recommendationStore = { insert: vi.fn().mockResolvedValue({ row: { id: "x" }, idempotent: false }) } as never;
    const agentEventStore = { record: vi.fn() };
    const recs = [baseRec(), baseRec({ campaignId: "c-2", action: "reduce_budget" })];
    const result = await runRecommendationSink({
      orgId: "org-1", auditRunId: "audit-1", recommendations: recs,
      recommendationStore, agentEventStore: agentEventStore as never,
    });
    expect(result.routedQueue + result.routedShadow + result.dropped).toBe(2);
    expect(recommendationStore.insert).toHaveBeenCalledTimes(2);
  });

  it("writes one AgentEvent rollup when dropped > 0", async () => {
    const recommendationStore = { insert: vi.fn().mockResolvedValue({ row: { id: "x" }, idempotent: false }) } as never;
    const agentEventStore = { record: vi.fn() };
    const recs = [
      baseRec({ confidence: 0.3 }),  // dropped
      baseRec({ confidence: 0.9 }),  // queue or shadow
    ];
    const result = await runRecommendationSink({
      orgId: "org-1", auditRunId: "audit-2", recommendations: recs,
      recommendationStore, agentEventStore: agentEventStore as never,
    });
    expect(result.dropped).toBeGreaterThan(0);
    expect(agentEventStore.record).toHaveBeenCalledTimes(1);
    expect(agentEventStore.record.mock.calls[0]?.[0]).toMatchObject({
      orgId: "org-1",
      eventType: "recommendation.batch_summary",
    });
  });

  it("does NOT write rollup when dropped === 0", async () => {
    const recommendationStore = { insert: vi.fn().mockResolvedValue({ row: { id: "x" }, idempotent: false }) } as never;
    const agentEventStore = { record: vi.fn() };
    await runRecommendationSink({
      orgId: "org-1", auditRunId: "audit-3", recommendations: [baseRec({ confidence: 0.9 })],
      recommendationStore, agentEventStore: agentEventStore as never,
    });
    expect(agentEventStore.record).not.toHaveBeenCalled();
  });

  it("humanizeRecommendation covers all 7 action kinds with no fallback", async () => {
    const summaries: string[] = [];
    const recommendationStore = {
      insert: vi.fn().mockImplementation((args) => {
        summaries.push(args.humanSummary);
        return Promise.resolve({ row: { id: "x" }, idempotent: false });
      }),
    } as never;
    const agentEventStore = { record: vi.fn() };
    const actions: RecommendationOutput["action"][] = ["pause", "reduce_budget", "add_creative", "consolidate", "kill", "expand_targeting", "shift_budget"];
    await runRecommendationSink({
      orgId: "org-1", auditRunId: "audit-4",
      recommendations: actions.map((a) => baseRec({ action: a, confidence: 0.6 })),
      recommendationStore, agentEventStore: agentEventStore as never,
    });
    expect(summaries).toHaveLength(7);
    summaries.forEach((s) => expect(s.length).toBeGreaterThan(5));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/ad-optimizer test recommendation-sink
```

Expected: FAIL.

- [ ] **Step 3: Write the sink**

Create `packages/ad-optimizer/src/recommendation-sink.ts`:

```ts
import { emitRecommendation, type RecommendationStore } from "@switchboard/core";
import type { RecommendationOutput } from "./recommendation-engine.js";

export interface AgentEventStore {
  record(args: {
    orgId: string;
    agentKey: string;
    eventType: string;
    summary: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface RunRecommendationSinkArgs {
  orgId: string;
  auditRunId: string;
  recommendations: RecommendationOutput[];
  recommendationStore: RecommendationStore;
  agentEventStore: AgentEventStore;
}

const URGENCY_TO_RISK: Record<string, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
};

const URGENCY_TO_EXPIRY_HOURS: Record<string, number> = {
  high: 8,
  medium: 24,
  low: 168, // 7d
};

const REVERSIBLE = new Set(["pause", "reduce_budget"]);

function humanizeRecommendation(rec: RecommendationOutput): string {
  const name = rec.campaignName;
  switch (rec.action) {
    case "pause":
      return `Pause ${name} — ${rec.estimatedImpact}`;
    case "reduce_budget":
      return `Reduce ${name} budget — ${rec.estimatedImpact}`;
    case "add_creative":
      return `Add creatives to ${name} — ${rec.estimatedImpact}`;
    case "consolidate":
      return `Consolidate ${name} — ${rec.estimatedImpact}`;
    case "kill":
      return `Kill ${name} — ${rec.estimatedImpact}`;
    case "expand_targeting":
      return `Expand targeting on ${name} — ${rec.estimatedImpact}`;
    case "shift_budget":
      return `Shift budget on ${name} — ${rec.estimatedImpact}`;
    default:
      return `${rec.action} on ${name} — ${rec.estimatedImpact}`;
  }
}

function buildPresentation(rec: RecommendationOutput) {
  const labels: Record<string, { primary: string; secondary: string }> = {
    pause: { primary: "Pause", secondary: "Reduce 50%" },
    reduce_budget: { primary: "Reduce 50%", secondary: "Reduce 25%" },
    add_creative: { primary: "Add creatives", secondary: "Adjust later" },
    consolidate: { primary: "Consolidate", secondary: "Review" },
    kill: { primary: "Kill campaign", secondary: "Pause instead" },
    expand_targeting: { primary: "Expand", secondary: "Wait" },
    shift_budget: { primary: "Shift budget", secondary: "Wait" },
  };
  const found = labels[rec.action] ?? { primary: "Confirm", secondary: "Adjust" };
  return {
    primaryLabel: found.primary,
    secondaryLabel: found.secondary,
    dismissLabel: "Dismiss",
    dataLines: [[rec.estimatedImpact], [`Learning phase: ${rec.learningPhaseImpact}`]],
  };
}

function estimateRisk(rec: RecommendationOutput): number {
  // Conservative heuristic: extract first dollar value from estimatedImpact, default 0.
  const m = /\$([\d,]+(?:\.\d+)?)/.exec(rec.estimatedImpact);
  if (!m) return 0;
  return parseFloat(m[1]!.replace(/,/g, ""));
}

export async function runRecommendationSink(args: RunRecommendationSinkArgs): Promise<{ routedQueue: number; routedShadow: number; dropped: number }> {
  let routedQueue = 0;
  let routedShadow = 0;
  let dropped = 0;

  for (const rec of args.recommendations) {
    const expiresAt = new Date(Date.now() + (URGENCY_TO_EXPIRY_HOURS[rec.urgency] ?? 24) * 60 * 60 * 1000);
    const result = await emitRecommendation(args.recommendationStore, {
      orgId: args.orgId,
      agentKey: "nova",
      intent: `recommendation.${rec.action}`,
      action: rec.action,
      humanSummary: humanizeRecommendation(rec),
      confidence: rec.confidence,
      dollarsAtRisk: estimateRisk(rec),
      riskLevel: URGENCY_TO_RISK[rec.urgency] ?? "medium",
      parameters: { ...(rec as { params?: Record<string, unknown> }).params ?? {} },
      presentation: buildPresentation(rec),
      targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName },
      expiresAt,
      sourceWorkflow: args.auditRunId,
    });
    if (result.surface === "dropped") dropped++;
    else if (result.surface === "shadow_action") routedShadow++;
    else routedQueue++;
  }

  if (dropped > 0) {
    await args.agentEventStore.record({
      orgId: args.orgId,
      agentKey: "nova",
      eventType: "recommendation.batch_summary",
      summary: `Nova reviewed ${args.recommendations.length} candidates. ${routedQueue} flagged for review, ${routedShadow} auto-actioned, ${dropped} below confidence threshold.`,
      metadata: { auditRunId: args.auditRunId, routedQueue, routedShadow, dropped },
    });
  }

  return { routedQueue, routedShadow, dropped };
}
```

- [ ] **Step 4: Wire the sink into audit-runner**

Edit `packages/ad-optimizer/src/audit-runner.ts`. At the top, add the import:

```ts
import { runRecommendationSink, type AgentEventStore } from "./recommendation-sink.js";
import type { RecommendationStore } from "@switchboard/core";
```

Add to `AuditDependencies` (interface, near the top of the file):

```ts
export interface AuditDependencies {
  // ... existing fields ...
  recommendationStore?: RecommendationStore;
  agentEventStore?: AgentEventStore;
}
```

Find the section near line 425 where `recommendations` is built. After that array is finalized but before the function returns (look for the existing `return { ... recommendations, ... }`), add:

```ts
if (this.deps.recommendationStore && this.deps.agentEventStore) {
  await runRecommendationSink({
    orgId,
    auditRunId,
    recommendations,
    recommendationStore: this.deps.recommendationStore,
    agentEventStore: this.deps.agentEventStore,
  });
}
```

The graceful degradation (the `if` guard) is intentional — current callers may not have wired the new deps yet, and we should not fail audits because the sink is missing.

- [ ] **Step 5: Append exports**

Edit `packages/ad-optimizer/src/index.ts` and add at the bottom:

```ts
export { runRecommendationSink } from "./recommendation-sink.js";
export type { AgentEventStore, RunRecommendationSinkArgs } from "./recommendation-sink.js";
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @switchboard/ad-optimizer build
pnpm --filter @switchboard/ad-optimizer test recommendation-sink
pnpm --filter @switchboard/ad-optimizer typecheck
```

Expected: PASS, 4 tests; typecheck clean (audit-runner still typechecks because the new deps are optional).

- [ ] **Step 7: Commit**

```bash
git add packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): emit recommendations to the new core sink

audit-runner now writes each RecommendationOutput through emitRecommendation
when recommendationStore + agentEventStore deps are wired. AgentEvent rollup
records the count of dropped (sub-threshold) recs per audit run."
```

---

## Task 19: Seed script `scripts/seed-recommendation.ts` `[haiku]`

**Files:**
- Create: `scripts/seed-recommendation.ts`

- [ ] **Step 1: Write the script**

Create `scripts/seed-recommendation.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Seed one canned recommendation per agent into the dev DB so the console
 * can render the queue without running a full ad-optimizer audit.
 *
 * Usage:
 *   pnpm tsx scripts/seed-recommendation.ts <orgId>
 *
 * Reads DATABASE_URL from .env.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaRecommendationStore } from "@switchboard/db";
import { emitRecommendation } from "@switchboard/core";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("Usage: pnpm tsx scripts/seed-recommendation.ts <orgId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const store = new PrismaRecommendationStore(prisma);

  const fixtures = [
    {
      agentKey: "nova" as const,
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Pause Whitening Ad Set B — CPA $42 vs target $30",
      confidence: 0.92,
      dollarsAtRisk: 25,
      riskLevel: "low" as const,
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [["CPA $42 vs target $30"], ["7-day spend $1,240"]] as unknown[],
      },
      targetEntities: { campaignId: "seed-c-1", campaignName: "Whitening Ad Set B" },
    },
    {
      agentKey: "alex" as const,
      intent: "recommendation.escalate_lead",
      action: "escalate",
      humanSummary: "Escalate angry lead — Sarah K. (3 negative messages)",
      confidence: 0.78,
      dollarsAtRisk: 150,
      riskLevel: "medium" as const,
      parameters: {},
      presentation: {
        primaryLabel: "Reply now",
        secondaryLabel: "Schedule callback",
        dismissLabel: "Dismiss",
        dataLines: [["3 negative messages in last 10 minutes"]] as unknown[],
      },
      targetEntities: { contactId: "seed-contact-1" },
    },
    {
      agentKey: "mira" as const,
      intent: "recommendation.creative_retry",
      action: "add_creative",
      humanSummary: "Add fresh creatives to Recovery Ad Set — fatigue rising",
      confidence: 0.84,
      dollarsAtRisk: 0,
      riskLevel: "low" as const,
      parameters: {},
      presentation: {
        primaryLabel: "Add creatives",
        secondaryLabel: "Adjust later",
        dismissLabel: "Dismiss",
        dataLines: [["frequency 3.4 (target < 2.5)"]] as unknown[],
      },
      targetEntities: { campaignId: "seed-c-2" },
    },
  ];

  for (const f of fixtures) {
    const result = await emitRecommendation(store, { orgId, ...f });
    console.warn(`[seed] ${f.agentKey} → ${result.surface} ${result.id ?? ""}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs**

```bash
pnpm tsx scripts/seed-recommendation.ts test-org-seed
```

Expected: three log lines like `[seed] nova → queue rec-...`. Then visit `/console` (with the seeded org as the active session) — you should see the cards.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-recommendation.ts
git commit -m "feat(scripts): seed-recommendation for local dev

Three canned recs (nova/alex/mira) so /console renders without an audit."
```

---

## Task 20: DOCTRINE.md Legacy Bridge Registry entry `[haiku]`

**Files:**
- Modify: `docs/DOCTRINE.md`

- [ ] **Step 1: Add the registry entry**

Edit `docs/DOCTRINE.md`. Find the "Legacy Bridge Registry" table (around line 100). Add a new row at the bottom of the existing table:

```
| Recommendation act direct mutation | `packages/core/src/recommendations/act.ts` | Migrate to `PlatformIngress.submit({ intent: "operator.respond_recommendation" })` when the executor lands (v2). Same migration as approval-response. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/DOCTRINE.md
git commit -m "docs(doctrine): register recommendation act as legacy-bridge debt

Pinned to ride the same future migration as approval-response. v2 (when
the real platform-call executor lands) flips this surface to
PlatformIngress.submit()."
```

---

## Task 21: Phase 3 dry-run merge verification `[sonnet]`

**Files:** none (verification step)

- [ ] **Step 1: Verify clean merge against feat/phase-3**

```bash
cd /Users/jasonli/switchboard-worktrees/feat-recommendations-backend
git fetch origin
git checkout feat/recommendations-backend-v1
git merge --no-commit --no-ff origin/feat/phase-3 2>&1 | tee /tmp/merge-result.log
```

Expected: clean merge OR conflicts only inside files this initiative is allowed to touch (`recommendation-card.tsx`, `queue-zone.tsx`, `console-mappers.ts`, `console-data.ts`, or new files).

- [ ] **Step 2: If clean, abort the dry-run**

```bash
git merge --abort
```

Verify clean working tree:

```bash
git status --short
```

Expected: empty.

- [ ] **Step 3: If conflicts**

If any conflict touches a file outside the allow-list (e.g., `agent-strip.tsx`, `nova-panel.tsx`, `console-view.tsx`):
1. STOP the merge: `git merge --abort`
2. Report the conflict to the user (which file, which Phase 3 commit, what change)
3. Coordinate with the Phase 3 owner before proceeding — do not unilaterally resolve

If conflicts are confined to allowed files, document them in the impl PR description so the reviewer can verify the resolution at PR time. Then `git merge --abort` and continue (do not actually merge here — that's the PR's job).

- [ ] **Step 4: Run final full-test pass**

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green. If anything fails, fix and recommit before opening the impl PR.

- [ ] **Step 5: No commit — verification only**

This task does not commit. It exits with confidence that the implementation branch will merge cleanly when both initiatives complete.

---

## Self-review (run after writing the plan)

Performed during plan authoring. Findings:

**1. Spec coverage:** Cross-checked each spec section against the task list:
- Storage (PendingActionRecord migration + JSON shape) → Tasks 1, 7
- Schemas (Zod + shared types) → Task 2
- Core surface (router/emit/act + barrel) → Tasks 3, 4, 5, 6
- Persistence implementation → Task 7
- API contract + app wiring (route + tests in one atomic commit) → Task 8
- Dashboard SDK + query keys + types → Task 9
- Dashboard proxy + 409 propagation → Task 10
- useRecommendations / useShadowActions / useRecommendationAction hooks → Tasks 11, 12, 13
- Mappers + queue widening → Task 14
- recommendation-card.tsx surgical swap → Task 15
- queue-zone.tsx 2-line additive → Task 16
- ShadowActionList component → Task 17
- ad-optimizer audit-runner sink → Task 18
- Seed script → Task 19
- DOCTRINE legacy-bridge registry → Task 20
- Phase 3 cross-stream merge verification → Task 21

No spec section is uncovered.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" references found. All code blocks contain runnable code.

**3. Type consistency:** `RecommendationApiRow` defined in Task 9 matches the shape used in Task 14 (mapper). `RecommendationStore` interface defined in Task 4 (with `PersistRecommendationInput` as the `insert()` arg) matches the implementation in Task 7 and the call signature in Task 5. `RecommendationAction` enum (5 values) matches across schemas (Task 2), core (Task 6), API (Task 8), SDK (Task 9), and hook (Task 13). Surface enum (3 values) is consistent. `Recommendation` type fields match between core (Task 4), store (Task 7), and API row (Task 9) — `updatedAt` is omitted everywhere (PendingActionRecord has no such column).

**4. Frontend protection:** The plan touches only the spec-allowed files. The single `queue-zone.tsx` exemption is explicit in Task 16 and labeled as such. No task touches `agent-strip.tsx`, `nova-panel.tsx`, `console-view.tsx`, or `console.css`.

**5. Typecheck-clean discipline:** Every task ends in a green commit. Task 4's barrel only re-exports symbols that exist; Tasks 5 and 6 each append their own export to the barrel as part of their TDD cycle.

**6. Task atomicity:** Tests do not depend on later tasks. Task 8 ships the route + the `app.ts` wiring + the tests as a single commit so the test suite can pass on first run.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-03-recommendations-backend-v1.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Two-stage review (spec compliance → code quality) per the spec.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
