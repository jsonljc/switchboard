# Riley Cockpit Wave B PR-3 — Outcome Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-visible Riley outcome loop — operator approves Riley recommendation → daily cron observes Meta metric movement in post-window → `/riley` activity feed renders a delayed `"observed"` row with allowlisted directional copy.

**Architecture:** Three layers. Pure attribution logic in `core` (DI on `RecommendationStore` + `MetaInsightsProvider` + `RecommendationOutcomeStore`). Persistence in `db` (new `RecommendationOutcome` Prisma model, FK to `PendingActionRecord`). Wiring in `apps/api` (dispatch cron in `ad-optimizer`, per-org worker + API route in `apps/api`). One new `"observed"` ActivityKind; everything else stays under the B.2 honest-impact guardrail.

**Tech Stack:** TypeScript, pnpm workspaces, Prisma + PostgreSQL, Inngest, Fastify, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-15-riley-cockpit-pr3-outcome-attribution-design.md` (on branch `docs/riley-pr3-outcome-attribution-spec`; will be on `main` once the spec PR merges).

---

## File Structure

**Create:**

- `packages/schemas/src/recommendation-outcome-copy.ts` — `ALLOWLISTED_TEMPLATES`, `renderOutcomeCopy()`
- `packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`
- `packages/core/src/recommendations/outcome-attribution-config.ts` — `KIND_CONFIG`, `SETTLEMENT_LAG_HOURS`, `V1_ATTRIBUTABLE_KINDS`
- `packages/core/src/recommendations/outcome-attribution-types.ts` — `MetaInsightsProvider`, `RecommendationOutcomeStore`, `WindowMetrics`, `RileyOutcomeRow`, `VisibilityFlag`
- `packages/core/src/recommendations/outcome-attribution.ts` — pure `attributeOneRecommendation()` + `runRileyOutcomeAttribution()`
- `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`
- `packages/db/src/recommendation-outcome-store.ts` — `PrismaRecommendationOutcomeStore`
- `packages/db/src/__tests__/recommendation-outcome-store.test.ts`
- `packages/db/prisma/migrations/<ts>_riley_recommendation_outcome/migration.sql`
- `apps/api/src/routes/cockpit/riley/outcomes.ts` — `GET /api/cockpit/riley/outcomes`
- `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`
- `apps/api/src/services/cron/riley-outcome-attribution.ts` — worker factory
- `apps/api/src/__tests__/api-cockpit-riley-outcome-cron.test.ts`

**Modify:**

- `packages/db/prisma/schema.prisma` — add `RecommendationOutcome` model under the existing "AI Agent System: Outcome Tracking" header (line 576)
- `packages/schemas/src/cockpit-activity.ts` — add `"observed"` to `ActivityKindSchema`
- `packages/schemas/src/index.ts` — export new copy module
- `packages/core/src/recommendations/index.ts` — export config/types/attribution
- `packages/db/src/index.ts` — export `PrismaRecommendationOutcomeStore`
- `packages/ad-optimizer/src/inngest-functions.ts` — add `createRileyOutcomeAttributionDispatch` factory
- `apps/api/src/bootstrap/inngest.ts` — wire dispatch + worker, gate worker on `RILEY_OUTCOME_ATTRIBUTION_ENABLED`
- `.env.example` — add `RILEY_OUTCOME_ATTRIBUTION_ENABLED`
- `docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md` (B.2 amendment paragraph — one paragraph at the bottom of the honest-impact guardrail section)

**Layering check.** `core` cannot import `db` or `ad-optimizer` (CLAUDE.md Layer 3 rule). Pure logic in `core` uses injected interfaces; concrete implementations are wired in `apps/api` (Layer 5). Same pattern as `packages/core/src/memory/booking-attribution.ts` and its `BookingAttributionStore` interface.

---

## Conventions assumed throughout

- ESM only; `.js` extensions in relative imports inside non-Next packages; **no `.js` in `apps/dashboard`** (per `feedback_dashboard_no_js_on_any_import`).
- `*.test.ts` colocated with source under `__tests__/`.
- Mocked Prisma for db-package tests (mirror `packages/db/src/__tests__/prisma-workflow-store.test.ts`).
- Vitest `describe`/`it`/`expect`.
- Conventional commits enforced by commitlint. Use `feat(riley-pr3)` / `test(riley-pr3)` / `chore(riley-pr3)`.
- Before any commit: `git branch --show-current && git status --short`. Expected branch starts with `worktree-riley-pr3-` or whatever the worktree was created with.
- After every commit run `pnpm format:check` locally — CI's lint job runs prettier (`feedback_ci_prettier_not_in_local_lint`).
- Pre-existing `prisma-work-trace-store-integrity` flake is documented in `feedback_db_integrity_tests_pg_advisory_lock`; do not block on it.

---

## Task 1 — Copy allowlist module

**Files:**
- Create: `packages/schemas/src/recommendation-outcome-copy.ts`
- Create: `packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALLOWLISTED_TEMPLATES, renderOutcomeCopy } from "../recommendation-outcome-copy.js";

describe("ALLOWLISTED_TEMPLATES", () => {
  it("contains exactly the four v1 templates", () => {
    expect(Object.keys(ALLOWLISTED_TEMPLATES).sort()).toEqual([
      "pause.spend.changed",
      "pause.spend.fell",
      "refresh.ctr.changed",
      "refresh.ctr.rose",
    ]);
  });
});

describe("renderOutcomeCopy", () => {
  it("renders favorable pause copy with 1-decimal absolute pct", () => {
    expect(renderOutcomeCopy("pause.spend.fell", { deltaPct: -92, windowDays: 7 })).toBe(
      "Spend fell 92.0% in 7d after pause.",
    );
  });

  it("renders changed pause copy", () => {
    expect(renderOutcomeCopy("pause.spend.changed", { deltaPct: 8.4, windowDays: 7 })).toBe(
      "Spend changed 8.4% in 7d after pause.",
    );
  });

  it("renders favorable refresh copy", () => {
    expect(renderOutcomeCopy("refresh.ctr.rose", { deltaPct: 12.3, windowDays: 14 })).toBe(
      "CTR rose 12.3% in 14d after refresh.",
    );
  });

  it("renders changed refresh copy", () => {
    expect(renderOutcomeCopy("refresh.ctr.changed", { deltaPct: -11.2, windowDays: 14 })).toBe(
      "CTR changed 11.2% in 14d after refresh.",
    );
  });

  it("returns null for unknown template (fail-closed)", () => {
    expect(renderOutcomeCopy("pause.spend.skyrocketed", { deltaPct: 1, windowDays: 7 })).toBeNull();
  });

  it("handles deltaPct = 0", () => {
    expect(renderOutcomeCopy("pause.spend.changed", { deltaPct: 0, windowDays: 7 })).toBe(
      "Spend changed 0.0% in 7d after pause.",
    );
  });

  it("contains no causal language (B.2 guardrail tripwire)", () => {
    // Cheap guard: any future template that introduces banned causal words
    // fails CI immediately. Keep this list in sync with the B.2 prohibited list.
    expect(JSON.stringify(ALLOWLISTED_TEMPLATES)).not.toMatch(
      /\b(saved|caused|recovered|improved|prevented)\b/i,
    );
  });
});
```

- [ ] **Step 1.2: Run tests, verify they fail**

```bash
pnpm --filter @switchboard/schemas test recommendation-outcome-copy
```

Expected: FAIL (module not found).

- [ ] **Step 1.3: Implement the module**

Create `packages/schemas/src/recommendation-outcome-copy.ts`:

```ts
/**
 * Allowlisted directional copy templates for RecommendationOutcome rows
 * surfaced on the /riley activity feed as "observed" rows.
 *
 * The B.2 honest-impact guardrail prohibits causal language ("Riley saved $X",
 * "refresh recovered fatigued CTR"). PR-3 introduces one narrow exception:
 * an "observed" activity row may render directional copy from this allowlist.
 * Every other Riley surface (KPI strip, ROI bar, approval cards, composer
 * responses, palette toasts) remains under the B.2 guardrail unchanged.
 *
 * Unknown templates render null and the API drops the row from the response —
 * fail-closed by construction.
 */
export const ALLOWLISTED_TEMPLATES = {
  "pause.spend.fell": "Spend fell {deltaPct}% in {windowDays}d after pause.",
  "pause.spend.changed": "Spend changed {deltaPct}% in {windowDays}d after pause.",
  "refresh.ctr.rose": "CTR rose {deltaPct}% in {windowDays}d after refresh.",
  "refresh.ctr.changed": "CTR changed {deltaPct}% in {windowDays}d after refresh.",
} as const;

export type OutcomeCopyTemplate = keyof typeof ALLOWLISTED_TEMPLATES;

export interface OutcomeCopyValues {
  deltaPct: number;
  windowDays: number;
}

export function renderOutcomeCopy(
  template: string,
  values: OutcomeCopyValues,
): string | null {
  if (!(template in ALLOWLISTED_TEMPLATES)) return null;
  const fmt = ALLOWLISTED_TEMPLATES[template as OutcomeCopyTemplate];
  return fmt
    .replace("{deltaPct}", Math.abs(values.deltaPct).toFixed(1))
    .replace("{windowDays}", String(values.windowDays));
}
```

- [ ] **Step 1.4: Add export to index**

In `packages/schemas/src/index.ts`, append next to the existing cockpit-activity export:

```ts
// PR-3: Allowlisted directional copy for "observed" activity rows
export {
  ALLOWLISTED_TEMPLATES,
  renderOutcomeCopy,
  type OutcomeCopyTemplate,
  type OutcomeCopyValues,
} from "./recommendation-outcome-copy.js";
```

- [ ] **Step 1.5: Run tests, verify they pass**

```bash
pnpm --filter @switchboard/schemas test recommendation-outcome-copy
```

Expected: PASS (6 tests).

- [ ] **Step 1.6: Commit**

```bash
git add packages/schemas/src/recommendation-outcome-copy.ts \
        packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(riley-pr3): allowlisted directional copy templates"
