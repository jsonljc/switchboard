# Riley v3 Slice 3: OutcomeLedger Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the existing Riley outcome-attribution path with `causalStrength`, `businessContextStable`, and `trustDelta` (advisory-only, honesty-floored, persisted with a same-commit migration plus DB CHECK constraints), and make `trustDelta` visible on the operator activity feed that replaced the retired `/riley` cockpit.

**Architecture:** Three required fields on `RileyOutcomeRow` derived inside `attributeOneRecommendation` (core), three nullable CHECK-constrained columns on `RecommendationOutcome` (legacy rows stay NULL = honest absence), all three projected onto the renderable read model, and an allowlisted trust-signal suffix composed into the `head` of `"observed"` ActivityRows. Display is restored by merging renderable outcome rows into `GET /api/dashboard/agents/riley/activity` server-side; the dashboard agent-panel work log then renders them with zero dashboard code changes.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/core` (pure derivation), `packages/db` (Prisma store + hand-written migration), `packages/schemas` (allowlisted copy), `apps/api` (Fastify routes); Vitest with mocked Prisma; `pnpm eval:riley` golden harness (must stay byte-unchanged).

**Review reconciliation (2026-06-04):** plan amended after operator review: trust copy softened to signal language (no "Trust moved"), DB CHECK constraints added to the migration (raw-SQL precedent: `20260603120000_booking_partial_unique_active`), Tasks 1+2 merged so schema + migration + writers land in ONE commit (the same-commit guarantee is literal), read model projects all three fields, trust-copy banned-word regex extended, advisory-only proof strengthened to a diff-scope check plus a tree-wide consumer grep. Store ordering (`orderBy windowEndedAt desc` + `take`) is already pinned on main by `recommendation-outcome-store.test.ts:107-120`; cited, not duplicated.

---

## Context: re-derived anchors (live `origin/main` @ `81f0325f`)

The spec (`docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` sections 2.5, 7.2, 7.4, 7.5) and roadmap (`docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` Slice 3) were audited at `63abdcb`. Re-derivation against live main found one load-bearing drift:

- **The "existing cockpit outcome feed" is orphaned.** PR #577 rendered outcome rows (ActivityKind `"observed"`) on the `/riley` cockpit; PR #750 retired that cockpit (redirects to `/?agent=riley`, the agent panel). Today `GET /api/cockpit/riley/outcomes` (`apps/api/src/routes/cockpit/riley/outcomes.ts`) is registered and tested but has **zero UI consumers** (`rileyOutcomes` query keys in `apps/dashboard/src/lib/query-keys.ts:152-154` are referenced nowhere). Outcome rows currently render nowhere.
- The operator surface that replaced the cockpit is the **agent-panel work log** (`apps/dashboard/src/components/agent-panel/work-log.tsx`), fed by `useAgentActivityCockpit` → dashboard proxy → `GET /api/dashboard/agents/:agentId/activity` (`apps/api/src/routes/agent-home/activity.ts`) → `translateAuditToCockpitActivity` (`packages/core/src/agent-home/cockpit-activity-translator.ts`), which translates AuditEntry rows only and never emits `"observed"`.
- The work log renders rows as `composeActivityVoice(row)` (`apps/dashboard/src/components/agent-panel/lib/activity-voice.ts`): `"observed"` → `` `I noted ${row.head}` ``. **Only `head` survives; `body`/`tag` are dropped.** So trustDelta must ride in `head`.
- `head` is built by allowlisted fail-closed templates (`packages/schemas/src/recommendation-outcome-copy.ts`, B.2 honest-impact guardrail). Trust copy must therefore be allowlist-governed too.
- Engine facts (`packages/core/src/recommendations/outcome-attribution.ts`): `cockpitRenderable = flags.length === 0 && deltaPct !== null` (line 91). Noise-floor flagging guarantees a renderable row has `|deltaPct| >= noiseFloorPct > 0`, so a directional row always has a definite direction. Favorability (`config.favorableDirection`) is already computed for copy templates (lines 97-106).
- Mercury `/activity` fetches `/api/dashboard/activity` (different legacy endpoint) — outside the blast radius.
- `evals/riley-recommendation/` has zero import-graph contact with the outcome path (grep-verified).
- `RileyOutcomeRow` constructors that must be updated when fields become required: the engine, core engine tests, db store test `SAMPLE_ROW`. No api test constructs it.

## Design decisions

1. **Display resolution (spec risk 7.2 hard gate):** merge renderable outcome rows into the per-agent activity feed **server-side** in apps/api, riley-only. This is the truthful reading of "render on the existing cockpit outcome feed" post-#750: the `"observed"` kind, its schema entry, and its dashboard voice handling all exist end-to-end; only the merge is missing. No new surface is built (the deferred standalone results dashboard stays deferred); zero dashboard diffs. The dedicated `/api/cockpit/riley/outcomes` route remains as a compatibility/debug endpoint (documented as such), sharing the same translator.
2. **Derivation rules** (in `attributeOneRecommendation`):
   - `causalStrength = (flags.length === 0 && deltaPct !== null) ? "directional" : "inconclusive"` — written against the flags/delta directly (not via `cockpitRenderable`) so a future renderability change cannot silently change causal semantics. `"corroborated"` is type-reserved, never emitted (slice 4 wires the CRM/booking-agreement signal).
   - `businessContextStable = "unknown"` constant (slice 4a/4c flips it; never a fabricated stable).
   - `trustDelta`: `inconclusive → "none"`; `directional` + favorable direction → `"up"`; `directional` + unfavorable → `"down"`.
3. **Type shape:** required fields on `RileyOutcomeRow` (the engine always emits them); nullable DB columns with CHECK constraints pinning the legal value sets at the database layer (ledger fields resist corruption; raw SQL because Prisma cannot express CHECK in-schema — same pattern as the partial unique index in `20260603120000_booking_partial_unique_active`); read model carries all three as `<Enum> | null` with defensive narrowing (unexpected strings → null = honest absence).
4. **Trust copy (signal language, not trust-state language):** `TRUST_DELTA_COPY` + `renderTrustDeltaCopy()` in `packages/schemas/src/recommendation-outcome-copy.ts`. `up` → "This outcome is a positive signal for this action."; `down` → "This outcome is a negative signal for this action."; `none`, `null`, unknown strings → `null` (no suffix; legacy rows render byte-identically to today). Copy avoids stateful "trust moved" phrasing (advisory annotation, not governance state) and an extended causal-language ban.
5. **`"none"` is recorded, never displayed.** The engine records `"none"` on hidden inconclusive rows; renderable rows are always directional (renderable ⟺ clean delta), so the live feed only ever shows up/down. The translator still handles `"none"` defensively (no suffix) because the read model could expose it through future route changes or manual inserts.
6. **Feed degradation:** if the outcomes fetch fails, the activity route logs and serves the audit-only feed (outcome enrichment must not sink the primary feed).
7. **Migration atomicity:** schema, migration, derivation, and store mapping land in ONE commit (Task 1), so there is no window where new rows lack values.

## Honesty floors (each is test-pinned)

- `causalStrength` is never `"corroborated"` in any engine output (and the DB CHECK rejects values outside the enum even from future writers).
- `businessContextStable` is `"unknown"` on every engine output, across both attributable kinds and clean/flagged windows.
- Legacy rows (NULL fields) render byte-identically to today's output everywhere.
- `trustDelta` is displayed via copy only; nothing feeds it back into scoring, trust levels, or governance (diff-scope + tree-wide consumer grep in Task 4).

## File map

| File                                                                                           | Change                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                                             | +3 nullable String columns on `RecommendationOutcome` (+ CHECK sync comment) |
| `packages/db/prisma/migrations/20260604200000_recommendation_outcome_enrichment/migration.sql` | new (hand-written, columns + CHECK constraints)                              |
| `packages/core/src/recommendations/outcome-attribution-types.ts`                               | +3 enums, +3 required `RileyOutcomeRow` fields                               |
| `packages/core/src/recommendations/outcome-attribution.ts`                                     | derive the 3 fields                                                          |
| `packages/core/src/recommendations/index.ts`                                                   | export the 3 enum types                                                      |
| `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`                      | honesty-floor + derivation tests                                             |
| `packages/db/src/recommendation-outcome-store.ts`                                              | insert mapping; read model + projection gain all three fields                |
| `packages/db/src/__tests__/recommendation-outcome-store.test.ts`                               | fixture fields, mapping + projection tests                                   |
| `packages/schemas/src/recommendation-outcome-copy.ts`                                          | `TRUST_DELTA_COPY` + `renderTrustDeltaCopy`                                  |
| `packages/schemas/src/index.ts`                                                                | export the two new symbols                                                   |
| `packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`                           | trust-copy tests + extended ban regex                                        |
| `apps/api/src/lib/outcome-activity-row.ts`                                                     | new: shared outcome→ActivityRow translator (extracted + trust suffix)        |
| `apps/api/src/routes/cockpit/riley/outcomes.ts`                                                | consume shared translator; legacy/debug comment                              |
| `apps/api/src/lib/cockpit-activity-deps.ts`                                                    | optional `listRenderableOutcomes` dep                                        |
| `apps/api/src/routes/agent-home/activity.ts`                                                   | riley-only merge of outcome rows (+ boundary comment)                        |
| `apps/api/src/bootstrap/routes.ts:137-150`                                                     | wire the outcome store into activity deps                                    |
| `apps/api/src/__tests__/outcome-activity-row.test.ts`                                          | new translator unit tests                                                    |
| `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`                                    | suffix + legacy-null assertions                                              |
| `apps/api/src/__tests__/api-cockpit-activity.test.ts`                                          | merge behavior tests                                                         |

Not touched: `packages/ad-optimizer/**` (advisory-only proof), `evals/**` (byte-unchanged), `apps/dashboard/**` (renders via existing voice path), the Inngest cron wiring (rows flow through transparently).

---

### Task 0: Commit the plan document

**Files:**

- Create: `docs/superpowers/plans/2026-06-04-riley-v3-slice3-outcome-ledger-enrichment.md` (this file)

- [ ] **Step 0.1: Commit**

```bash
git add docs/superpowers/plans/2026-06-04-riley-v3-slice3-outcome-ledger-enrichment.md
git commit -m "docs(superpowers): riley v3 slice-3 outcome-ledger enrichment plan"
```

(Same landing pattern as slices 1 and 2: the per-slice plan rides in the implementation PR; the spec it consumes is already on main.)

---

### Task 1: Fields end to end in ONE commit (schema + migration + derivation + persistence)

Schema, migration, core types, engine derivation, and store mapping land atomically: there is never a window where new rows lack values. Required fields on `RileyOutcomeRow` force every constructor into this commit anyway (vitest does not typecheck; `pnpm typecheck` is the per-commit gate).

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (model `RecommendationOutcome`, after the `cockpitRenderable` line)
- Create: `packages/db/prisma/migrations/20260604200000_recommendation_outcome_enrichment/migration.sql`
- Modify: `packages/core/src/recommendations/outcome-attribution-types.ts`
- Modify: `packages/core/src/recommendations/outcome-attribution.ts`
- Modify: `packages/core/src/recommendations/index.ts`
- Test: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`
- Modify: `packages/db/src/recommendation-outcome-store.ts` (insert mapping only)
- Test: `packages/db/src/__tests__/recommendation-outcome-store.test.ts` (fixture + mapping assertion)

- [ ] **Step 1.1: Add the three columns to the Prisma model**

In `packages/db/prisma/schema.prisma`, inside `model RecommendationOutcome`, directly after `cockpitRenderable Boolean @default(false)`:

```prisma
  // Slice-3 OutcomeLedger enrichments. Nullable: rows predating the fields
  // stay NULL (honest absence); new rows always carry values. Value sets are
  // enforced by CHECK constraints in raw SQL (migration
  // 20260604200000_recommendation_outcome_enrichment); Prisma cannot express
  // CHECK constraints in-schema. Keep this comment in sync.
  // causalStrength: "directional" | "corroborated" | "inconclusive".
  // The engine emits only directional|inconclusive until slice 4 wires the
  // CRM/booking corroboration signal; "corroborated" is reserved.
  causalStrength String?
  // businessContextStable: "stable" | "unstable" | "unknown". Records
  // "unknown" until the slice-4 operational-state source exists.
  businessContextStable String?
  // trustDelta: "up" | "none" | "down". Advisory display signal; rendered
  // on the cockpit outcome feed, never auto-applied into scoring.
  trustDelta String?
```

- [ ] **Step 1.2: Hand-write the migration (columns + CHECK constraints)**

Create `packages/db/prisma/migrations/20260604200000_recommendation_outcome_enrichment/migration.sql`:

```sql
-- Slice-3 OutcomeLedger enrichments: three nullable advisory columns.
-- Legacy rows stay NULL (honest absence); the attribution engine populates
-- all three on every new row. No new indexes (query patterns unchanged).
-- CHECK constraints pin the legal value sets at the database layer (ledger
-- fields resist corruption; "corroborated" is reserved for slice 4 but legal
-- so the slice-4 writer needs no migration). Prisma cannot express CHECK
-- constraints in-schema (same pattern as 20260603120000_booking_partial_unique_active).
ALTER TABLE "RecommendationOutcome"
  ADD COLUMN "causalStrength" TEXT,
  ADD COLUMN "businessContextStable" TEXT,
  ADD COLUMN "trustDelta" TEXT,
  ADD CONSTRAINT "RecommendationOutcome_causalStrength_check"
    CHECK ("causalStrength" IS NULL OR "causalStrength" IN ('directional', 'corroborated', 'inconclusive')),
  ADD CONSTRAINT "RecommendationOutcome_businessContextStable_check"
    CHECK ("businessContextStable" IS NULL OR "businessContextStable" IN ('stable', 'unstable', 'unknown')),
  ADD CONSTRAINT "RecommendationOutcome_trustDelta_check"
    CHECK ("trustDelta" IS NULL OR "trustDelta" IN ('up', 'none', 'down'));
```

(Constraint names are 42/49/38 chars, under the 63-char cap.)

- [ ] **Step 1.3: Apply + regenerate + check drift**

```bash
pnpm --filter @switchboard/db exec prisma migrate deploy
pnpm db:generate
pnpm db:check-drift
```

Expected: deploy applies `20260604200000_recommendation_outcome_enrichment`; generate succeeds; drift check exits 0 (CHECK constraints are invisible to the Prisma datamodel layer, so they cannot drift — the booking partial-index migration is the in-repo precedent).

- [ ] **Step 1.4: Write the failing core tests**

Append to `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`:

```ts
describe("attributeOneRecommendation — slice-3 enrichments (honesty floors)", () => {
  it("emits directional + trustDelta up for a clean favorable pause delta", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("up");
  });

  it("emits directional + trustDelta down for a clean unfavorable pause delta", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(11000, 0.02), // spend rose 10% after pause
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("down");
  });

  it("emits directional + trustDelta up for a clean favorable refresh delta", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.024, 14), // CTR +20%
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("up");
  });

  it("emits directional + trustDelta down for a clean unfavorable refresh delta", () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const row = attributeOneRecommendation({
      candidate: refreshRec,
      preWindow: w(50000, 0.02, 14),
      postWindow: w(50000, 0.017, 14), // CTR -15%
      overlaps: [],
    });
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("down");
  });

  it("emits inconclusive + trustDelta none under every confidence-subtracting signal", () => {
    const flagged: Array<{ name: string; row: ReturnType<typeof attributeOneRecommendation> }> = [
      {
        name: "meta_data_missing (null window)",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: null,
          postWindow: w(800, 0.02),
          overlaps: [],
        }),
      },
      {
        name: "meta_data_missing (sparse dailyRowCount)",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(10000, 0.02, 7),
          postWindow: w(800, 0.02, 3),
          overlaps: [],
        }),
      },
      {
        name: "zero_pre_baseline",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(0, 0.02),
          postWindow: w(800, 0.02),
          overlaps: [],
        }),
      },
      {
        name: "below_noise_floor",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(10000, 0.02),
          postWindow: w(9700, 0.02),
          overlaps: [],
        }),
      },
      {
        name: "same_campaign_overlap / same_kind_retry",
        row: attributeOneRecommendation({
          candidate: REC,
          preWindow: w(10000, 0.02),
          postWindow: w(800, 0.02),
          overlaps: [{ id: "rec-2", actionKind: "pause" }],
        }),
      },
    ];
    for (const { name, row } of flagged) {
      expect(row.causalStrength, name).toBe("inconclusive");
      expect(row.trustDelta, name).toBe("none");
    }
  });

  it("records businessContextStable as unknown on every row across kinds and window states (slice-4 gate, never fabricated)", () => {
    const kinds = ["pause", "refresh_creative"] as const;
    for (const actionKind of kinds) {
      const candidate: AttributableRecommendation = { ...REC, actionKind };
      const clean = attributeOneRecommendation({
        candidate,
        preWindow: w(10000, 0.02, 14),
        postWindow: w(800, 0.024, 14),
        overlaps: [],
      });
      const contaminated = attributeOneRecommendation({
        candidate,
        preWindow: null,
        postWindow: null,
        overlaps: [{ id: "rec-2", actionKind }],
      });
      expect(clean.businessContextStable, `${actionKind} clean`).toBe("unknown");
      expect(contaminated.businessContextStable, `${actionKind} contaminated`).toBe("unknown");
    }
  });

  it("never emits corroborated (reserved for the slice-4 corroboration signal)", () => {
    const fixtures = [
      { preWindow: w(10000, 0.02), postWindow: w(800, 0.02), overlaps: [] },
      { preWindow: w(10000, 0.02), postWindow: w(11000, 0.02), overlaps: [] },
      { preWindow: null, postWindow: w(800, 0.02), overlaps: [] },
      { preWindow: w(0, 0.02), postWindow: w(800, 0.02), overlaps: [] },
      { preWindow: w(10000, 0.02), postWindow: w(9700, 0.02), overlaps: [] },
      {
        preWindow: w(10000, 0.02),
        postWindow: w(800, 0.02),
        overlaps: [{ id: "rec-2", actionKind: "pause" as const }],
      },
    ];
    for (const f of fixtures) {
      const row = attributeOneRecommendation({ candidate: REC, ...f });
      expect(["directional", "inconclusive"]).toContain(row.causalStrength);
    }
  });
});
```

- [ ] **Step 1.5: Run the new tests; verify they fail**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution
```

Expected: FAIL — `row.causalStrength` is `undefined`, not `"directional"`.

- [ ] **Step 1.6: Add the enum types and required row fields**

In `packages/core/src/recommendations/outcome-attribution-types.ts`, after the `VisibilityFlag` type:

```ts
/**
 * Slice-3 enrichment enums (Riley v3 OutcomeLedger, spec section 2.5).
 *
 * causalStrength: "corroborated" is RESERVED for the slice-4 CRM/booking
 * agreement signal; the attribution engine must never emit it before that
 * signal exists (honesty floor, spec section 7.5).
 */
export type CausalStrength = "directional" | "corroborated" | "inconclusive";

/**
 * "unknown" until the slice-4 operational-state source exists; never a
 * fabricated "stable" (spec section 7.4).
 */
export type BusinessContextStability = "stable" | "unstable" | "unknown";

/**
 * Advisory display signal: should trust in this action class move, given
 * the outcome direction and its causal strength. Recorded and rendered on
 * the cockpit outcome feed; never fed back into recommendation scoring
 * (that switch is Phase-C, spec section 2.5).
 */
export type TrustDelta = "up" | "none" | "down";
```

In `RileyOutcomeRow`, after `visibilityFlags: VisibilityFlag[];`:

```ts
/** Slice-3 enrichments: always present on engine output; NULL on legacy DB rows. */
causalStrength: CausalStrength;
businessContextStable: BusinessContextStability;
trustDelta: TrustDelta;
```

- [ ] **Step 1.7: Derive the fields in the engine**

In `packages/core/src/recommendations/outcome-attribution.ts`:

Extend the type import:

```ts
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  BusinessContextStability,
  CausalStrength,
  MetaInsightsProvider,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  TrustDelta,
  VisibilityFlag,
  WindowMetrics,
} from "./outcome-attribution-types.js";
```

Replace the section between the noise-floor check and the return (current lines 90-108, the `// 6.` block) with:

```ts
// 6. Determine renderability + template + confidence
const cockpitRenderable = flags.length === 0 && deltaPct !== null;
const confidence: "low" | "medium" = cockpitRenderable ? config.confidence : "low";

// 7. Slice-3 enrichments (advisory; spec sections 2.5, 7.4, 7.5).
// causalStrength is derived from the flags/delta directly, not from
// cockpitRenderable, so a future renderability change cannot silently
// change causal semantics. "corroborated" requires the slice-4
// CRM/booking-agreement signal and is never emitted here.
const causalStrength: CausalStrength =
  flags.length === 0 && deltaPct !== null ? "directional" : "inconclusive";
// Always "unknown" until the slice-4 operational-state source exists.
const businessContextStable: BusinessContextStability = "unknown";

let copyTemplate: string | null = null;
let copyValues: { deltaPct: number; windowDays: number } | null = null;
let trustDelta: TrustDelta = "none";

if (cockpitRenderable && deltaPct !== null) {
  const direction = Math.sign(deltaPct);
  const favorableSign = config.favorableDirection === "down" ? -1 : 1;
  const isFavorable = direction === favorableSign;

  // The noise floor guarantees |deltaPct| >= noiseFloorPct on a clean row,
  // so a directional outcome always has a definite direction.
  trustDelta = isFavorable ? "up" : "down";

  if (candidate.actionKind === "pause") {
    copyTemplate = isFavorable ? "pause.spend.fell" : "pause.spend.changed";
  } else {
    copyTemplate = isFavorable ? "refresh.ctr.rose" : "refresh.ctr.changed";
  }
  copyValues = { deltaPct, windowDays };
}
```