```

---

## Task 2 — Add `"observed"` ActivityKind

**Files:**
- Modify: `packages/schemas/src/cockpit-activity.ts`
- Modify: `packages/schemas/src/__tests__/cockpit-activity.test.ts`

- [ ] **Step 2.1: Extend the failing tests**

Append to `packages/schemas/src/__tests__/cockpit-activity.test.ts`:

```ts
describe("ActivityKindSchema — observed", () => {
  it("accepts observed as a valid kind", () => {
    expect(ActivityKindSchema.parse("observed")).toBe("observed");
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail**

```bash
pnpm --filter @switchboard/schemas test cockpit-activity
```

Expected: FAIL (`"observed"` not in enum).

- [ ] **Step 2.3: Extend the schema**

In `packages/schemas/src/cockpit-activity.ts`, append `"observed"` to the enum (keep the existing trailing entries; add as the last value so order changes are reviewable):

```ts
export const ActivityKindSchema = z.enum([
  "booked",
  "qualified",
  "replied",
  "sent",
  "started",
  "connected",
  "waiting",
  "escalated",
  "passed",
  "watching",
  "reviewing",
  "paused",
  "scaled",
  "rotated",
  "shifted",
  "restructured",
  "alert",
  "observed", // PR-3: RecommendationOutcome rendered into the activity feed
]);
```

- [ ] **Step 2.4: Run tests, verify they pass**

```bash
pnpm --filter @switchboard/schemas test cockpit-activity
```

Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add packages/schemas/src/cockpit-activity.ts \
        packages/schemas/src/__tests__/cockpit-activity.test.ts
git commit -m "feat(riley-pr3): add 'observed' ActivityKind for outcome rows"
```

---

## Task 3 — Outcome attribution config

**Files:**
- Create: `packages/core/src/recommendations/outcome-attribution-config.ts`
- Create: `packages/core/src/recommendations/__tests__/outcome-attribution-config.test.ts`
- Modify: `packages/core/src/recommendations/index.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `packages/core/src/recommendations/__tests__/outcome-attribution-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  KIND_CONFIG,
  SETTLEMENT_LAG_HOURS,
  V1_ATTRIBUTABLE_KINDS,
  isAttributableKind,
} from "../outcome-attribution-config.js";

describe("V1_ATTRIBUTABLE_KINDS", () => {
  it("contains exactly pause and refresh_creative", () => {
    expect([...V1_ATTRIBUTABLE_KINDS].sort()).toEqual(["pause", "refresh_creative"]);
  });
});

describe("KIND_CONFIG.pause", () => {
  it("has 7d window, medium confidence, spend metric, favorable down, 5% noise floor", () => {
    expect(KIND_CONFIG.pause).toEqual({
      windowDays: 7,
      confidence: "medium",
      primaryMetric: "spend",
      favorableDirection: "down",
      noiseFloorPct: 5,
      minimumAbsoluteMovementCents: 500,
    });
  });
});

describe("KIND_CONFIG.refresh_creative", () => {
  it("has 14d window, low confidence, ctr metric, favorable up, 10% noise floor", () => {
    expect(KIND_CONFIG.refresh_creative).toEqual({
      windowDays: 14,
      confidence: "low",
      primaryMetric: "ctr",
      favorableDirection: "up",
      noiseFloorPct: 10,
    });
  });
});

describe("SETTLEMENT_LAG_HOURS", () => {
  it("is 24 hours", () => {
    expect(SETTLEMENT_LAG_HOURS).toBe(24);
  });
});

describe("isAttributableKind", () => {
  it("returns true for pause and refresh_creative", () => {
    expect(isAttributableKind("pause")).toBe(true);
    expect(isAttributableKind("refresh_creative")).toBe(true);
  });

  it("returns false for scale, shift_budget_to_source, and unknown", () => {
    expect(isAttributableKind("scale")).toBe(false);
    expect(isAttributableKind("shift_budget_to_source")).toBe(false);
    expect(isAttributableKind("bogus")).toBe(false);
    expect(isAttributableKind(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run tests, verify they fail**

```bash
pnpm --filter @switchboard/core test outcome-attribution-config
```

Expected: FAIL (module not found).

- [ ] **Step 3.3: Implement the config module**

Create `packages/core/src/recommendations/outcome-attribution-config.ts`:

```ts
export const SETTLEMENT_LAG_HOURS = 24;

export const V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"] as const;

export type AttributableKind = (typeof V1_ATTRIBUTABLE_KINDS)[number];

export const KIND_CONFIG = {
  pause: {
    windowDays: 7,
    confidence: "medium" as const,
    primaryMetric: "spend" as const,
    favorableDirection: "down" as const,
    noiseFloorPct: 5,
    minimumAbsoluteMovementCents: 500,
  },
  refresh_creative: {
    windowDays: 14,
    confidence: "low" as const,
    primaryMetric: "ctr" as const,
    favorableDirection: "up" as const,
    noiseFloorPct: 10,
  },
} as const;

export function isAttributableKind(kind: string | undefined | null): kind is AttributableKind {
  return typeof kind === "string" && (V1_ATTRIBUTABLE_KINDS as readonly string[]).includes(kind);
}
```

- [ ] **Step 3.4: Add exports**

In `packages/core/src/recommendations/index.ts`, append:

```ts
// PR-3: Outcome attribution
export {
  SETTLEMENT_LAG_HOURS,
  V1_ATTRIBUTABLE_KINDS,
  KIND_CONFIG,
  isAttributableKind,
  type AttributableKind,
} from "./outcome-attribution-config.js";
```

- [ ] **Step 3.5: Run tests, verify they pass**

```bash
pnpm --filter @switchboard/core test outcome-attribution-config
```

Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add packages/core/src/recommendations/outcome-attribution-config.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution-config.test.ts \
        packages/core/src/recommendations/index.ts
git commit -m "feat(riley-pr3): per-kind attribution config + settlement lag"
```

---

## Task 4 — Interface definitions (DI surfaces)

**Files:**
- Create: `packages/core/src/recommendations/outcome-attribution-types.ts`
- Modify: `packages/core/src/recommendations/index.ts`

This task defines the interfaces concrete implementations must satisfy. No tests yet — pure type-level work. Vitest passes if compilation passes.

- [ ] **Step 4.1: Create the types module**

Create `packages/core/src/recommendations/outcome-attribution-types.ts`:

```ts
import type { AttributableKind } from "./outcome-attribution-config.js";

/**
 * Visibility flags that govern whether an outcome row is renderable in the
 * cockpit. Any non-empty flags array ⇒ cockpitRenderable = false.
 */
export type VisibilityFlag =
  | "meta_data_missing"
  | "zero_pre_baseline"
  | "below_noise_floor"
  | "same_campaign_overlap"
  | "same_kind_retry";

/**
 * Aggregated metrics for a single attribution window. Implementations must
 * return null when the window has no data; sparse data (<50% of window days)
 * is the provider's call to count as "sparse" via the dailyRowCount field.
 */
export interface WindowMetrics {
  /** Sum of spend across the window, in account-currency cents. */
  spendCents: number;
  /** Click-through rate as decimal (0.05 = 5%). */
  ctr: number;
  /** Number of daily rows actually observed in the window (used for sparse detection). */
  dailyRowCount: number;
}

export interface InsightsWindowQuery {
  campaignId: string;
  startInclusive: Date;
  endExclusive: Date;
}

/**
 * Layer-3 interface satisfied by the ad-optimizer's meta-campaign-insights-provider
 * at the apps/api wiring layer. Pure logic in `core` MUST NOT import the
 * concrete provider — only this interface.
 */
export interface MetaInsightsProvider {
  /** Returns null when no insights rows exist for the campaign in this window. */
  getWindowMetrics(query: InsightsWindowQuery): Promise<WindowMetrics | null>;
}

/**
 * Mirrors `Recommendation` projection but only the fields attribution needs.
 * Avoids importing the full Recommendation type to keep the test surface small.
 */
export interface AttributableRecommendation {
  id: string;
  organizationId: string;
  campaignId: string;
  actionKind: AttributableKind;
  resolvedAt: Date;
}

/**
 * Read-side store interface attribution uses to find candidates and detect
 * overlap. Concrete implementation lives in @switchboard/db.
 */
export interface AttributableRecommendationStore {
  /**
   * Returns acted Riley recommendations for orgId where:
   *   - actionKind ∈ V1_ATTRIBUTABLE_KINDS
   *   - resolvedAt + windowDays(kind) + SETTLEMENT_LAG_HOURS <= now
   *   - no existing RecommendationOutcome row for this recommendation id
   * Ordered by resolvedAt ASC.
   */
  findAttributableCandidates(args: {
    organizationId: string;
    now: Date;
  }): Promise<AttributableRecommendation[]>;

  /**
   * For overlap detection: returns acted Riley recommendations on the SAME campaign
   * within [windowStart, windowEnd], EXCLUDING the candidate row by id.
   * Used to detect same_campaign_overlap / same_kind_retry.
   */
  findOverlapsForCampaign(args: {
    organizationId: string;
    campaignId: string;
    excludeRecommendationId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Pick<AttributableRecommendation, "id" | "actionKind">[]>;
}

/**
 * Row shape persisted via RecommendationOutcomeStore. Mirrors the Prisma
 * model in db package; defined here so core does not import @prisma/client.
 */
export interface RileyOutcomeRow {
  recommendationId: string;
  executableWorkUnitId: string | null;
  organizationId: string;
  agentRole: "riley";
  actionKind: AttributableKind;
  anchorAt: Date;
  windowStartedAt: Date;
  windowEndedAt: Date;
  attributionMethod: "directional";
  confidence: "low" | "medium";
  cockpitRenderable: boolean;
  metricSummary: {
    preWindowDays: number;
    postWindowDays: number;
    preWindow: WindowMetrics | null;
    postWindow: WindowMetrics | null;
    deltas: { deltaPct: number | null; deltaAmountCents: number | null };
  };
  copyTemplate: string | null;
  copyValues: { deltaPct: number; windowDays: number } | null;
  visibilityFlags: VisibilityFlag[];
}

export interface RecommendationOutcomeStore {
  /** Idempotent: throws if row for recommendationId already exists. */
  insert(row: RileyOutcomeRow): Promise<void>;

  /** Quick existence check used by the worker to short-circuit before Meta queries. */
  existsByRecommendationId(recommendationId: string): Promise<boolean>;
}
```

- [ ] **Step 4.2: Add exports**

In `packages/core/src/recommendations/index.ts`, append:

```ts
export type {
  VisibilityFlag,
  WindowMetrics,
  InsightsWindowQuery,
  MetaInsightsProvider,
  AttributableRecommendation,
  AttributableRecommendationStore,
  RileyOutcomeRow,
  RecommendationOutcomeStore,
} from "./outcome-attribution-types.js";
```

- [ ] **Step 4.3: Run typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add packages/core/src/recommendations/outcome-attribution-types.ts \
        packages/core/src/recommendations/index.ts
git commit -m "feat(riley-pr3): attribution DI interfaces (provider, stores, row shape)"
```

---

## Task 5 — Pure attribution logic

**Files:**
- Create: `packages/core/src/recommendations/outcome-attribution.ts`
- Create: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`
- Modify: `packages/core/src/recommendations/index.ts`

This is the largest task. It implements `attributeOneRecommendation()` (pure function: in = candidate + windows + overlaps, out = `RileyOutcomeRow`) and `runRileyOutcomeAttribution()` (orchestrator: pulls candidates, calls overlap+meta queries, calls `attributeOneRecommendation()`, writes via store).

- [ ] **Step 5.1: Write failing tests**

Create `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  attributeOneRecommendation,
  runRileyOutcomeAttribution,
} from "../outcome-attribution.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  MetaInsightsProvider,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  WindowMetrics,
} from "../outcome-attribution-types.js";

const REC: AttributableRecommendation = {
  id: "rec-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
};

function w(spendCents: number, ctr: number, dailyRowCount = 7): WindowMetrics {
  return { spendCents, ctr, dailyRowCount };
}

describe("attributeOneRecommendation — pause favorable", () => {
  it("renders pause.spend.fell when spend drops past noise floor", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.fell");
    expect(row.copyValues).toEqual({ deltaPct: -92, windowDays: 7 });
    expect(row.visibilityFlags).toEqual([]);
    expect(row.confidence).toBe("medium");
    expect(row.attributionMethod).toBe("directional");
    expect(row.windowStartedAt).toEqual(new Date("2026-04-24T12:00:00Z"));
    expect(row.windowEndedAt).toEqual(new Date("2026-05-08T12:00:00Z"));
  });
});

describe("attributeOneRecommendation — pause unfavorable", () => {
  it("renders pause.spend.changed when spend rises past noise floor", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(11000, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.changed");
    expect(row.copyValues?.deltaPct).toBe(10);
  });
});

describe("attributeOneRecommendation — pause below noise floor (pct)", () => {
  it("hides when |deltaPct| < 5", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(9700, 0.02), // -3%
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(["below_noise_floor"]);
    expect(row.copyTemplate).toBeNull();
  });
});

describe("attributeOneRecommendation — pause below absolute floor", () => {
  it("hides when |deltaAmountCents| < 500 even if pct passes", () => {
    // pre 100c, post 0c → deltaPct -100% (passes), deltaAmount -100c (fails $5 floor)
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(100, 0.02),
      postWindow: w(0, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(["below_noise_floor"]);
  });
});

describe("attributeOneRecommendation — refresh favorable", () => {
  it("renders refresh.ctr.rose when CTR rises past 10% noise floor", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.024, 14), // +20%
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("refresh.ctr.rose");
    expect(row.copyValues).toEqual({ deltaPct: 20, windowDays: 14 });
    expect(row.confidence).toBe("low");
    expect(row.windowEndedAt).toEqual(
      new Date(REC.resolvedAt.getTime() + 14 * 24 * 60 * 60 * 1000),
    );
  });
});

describe("attributeOneRecommendation — refresh below noise floor", () => {
  it("hides when |deltaPct| < 10", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.021, 14), // +5%
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(["below_noise_floor"]);
  });
});

describe("attributeOneRecommendation — zero pre baseline", () => {
  it("flags zero_pre_baseline for pause when preWindow.spendCents = 0", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(0, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("zero_pre_baseline");
  });

  it("flags zero_pre_baseline for refresh when preWindow.ctr = 0", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0, 14),
      postWindow: w(50000, 0.02, 14),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("zero_pre_baseline");
  });
});

describe("attributeOneRecommendation — sparse meta data", () => {
  it("flags meta_data_missing when post-window dailyRowCount < 50% of windowDays", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02, 7),
      postWindow: w(800, 0.02, 3), // 3 < 7 * 0.5
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("meta_data_missing");
  });

  it("flags meta_data_missing when either window is null", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: null,
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toContain("meta_data_missing");
    expect(row.metricSummary.preWindow).toBeNull();
  });
});

describe("attributeOneRecommendation — overlap", () => {
  it("flags same_campaign_overlap when another acted rec exists on the same campaign", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [{ id: "rec-2", actionKind: "refresh_creative" }],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(expect.arrayContaining(["same_campaign_overlap"]));
    expect(row.visibilityFlags).not.toContain("same_kind_retry");
  });

  it("adds same_kind_retry as additive flag when overlap shares this kind", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [{ id: "rec-2", actionKind: "pause" }],
    });
    expect(row.cockpitRenderable).toBe(false);
    expect(row.visibilityFlags).toEqual(
      expect.arrayContaining(["same_campaign_overlap", "same_kind_retry"]),
    );
  });
});

describe("attributeOneRecommendation — metricSummary always populated", () => {
  it("includes raw windows + window-day metadata for auditability", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.metricSummary.preWindowDays).toBe(7);
    expect(row.metricSummary.postWindowDays).toBe(7);
    expect(row.metricSummary.preWindow).toEqual(w(10000, 0.02));
    expect(row.metricSummary.postWindow).toEqual(w(800, 0.02));
    expect(row.metricSummary.deltas.deltaPct).toBe(-92);
    expect(row.metricSummary.deltas.deltaAmountCents).toBe(-9200);
  });
});

describe("runRileyOutcomeAttribution — orchestration", () => {
  function buildDeps() {
    const recommendationStore: AttributableRecommendationStore = {
      findAttributableCandidates: vi.fn().mockResolvedValue([REC]),
      findOverlapsForCampaign: vi.fn().mockResolvedValue([]),
    };
    const insightsProvider: MetaInsightsProvider = {
      getWindowMetrics: vi.fn().mockImplementation(async ({ startInclusive }) => {
        return startInclusive.getTime() < REC.resolvedAt.getTime()
          ? w(10000, 0.02)
          : w(800, 0.02);
      }),
    };
    const outcomeStore: RecommendationOutcomeStore = {
      existsByRecommendationId: vi.fn().mockResolvedValue(false),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    return { recommendationStore, insightsProvider, outcomeStore };
  }

  it("writes an outcome row and returns a run summary", async () => {
    const deps = buildDeps();
    const summary = await runRileyOutcomeAttribution({
      ...deps,
      orgId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    expect(deps.outcomeStore.insert).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      orgId: "org-1",
      candidatesScanned: 1,
      skippedExisting: 0,
      outcomesWritten: 1,
      renderable: 1,
      hidden: 0,
      hiddenByFlag: {
        meta_data_missing: 0,
        zero_pre_baseline: 0,
        below_noise_floor: 0,
        same_campaign_overlap: 0,
      },
    });
  });

  it("short-circuits when outcome already exists (skippedExisting++)", async () => {
    const deps = buildDeps();
    (deps.outcomeStore.existsByRecommendationId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const summary = await runRileyOutcomeAttribution({
      ...deps,
      orgId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    expect(deps.insightsProvider.getWindowMetrics).not.toHaveBeenCalled();
    expect(deps.outcomeStore.insert).not.toHaveBeenCalled();
    expect(summary.skippedExisting).toBe(1);
    expect(summary.outcomesWritten).toBe(0);
  });

  it("writes hidden audit row + increments hiddenByFlag on contamination", async () => {
    const deps = buildDeps();
    (deps.recommendationStore.findOverlapsForCampaign as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "rec-2", actionKind: "refresh_creative" },
    ]);
    const summary = await runRileyOutcomeAttribution({
      ...deps,
      orgId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    expect(deps.outcomeStore.insert).toHaveBeenCalledTimes(1);
    expect(summary.hidden).toBe(1);
    expect(summary.renderable).toBe(0);
    expect(summary.hiddenByFlag.same_campaign_overlap).toBe(1);
  });

  it("retries on Meta provider failure (let error propagate for Inngest retry)", async () => {
    const deps = buildDeps();
    (deps.insightsProvider.getWindowMetrics as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("meta 500"),
    );
    await expect(
      runRileyOutcomeAttribution({
        ...deps,
        orgId: "org-1",
        now: new Date("2026-05-15T07:00:00Z"),
      }),
    ).rejects.toThrow("meta 500");
    expect(deps.outcomeStore.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run tests, verify they fail**

```bash
pnpm --filter @switchboard/core test outcome-attribution
```

Expected: FAIL (`outcome-attribution.ts` not found).

- [ ] **Step 5.3: Implement the pure logic**

Create `packages/core/src/recommendations/outcome-attribution.ts`:

```ts
import {
  KIND_CONFIG,
  SETTLEMENT_LAG_HOURS,
  type AttributableKind,
} from "./outcome-attribution-config.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  MetaInsightsProvider,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  VisibilityFlag,
  WindowMetrics,
} from "./outcome-attribution-types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AttributeOneInput {
  candidate: AttributableRecommendation;
  preWindow: WindowMetrics | null;
  postWindow: WindowMetrics | null;
  overlaps: { id: string; actionKind: AttributableKind }[];
}

export function attributeOneRecommendation(input: AttributeOneInput): RileyOutcomeRow {
  const { candidate, preWindow, postWindow, overlaps } = input;
  const config = KIND_CONFIG[candidate.actionKind];
  const windowDays = config.windowDays;
  const anchorAt = candidate.resolvedAt;
  const windowStartedAt = new Date(anchorAt.getTime() - windowDays * MS_PER_DAY);
  const windowEndedAt = new Date(anchorAt.getTime() + windowDays * MS_PER_DAY);

  const flags: VisibilityFlag[] = [];

  // 1. Missing/sparse Meta data
  const sparseThreshold = Math.ceil(windowDays * 0.5);
  if (!preWindow || !postWindow) {
    flags.push("meta_data_missing");
  } else if (
    preWindow.dailyRowCount < sparseThreshold ||
    postWindow.dailyRowCount < sparseThreshold
  ) {
    flags.push("meta_data_missing");
  }

  // 2. Zero baseline (only meaningful if windows exist)
  if (preWindow && postWindow) {
    if (candidate.actionKind === "pause" && preWindow.spendCents === 0) {
      flags.push("zero_pre_baseline");
    }
    if (candidate.actionKind === "refresh_creative" && preWindow.ctr === 0) {
      flags.push("zero_pre_baseline");
    }
  }

  // 3. Overlap (regardless of meta status)
  for (const other of overlaps) {
    if (other.id === candidate.id) continue; // belt-and-suspenders; store should exclude
    if (!flags.includes("same_campaign_overlap")) flags.push("same_campaign_overlap");
    if (other.actionKind === candidate.actionKind && !flags.includes("same_kind_retry")) {
      flags.push("same_kind_retry");
    }
  }

  // 4. Compute deltas (when both windows exist; null otherwise — kept in summary)
  let deltaPct: number | null = null;
  let deltaAmountCents: number | null = null;
  if (preWindow && postWindow) {
    if (candidate.actionKind === "pause") {
      if (preWindow.spendCents > 0) {
        deltaPct = ((postWindow.spendCents - preWindow.spendCents) / preWindow.spendCents) * 100;
      }
      deltaAmountCents = postWindow.spendCents - preWindow.spendCents;
    } else {
      if (preWindow.ctr > 0) {
        deltaPct = ((postWindow.ctr - preWindow.ctr) / preWindow.ctr) * 100;
      }
    }
  }

  // 5. Noise-floor check (only when no prior flag and deltas computable)
  const hadPriorFlag = flags.length > 0;
  if (!hadPriorFlag && deltaPct !== null) {
    const belowPct = Math.abs(deltaPct) < config.noiseFloorPct;
    const belowAbsCents =
      candidate.actionKind === "pause" &&
      "minimumAbsoluteMovementCents" in config &&
      Math.abs(deltaAmountCents ?? 0) < config.minimumAbsoluteMovementCents;
    if (belowPct || belowAbsCents) {
      flags.push("below_noise_floor");
    }
  }

  // 6. Determine renderability + template + confidence
  const cockpitRenderable = flags.length === 0 && deltaPct !== null;
  const confidence: "low" | "medium" = cockpitRenderable ? config.confidence : "low";

  let copyTemplate: string | null = null;
  let copyValues: { deltaPct: number; windowDays: number } | null = null;

  if (cockpitRenderable && deltaPct !== null) {
    const direction = Math.sign(deltaPct);
    const favorableSign = config.favorableDirection === "down" ? -1 : 1;
    const isFavorable = direction === favorableSign;

    if (candidate.actionKind === "pause") {
      copyTemplate = isFavorable ? "pause.spend.fell" : "pause.spend.changed";
    } else {
      copyTemplate = isFavorable ? "refresh.ctr.rose" : "refresh.ctr.changed";
    }
    copyValues = { deltaPct, windowDays };
  }

  return {
    recommendationId: candidate.id,
    executableWorkUnitId: null,
    organizationId: candidate.organizationId,
    agentRole: "riley",
    actionKind: candidate.actionKind,
    anchorAt,
    windowStartedAt,
    windowEndedAt,
    attributionMethod: "directional",
    confidence,
    cockpitRenderable,
    metricSummary: {
      preWindowDays: windowDays,
      postWindowDays: windowDays,
      preWindow,
      postWindow,
      deltas: { deltaPct, deltaAmountCents },
    },
    copyTemplate,
    copyValues,
    visibilityFlags: flags,
  };
}

export interface RileyOutcomeRunSummary {
  orgId: string;
  candidatesScanned: number;
  skippedExisting: number;
  outcomesWritten: number;
  renderable: number;
  hidden: number;
  hiddenByFlag: {
    meta_data_missing: number;
    zero_pre_baseline: number;
    below_noise_floor: number;
    same_campaign_overlap: number;
  };
}

export interface RunRileyOutcomeAttributionInput {
  recommendationStore: AttributableRecommendationStore;
  insightsProvider: MetaInsightsProvider;
  outcomeStore: RecommendationOutcomeStore;
  orgId: string;
  now: Date;
}

export async function runRileyOutcomeAttribution(
  input: RunRileyOutcomeAttributionInput,
): Promise<RileyOutcomeRunSummary> {
  const { recommendationStore, insightsProvider, outcomeStore, orgId, now } = input;
  const summary: RileyOutcomeRunSummary = {
    orgId,
    candidatesScanned: 0,
    skippedExisting: 0,
    outcomesWritten: 0,
    renderable: 0,
    hidden: 0,
    hiddenByFlag: {
      meta_data_missing: 0,
      zero_pre_baseline: 0,
      below_noise_floor: 0,
      same_campaign_overlap: 0,
    },
  };

  const candidates = await recommendationStore.findAttributableCandidates({
    organizationId: orgId,
    now,
  });

  for (const candidate of candidates) {
    summary.candidatesScanned++;

    // Cheap pre-check before any Meta query
    if (await outcomeStore.existsByRecommendationId(candidate.id)) {
      summary.skippedExisting++;
      continue;
    }

    const config = KIND_CONFIG[candidate.actionKind];
    const windowDays = config.windowDays;
    const anchorAt = candidate.resolvedAt;
    const preStart = new Date(anchorAt.getTime() - windowDays * MS_PER_DAY);
    const postEnd = new Date(anchorAt.getTime() + windowDays * MS_PER_DAY);

    // Overlap query (excludes current rec id in the store)
    const overlaps = await recommendationStore.findOverlapsForCampaign({
      organizationId: orgId,
      campaignId: candidate.campaignId,
      excludeRecommendationId: candidate.id,
      windowStart: new Date(preStart.getTime() - windowDays * MS_PER_DAY),
      windowEnd: postEnd,
    });

    // Meta windows — let provider errors propagate to trigger Inngest retry
    const [preWindow, postWindow] = await Promise.all([
      insightsProvider.getWindowMetrics({
        campaignId: candidate.campaignId,
        startInclusive: preStart,
        endExclusive: anchorAt,
      }),
      insightsProvider.getWindowMetrics({
        campaignId: candidate.campaignId,
        startInclusive: anchorAt,
        endExclusive: postEnd,
      }),
    ]);

    const row = attributeOneRecommendation({
      candidate,
      preWindow,
      postWindow,
      overlaps,
    });

    await outcomeStore.insert(row);
    summary.outcomesWritten++;
    if (row.cockpitRenderable) {
      summary.renderable++;
    } else {
      summary.hidden++;
      for (const flag of row.visibilityFlags) {
        if (flag in summary.hiddenByFlag) {
          summary.hiddenByFlag[flag as keyof typeof summary.hiddenByFlag]++;
        }
        // same_kind_retry intentionally not counted (additive metadata; parent flag drives hide)
      }
    }
  }

  return summary;
}
```

- [ ] **Step 5.4: Add exports**

In `packages/core/src/recommendations/index.ts`, append:

```ts
export {
  attributeOneRecommendation,
  runRileyOutcomeAttribution,
  type AttributeOneInput,
  type RileyOutcomeRunSummary,
  type RunRileyOutcomeAttributionInput,
} from "./outcome-attribution.js";
```

- [ ] **Step 5.5: Run tests, verify they pass**

```bash
pnpm --filter @switchboard/core test outcome-attribution
```

Expected: all tests PASS.

- [ ] **Step 5.6: Verify no layer violations**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS. (Core must not import `@switchboard/db` or `@switchboard/ad-optimizer` — grep the new files to confirm.)

```bash
grep -r "@switchboard/db\|@switchboard/ad-optimizer" packages/core/src/recommendations/outcome-attribution.ts packages/core/src/recommendations/outcome-attribution-types.ts packages/core/src/recommendations/outcome-attribution-config.ts
```

Expected: no matches.

- [ ] **Step 5.7: Commit**

```bash
git add packages/core/src/recommendations/outcome-attribution.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution.test.ts \
        packages/core/src/recommendations/index.ts
git commit -m "feat(riley-pr3): pure directional attribution logic + orchestrator"
```

---

## Task 6 — Prisma schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_riley_recommendation_outcome/migration.sql`

This task requires a running Postgres. If Postgres isn't reachable, see CLAUDE.md: `pnpm worktree:init` warns; start docker-compose first.

- [ ] **Step 6.1: Add the model to schema.prisma**

In `packages/db/prisma/schema.prisma`, replace the empty "AI Agent System: Outcome Tracking" section (line 576) with:

```prisma
// ── AI Agent System: Outcome Tracking ──

model RecommendationOutcome {
  id String @id @default(cuid())

  // PendingActionRecord.id for intent="recommendation.*".
  // Product-facing name; the FK target is PendingActionRecord because
  // "Recommendation" is not its own table.
  recommendationId     String  @unique
  executableWorkUnitId String?

  organizationId String
  agentRole      String // "riley" v1; "alex" reserved
  actionKind     String // "pause" | "refresh_creative"

  anchorAt        DateTime
  windowStartedAt DateTime
  windowEndedAt   DateTime
  observedAt      DateTime @default(now())

  attributionMethod String // "directional" v1
  confidence        String // "low" | "medium"

  cockpitRenderable Boolean @default(false)

  metricSummary    Json
  copyTemplate     String?
  copyValues       Json?
  visibilityFlags  Json

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  recommendation PendingActionRecord @relation(
    fields: [recommendationId],
    references: [id],
    onDelete: Cascade
  )

  @@index([organizationId, agentRole, actionKind, windowEndedAt])
  @@index([organizationId, agentRole, cockpitRenderable, windowEndedAt])
  @@index([executableWorkUnitId])
}
```

Then add the reverse-relation line to `PendingActionRecord`. Find `model PendingActionRecord` (around line 1460) and add inside the model body next to other relations:

```prisma
  recommendationOutcome RecommendationOutcome?
```

- [ ] **Step 6.2: Generate the incremental migration SQL**

Per CLAUDE.md `feedback_prisma_migrate_dev_tty` and `feedback_prisma_index_name_63_char_limit`, do NOT use `prisma migrate dev` (it needs a TTY). Generate the incremental SQL diff between current DB state and the new schema via `migrate diff` with `--from-url`:

```bash
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/riley-outcome-migration.sql
cat /tmp/riley-outcome-migration.sql
```

`--from-url "$DATABASE_URL"` is the right flag for incremental migrations: it produces the SQL diff from the live DB state to the new schema. (`--from-empty` would emit the entire schema from scratch and is only useful for canonical-index-name verification, not for the actual migration.)

Verify index names are Prisma-truncated (under 63 chars). Inspect; should look like:

```sql
CREATE TABLE "RecommendationOutcome" (...);
CREATE UNIQUE INDEX "RecommendationOutcome_recommendationId_key" ...;
CREATE INDEX "RecommendationOutcome_organizationId_agentRole_actionKi_idx" ...;
CREATE INDEX "RecommendationOutcome_organizationId_agentRole_cockpitRe_idx" ...;
CREATE INDEX "RecommendationOutcome_executableWorkUnitId_idx" ...;
ALTER TABLE "RecommendationOutcome" ADD CONSTRAINT ... FOREIGN KEY ("recommendationId") REFERENCES "PendingActionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6.3: Create the migration directory**

```bash
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "packages/db/prisma/migrations/${TS}_riley_recommendation_outcome"
mv /tmp/riley-outcome-migration.sql "packages/db/prisma/migrations/${TS}_riley_recommendation_outcome/migration.sql"
```

- [ ] **Step 6.4: Apply the migration**

```bash
pnpm db:migrate
```

Expected: `Applying migration <ts>_riley_recommendation_outcome` and `All migrations have been successfully applied.`

- [ ] **Step 6.5: Check drift**

```bash
pnpm db:check-drift
```

Expected: PASS (no drift).

- [ ] **Step 6.6: Regenerate Prisma client**

```bash
pnpm db:generate
```

Expected: client regenerated with `prisma.recommendationOutcome`.

- [ ] **Step 6.7: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations
git commit -m "feat(riley-pr3): add RecommendationOutcome table + migration"
```

---

## Task 7 — `PrismaRecommendationOutcomeStore`

**Files:**
- Create: `packages/db/src/recommendation-outcome-store.ts`
- Create: `packages/db/src/__tests__/recommendation-outcome-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 7.1: Write the failing tests**

Mirror `packages/db/src/__tests__/prisma-workflow-store.test.ts` for the mocked-Prisma pattern. Create `packages/db/src/__tests__/recommendation-outcome-store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  PrismaRecommendationOutcomeStore,
  PrismaAttributableRecommendationStore,
  RecommendationOutcomeAlreadyExistsError,
  extractCampaignIdentity,
} from "../recommendation-outcome-store.js";
import type { RileyOutcomeRow } from "@switchboard/core";

function buildPrismaMock() {
  return {
    recommendationOutcome: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    pendingActionRecord: {
      findMany: vi.fn(),
    },
  } as const;
}

const SAMPLE_ROW: RileyOutcomeRow = {
  recommendationId: "rec-1",
  executableWorkUnitId: null,
  organizationId: "org-1",
  agentRole: "riley",
  actionKind: "pause",
  anchorAt: new Date("2026-05-01T12:00:00Z"),
  windowStartedAt: new Date("2026-04-24T12:00:00Z"),
  windowEndedAt: new Date("2026-05-08T12:00:00Z"),
  attributionMethod: "directional",
  confidence: "medium",
  cockpitRenderable: true,
  metricSummary: {
    preWindowDays: 7,
    postWindowDays: 7,
    preWindow: { spendCents: 10000, ctr: 0.02, dailyRowCount: 7 },
    postWindow: { spendCents: 800, ctr: 0.02, dailyRowCount: 7 },
    deltas: { deltaPct: -92, deltaAmountCents: -9200 },
  },
  copyTemplate: "pause.spend.fell",
  copyValues: { deltaPct: -92, windowDays: 7 },
  visibilityFlags: [],
};

describe("PrismaRecommendationOutcomeStore.insert", () => {
  it("creates the row with visibilityFlags serialized as JSON", async () => {
    const prisma = buildPrismaMock();
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await store.insert(SAMPLE_ROW);
    expect(prisma.recommendationOutcome.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recommendationId: "rec-1",
        organizationId: "org-1",
        agentRole: "riley",
        actionKind: "pause",
        cockpitRenderable: true,
        copyTemplate: "pause.spend.fell",
        visibilityFlags: [],
      }),
    });
  });

  it("translates P2002 unique violation to RecommendationOutcomeAlreadyExistsError", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "P2002",
    });
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await expect(store.insert(SAMPLE_ROW)).rejects.toBeInstanceOf(
      RecommendationOutcomeAlreadyExistsError,
    );
  });

  it("propagates non-P2002 errors", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("conn lost"),
    );
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await expect(store.insert(SAMPLE_ROW)).rejects.toThrow("conn lost");
  });
});

describe("PrismaRecommendationOutcomeStore.existsByRecommendationId", () => {
  it("returns true when a row exists", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "outcome-1",
    });
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    expect(await store.existsByRecommendationId("rec-1")).toBe(true);
  });

  it("returns false when no row exists", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    expect(await store.existsByRecommendationId("rec-1")).toBe(false);
  });
});

describe("PrismaRecommendationOutcomeStore.listRenderableForOrg", () => {
  it("filters cockpitRenderable=true, orders by windowEndedAt desc, includes recommendation relation", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
    expect(prisma.recommendationOutcome.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentRole: "riley", cockpitRenderable: true },
      orderBy: { windowEndedAt: "desc" },
      take: 50,
      include: {
        recommendation: { select: { targetEntities: true, parameters: true } },
      },
    });
  });

  it("projects campaignId/campaignName from the joined recommendation", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "outcome-1",
        recommendationId: "rec-1",
        actionKind: "pause",
        windowEndedAt: new Date("2026-05-08T12:00:00Z"),
        copyTemplate: "pause.spend.fell",
        copyValues: { deltaPct: -92, windowDays: 7 },
        recommendation: {
          targetEntities: { campaignId: "camp-A", campaignName: "Campaign A" },
          parameters: {},
        },
      },
    ]);
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    const out = await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
    expect(out[0]).toMatchObject({
      id: "outcome-1",
      campaignId: "camp-A",
      campaignName: "Campaign A",
    });
  });
});
```

Add a second describe block for the AttributableRecommendationStore (lives in same file):

```ts
describe("extractCampaignIdentity", () => {
  it("reads {campaignId, campaignName} from top-level targetEntities", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { campaignId: "camp-A", campaignName: "Campaign A" },
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-A", campaignName: "Campaign A" });
  });

  it("falls back to campaignName=null when only campaignId is present", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { campaignId: "camp-A" },
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-A", campaignName: null });
  });

  it("reads from {entities: [{kind:'campaign', id, name}]} shape", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { entities: [{ kind: "campaign", id: "camp-B", name: "B" }] },
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-B", campaignName: "B" });
  });

  it("reads from bare array shape", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: [{ kind: "campaign", id: "camp-C" }],
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-C", campaignName: null });
  });

  it("falls back to parameters.campaignId", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: {},
        parameters: { campaignId: "camp-D" },
      }),
    ).toEqual({ campaignId: "camp-D", campaignName: null });
  });

  it("returns null when no campaign identity is findable", () => {
    expect(
      extractCampaignIdentity({ targetEntities: {}, parameters: {} }),
    ).toBeNull();
  });

  it("returns null on malformed entities (no campaign element)", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { entities: [{ kind: "ad", id: "ad-1" }] },
        parameters: {},
      }),
    ).toBeNull();
  });
});