And add the three fields to the returned object, after `visibilityFlags: flags,`:

```ts
    causalStrength,
    businessContextStable,
    trustDelta,
```

- [ ] **Step 1.8: Export the enum types**

In `packages/core/src/recommendations/index.ts`, extend the types export from `./outcome-attribution-types.js`:

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
  CausalStrength,
  BusinessContextStability,
  TrustDelta,
} from "./outcome-attribution-types.js";
```

- [ ] **Step 1.9: Run core tests; verify green**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution
```

Expected: PASS (all pre-existing + new describe block).

- [ ] **Step 1.10: Extend the db insert-mapping test (red)**

In `packages/db/src/__tests__/recommendation-outcome-store.test.ts`:

Add the three fields to `SAMPLE_ROW` (after `visibilityFlags: [],`):

```ts
  causalStrength: "directional",
  businessContextStable: "unknown",
  trustDelta: "up",
```

Extend the first insert test's `expect.objectContaining` (after `visibilityFlags: [],`):

```ts
        causalStrength: "directional",
        businessContextStable: "unknown",
        trustDelta: "up",
```

Run:

```bash
pnpm --filter @switchboard/db test -- recommendation-outcome-store
```

Expected: FAIL — `create` was called without the three new keys.

- [ ] **Step 1.11: Map the fields in the store insert**

In `packages/db/src/recommendation-outcome-store.ts`, inside `insert()`'s `data:` object, after `visibilityFlags: row.visibilityFlags as Prisma.InputJsonValue,`:

```ts
          causalStrength: row.causalStrength,
          businessContextStable: row.businessContextStable,
          trustDelta: row.trustDelta,
```

- [ ] **Step 1.12: Run db tests + monorepo typecheck; verify green**

```bash
pnpm --filter @switchboard/db test -- recommendation-outcome-store && pnpm typecheck
```

Expected: PASS / 21 successful tasks.

- [ ] **Step 1.13: Verify the eval seam is untouched**

```bash
pnpm eval:riley && git diff origin/main --stat -- evals/
```

Expected: "All 12 decideForCampaign + 10 source-reallocation + 6 arbitration cases match." and an empty diff.

- [ ] **Step 1.14: Commit (schema + migration + writers, atomically)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260604200000_recommendation_outcome_enrichment/ packages/core/src/recommendations/ packages/db/src/recommendation-outcome-store.ts packages/db/src/__tests__/recommendation-outcome-store.test.ts
git commit -m "feat(core,db): derive and persist causal strength, business context, trust delta on outcome rows"
```

---

### Task 2: Display pipeline in ONE commit (read model + allowlisted copy + shared translator)

**Files:**

- Modify: `packages/db/src/recommendation-outcome-store.ts` (read model + projection)
- Test: `packages/db/src/__tests__/recommendation-outcome-store.test.ts`
- Modify: `packages/schemas/src/recommendation-outcome-copy.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`
- Create: `apps/api/src/lib/outcome-activity-row.ts`
- Test: `apps/api/src/__tests__/outcome-activity-row.test.ts` (apps/api convention: tests flat in `__tests__/`)
- Modify: `apps/api/src/routes/cockpit/riley/outcomes.ts`
- Modify: `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`

Note: the store-level ordering guarantee the merge depends on (`orderBy: { windowEndedAt: "desc" }`, `take: limit`) is already pinned by the existing test at `packages/db/src/__tests__/recommendation-outcome-store.test.ts:107-120`; it is not duplicated here.

- [ ] **Step 2.1: Write the failing read-model projection tests**

In `packages/db/src/__tests__/recommendation-outcome-store.test.ts`, append to the `listRenderableForOrg` describe block:

```ts
it("projects the three enrichment fields when present", async () => {
  const prisma = buildPrismaMock();
  (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: "outcome-1",
      recommendationId: "rec-1",
      actionKind: "pause",
      windowEndedAt: new Date("2026-05-08T12:00:00Z"),
      copyTemplate: "pause.spend.fell",
      copyValues: { deltaPct: -92, windowDays: 7 },
      causalStrength: "directional",
      businessContextStable: "unknown",
      trustDelta: "up",
      recommendation: { targetEntities: { campaignId: "camp-A" }, parameters: {} },
    },
  ]);
  const store = new PrismaRecommendationOutcomeStore(prisma as never);
  const out = await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
  expect(out[0]).toMatchObject({
    causalStrength: "directional",
    businessContextStable: "unknown",
    trustDelta: "up",
  });
});

it("projects null enrichments on legacy rows (honest absence)", async () => {
  const prisma = buildPrismaMock();
  (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: "outcome-legacy",
      recommendationId: "rec-9",
      actionKind: "pause",
      windowEndedAt: new Date("2026-05-08T12:00:00Z"),
      copyTemplate: "pause.spend.fell",
      copyValues: { deltaPct: -92, windowDays: 7 },
      causalStrength: null,
      businessContextStable: null,
      trustDelta: null,
      recommendation: { targetEntities: { campaignId: "camp-A" }, parameters: {} },
    },
  ]);
  const store = new PrismaRecommendationOutcomeStore(prisma as never);
  const out = await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
  expect(out[0]).toMatchObject({
    causalStrength: null,
    businessContextStable: null,
    trustDelta: null,
  });
});