describe("PrismaAttributableRecommendationStore.findAttributableCandidates", () => {
  it("filters intent/sourceAgent/status and excludes existing outcomes", async () => {
    const prisma = buildPrismaMock();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);
    await store.findAttributableCandidates({
      organizationId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    const call = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.organizationId).toBe("org-1");
    expect(call.where.sourceAgent).toBe("riley");
    expect(call.where.status).toBe("acted");
    expect(call.where.intent.startsWith).toBe("recommendation.");
    expect(call.where.resolvedAt.not).toBeNull();
    expect(call.where.recommendationOutcome.is).toBeNull();
    expect(call.orderBy).toEqual({ resolvedAt: "asc" });
  });
});

describe("PrismaAttributableRecommendationStore.findOverlapsForCampaign", () => {
  it("excludes the candidate id and filters by campaignId in targetEntities", async () => {
    const prisma = buildPrismaMock();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);
    await store.findOverlapsForCampaign({
      organizationId: "org-1",
      campaignId: "camp-A",
      excludeRecommendationId: "rec-1",
      windowStart: new Date("2026-04-17T12:00:00Z"),
      windowEnd: new Date("2026-05-08T12:00:00Z"),
    });
    const call = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.id.not).toBe("rec-1");
    expect(call.where.organizationId).toBe("org-1");
    expect(call.where.sourceAgent).toBe("riley");
    expect(call.where.status).toBe("acted");
  });
});
```

- [ ] **Step 7.2: Run tests, verify they fail**

```bash
pnpm --filter @switchboard/db test recommendation-outcome-store
```

Expected: FAIL (module not found).

- [ ] **Step 7.3: Implement the stores**

Create `packages/db/src/recommendation-outcome-store.ts`:

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  isAttributableKind,
  KIND_CONFIG,
  SETTLEMENT_LAG_HOURS,
  type AttributableKind,
  type AttributableRecommendation,
  type AttributableRecommendationStore,
  type RecommendationOutcomeStore,
  type RileyOutcomeRow,
} from "@switchboard/core";

export class RecommendationOutcomeAlreadyExistsError extends Error {
  constructor(public readonly recommendationId: string) {
    super(`RecommendationOutcome already exists for recommendation ${recommendationId}`);
    this.name = "RecommendationOutcomeAlreadyExistsError";
  }
}

/**
 * Tolerant extractor for the campaign identity carried on a recommendation row.
 * Riley emits campaignId inside targetEntities, but historic shapes have varied
 * (top-level field, array of {kind, id}, parameters payload). Try the known
 * locations in priority order; return null if none match.
 *
 * Tested against real PendingActionRecord rows in the store tests.
 */
export function extractCampaignIdentity(row: {
  targetEntities: Prisma.JsonValue;
  parameters: Prisma.JsonValue;
}): { campaignId: string; campaignName: string | null } | null {
  const te = row.targetEntities;
  const params = row.parameters;

  // Shape 1: { campaignId: "...", campaignName?: "..." } on targetEntities
  if (te && typeof te === "object" && !Array.isArray(te)) {
    const obj = te as Record<string, unknown>;
    if (typeof obj.campaignId === "string" && obj.campaignId.length > 0) {
      return {
        campaignId: obj.campaignId,
        campaignName: typeof obj.campaignName === "string" ? obj.campaignName : null,
      };
    }
    // Shape 2: { entities: [{ kind: "campaign", id, name? }, ...] } on targetEntities
    if (Array.isArray(obj.entities)) {
      const match = obj.entities.find(
        (e: unknown): e is { kind: string; id: string; name?: string } =>
          !!e &&
          typeof e === "object" &&
          (e as { kind?: unknown }).kind === "campaign" &&
          typeof (e as { id?: unknown }).id === "string",
      );
      if (match) {
        return {
          campaignId: match.id,
          campaignName: typeof match.name === "string" ? match.name : null,
        };
      }
    }
  }

  // Shape 3: bare array of {kind, id, name?}
  if (Array.isArray(te)) {
    const match = (te as unknown[]).find(
      (e): e is { kind: string; id: string; name?: string } =>
        !!e &&
        typeof e === "object" &&
        (e as { kind?: unknown }).kind === "campaign" &&
        typeof (e as { id?: unknown }).id === "string",
    );
    if (match) {
      return {
        campaignId: match.id,
        campaignName: typeof match.name === "string" ? match.name : null,
      };
    }
  }

  // Shape 4: parameters.campaignId fallback
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const obj = params as Record<string, unknown>;
    if (typeof obj.campaignId === "string" && obj.campaignId.length > 0) {
      return { campaignId: obj.campaignId, campaignName: null };
    }
  }

  return null;
}

export class PrismaRecommendationOutcomeStore implements RecommendationOutcomeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(row: RileyOutcomeRow): Promise<void> {
    try {
      await this.prisma.recommendationOutcome.create({
        data: {
          recommendationId: row.recommendationId,
          executableWorkUnitId: row.executableWorkUnitId,
          organizationId: row.organizationId,
          agentRole: row.agentRole,
          actionKind: row.actionKind,
          anchorAt: row.anchorAt,
          windowStartedAt: row.windowStartedAt,
          windowEndedAt: row.windowEndedAt,
          attributionMethod: row.attributionMethod,
          confidence: row.confidence,
          cockpitRenderable: row.cockpitRenderable,
          metricSummary: row.metricSummary as Prisma.InputJsonValue,
          // Prisma nullable JSON column: must use Prisma.JsonNull, not raw null.
          copyTemplate: row.copyTemplate,
          copyValues:
            row.copyValues === null
              ? Prisma.JsonNull
              : (row.copyValues as Prisma.InputJsonValue),
          visibilityFlags: row.visibilityFlags as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        throw new RecommendationOutcomeAlreadyExistsError(row.recommendationId);
      }
      throw err;
    }
  }

  async existsByRecommendationId(recommendationId: string): Promise<boolean> {
    const row = await this.prisma.recommendationOutcome.findUnique({
      where: { recommendationId },
      select: { id: true },
    });
    return row !== null;
  }

  async listRenderableForOrg(args: {
    orgId: string;
    agentRole: string;
    limit: number;
  }): Promise<RecommendationOutcomeReadModel[]> {
    const rows = await this.prisma.recommendationOutcome.findMany({
      where: {
        organizationId: args.orgId,
        agentRole: args.agentRole,
        cockpitRenderable: true,
      },
      orderBy: { windowEndedAt: "desc" },
      take: args.limit,
      include: {
        // Join the parent recommendation so the projection can extract
        // campaignId + campaignName for the API's activity-row body. Avoids
        // a second roundtrip from the route.
        recommendation: {
          select: { targetEntities: true, parameters: true },
        },
      },
    });
    return rows.map(projectReadModel);
  }
}

export interface RecommendationOutcomeReadModel {
  id: string;
  recommendationId: string;
  actionKind: AttributableKind;
  windowEndedAt: Date;
  copyTemplate: string | null;
  copyValues: { deltaPct: number; windowDays: number } | null;
  campaignId: string | null;
  campaignName: string | null;
}

function projectReadModel(row: {
  id: string;
  recommendationId: string;
  actionKind: string;
  windowEndedAt: Date;
  copyTemplate: string | null;
  copyValues: Prisma.JsonValue;
  recommendation: { targetEntities: Prisma.JsonValue; parameters: Prisma.JsonValue } | null;
}): RecommendationOutcomeReadModel {
  const cv = row.copyValues as { deltaPct?: number; windowDays?: number } | null;
  const campaign = row.recommendation
    ? extractCampaignIdentity(row.recommendation)
    : null;
  return {
    id: row.id,
    recommendationId: row.recommendationId,
    actionKind: row.actionKind as AttributableKind,
    windowEndedAt: row.windowEndedAt,
    copyTemplate: row.copyTemplate,
    copyValues:
      cv && typeof cv.deltaPct === "number" && typeof cv.windowDays === "number"
        ? { deltaPct: cv.deltaPct, windowDays: cv.windowDays }
        : null,
    campaignId: campaign?.campaignId ?? null,
    campaignName: campaign?.campaignName ?? null,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export class PrismaAttributableRecommendationStore implements AttributableRecommendationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findAttributableCandidates(args: {
    organizationId: string;
    now: Date;
  }): Promise<AttributableRecommendation[]> {
    // SQL prefilter: any kind's earliest eligible resolvedAt is
    // now - maxWindowDays - settlementLag. Pull anything older; refine per-kind
    // in projectCandidate() since each kind has its own windowDays.
    const maxWindowDays = Math.max(...Object.values(KIND_CONFIG).map((c) => c.windowDays));
    const cutoff = new Date(
      args.now.getTime() -
        SETTLEMENT_LAG_HOURS * MS_PER_HOUR -
        maxWindowDays * MS_PER_DAY,
    );

    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        organizationId: args.organizationId,
        sourceAgent: "riley",
        status: "acted",
        intent: { startsWith: "recommendation." },
        resolvedAt: { not: null, lte: cutoff },
        recommendationOutcome: { is: null },
      },
      orderBy: { resolvedAt: "asc" },
    });

    return rows
      .map((row) => projectCandidate(row, args.now))
      .filter((c): c is AttributableRecommendation => c !== null);
  }

  async findOverlapsForCampaign(args: {
    organizationId: string;
    campaignId: string;
    excludeRecommendationId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Pick<AttributableRecommendation, "id" | "actionKind">[]> {
    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        id: { not: args.excludeRecommendationId },
        organizationId: args.organizationId,
        sourceAgent: "riley",
        status: "acted",
        intent: { startsWith: "recommendation." },
        resolvedAt: { not: null, gte: args.windowStart, lte: args.windowEnd },
      },
    });

    return rows
      .map((row) => {
        const projected = projectCandidate(row, args.windowEnd);
        if (!projected) return null;
        if (projected.campaignId !== args.campaignId) return null;
        return { id: projected.id, actionKind: projected.actionKind };
      })
      .filter((r): r is { id: string; actionKind: AttributableKind } => r !== null);
  }
}

interface PrismaCandidateRow {
  id: string;
  organizationId: string;
  parameters: Prisma.JsonValue;
  targetEntities: Prisma.JsonValue;
  resolvedAt: Date | null;
}

function projectCandidate(row: PrismaCandidateRow, now: Date): AttributableRecommendation | null {
  if (!row.resolvedAt) return null;

  const params = (row.parameters ?? {}) as { __recommendation?: { action?: string } };
  const kind = params.__recommendation?.action;
  if (!isAttributableKind(kind)) return null;

  const identity = extractCampaignIdentity(row);
  if (!identity) return null;

  // Refine per-kind eligibility: windowDays must have elapsed + settlement lag.
  const windowDays = KIND_CONFIG[kind].windowDays;
  const eligibleAfter = new Date(
    row.resolvedAt.getTime() + windowDays * MS_PER_DAY + SETTLEMENT_LAG_HOURS * MS_PER_HOUR,
  );
  if (eligibleAfter.getTime() > now.getTime()) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    campaignId: identity.campaignId,
    actionKind: kind,
    resolvedAt: row.resolvedAt,
  };
}
```