it("narrows unexpected enrichment strings to null (fail-closed)", async () => {
  const prisma = buildPrismaMock();
  (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: "outcome-weird",
      recommendationId: "rec-10",
      actionKind: "pause",
      windowEndedAt: new Date("2026-05-08T12:00:00Z"),
      copyTemplate: "pause.spend.fell",
      copyValues: { deltaPct: -92, windowDays: 7 },
      causalStrength: "telepathic",
      businessContextStable: "vibes",
      trustDelta: "sideways",
      recommendation: { targetEntities: { campaignId: "camp-A" }, parameters: {} },
    },
  ]);
  const store = new PrismaRecommendationOutcomeStore(prisma as never);
  const out = await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
  expect(out[0]).toMatchObject({
    causalStrength: null,
    businessContextStable: null,
    trustDelta: null,
  });
});
```

Also add the three fields (`causalStrength: null, businessContextStable: null, trustDelta: null,` after `copyValues`) to the existing "projects campaignId/campaignName" fixture row, since the projection input type will require them.

- [ ] **Step 2.2: Run; verify the new tests fail**

```bash
pnpm --filter @switchboard/db test -- recommendation-outcome-store
```

Expected: FAIL — projected fields are `undefined`.

- [ ] **Step 2.3: Implement read model + projection (all three fields)**

In `packages/db/src/recommendation-outcome-store.ts`:

Extend the core type import:

```ts
import {
  isAttributableKind,
  KIND_CONFIG,
  SETTLEMENT_LAG_HOURS,
  type AttributableKind,
  type AttributableRecommendation,
  type AttributableRecommendationStore,
  type BusinessContextStability,
  type CausalStrength,
  type RecommendationOutcomeStore,
  type RileyOutcomeRow,
  type TrustDelta,
} from "@switchboard/core";
```

Add to `RecommendationOutcomeReadModel` (after `copyValues`):

```ts
/** Slice-3 enrichments; null on rows predating slice 3 (honest absence). */
causalStrength: CausalStrength | null;
businessContextStable: BusinessContextStability | null;
trustDelta: TrustDelta | null;
```

Add a narrowing helper above `projectReadModel`:

```ts
/** Fail-closed enum narrowing: unexpected DB strings project as null (honest absence). */
function narrowEnum<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
```

In `projectReadModel`, extend the input type (after `copyValues: Prisma.JsonValue;`):

```ts
causalStrength: string | null;
businessContextStable: string | null;
trustDelta: string | null;
```

and the returned object (after `copyValues`):

```ts
    causalStrength: narrowEnum(row.causalStrength, [
      "directional",
      "corroborated",
      "inconclusive",
    ] as const),
    businessContextStable: narrowEnum(row.businessContextStable, [
      "stable",
      "unstable",
      "unknown",
    ] as const),
    trustDelta: narrowEnum(row.trustDelta, ["up", "none", "down"] as const),
```

("corroborated" is legal on the READ side: reading a future slice-4 value is not fabricating it.)

- [ ] **Step 2.4: Pad the apps/api outcome-route fixtures (typecheck-only)**

In `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`, add to both `SAMPLE_ROWS` entries (after `campaignName`):

```ts
    causalStrength: "directional",
    businessContextStable: "unknown",
    trustDelta: null,
```

(`trustDelta` values change in Step 2.10.)

- [ ] **Step 2.5: Run db tests + typecheck; verify green**

```bash
pnpm --filter @switchboard/db test -- recommendation-outcome-store && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2.6: Write the failing trust-copy tests**

Append to `packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`:

```ts
describe("renderTrustDeltaCopy", () => {
  it("renders up copy (signal language, not trust-state language)", () => {
    expect(renderTrustDeltaCopy("up")).toBe("This outcome is a positive signal for this action.");
  });

  it("renders down copy", () => {
    expect(renderTrustDeltaCopy("down")).toBe("This outcome is a negative signal for this action.");
  });

  it("returns null for none (recorded, not displayed: nothing moved, nothing claimed)", () => {
    expect(renderTrustDeltaCopy("none")).toBeNull();
  });

  it("returns null for null/undefined (legacy rows render unchanged)", () => {
    expect(renderTrustDeltaCopy(null)).toBeNull();
    expect(renderTrustDeltaCopy(undefined)).toBeNull();
  });

  it("returns null for unknown strings (fail-closed)", () => {
    expect(renderTrustDeltaCopy("sideways")).toBeNull();
  });

  it("contains no causal or trust-state language (extended B.2 tripwire)", () => {
    expect(JSON.stringify(TRUST_DELTA_COPY)).not.toMatch(
      /\b(caused|because|led to|resulted|drove|fixed|saved|prevented|proved|recovered|improved|trust)\b/i,
    );
  });
});
```

Update the test file's import line:

```ts
import {
  ALLOWLISTED_TEMPLATES,
  TRUST_DELTA_COPY,
  renderOutcomeCopy,
  renderTrustDeltaCopy,
} from "../recommendation-outcome-copy.js";
```

- [ ] **Step 2.7: Run; verify fail**

```bash
pnpm --filter @switchboard/schemas test -- recommendation-outcome-copy
```

Expected: FAIL — `renderTrustDeltaCopy` is not exported.

- [ ] **Step 2.8: Implement the trust-copy allowlist + renderer**

Append to `packages/schemas/src/recommendation-outcome-copy.ts`:

```ts
/**
 * Allowlisted trust-delta suffix copy (Riley v3 slice 3). Appended to the
 * outcome head on the activity feed so the operator reads whether this
 * outcome supports or undermines the action class. Signal language by
 * design: trustDelta is an advisory annotation, not a product trust state
 * ("trust moved" phrasing is banned by the tripwire test). "none" is
 * deliberately absent: nothing moved, nothing claimed (recorded on the row,
 * not displayed). Unknown or null values (legacy rows) render no suffix —
 * fail-closed, byte-identical to pre-slice-3 output.
 */
export const TRUST_DELTA_COPY = {
  up: "This outcome is a positive signal for this action.",
  down: "This outcome is a negative signal for this action.",
} as const;

export function renderTrustDeltaCopy(trustDelta: string | null | undefined): string | null {
  if (trustDelta !== "up" && trustDelta !== "down") return null;
  return TRUST_DELTA_COPY[trustDelta];
}
```

In `packages/schemas/src/index.ts` (line ~201, the PR-3 outcome-copy block uses named exports), extend the export list:

```ts
// PR-3: Allowlisted directional copy for "observed" activity rows
export {
  ALLOWLISTED_TEMPLATES,
  TRUST_DELTA_COPY,
  renderOutcomeCopy,
  renderTrustDeltaCopy,
  type OutcomeCopyTemplate,
  type OutcomeCopyValues,
} from "./recommendation-outcome-copy.js";
```

- [ ] **Step 2.9: Run; verify green**

```bash
pnpm --filter @switchboard/schemas test -- recommendation-outcome-copy && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2.10: Write the failing shared-translator tests**

Create `apps/api/src/__tests__/outcome-activity-row.test.ts`:

```ts
/**
 * Unit tests for the shared RecommendationOutcomeReadModel → ActivityRow
 * translator (extracted from the dedicated outcomes route in slice 3 so the
 * cockpit activity feed can reuse it). Pins the trust-signal suffix and the
 * legacy-null honesty floor: rows predating slice 3 render byte-identically
 * to the pre-slice-3 output.
 */
import { describe, it, expect } from "vitest";
import { translateOutcomeToActivityRow } from "../lib/outcome-activity-row.js";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

const BASE: RecommendationOutcomeReadModel = {
  id: "outcome-1",
  recommendationId: "rec-1",
  actionKind: "pause",
  windowEndedAt: new Date("2026-05-08T12:00:00Z"),
  copyTemplate: "pause.spend.fell",
  copyValues: { deltaPct: -92, windowDays: 7 },
  campaignId: "camp-A",
  campaignName: "Campaign A",
  causalStrength: "directional",
  businessContextStable: "unknown",
  trustDelta: "up",
};