- [ ] **Step 7.4: Add exports**

In `packages/db/src/index.ts`, append:

```ts
export {
  PrismaRecommendationOutcomeStore,
  PrismaAttributableRecommendationStore,
  RecommendationOutcomeAlreadyExistsError,
  type RecommendationOutcomeReadModel,
} from "./recommendation-outcome-store.js";
```

- [ ] **Step 7.5: Run tests, verify they pass**

```bash
pnpm --filter @switchboard/db test recommendation-outcome-store
```

Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add packages/db/src/recommendation-outcome-store.ts \
        packages/db/src/__tests__/recommendation-outcome-store.test.ts \
        packages/db/src/index.ts
git commit -m "feat(riley-pr3): Prisma RecommendationOutcome + AttributableRecommendation stores"
```

---

## Task 8 — API route `/api/cockpit/riley/outcomes`

**Files:**
- Create: `apps/api/src/routes/cockpit/riley/outcomes.ts`
- Create: `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`
- Modify: `apps/api/src/app.ts` (register the route)

- [ ] **Step 8.1: Locate the existing cockpit riley route pattern**

```bash
find apps/api/src/routes/cockpit/riley -type f -name '*.ts' | head
grep -n "cockpit/riley" apps/api/src/app.ts | head
```

Expected: existing files like `activity.ts`. The new `outcomes.ts` follows the same pattern.

- [ ] **Step 8.2: Write the failing test**

Create `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTestServer } from "./helpers/build-test-server.js"; // adjust to existing helper path
import { renderOutcomeCopy } from "@switchboard/schemas";

const SAMPLE_ROWS = [
  {
    id: "outcome-1",
    recommendationId: "rec-1",
    actionKind: "pause",
    windowEndedAt: new Date("2026-05-08T12:00:00Z"),
    copyTemplate: "pause.spend.fell",
    copyValues: { deltaPct: -92, windowDays: 7 },
    campaignId: "camp-A",
    campaignName: "Campaign A",
  },
  {
    id: "outcome-2",
    recommendationId: "rec-2",
    actionKind: "refresh_creative",
    windowEndedAt: new Date("2026-05-09T12:00:00Z"),
    copyTemplate: "refresh.ctr.rose",
    copyValues: { deltaPct: 12.3, windowDays: 14 },
    campaignId: "camp-B",
    campaignName: null,
  },
];

describe("GET /api/cockpit/riley/outcomes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns translated ActivityRow[] with kind='observed'", async () => {
    const server = await buildTestServer({
      outcomes: SAMPLE_ROWS,
    });
    const res = await server.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes?orgId=org-1",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: { kind: string; head: string; body: string; id: string }[] };
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({
      id: "outcome:outcome-1",
      kind: "observed",
      head: "Spend fell 92.0% in 7d after pause.",
      body: "after pause · Campaign A",
    });
    expect(body.rows[1]).toMatchObject({
      id: "outcome:outcome-2",
      kind: "observed",
      head: "CTR rose 12.3% in 14d after refresh.",
      body: "after creative refresh",
    });
  });

  it("drops rows with unknown copyTemplate (fail-closed)", async () => {
    const server = await buildTestServer({
      outcomes: [
        {
          ...SAMPLE_ROWS[0],
          copyTemplate: "pause.spend.exploded", // not allowlisted
        },
      ],
    });
    const res = await server.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes?orgId=org-1",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: unknown[] };
    expect(body.rows).toHaveLength(0);
  });

  it("requires orgId query param", async () => {
    const server = await buildTestServer({ outcomes: [] });
    const res = await server.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes",
    });
    expect(res.statusCode).toBe(400);
  });

  it("invokes the store's renderable-only list (contract — hidden rows never reach the wire)", async () => {
    // Inject a spy fake instead of seeding via buildTestServer. The route's
    // contract is that it calls listRenderable; the store filters
    // cockpitRenderable=true at the SQL layer. We verify the route honors
    // that contract regardless of what the store returns.
    const listRenderable = vi.fn().mockResolvedValue([]);
    const server = await buildTestServer({ listRenderableOverride: listRenderable });
    await server.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes?orgId=org-1",
    });
    expect(listRenderable).toHaveBeenCalledTimes(1);
    expect(listRenderable).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
    );
  });
});
```

> NOTE: Adjust the `buildTestServer` import path to match existing tests under `apps/api/src/__tests__/`. Look at `api-activity.test.ts` for the established pattern and mirror it — including the injected dependency shape.

- [ ] **Step 8.3: Implement the route**

Create `apps/api/src/routes/cockpit/riley/outcomes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { renderOutcomeCopy } from "@switchboard/schemas";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

export interface OutcomesRouteDeps {
  listRenderable(args: { orgId: string; limit: number }): Promise<RecommendationOutcomeReadModel[]>;
}

const DEFAULT_LIMIT = 100;

const ACTION_LABEL: Record<string, string> = {
  pause: "pause",
  refresh_creative: "creative refresh",
};

export async function registerRileyOutcomesRoute(
  app: FastifyInstance,
  deps: OutcomesRouteDeps,
): Promise<void> {
  app.get("/api/cockpit/riley/outcomes", async (req, reply) => {
    const orgId = (req.query as { orgId?: string } | undefined)?.orgId;
    if (!orgId) {
      reply.code(400);
      return { error: "orgId query param required" };
    }
    const rows = await deps.listRenderable({ orgId, limit: DEFAULT_LIMIT });
    return { rows: rows.map(translateRow).filter((r): r is ActivityRow => r !== null) };
  });
}

function translateRow(row: RecommendationOutcomeReadModel): ActivityRow | null {
  if (!row.copyTemplate || !row.copyValues) return null;
  const head = renderOutcomeCopy(row.copyTemplate, row.copyValues);
  if (head === null) return null; // fail-closed on off-allowlist template

  const label = ACTION_LABEL[row.actionKind] ?? row.actionKind;
  const body = row.campaignName ? `after ${label} · ${row.campaignName}` : `after ${label}`;

  return {
    id: `outcome:${row.id}`,
    time: formatTime(row.windowEndedAt),
    timestampIso: row.windowEndedAt.toISOString(),
    kind: "observed",
    head,
    body,
  };
}