describe("translateOutcomeToActivityRow", () => {
  it("translates a renderable row to an observed ActivityRow with the trust-signal suffix in head", () => {
    const row = translateOutcomeToActivityRow(BASE);
    expect(row).toMatchObject({
      id: "outcome:outcome-1",
      kind: "observed",
      head: "Spend fell 92.0% in 7d after pause. This outcome is a positive signal for this action.",
      body: "after pause · Campaign A",
      time: "12:00",
      timestampIso: "2026-05-08T12:00:00.000Z",
    });
  });

  it("renders the negative-signal suffix for trustDelta down", () => {
    const row = translateOutcomeToActivityRow({
      ...BASE,
      copyTemplate: "pause.spend.changed",
      copyValues: { deltaPct: 10, windowDays: 7 },
      trustDelta: "down",
    });
    expect(row?.head).toBe(
      "Spend changed 10.0% in 7d after pause. This outcome is a negative signal for this action.",
    );
  });

  it("renders legacy rows (trustDelta null) byte-identically to pre-slice-3 output", () => {
    const row = translateOutcomeToActivityRow({ ...BASE, trustDelta: null });
    expect(row?.head).toBe("Spend fell 92.0% in 7d after pause.");
  });

  it("renders no suffix for trustDelta none (defensive: recorded, never displayed)", () => {
    const row = translateOutcomeToActivityRow({ ...BASE, trustDelta: "none" });
    expect(row?.head).toBe("Spend fell 92.0% in 7d after pause.");
  });

  it("fail-closes on off-allowlist copy templates", () => {
    expect(
      translateOutcomeToActivityRow({ ...BASE, copyTemplate: "pause.spend.exploded" }),
    ).toBeNull();
  });

  it("fail-closes when copyTemplate or copyValues are missing", () => {
    expect(translateOutcomeToActivityRow({ ...BASE, copyTemplate: null })).toBeNull();
    expect(translateOutcomeToActivityRow({ ...BASE, copyValues: null })).toBeNull();
  });
});
```

- [ ] **Step 2.11: Run; verify fail**

```bash
pnpm --filter api test -- outcome-activity-row
```

Expected: FAIL — module does not exist.

- [ ] **Step 2.12: Create the shared translator (extraction + suffix)**

Create `apps/api/src/lib/outcome-activity-row.ts`:

```ts
// ---------------------------------------------------------------------------
// Shared RecommendationOutcomeReadModel → ActivityRow translator.
//
// Extracted from routes/cockpit/riley/outcomes.ts in slice 3 so both the
// dedicated outcomes route and the cockpit activity feed render outcome rows
// identically. Slice 3 appends the allowlisted trust-signal suffix to `head`
// (the agent-panel work log renders only `head`; body/tag are dropped there).
//
// Honesty floors:
// - off-allowlist copy templates render null and the row is dropped
//   (fail-closed, B.2 guardrail);
// - trustDelta null (legacy rows) or "none" renders no suffix — output is
//   byte-identical to pre-slice-3 copy.
// ---------------------------------------------------------------------------
import { renderOutcomeCopy, renderTrustDeltaCopy } from "@switchboard/schemas";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

const ACTION_LABEL: Record<string, string> = {
  pause: "pause",
  refresh_creative: "creative refresh",
};