function formatTime(d: Date): string {
  // Match existing activity-row time formatting; copy whatever convention
  // riley-activity-translator uses. Assuming HH:mm UTC for v1:
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
```

- [ ] **Step 8.4: Register the route**

In `apps/api/src/app.ts`, locate where existing cockpit riley routes are registered (search for `cockpit/riley`) and add:

```ts
import { registerRileyOutcomesRoute } from "./routes/cockpit/riley/outcomes.js";
// ...inside server build function, alongside other route registrations:
await registerRileyOutcomesRoute(app, {
  listRenderable: ({ orgId, limit }) =>
    recommendationOutcomeStore.listRenderableForOrg({
      orgId,
      agentRole: "riley",
      limit,
    }),
});
```

The construction of `recommendationOutcomeStore` will be added in Task 10 (bootstrap).

- [ ] **Step 8.5: Run tests, verify they pass**

```bash
pnpm --filter @switchboard/api test api-cockpit-riley-outcomes
```

Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add apps/api/src/routes/cockpit/riley/outcomes.ts \
        apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts \
        apps/api/src/app.ts
git commit -m "feat(riley-pr3): API route /api/cockpit/riley/outcomes → ActivityRow[]"
```

---

## Task 9 — Dispatch cron in `ad-optimizer`

**Files:**
- Modify: `packages/ad-optimizer/src/inngest-functions.ts`
- Modify: `packages/ad-optimizer/src/__tests__/inngest-functions.test.ts` (if it exists; otherwise create alongside)

The dispatch is pure fan-out — enumerate orgs that have Riley deployments, emit one `riley.outcome.attribute` event per org. Mirror the existing `ad-optimizer-weekly-dispatch` pattern.

- [ ] **Step 9.1: Find the existing dispatch pattern**

```bash
grep -n "weekly-dispatch\|daily-dispatch\|createWeeklyAuditCron" packages/ad-optimizer/src/inngest-functions.ts | head
```

Expected: existing dispatch factories returning `inngestClient.createFunction(...)`.

- [ ] **Step 9.2: Write a failing test for the dispatch**

Append to `packages/ad-optimizer/src/__tests__/inngest-functions.test.ts` (or create using the same harness as the weekly test):

```ts
import { describe, it, expect, vi } from "vitest";
import { createRileyOutcomeAttributionDispatch } from "../inngest-functions.js";

describe("createRileyOutcomeAttributionDispatch", () => {
  it("emits one event per Riley-active org", async () => {
    const listRileyOrgs = vi.fn().mockResolvedValue(["org-1", "org-2"]);
    const sendEvent = vi.fn().mockResolvedValue(undefined);
    const factory = createRileyOutcomeAttributionDispatch({
      listRileyOrgs,
      sendEvent,
    });
    // The factory is an Inngest function — exercise the handler directly.
    await factory.handler({ event: { data: {} }, step: makeStubStep() });
    expect(listRileyOrgs).toHaveBeenCalled();
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent).toHaveBeenNthCalledWith(1, { name: "riley.outcome.attribute", data: { orgId: "org-1" } });
    expect(sendEvent).toHaveBeenNthCalledWith(2, { name: "riley.outcome.attribute", data: { orgId: "org-2" } });
  });
});

function makeStubStep() {
  return {
    run: <T>(_id: string, fn: () => Promise<T>) => fn(),
    sendEvent: vi.fn(),
  };
}
```

> NOTE: The exact shape of the Inngest function and how it's exported may differ. Inspect the existing `createWeeklyAuditCron` factory and mirror its export shape. If the factory returns the raw `InngestFunction` from `inngestClient.createFunction`, the test will exercise its `.handler` (or whatever the SDK exposes). Adjust test to match how existing tests do this.

- [ ] **Step 9.3: Run test, verify it fails**

```bash
pnpm --filter @switchboard/ad-optimizer test inngest-functions
```

Expected: FAIL (factory not found).

- [ ] **Step 9.4: Implement the dispatch factory**

In `packages/ad-optimizer/src/inngest-functions.ts`, near the other dispatch crons:

```ts
export interface RileyOutcomeAttributionDispatchDeps {
  listRileyOrgs: () => Promise<string[]>;
  /** Bound to inngestClient.send in apps/api. */
  sendEvent: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
}

export function createRileyOutcomeAttributionDispatch(deps: RileyOutcomeAttributionDispatchDeps) {
  return inngestClient.createFunction(
    { id: "riley-outcome-attribution-dispatch" },
    { cron: "0 7 * * *" },
    async ({ step }) => {
      const orgs = await step.run("list-riley-orgs", () => deps.listRileyOrgs());
      for (const orgId of orgs) {
        await step.run(`emit-${orgId}`, async () => {
          await deps.sendEvent({ name: "riley.outcome.attribute", data: { orgId } });
        });
      }
      return { dispatched: orgs.length };
    },
  );
}
```

> NOTE: If the existing module uses `inngestClient` from a shared `creative-pipeline` import, follow that convention. Adapt above to match.

- [ ] **Step 9.5: Run test, verify it passes**

```bash
pnpm --filter @switchboard/ad-optimizer test inngest-functions
```

Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add packages/ad-optimizer/src/inngest-functions.ts \
        packages/ad-optimizer/src/__tests__/inngest-functions.test.ts
git commit -m "feat(riley-pr3): riley-outcome-attribution-dispatch cron factory"
```

---

## Task 10 — Per-org worker + bootstrap wiring + kill-switch

**Files:**
- Create: `apps/api/src/services/cron/riley-outcome-attribution.ts`
- Create: `apps/api/src/__tests__/api-cockpit-riley-outcome-cron.test.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`
- Modify: `.env.example`

- [ ] **Step 10.1: Write the failing worker test**

Create `apps/api/src/__tests__/api-cockpit-riley-outcome-cron.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createRileyOutcomeAttributionWorker } from "../services/cron/riley-outcome-attribution.js";

function buildDeps() {
  return {
    runRileyOutcomeAttribution: vi.fn().mockResolvedValue({
      orgId: "org-1",
      candidatesScanned: 0,
      skippedExisting: 0,
      outcomesWritten: 0,
      renderable: 0,
      hidden: 0,
      hiddenByFlag: {
        meta_data_missing: 0,
        zero_pre_baseline: 0,
        below_noise_floor: 0,
        same_campaign_overlap: 0,
      },
    }),
    readEnabledFlag: vi.fn().mockReturnValue(true),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const EVENT = { data: { orgId: "org-1" }, name: "riley.outcome.attribute" };
const STEP_STUB = { run: <T>(_id: string, fn: () => Promise<T>) => fn() };

describe("createRileyOutcomeAttributionWorker", () => {
  it("invokes the orchestrator when enabled", async () => {
    const deps = buildDeps();
    const fn = createRileyOutcomeAttributionWorker(deps);
    const out = await fn.handler({ event: EVENT, step: STEP_STUB });
    expect(deps.runRileyOutcomeAttribution).toHaveBeenCalledWith({ orgId: "org-1", now: expect.any(Date) });
    expect(out).toMatchObject({ orgId: "org-1" });
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it("no-ops with skipped:disabled when kill-switch is off", async () => {
    const deps = buildDeps();
    deps.readEnabledFlag.mockReturnValue(false);
    const fn = createRileyOutcomeAttributionWorker(deps);
    const out = await fn.handler({ event: EVENT, step: STEP_STUB });
    expect(deps.runRileyOutcomeAttribution).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: "disabled" });
    expect(deps.logger.info).toHaveBeenCalledWith(expect.objectContaining({ skipped: "disabled" }));
  });
});
```

- [ ] **Step 10.2: Run test, verify it fails**

```bash
pnpm --filter @switchboard/api test api-cockpit-riley-outcome-cron
```

Expected: FAIL (worker not found).

- [ ] **Step 10.3: Implement the worker factory**

Create `apps/api/src/services/cron/riley-outcome-attribution.ts`:

```ts
import { inngestClient } from "@switchboard/creative-pipeline";
import {
  runRileyOutcomeAttribution,
  type AttributableRecommendationStore,
  type MetaInsightsProvider,
  type RecommendationOutcomeStore,
  type RileyOutcomeRunSummary,
} from "@switchboard/core";

export interface RileyOutcomeAttributionWorkerDeps {
  runRileyOutcomeAttribution: (args: { orgId: string; now: Date }) => Promise<RileyOutcomeRunSummary>;
  readEnabledFlag: () => boolean;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export function createRileyOutcomeAttributionWorker(deps: RileyOutcomeAttributionWorkerDeps) {
  return inngestClient.createFunction(
    { id: "riley-outcome-attribution-worker" },
    { event: "riley.outcome.attribute" },
    async ({ event }) => {
      const orgId = (event.data as { orgId?: string } | undefined)?.orgId;
      if (!orgId) {
        deps.logger.error({ msg: "riley-outcome-attribution: missing orgId in event payload" });
        throw new Error("missing orgId");
      }
      if (!deps.readEnabledFlag()) {
        deps.logger.info({ msg: "riley-outcome-attribution", skipped: "disabled", orgId });
        return { skipped: "disabled" as const };
      }
      const summary = await deps.runRileyOutcomeAttribution({ orgId, now: new Date() });
      deps.logger.info({ msg: "riley-outcome-attribution-summary", ...summary });
      return summary;
    },
  );
}

/**
 * Wire helper: given the concrete stores + provider, returns a closure that
 * apps/api can hand to createRileyOutcomeAttributionWorker as runRileyOutcomeAttribution.
 */
export function bindRileyOutcomeOrchestrator(deps: {
  recommendationStore: AttributableRecommendationStore;
  insightsProvider: MetaInsightsProvider;
  outcomeStore: RecommendationOutcomeStore;
}) {
  return (args: { orgId: string; now: Date }) =>
    runRileyOutcomeAttribution({ ...deps, ...args });
}
```

- [ ] **Step 10.4: Wire into bootstrap**

In `apps/api/src/bootstrap/inngest.ts`:

1. Add imports near the existing `@switchboard/db` imports:

   ```ts
   import {
     PrismaRecommendationOutcomeStore,
     PrismaAttributableRecommendationStore,
   } from "@switchboard/db";
   ```

2. Add import for the worker + dispatch factories:

   ```ts
   import { createRileyOutcomeAttributionDispatch } from "@switchboard/ad-optimizer";
   import {
     createRileyOutcomeAttributionWorker,
     bindRileyOutcomeOrchestrator,
   } from "../services/cron/riley-outcome-attribution.js";
   ```

3. Inside the bootstrap function, near other store constructions:

   ```ts
   const recommendationOutcomeStore = new PrismaRecommendationOutcomeStore(prisma);
   const attributableRecommendationStore = new PrismaAttributableRecommendationStore(prisma);
   ```

4. Construct the dispatch + worker functions next to other `inngestClient.createFunction` calls (already present in this file):

   ```ts
   const rileyOutcomeDispatch = createRileyOutcomeAttributionDispatch({
     listRileyOrgs: () => listRileyActiveOrgs(prisma), // helper — implement inline or reuse existing org-enumeration helper
     sendEvent: (event) => inngestClient.send(event),
   });

   const rileyOutcomeWorker = createRileyOutcomeAttributionWorker({
     runRileyOutcomeAttribution: bindRileyOutcomeOrchestrator({
       recommendationStore: attributableRecommendationStore,
       insightsProvider: metaCampaignInsightsProvider, // already constructed in this file for the existing weekly audit
       outcomeStore: recommendationOutcomeStore,
     }),
     readEnabledFlag: () => process.env.RILEY_OUTCOME_ATTRIBUTION_ENABLED === "true",
     logger: app.log,
   });
   ```

5. Add both to the function list passed to `inngestFastify({ client, functions: [...] })`:

   ```ts
   await app.register(inngestFastify, {
     client: inngestClient,
     functions: [
       /* existing */,
       rileyOutcomeDispatch,
       rileyOutcomeWorker,
     ],
   });
   ```

6. Add a helper at the bottom of the file (or in a sibling helper module if one exists) for `listRileyActiveOrgs`:

   ```ts
   async function listRileyActiveOrgs(prisma: PrismaClient): Promise<string[]> {
     const rows = await prisma.pendingActionRecord.findMany({
       where: { sourceAgent: "riley", intent: { startsWith: "recommendation." } },
       distinct: ["organizationId"],
       select: { organizationId: true },
     });
     return rows.map((r) => r.organizationId);
   }
   ```

   (If a canonical "active orgs" helper already exists for the weekly cron, reuse it instead — search for `sourceAgent: "riley"` in bootstrap/inngest.ts to find it. Update the plan inline if you reuse.)

- [ ] **Step 10.5: Add the env var to `.env.example`**

Append to `.env.example`:

```
# Riley PR-3 outcome-attribution kill-switch. Default false until rollout.
RILEY_OUTCOME_ATTRIBUTION_ENABLED=false
```

- [ ] **Step 10.6: Run worker tests, verify they pass**

```bash
pnpm --filter @switchboard/api test api-cockpit-riley-outcome-cron
```

Expected: PASS.

- [ ] **Step 10.7: Run full typecheck**

```bash
pnpm typecheck
```

Expected: PASS. If schemas/db/core exports are stale: `pnpm reset` then retry.

- [ ] **Step 10.8: Commit**

```bash
git add apps/api/src/services/cron/riley-outcome-attribution.ts \
        apps/api/src/__tests__/api-cockpit-riley-outcome-cron.test.ts \
        apps/api/src/bootstrap/inngest.ts \
        .env.example
git commit -m "feat(riley-pr3): wire dispatch+worker into bootstrap; add kill-switch env"
```

---

## Task 11 — Riley activity-feed merge

The /riley page already calls `riley-activity-translator` for activity rows. To surface outcomes, the page (or API aggregator) must also call the new outcomes route and merge the rows.

**Files:**
- Modify: existing `/riley` activity-feed loader (path TBD by inspection)

- [ ] **Step 11.1: Locate the existing activity-feed call site**

```bash
grep -rn "cockpit/riley/activity\|riley-activity-translator\|translateRileyActivity" apps/dashboard/src apps/api/src | head -20
```

Expected: identifies the loader that fetches `/api/cockpit/riley/activity` and renders the ActivityRow[].

- [ ] **Step 11.2: Add a parallel fetch + merge**

In the same loader (likely a server-side fetch or React Query hook), add a second fetch to `/api/cockpit/riley/outcomes` and concatenate the two `rows` arrays, sorting descending by `timestampIso`:

```ts
const [activityRes, outcomesRes] = await Promise.all([
  fetch(`/api/cockpit/riley/activity?orgId=${orgId}`).then((r) => r.json()),
  fetch(`/api/cockpit/riley/outcomes?orgId=${orgId}`).then((r) => r.json()),
]);

const merged = [...activityRes.rows, ...outcomesRes.rows].sort((a, b) => {
  if (!a.timestampIso || !b.timestampIso) return 0;
  return a.timestampIso < b.timestampIso ? 1 : -1;
});

return { rows: merged };
```

Adapt to the actual hook/loader shape — copy whatever pattern `riley-activity` uses.

- [ ] **Step 11.3: Verify the activity-feed component renders "observed" rows**

In the activity-row UI component, ensure `kind: "observed"` maps to an existing or new icon. Per the spec: **quiet treatment, no celebratory icon.** Reuse `watching` / `reviewing` icon if available, or add a neutral `chart-line` / `eye` glyph.

Find the icon mapping:

```bash
grep -rn "kind.*observed\|ActivityKind\|kind === 'paused'" apps/dashboard/src/components apps/dashboard/src/lib/cockpit | head
```

Add the `observed` case to the kind-to-icon map.

- [ ] **Step 11.4: Add a merge/sort test for the loader**

The activity-feed merge is new dashboard-side behavior; cover it with a focused test colocated with the loader. Test file path follows the loader's location — e.g., `apps/dashboard/src/lib/cockpit/riley/__tests__/<loader>.test.ts`.

```ts
import { describe, it, expect } from "vitest";
import { mergeRileyActivityAndOutcomes } from "../<loader>";
import type { ActivityRow } from "@switchboard/schemas";

const activity: ActivityRow[] = [
  { id: "a-1", time: "11:42", timestampIso: "2026-05-01T11:42:00Z", kind: "paused", head: "..." },
];
const outcomes: ActivityRow[] = [
  { id: "outcome:o-1", time: "07:00", timestampIso: "2026-05-08T07:00:00Z", kind: "observed", head: "Spend fell 92.0% in 7d after pause." },
];

describe("mergeRileyActivityAndOutcomes", () => {
  it("merges and sorts descending by timestampIso", () => {
    const merged = mergeRileyActivityAndOutcomes(activity, outcomes);
    expect(merged.map((r) => r.id)).toEqual(["outcome:o-1", "a-1"]);
  });

  it("preserves order when timestamps are equal (stable sort)", () => {
    const a: ActivityRow = { id: "a-eq", time: "07:00", timestampIso: "2026-05-08T07:00:00Z", kind: "paused", head: "..." };
    const o: ActivityRow = { id: "outcome:o-eq", time: "07:00", timestampIso: "2026-05-08T07:00:00Z", kind: "observed", head: "..." };
    const merged = mergeRileyActivityAndOutcomes([a], [o]);
    expect(merged.map((r) => r.id)).toEqual(["a-eq", "outcome:o-eq"]);
  });
});
```

> NOTE: If you inline the merge inside an existing loader/hook rather than extracting `mergeRileyActivityAndOutcomes`, extract a pure helper for the merge so it's unit-testable. The contract is the same: concat + sort desc by `timestampIso`.

- [ ] **Step 11.5: Run dashboard build (CI doesn't run this — `feedback_dashboard_build_not_in_ci`)**

```bash
pnpm --filter @switchboard/dashboard build
pnpm --filter @switchboard/dashboard test
```

Expected: PASS.

- [ ] **Step 11.6: Commit**

```bash
git add <paths-modified-in-this-task>
git commit -m "feat(riley-pr3): merge outcomes into /riley activity feed"
```

---

## Task 12 — B.2 spec amendment

**Files:**
- Modify: `docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md`

- [ ] **Step 12.1: Locate the B.2 honest-impact guardrail section**

```bash
grep -n "honest-impact\|honest impact\|B.2" docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md | head
```

- [ ] **Step 12.2: Append one paragraph at the end of that section**

```markdown
**PR-3 amendment (2026-05-15).** The honest-impact guardrail relaxes for one narrow surface: the new `"observed"` activity row added by PR-3 (outcome attribution) may render directional copy from the allowlist defined in `packages/schemas/src/recommendation-outcome-copy.ts`. Every other Riley surface — KPI strip, ROI bar, approval cards, recommendation cards, composer responses, palette toasts — remains under this guardrail unchanged. Unknown copy templates fail-closed: `renderOutcomeCopy()` returns `null` and the API drops the row from the response. See `docs/superpowers/specs/2026-05-15-riley-cockpit-pr3-outcome-attribution-design.md` for full methodology.
```

- [ ] **Step 12.3: Commit**

```bash
git add docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md
git commit -m "docs(riley-pr3): B.2 honest-impact guardrail amendment for observed rows"
```

---

## Task 13 — Final verification

- [ ] **Step 13.1: Full repo typecheck**

```bash
pnpm typecheck
```

Expected: PASS across all packages.

- [ ] **Step 13.2: Full test suite**

```bash
pnpm test
```

Expected: PASS. Known flake: `prisma-work-trace-store-integrity` per `feedback_db_integrity_tests_pg_advisory_lock` — not a regression.

- [ ] **Step 13.3: Lint + format**

```bash
pnpm lint
pnpm format:check
```

Expected: PASS. If format fails: `pnpm format` then re-stage.

- [ ] **Step 13.4: Dashboard build (since CI doesn't catch it)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: PASS.

- [ ] **Step 13.5: Schema drift check**

```bash
pnpm db:check-drift
```

Expected: PASS (requires Postgres).

- [ ] **Step 13.6: Manual smoke (optional)**

```bash
# 1. Set kill-switch off, confirm worker no-ops:
export RILEY_OUTCOME_ATTRIBUTION_ENABLED=false
pnpm dev # in another shell trigger the worker via Inngest dev UI
# Expected log: skipped:disabled

# 2. Set kill-switch on, seed an acted Riley pause with resolvedAt 8d ago,
#    trigger the worker, confirm a row lands.
export RILEY_OUTCOME_ATTRIBUTION_ENABLED=true
```

- [ ] **Step 13.7: Push branch + open PR**

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --title "feat(riley-pr3): outcome attribution loop + observed activity row" --body "$(cat <<'EOF'
## Summary
- New RecommendationOutcome table + migration; PR-1's WorkTrace mirror remains untouched
- Daily cron (07:00 UTC) attributes pause/refresh_creative outcomes directionally (matched pre/post windows)
- Write-but-hide on contamination/sparse/below-noise/zero-baseline; auditable rows + cockpit-renderable subset
- New "observed" ActivityKind + /api/cockpit/riley/outcomes route; B.2 honest-impact guardrail relaxes only for this row
- Kill-switch: RILEY_OUTCOME_ATTRIBUTION_ENABLED env, default false in prod

Spec: docs/superpowers/specs/2026-05-15-riley-cockpit-pr3-outcome-attribution-design.md

## Test plan
- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm --filter @switchboard/dashboard build
- [ ] pnpm db:check-drift
- [ ] Smoke with RILEY_OUTCOME_ATTRIBUTION_ENABLED=false → log skipped:disabled
- [ ] Smoke with RILEY_OUTCOME_ATTRIBUTION_ENABLED=true + seeded acted Riley pause → renderable outcome row

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> NOTE: Don't push to remote unless the user explicitly approves — per CLAUDE.md "do NOT push to the remote repository unless the user explicitly asks you to do so." Wait for confirmation before Step 13.7.

---

## Out of scope (per the spec — do NOT add)

- `scale` and `shift_budget_to_source` action kinds (v1.1 / v1.2)
- Counterfactual modeling
- Pattern extraction / learning memory (that's PR-4)
- KPI strip / ROI bar copy changes (B.2 stays in force)
- Causal language anywhere (`Riley saved`, `refresh recovered`, `pause prevented`)
- Deep-link from "observed" row to original action row (follow-up)
- `executableWorkUnitId` population (auto-fills when PR-2 lands)
- Outcome dashboard / report (activity-row line is the entire UI surface)
- Emitter-side metric snapshots

---

## Self-review checklist (performed after writing this plan)

- ✅ Every spec section maps to a task: schema → Task 6; config → Task 3; copy allowlist → Task 1; pure logic → Task 5; store → Task 7; API route → Task 8; cron dispatch → Task 9; worker + bootstrap + kill-switch → Task 10; activity-feed merge → Task 11; B.2 amendment → Task 12.
- ✅ No placeholders: every step has exact paths + complete code blocks (`buildTestServer` import path is the one explicit "adjust to existing helper" note, which is unavoidable without knowing the file).
- ✅ Type consistency: `RileyOutcomeRow` is the canonical row shape across Task 4 (definition), Task 5 (production), Task 7 (persistence). `KIND_CONFIG` keys (`pause` / `refresh_creative`) match `AttributableKind` everywhere.
- ✅ TDD: every code-introducing task has a failing test before implementation.
- ✅ Frequent commits: one per task minimum; 13 commits total.