export function translateOutcomeToActivityRow(
  row: RecommendationOutcomeReadModel,
): ActivityRow | null {
  if (!row.copyTemplate || !row.copyValues) return null;
  const outcomeCopy = renderOutcomeCopy(row.copyTemplate, row.copyValues);
  if (outcomeCopy === null) return null; // fail-closed on off-allowlist template

  const trustCopy = renderTrustDeltaCopy(row.trustDelta);
  const head = trustCopy ? `${outcomeCopy} ${trustCopy}` : outcomeCopy;

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
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
```

- [ ] **Step 2.13: Point the dedicated route at the shared translator**

Rewrite `apps/api/src/routes/cockpit/riley/outcomes.ts` to drop its private `translateRow`/`formatTime`/`ACTION_LABEL` and use the shared module:

```ts
// @route-class: read-only
// Legacy/debug endpoint. The operator-visible surface for outcome rows is
// GET /api/dashboard/agents/riley/activity (the agent-panel work log feed);
// this route remains as the dedicated outcomes contract for debugging and
// compatibility. Both render through lib/outcome-activity-row.ts.
import type { FastifyInstance } from "fastify";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";
import { requireOrganizationScope } from "../../../utils/require-org.js";
import { translateOutcomeToActivityRow } from "../../../lib/outcome-activity-row.js";

export interface OutcomesRouteDeps {
  listRenderable(args: { orgId: string; limit: number }): Promise<RecommendationOutcomeReadModel[]>;
}

const DEFAULT_LIMIT = 100;

export async function registerRileyOutcomesRoute(
  app: FastifyInstance,
  deps: OutcomesRouteDeps,
): Promise<void> {
  // Dev/test mode: allow `x-org-id` header to set the org scope.
  // In production the auth middleware sets organizationIdFromAuth before handlers run.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
    }
  });

  app.get("/api/cockpit/riley/outcomes", async (req, reply) => {
    const orgId = requireOrganizationScope(req, reply);
    if (!orgId) return;
    const rows = await deps.listRenderable({ orgId, limit: DEFAULT_LIMIT });
    return {
      rows: rows.map(translateOutcomeToActivityRow).filter((r): r is ActivityRow => r !== null),
    };
  });
}
```

- [ ] **Step 2.14: Update the outcomes-route tests for the suffix**

In `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`:

- Change `SAMPLE_ROWS[0]` to `trustDelta: "up"` (padded as null in Step 2.4).
- Update the first test's head assertions:

```ts
expect(body.rows[0]).toMatchObject({
  id: "outcome:outcome-1",
  kind: "observed",
  head: "Spend fell 92.0% in 7d after pause. This outcome is a positive signal for this action.",
  body: "after pause · Campaign A",
});
expect(body.rows[1]).toMatchObject({
  id: "outcome:outcome-2",
  kind: "observed",
  head: "CTR rose 12.3% in 14d after refresh.",
  body: "after creative refresh",
});
```

(`SAMPLE_ROWS[1]` keeps `trustDelta: null` — it doubles as the legacy-row pin at the route level.)

- [ ] **Step 2.15: Run; verify green**

```bash
pnpm --filter api test -- outcome && pnpm typecheck
```

Expected: PASS (translator unit tests + updated route tests).

- [ ] **Step 2.16: Commit**

```bash
git add packages/db/src/recommendation-outcome-store.ts packages/db/src/__tests__/recommendation-outcome-store.test.ts packages/schemas/src/recommendation-outcome-copy.ts packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts packages/schemas/src/index.ts apps/api/src/lib/outcome-activity-row.ts apps/api/src/__tests__/outcome-activity-row.test.ts apps/api/src/routes/cockpit/riley/outcomes.ts apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts
git commit -m "feat(db,schemas,api): outcome enrichment read model + allowlisted trust-signal copy"
```

---

### Task 3: Merge riley outcome rows into the cockpit activity feed

**Files:**

- Modify: `apps/api/src/lib/cockpit-activity-deps.ts`
- Modify: `apps/api/src/routes/agent-home/activity.ts`
- Modify: `apps/api/src/bootstrap/routes.ts:137-150`
- Test: `apps/api/src/__tests__/api-cockpit-activity.test.ts`

- [ ] **Step 3.1: Write the failing merge tests**

In `apps/api/src/__tests__/api-cockpit-activity.test.ts`:

Update the deps import:

```ts
import {
  buildCockpitActivityDeps,
  type CockpitActivityDeps,
} from "../lib/cockpit-activity-deps.js";
```

Extend `buildApp` to accept an optional outcomes dep (only the deps line changes; decorations stay as they are):

```ts
async function buildApp(
  prisma: ReturnType<typeof buildMockPrisma>,
  listRenderableOutcomes?: CockpitActivityDeps["listRenderableOutcomes"],
) {
  // ... existing decorations unchanged ...
  const deps = { ...buildCockpitActivityDeps(prisma as never), listRenderableOutcomes };
  await app.register(cockpitActivityRoutes(deps), { prefix: "/api/dashboard" });
  return app;
}
```

Append a new describe block:

```ts
describe("GET /api/dashboard/agents/riley/activity — outcome-row merge (slice 3)", () => {
  const OUTCOME = {
    id: "outcome-1",
    recommendationId: "rec-1",
    actionKind: "pause" as const,
    windowEndedAt: new Date("2026-05-15T13:00:00.000Z"),
    copyTemplate: "pause.spend.fell",
    copyValues: { deltaPct: -92, windowDays: 7 },
    campaignId: "camp-A",
    campaignName: "Campaign A",
    causalStrength: "directional" as const,
    businessContextStable: "unknown" as const,
    trustDelta: "up" as const,
  };

  const RILEY_AUDIT: AuditRow = {
    id: "a-riley",
    eventType: "message.sent",
    timestamp: new Date("2026-05-15T12:00:00.000Z"),
    actorType: "agent",
    actorId: "riley",
    snapshot: {},
    organizationId: "org-1",
  };

  it("merges observed outcome rows into the riley feed, newest first, trust suffix in head", async () => {
    const prisma = buildMockPrisma({ audit: [RILEY_AUDIT] });
    const listRenderableOutcomes = vi.fn().mockResolvedValue([OUTCOME]);
    const app = await buildApp(prisma, listRenderableOutcomes);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/activity?expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ id: string; kind: string; head: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(["outcome:outcome-1", "a-riley"]);
    expect(body.rows[0]).toMatchObject({
      kind: "observed",
      head: "Spend fell 92.0% in 7d after pause. This outcome is a positive signal for this action.",
    });
    expect(listRenderableOutcomes).toHaveBeenCalledWith({ orgId: "org-1", limit: 50 });
  });

  it("honors the limit cap across merged sources", async () => {
    const prisma = buildMockPrisma({ audit: [RILEY_AUDIT] });
    const listRenderableOutcomes = vi.fn().mockResolvedValue([OUTCOME]);
    const app = await buildApp(prisma, listRenderableOutcomes);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/activity?limit=1&expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { rows: Array<{ id: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.id).toBe("outcome:outcome-1"); // newest survives
  });

  it("never fetches outcomes for non-riley agents", async () => {
    const prisma = buildMockPrisma({
      audit: [{ ...RILEY_AUDIT, id: "a-alex", actorId: "alex" }],
    });
    const listRenderableOutcomes = vi.fn().mockResolvedValue([OUTCOME]);
    const app = await buildApp(prisma, listRenderableOutcomes);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity?expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(listRenderableOutcomes).not.toHaveBeenCalled();
  });

  it("serves the audit-only feed when the outcomes dep is absent (backward compat)", async () => {
    const prisma = buildMockPrisma({ audit: [RILEY_AUDIT] });
    const app = await buildApp(prisma); // no outcomes dep
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/activity?expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ id: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(["a-riley"]);
  });

  it("degrades to the audit-only feed when the outcomes fetch fails", async () => {
    const prisma = buildMockPrisma({ audit: [RILEY_AUDIT] });
    const listRenderableOutcomes = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await buildApp(prisma, listRenderableOutcomes);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/activity?expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ id: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(["a-riley"]);
  });
});
```

- [ ] **Step 3.2: Run; verify fail**

```bash
pnpm --filter api test -- api-cockpit-activity
```

Expected: FAIL — merged rows absent.

- [ ] **Step 3.3: Extend the deps contract**

In `apps/api/src/lib/cockpit-activity-deps.ts`:

```ts
import type { RecommendationOutcomeReadModel } from "@switchboard/db";
```

and extend the interface:

```ts
export interface CockpitActivityDeps {
  previewReader: ActivityPreviewReader;
  fetchAuditEntries: (args: { orgId: string; limit: number }) => Promise<AuditEntryForTranslator[]>;
  /**
   * Slice 3: renderable Riley outcome rows merged into the activity feed
   * (the operator surface that replaced the retired /riley cockpit).
   * Optional: when absent the feed is audit-only (backward compatible).
   */
  listRenderableOutcomes?: (args: {
    orgId: string;
    limit: number;
  }) => Promise<RecommendationOutcomeReadModel[]>;
}
```

(`buildCockpitActivityDeps` itself is unchanged; the field is attached at the wiring site.)

- [ ] **Step 3.4: Merge in the route**

In `apps/api/src/routes/agent-home/activity.ts`:

Add the import:

```ts
import { translateOutcomeToActivityRow } from "../../lib/outcome-activity-row.js";
```

Replace the body of the `try` block (currently `const entries = ...` through `return reply.code(200).send({ rows });`) with:

```ts
const entries = await deps.fetchAuditEntries({ orgId, limit });
const agentKey = agentId as AgentHomeKey; // narrowed by the access gate above (alex/riley/mira)
const translated = await translateAuditToCockpitActivity({
  entries,
  previewReader: deps.previewReader,
  orgId,
  agentKey,
  limit,
  expandPreview,
});

// Slice 3: merge renderable Riley outcome rows ("observed", with the
// allowlisted trust-signal suffix in head) into the audit-derived feed.
// Outcomes exist only for riley; a fetch failure degrades to the
// audit-only feed rather than sinking the operator surface.
let outcomeRows: ActivityRow[] = [];
if (agentKey === "riley" && deps.listRenderableOutcomes) {
  try {
    const outcomes = await deps.listRenderableOutcomes({ orgId, limit });
    outcomeRows = outcomes
      .map(translateOutcomeToActivityRow)
      .filter((r): r is ActivityRow => r !== null);
  } catch (err) {
    app.log.warn({ err }, "riley outcome merge failed; serving audit-only feed");
  }
}

// Top-limit merge of two independently sorted sources is correct
// because each source returns its own newest `limit` rows (audit via
// the over-fetch + translate + slice path; outcomes via the store's
// orderBy windowEndedAt desc + take, pinned in
// recommendation-outcome-store.test.ts): no row outside either
// source's top `limit` can enter the merged top `limit`.
const merged = [...translated, ...outcomeRows].sort((a, b) =>
  (b.timestampIso ?? "").localeCompare(a.timestampIso ?? ""),
);
const rows: ActivityRow[] = merged.slice(0, limit);
return reply.code(200).send({ rows });
```

- [ ] **Step 3.5: Wire the store at bootstrap**

In `apps/api/src/bootstrap/routes.ts`, inside the existing `if (app.prisma)` block, hoist the store construction above the deps and attach the dep (final shape):

```ts
if (app.prisma) {
  // Riley outcome store backs both the dedicated outcomes route and the
  // slice-3 activity-feed merge. Store filters cockpitRenderable=true at
  // the SQL layer.
  const { PrismaRecommendationOutcomeStore } = await import("@switchboard/db");
  const recommendationOutcomeStore = new PrismaRecommendationOutcomeStore(app.prisma);
  const listRenderableOutcomes = ({ orgId, limit }: { orgId: string; limit: number }) =>
    recommendationOutcomeStore.listRenderableForOrg({ orgId, agentRole: "riley", limit });

  const cockpitActivityDeps = {
    ...buildCockpitActivityDeps(app.prisma),
    listRenderableOutcomes,
  };
  await app.register(cockpitActivityRoutes(cockpitActivityDeps), {
    prefix: "/api/dashboard",
  });
  // Riley outcomes route: GET /api/cockpit/riley/outcomes (legacy/debug;
  // the operator surface is the activity feed above)
  await registerRileyOutcomesRoute(app, {
    listRenderable: listRenderableOutcomes,
  });
}
```

- [ ] **Step 3.6: Run; verify green**

```bash
pnpm --filter api test && pnpm typecheck
```

Expected: PASS (merge tests + all pre-existing api tests; known flake set per memory: api-auth prod-hardening and bootstrap-smoke npm-warn may flake under full-suite load — rerun before investigating).

- [ ] **Step 3.7: Commit**

```bash
git add apps/api/src/lib/cockpit-activity-deps.ts apps/api/src/routes/agent-home/activity.ts apps/api/src/bootstrap/routes.ts apps/api/src/__tests__/api-cockpit-activity.test.ts
git commit -m "feat(api): merge riley outcome rows into the cockpit activity feed"
```

---

### Task 4: Full verification sweep

- [ ] **Step 4.1: Full gates**

```bash
pnpm build && pnpm typecheck && pnpm test
pnpm eval:riley
pnpm format:check
pnpm arch:check
pnpm db:check-drift
```

Expected: all green; eval prints "All 12 decideForCampaign + 10 source-reallocation + 6 arbitration cases match." (Known pre-existing local PG integration flakes per memory: work-trace/ledger/greeting advisory-lock tests; they fail identically on main and do not block.)

- [ ] **Step 4.2: Advisory-only + boundary proofs**

Diff-scope proof (the only touched paths are the sanctioned ones):

```bash
git diff origin/main --name-only | grep -vE "^(docs/|packages/db/|packages/schemas/|apps/api/|packages/core/src/recommendations/)"
```

Expected: empty. Proves: no ad-optimizer change, no dashboard change, no eval change, no core change outside the outcome module.

Tree-wide consumer proof (no scoring/governance/routing consumer of the new fields in the decision-capable layers):

```bash
grep -rn "trustDelta\|causalStrength\|businessContextStable" packages/core/src packages/ad-optimizer/src --include="*.ts" | grep -v "src/recommendations"
```

Expected: empty. The fields exist in `packages/core/src/recommendations/` (writer), `packages/db` (persistence), `packages/schemas` (display copy), `apps/api` (display translation) — and nowhere else.

No new ingress caller:

```bash
git diff origin/main -- ':!docs' | grep -i "PlatformIngress"
```

Expected: empty.

- [ ] **Step 4.3 (best-effort): Live feed verification**

With local Postgres + API running: seed one acted riley recommendation + outcome row (see `scripts/seed-recommendation.ts`), then:

```bash
curl -s "http://localhost:3000/api/dashboard/agents/riley/activity?limit=10" -H "x-org-id: default" | jq '.rows[] | select(.kind=="observed")'
```

Expected: an observed row whose `head` ends with "This outcome is a positive signal for this action." (or negative). Optional: headless screenshot of the agent panel per the dashboard visual-verification memory. Skip without blocking if local stack friction exceeds value; the api tests pin the same contract.

---

### Task 5: Land the PR (per session protocol)

- [ ] Re-fetch and rebase onto live `origin/main`; re-run all gates after the rebase (Task 4.1 set). If a parallel session landed a migration with a nearby timestamp, verify migration ordering still applies cleanly (`prisma migrate deploy` against a scratch DB or rely on `db:check-drift`).
- [ ] Rename the branch (`git branch -m feat/riley-v3-slice3-outcome-ledger`), push, open ONE focused PR titled `feat(core,db,api): riley v3 slice 3 outcome-ledger enrichment (causal strength + trust delta)`.
- [ ] PR body: summary of the three fields + honesty floors, the orphaned-feed finding and the activity-feed merge resolution (spec risk 7.2), the consumer sweep, eval-unchanged proof, advisory-only grep proofs, DB CHECK constraints, review reconciliation summary.
- [ ] Enable auto-merge (squash) once required checks pass (typecheck, lint, test, security). Known noise: the informational Eval Claim Classifier job 401s on every main push (ANTHROPIC_API_KEY rotation pending); it is not a required check.
- [ ] After merge: verify the post-merge CI run's required jobs on main; same-day teardown (worktree remove + prune, branch deleted local+remote); update memory (slice 3 shipped; slice 4a next, unlocks the corroborated arm).

---

## Self-review (spec coverage)

- Spec 2.5 `causalStrength` (3-value enum, emits 2) → Task 1 (derivation + never-corroborated sweep test + DB CHECK).
- Spec 2.5 / 7.4 `businessContextStable` ("unknown", never fabricated) → Task 1 (constant + cross-kind test pin).
- Spec 2.5 / 7.2 `trustDelta` (recorded AND displayed on an existing surface, not auto-applied) → Tasks 1 (recorded), 2 (projection + signal copy + translator), 3 (displayed on the feed that replaced the retired cockpit); advisory-only proofs in Task 4.2.
- Scope `V1_ATTRIBUTABLE_KINDS` → automatic: the engine only runs for attributable kinds; no per-kind config change needed.
- Honest-null legacy rows → Task 2 (projection nulls + byte-identical copy, pinned at unit + route level).
- Same-commit migration → Task 1 (schema + migration + writers in ONE commit; literal guarantee).
- Eval untouched → Tasks 1.13 / 4.1 / 4.2. No new surface → Task 3 merges into an existing feed; the dedicated route is documented as legacy/debug; deferred results dashboard untouched.
- Risk "feed degradation" → Task 3 inner try/catch + test.
