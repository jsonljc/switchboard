# Riley v3 Slice 4a: Operational-State Confirmations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator-editable operational-state persistence (schema + store + migration) with an honest freshness anchor that lets slice 4c check whether an operator confirmation's validity interval overlaps a past attribution window.

**Architecture:** A new sibling Zod module in `@switchboard/schemas` (`operational-state.ts`, Layer 1, zod-only) plus a new append-only Prisma table `OperationalStateConfirmation` and a sibling store `PrismaOperationalStateStore` in `@switchboard/db`. Confirmations are INSERT-only rows; a confirmation's validity interval is derived as `[confirmedAt_i, confirmedAt_{i+1})`, never stored or mutated, so freshness is structurally immune to unrelated writes. The store ships three reads/writes: `recordConfirmation`, `getLatest`, `getConfirmationsOverlappingWindow` (the 4c substrate). No app wiring, no routes, no consumers flip in this slice.

**Tech Stack:** Zod 3.25, Prisma 6.19 (PostgreSQL), vitest with mocked Prisma (CI has no Postgres), hand-written SQL migration with CHECK constraints.

**Consumes:** `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` sections 2.1 (net-new paragraph), 2.5, 4 item 6, 7.4; `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` Slice 4a. Slices 1 (#867), 2 (#876), 3 (#886) are merged and consumed as-is.

**Scope fence (4a only):** schema + store + migration + tests. NO operator editor (4b), NO RevenueState/outcome consumption (4c), NO new UI, NO route, NO PlatformIngress caller, NO diff under `packages/ad-optimizer`, `packages/core`, `apps/`, or `evals/`. `RecommendationOutcome.businessContextStable` keeps recording `"unknown"`, `causalStrength` keeps never emitting `"corroborated"`, `RevenueState.businessContextFreshness` stays reserved `"unknown"`; 4c flips them, 4a builds the source they will read.

---

## Settled design decisions (the load-bearing part)

### Decision A: sibling schema + sibling table, NOT an extension of `BusinessFactsSchema`

The spec sanctions either ("net-new operational-state fields on that store _(or a sibling)_"). Sibling wins on four independent grounds, each verified against live main at `dc949b2e`:

1. **Whole-blob write hazard (live data-loss risk).** The live write path (`apps/api/src/routes/marketplace.ts:349-380`, shipped in #828) does `BusinessFactsSchema.safeParse(request.body)` then `factsStore.upsert(orgId, parsed.data)`, and the store (`packages/db/src/stores/prisma-business-facts-store.ts:70-76`) replaces the entire `BusinessConfig.config` JSON. If operational state lived inside that blob, every identity-facts save from the existing editor form would silently erase whatever operational fields the form does not round-trip. The freshness anchor would be destroyable by an unrelated edit, the exact failure mode spec 7.4 forbids.
2. **Freshness anchor isolation.** Spec 7.4 requires freshness to encode "staleness of the input itself (when did the operator last confirm)", never an `updatedAt` that unrelated writes touch. `BusinessConfig.updatedAt` moves on every identity edit. A separate INSERT-only table makes the anchor immune by construction: rows are never updated, so `confirmedAt` cannot move.
3. **History requirement.** The outcome cron runs after the attribution window closes; 4c must ask "what governed `[windowStartedAt, windowEndedAt]`", which a single mutable row cannot answer (see Decision B). `BusinessConfig` is one row per org.
4. **Alex blast radius = zero by construction.** Alex's live dialogue path parses `BusinessFactsSchema` (`packages/core/src/skill-runtime/builders/alex.ts:99-105` via `stores.businessFactsStore.get`), and the alex-conversation eval drives the REAL `PrismaBusinessFactsStore` (`evals/alex-conversation/run-conversation.ts:136`). Touching neither the schema nor the store means no behavioral delta can reach Alex. This matters doubly right now because the model-driven alex eval is environmentally blocked (see "Eval gates" below).

The trap is re-verified: `PlaybookBusinessFactsSchema` (`packages/schemas/src/playbook.ts:39`) is a separate, like-named schema and is NOT the store substrate (`prisma-business-facts-store.ts:2` imports `BusinessFactsSchema` from `@switchboard/schemas`, defined at `packages/schemas/src/marketplace.ts:274`). Neither file is touched by this slice.

### Decision B: append-only confirmations with DERIVED validity intervals

Three candidate shapes were weighed for the 4c past-window overlap requirement:

| Shape                                                                       | Past-window overlap                                                          | Write path                                                                                                              | Verdict                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Single mutable current-state row + `lastConfirmedAt`                        | Cannot answer: intervening edits erase what governed the window              | trivial                                                                                                                 | **Rejected**: exactly the failure 7.4 names |
| Current row + history table                                                 | Answers it                                                                   | Two writes per confirm (UPDATE + INSERT), transactional consistency burden; "current" is derivable as latest row anyway | **Rejected**: redundant write complexity    |
| Stored `validUntil` closed on supersede                                     | One-row SQL overlap predicate                                                | UPDATE on supersede breaks append-only purity; concurrent confirms race                                                 | **Rejected**: mutation reintroduced         |
| **Append-only rows, validity derived** `[confirmedAt_i, confirmedAt_{i+1})` | Answers it: governing row (latest at-or-before windowStart) + in-window rows | Single INSERT, no mutation ever                                                                                         | **Chosen**                                  |

How 4c provably answers its question on this shape: for window `W = [windowStartedAt, windowEndedAt]` (both already columns on `RecommendationOutcome`, `packages/db/prisma/schema.prisma:608-609`), the store returns (1) the latest confirmation with `confirmedAt <= windowStart` (the regime in force as the window opened) plus (2) every confirmation with `windowStart < confirmedAt <= windowEnd` (mid-window regime changes). From that set 4c can detect disruptive states governing the window, detect mid-window transitions (a promo starting mid-window breaks pre/post comparability), and apply its own staleness policy using each `confirmedAt`. Empty set = unknown (honest absence). The store test pins these exact query predicates and the assembly contract.

**Same-instant ties are defined, not accidental.** If multiple confirmations share the same `confirmedAt`, the later row supersedes at that instant and the earlier row's derived validity interval is zero-length, which is acceptable. "Later" is defined as (`createdAt`, then `id`): CUID lexical order is not a semantic operator-action order, so `createdAt` sits before `id` in the tiebreak and `id` exists only to make ordering total. Every store read orders by the full triple (`confirmedAt`, `createdAt`, `id`), pinned by tests including a two-rows-same-instant case.

**Staleness policy is deliberately NOT encoded in 4a.** The data records who confirmed what when; "how old is too old to vouch" is a 4c policy knob. Baking a TTL into the rows would fabricate a confidence claim the operator never made.

**Two interval concepts, kept distinct:**

- The _confirmation's_ validity interval is derived from row ordering (above), never stored.
- _In-state_ intervals (`promoWindows`, `closures`) are operator-known explicit bounds ("promo runs June 1-15"), stored inside the state payload. These are load-bearing for the spec's own example: an operator confirming on June 16 "promo just ended (ran June 1-15)" must let 4c see the promo overlapped a June 8-14 window even though no confirmation row existed during it.

### Decision C: the operational-state field set

Exactly the spec's four dimensions (2.1: "clinic closed, promo ended, rep away, inventory out"; plan: "open/closed, promo window, staffing, inventory"), nothing more (YAGNI):

| Field             | Type                                        | Why 4c's stability check needs it                                                                                                                           |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operatingStatus` | `"open" \| "temporarily_closed"` (optional) | "clinic closed": a closed clinic invalidates booked-revenue comparisons                                                                                     |
| `closures`        | `Array<{start, end?, label?}>` (optional)   | closure with operator-known dates; overlap with the window even when confirmed after the fact                                                               |
| `promoWindows`    | `Array<{start, end?, label?}>` (optional)   | "promo ended": promos shift demand; mid-window promo transitions break pre/post deltas                                                                      |
| `staffing`        | `"normal" \| "shortfall"` (optional)        | "rep away": capacity shifts conversion                                                                                                                      |
| `inventory`       | `"normal" \| "outage"` (optional)           | "inventory out": service unbookable, demand signal distorted                                                                                                |
| `note`            | string (optional)                           | operator free-text context for the 4b surface; NOT consumed by 4c logic and NEVER satisfies the at-least-one floor (a note alone must not create freshness) |

**Honesty floors, encoded structurally:**

- Every dimension is optional and **nothing carries a `.default()`** (deliberate contrast with `BusinessFactsSchema.openingHours.closed: z.boolean().default(false)`, a fabrication-by-default pattern this slice must not replicate). Absent = "operator has not confirmed this", never "open"/"normal".
- `promoWindows`/`closures`: `undefined` = unconfirmed; explicit `[]` = "operator confirmed none". The distinction is semantic and test-pinned.
- A confirmation must confirm at least one OPERATIONAL dimension (`operatingStatus`, `staffing`, `inventory`, `promoWindows`, `closures`); a free-text `note` alone is NOT a confirmation, because it would create a freshness anchor with no machine-readable content. Enforced twice: a Zod `.refine` at the store boundary AND a database CHECK constraint, so a hand-written SQL insert, admin edit, or future bulk tool cannot fabricate freshness either.
- Operator-declared intervals must be ordered: `end`, when present, must be strictly after `start`. Inverted and zero-length intervals are rejected at the schema so 4c never has to guess what an inverted promo window meant.
- `confirmedAt` is a required column with **no DB default** AND a required `recordConfirmation` parameter: every writer supplies the operator confirmation moment explicitly; nothing assigns one implicitly.
- **No backfill.** The 2026-06-02 business-facts backfill is shape precedent only; fabricating confirmations for existing orgs would violate the floor. Legacy orgs have zero rows = honest absence, pinned by store tests and by the migration containing no INSERT/UPDATE.
- Malformed rows (hand-edited DB, future drift) degrade to absence with a `console.warn`; they never surface as fabricated state, never throw mid-cron.

Interval bounds are ISO-8601 instants (`z.string().datetime()`), unambiguous across timezones; the 4b editor converts operator-local dates using the org timezone at the edge.

### Decision D: write-path convention (documented for 4b; 4a ships capability only)

The live business-facts write is an org-scoped settings write: plain Fastify route under `apps/api/src/routes/marketplace.ts` (org from `request.organizationIdFromAuth`, deployment `:id` used only to anchor org ownership with 404 on mismatch, Zod `safeParse` → 400, store constructed inline per-request, dashboard reaches it through a Next proxy route with `requireSession`). It is NOT a PlatformIngress action: operational-state confirmations are settings writes, not revenue actions, and the spec's defer list keeps Riley advisory. 4b will add `recordConfirmation` behind this same convention. **4a adds no route and no caller**; the store class is exported but unconstructed by any app (grep-proven in Task 4).

### Layering note (why the row type lives in schemas)

`packages/ad-optimizer` is Layer 2 (schemas only; it cannot import db), and core is Layer 3. 4c's consumers receive confirmations via dependency injection at the app layer (same pattern as `stores.businessFactsStore` injection into the alex builder). Therefore `OperationalState` and `OperationalStateConfirmation` types must live in `@switchboard/schemas` (Layer 1, zod-only) so every future consumer can type its inputs without layer violations.

### Organization scoping: bare `organizationId`, no FK (by necessity, then by convention)

There is no `model Organization` in `packages/db/prisma/schema.prisma` at all (verified: zero matches for `^model Organization` except `OrganizationConfig`, and zero `Organization @relation` usages anywhere in the schema). Org identity lives in the auth layer, so an FK to an organizations table is structurally impossible, not merely unconventional. Every org-scoped model (`BusinessConfig`, `RecommendationOutcome`, `OrganizationConfig`, the consent and connection stores) carries a bare indexed `organizationId` string, with org scoping enforced at the store/route layer (`request.organizationIdFromAuth` keys every read and write). `OperationalStateConfirmation` follows the same rule. Orphaned-row hygiene is the same story as every other org-scoped table in this schema and is owned by whatever org-offboarding story the platform adopts; this slice does not invent a different lifecycle for one table.

### Eval gates and the alex-eval environmental blocker

- `pnpm eval:riley` (12+10+6) and `pnpm eval:governance` (26): baseline captured GREEN pre-change (`/tmp/baseline-eval-riley.txt`, `/tmp/baseline-eval-governance.txt`); re-run + diff post-change. No file under `evals/` or `packages/ad-optimizer` is touched, so byte-unchanged is also provable from the diff itself.
- `pnpm eval:alex-conversation` is **model-driven and currently cannot run**: the only available `ANTHROPIC_API_KEY` (root `.env`) authenticates but returns 400 "credit balance is too low" (verified 2026-06-04; matches the known broken-eval-key situation). Mitigation chain, in lieu of a before/after model run: (1) `BusinessFactsSchema`, the store, and the alex builder are byte-untouched (diff-proven), so Alex's prompt assembly cannot change; (2) the eval's own harness code under `evals/alex-conversation/` is byte-untouched; (3) core builder tests (385 files, includes alex builder + context-resolver suites) and the deterministic `eval:governance` stay green; (4) `pnpm build` + typecheck prove the eval still compiles against the rebuilt `@switchboard/schemas`/`@switchboard/db` dists. If the key gains credits before PR open, run the eval before and after as originally specified.

### Known pre-existing failures (not blockers, not ours)

`pnpm --filter @switchboard/db test` fails 9 tests across exactly 3 files at clean baseline `dc949b2e`: `prisma-work-trace-store-integrity`, `prisma-ledger-storage`, `prisma-greeting-signal-store`: the known local-PG shared-DB integrity trio. Gate = "no NEW failures beyond the trio". Chat `gateway-bridge-attribution` flakes under full-suite load; passes isolated.

---

## File structure

```
packages/schemas/src/operational-state.ts                                  (create ~110 lines)
packages/schemas/src/__tests__/operational-state.test.ts                   (create ~150 lines)
packages/schemas/src/__tests__/index-exports.test.ts                       (modify  +7 lines)
packages/schemas/src/index.ts                                              (modify  +3 lines)
packages/db/prisma/schema.prisma                                           (modify +40 lines, new model after ConfigVersion)
packages/db/prisma/migrations/20260604233000_operational_state_confirmation/migration.sql  (create, hand-written)
packages/db/src/stores/prisma-operational-state-store.ts                   (create ~175 lines)
packages/db/src/stores/__tests__/prisma-operational-state-store.test.ts    (create ~265 lines)
packages/db/src/index.ts                                                   (modify  +2 lines)
docs/superpowers/plans/2026-06-04-riley-v3-slice4a-operational-state.md    (this file; rides in the PR per slice 1/3 precedent: #867, #886)
```

All files well under the 600-line arch-check ceiling. ESM with `.js` relative imports. No `any` (one `as never` for mocked Prisma constructor injection and `as unknown as OperationalState` for invalid-input tests, both mirroring `prisma-business-facts-store.test.ts`).

---

## Task 0: Commit the approved plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-04-riley-v3-slice4a-operational-state.md` (this document)

- [ ] **Step 0.1: Verify branch context, then commit the plan doc**

```bash
git branch --show-current   # expect: worktree-riley-v3-slice-4a
git status --short          # expect: only this plan doc (do NOT stage .claude/settings.local.json)
git add docs/superpowers/plans/2026-06-04-riley-v3-slice4a-operational-state.md
git commit -m "docs(plans): riley v3 slice 4a operational-state confirmations plan"
```

Note: lint-staged may reformat the markdown on commit; if the commit fails with reformatted files, `git add` again and re-commit.

---

## Task 1: Operational-state schemas (`@switchboard/schemas`)

**Files:**

- Create: `packages/schemas/src/__tests__/operational-state.test.ts`
- Create: `packages/schemas/src/operational-state.ts`
- Modify: `packages/schemas/src/index.ts` (after the `export * from "./marketplace.js";` line)
- Modify: `packages/schemas/src/__tests__/index-exports.test.ts`

- [ ] **Step 1.1: Write the failing schema test**

Create `packages/schemas/src/__tests__/operational-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  OperationalIntervalSchema,
  OperationalStateConfirmationSchema,
  OperationalStateSchema,
} from "../operational-state.js";

describe("OperationalStateSchema", () => {
  it("accepts a full confirmation payload", () => {
    const parsed = OperationalStateSchema.parse({
      operatingStatus: "open",
      staffing: "shortfall",
      inventory: "normal",
      promoWindows: [
        {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-15T23:59:59.000Z",
          label: "june glow promo",
        },
      ],
      closures: [],
      note: "lead injector away second week of june",
    });
    expect(parsed.operatingStatus).toBe("open");
    expect(parsed.promoWindows).toHaveLength(1);
    // Explicit empty array = "operator confirmed none", distinct from absent.
    expect(parsed.closures).toEqual([]);
  });

  it("accepts a partial payload and leaves unconfirmed dimensions absent (no fabricated defaults)", () => {
    const parsed = OperationalStateSchema.parse({ staffing: "shortfall" });
    expect(parsed.staffing).toBe("shortfall");
    // Honesty floor: parsing must not invent "open"/"normal"/[] for dimensions
    // the operator never confirmed.
    expect(Object.prototype.hasOwnProperty.call(parsed, "operatingStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "inventory")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "promoWindows")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "closures")).toBe(false);
  });

  it("rejects an empty confirmation (confirming nothing is not a confirmation)", () => {
    expect(OperationalStateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a note-only payload (a note alone must not create freshness)", () => {
    expect(OperationalStateSchema.safeParse({ note: "all fine here" }).success).toBe(false);
  });

  it("accepts a note alongside an operational dimension", () => {
    const parsed = OperationalStateSchema.parse({ staffing: "normal", note: "back to full team" });
    expect(parsed.note).toBe("back to full team");
  });

  it("rejects inverted and zero-length intervals (end must be strictly after start)", () => {
    expect(
      OperationalStateSchema.safeParse({
        promoWindows: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
    expect(
      OperationalStateSchema.safeParse({
        closures: [{ start: "2026-06-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown enum values", () => {
    expect(OperationalStateSchema.safeParse({ operatingStatus: "closed" }).success).toBe(false);
    expect(OperationalStateSchema.safeParse({ staffing: "full" }).success).toBe(false);
    expect(OperationalStateSchema.safeParse({ inventory: "low" }).success).toBe(false);
  });

  it("rejects non-datetime interval bounds", () => {
    expect(OperationalStateSchema.safeParse({ promoWindows: [{ start: "june 1" }] }).success).toBe(
      false,
    );
  });

  it("accepts open-ended intervals (end omitted: until further notice)", () => {
    const parsed = OperationalStateSchema.parse({
      closures: [{ start: "2026-06-20T00:00:00.000Z", label: "renovation, reopen date unknown" }],
    });
    expect(parsed.closures?.[0]?.end).toBeUndefined();
  });

  it("rejects an interval without a start", () => {
    expect(OperationalIntervalSchema.safeParse({ end: "2026-06-15T00:00:00.000Z" }).success).toBe(
      false,
    );
  });
});

describe("OperationalStateConfirmationSchema", () => {
  it("round-trips a persisted confirmation row", () => {
    const parsed = OperationalStateConfirmationSchema.parse({
      id: "osc_1",
      organizationId: "org_1",
      state: { operatingStatus: "open" },
      confirmedBy: null,
      confirmedAt: new Date("2026-06-04T10:00:00.000Z"),
      createdAt: new Date("2026-06-04T10:00:00.000Z"),
    });
    expect(parsed.confirmedAt).toBeInstanceOf(Date);
    expect(parsed.confirmedBy).toBeNull();
  });

  it("coerces ISO-string timestamps (rows that crossed a JSON boundary)", () => {
    const parsed = OperationalStateConfirmationSchema.parse({
      id: "osc_1",
      organizationId: "org_1",
      state: { staffing: "normal" },
      confirmedBy: "user_1",
      confirmedAt: "2026-06-04T10:00:00.000Z",
      createdAt: "2026-06-04T10:00:00.000Z",
    });
    expect(parsed.confirmedAt.toISOString()).toBe("2026-06-04T10:00:00.000Z");
  });

  it("rejects a row whose state is empty", () => {
    const result = OperationalStateConfirmationSchema.safeParse({
      id: "osc_1",
      organizationId: "org_1",
      state: {},
      confirmedBy: null,
      confirmedAt: new Date(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run the test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/schemas test -- operational-state
```

Expected: FAIL with `Cannot find module '../operational-state.js'` (or equivalent resolve error).

- [ ] **Step 1.3: Write the schema module**

Create `packages/schemas/src/operational-state.ts`:

```ts
import { z } from "zod";

/**
 * Operational state of the business: time-anchored, operator-confirmed
 * conditions (Riley v3 slice 4a; spec 2026-06-03-riley-v3-control-plane
 * sections 2.1 net-new paragraph and 7.4).
 *
 * Deliberately a SIBLING of BusinessFactsSchema (marketplace.ts), not an
 * extension of it: BusinessFacts is durable identity written whole-blob by
 * the operator editor, while operational state is a stream of dated
 * confirmations whose freshness anchor must never move under unrelated
 * identity edits.
 *
 * HONESTY FLOOR: every dimension is optional and nothing carries a default.
 * An absent dimension means "the operator has not confirmed this", never
 * "open"/"normal". For the interval lists, undefined means unconfirmed while
 * an explicit empty array means "operator confirmed none". A free-text note
 * alone never counts as a confirmation (it would create a freshness anchor
 * with no machine-readable content); the same floor is mirrored by a
 * database CHECK constraint.
 */

/**
 * A bounded condition the operator knows explicit dates for (promo, closure).
 * Bounds are ISO-8601 instants; the operator-editor surface (4b) converts
 * operator-local dates using the org timezone at the edge. `end` is optional:
 * open-ended ("until further notice") conditions are real. When present,
 * `end` must be strictly after `start`: inverted and zero-length intervals
 * are rejected here so the slice-4c overlap check never has to guess what
 * they meant.
 */
export const OperationalIntervalSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime().optional(),
    label: z.string().min(1).optional(),
  })
  .refine(
    (interval) =>
      interval.end === undefined || Date.parse(interval.end) > Date.parse(interval.start),
    { message: "interval end must be strictly after start" },
  );

export type OperationalInterval = z.infer<typeof OperationalIntervalSchema>;

export const OPERATING_STATUS_VALUES = ["open", "temporarily_closed"] as const;
export const STAFFING_VALUES = ["normal", "shortfall"] as const;
export const INVENTORY_VALUES = ["normal", "outage"] as const;

export const OperationalStateSchema = z
  .object({
    operatingStatus: z.enum(OPERATING_STATUS_VALUES).optional(),
    staffing: z.enum(STAFFING_VALUES).optional(),
    inventory: z.enum(INVENTORY_VALUES).optional(),
    promoWindows: z.array(OperationalIntervalSchema).optional(),
    closures: z.array(OperationalIntervalSchema).optional(),
    note: z.string().min(1).optional(),
  })
  .refine(
    (state) =>
      state.operatingStatus !== undefined ||
      state.staffing !== undefined ||
      state.inventory !== undefined ||
      state.promoWindows !== undefined ||
      state.closures !== undefined,
    {
      message:
        "an operational-state confirmation must confirm at least one operational dimension (a note alone is not a confirmation)",
    },
  );

export type OperationalState = z.infer<typeof OperationalStateSchema>;

/**
 * A persisted operator confirmation. Append-only: rows are never updated, so
 * `confirmedAt` (the spec-7.4 freshness anchor: when the operator last
 * confirmed) is structurally immune to unrelated writes. A confirmation's
 * validity interval is DERIVED, not stored:
 * [confirmedAt_i, confirmedAt_of_next_row), open-ended for the latest row.
 * That derivation is what lets the slice-4c outcome path check overlap
 * against a PAST attribution window (windowStartedAt..windowEndedAt) instead
 * of "was edited recently".
 */
export const OperationalStateConfirmationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  state: OperationalStateSchema,
  confirmedBy: z.string().min(1).nullable(),
  confirmedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export type OperationalStateConfirmation = z.infer<typeof OperationalStateConfirmationSchema>;
```

Modify `packages/schemas/src/index.ts`: directly after the `export * from "./marketplace.js";` line, add:

```ts
// Operational state (operator-confirmed business conditions; Riley v3 slice 4a)
export * from "./operational-state.js";
```

Modify `packages/schemas/src/__tests__/index-exports.test.ts`: add inside the existing `describe`:

```ts
it("exports operational-state primitives (riley v3 slice 4a)", () => {
  expect(schemas.OperationalStateSchema).toBeDefined();
  expect(schemas.OperationalStateConfirmationSchema).toBeDefined();
  expect(schemas.OperationalIntervalSchema).toBeDefined();
});
```

- [ ] **Step 1.4: Run schemas tests + typecheck, verify green**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/schemas typecheck 2>/dev/null || pnpm typecheck
```

Expected: all schemas tests PASS (735 baseline + ~12 new), typecheck clean.

- [ ] **Step 1.5: Build schemas (so db sees the new exports), commit**

```bash
pnpm --filter @switchboard/schemas build
git add packages/schemas/src/operational-state.ts \
        packages/schemas/src/__tests__/operational-state.test.ts \
        packages/schemas/src/index.ts \
        packages/schemas/src/__tests__/index-exports.test.ts
git commit -m "feat(schemas): operational-state confirmation schemas (riley v3 slice 4a)"
```

---

## Task 2: Prisma model + hand-written migration + append-only store (`@switchboard/db`)

**Files:**

- Create: `packages/db/src/stores/__tests__/prisma-operational-state-store.test.ts`
- Modify: `packages/db/prisma/schema.prisma` (insert between the `ConfigVersion` model and the `// ── AI Agent System: Outcome Tracking ──` banner, ~line 591)
- Create: `packages/db/prisma/migrations/20260604233000_operational_state_confirmation/migration.sql`
- Create: `packages/db/src/stores/prisma-operational-state-store.ts`
- Modify: `packages/db/src/index.ts` (next to the business-facts store export block, ~line 113)

- [ ] **Step 2.1: Write the failing store test**

Create `packages/db/src/stores/__tests__/prisma-operational-state-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOperationalStateStore } from "../prisma-operational-state-store.js";
import type { OperationalState } from "@switchboard/schemas";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "osc_1",
    organizationId: "org_1",
    operatingStatus: "open",
    staffing: null,
    inventory: null,
    promoWindows: null,
    closures: null,
    note: null,
    confirmedBy: null,
    confirmedAt: new Date("2026-06-03T10:00:00.000Z"),
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    operationalStateConfirmation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("PrismaOperationalStateStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaOperationalStateStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaOperationalStateStore(prisma as never);
  });

  describe("recordConfirmation", () => {
    it("inserts a validated confirmation and omits unconfirmed dimensions entirely", async () => {
      const confirmedAt = new Date("2026-06-04T09:00:00.000Z");
      prisma.operationalStateConfirmation.create.mockResolvedValue(
        makeRow({
          id: "osc_9",
          operatingStatus: null,
          staffing: "shortfall",
          confirmedBy: "user_7",
          confirmedAt,
          createdAt: confirmedAt,
        }),
      );
      const state: OperationalState = { staffing: "shortfall" };
      const got = await store.recordConfirmation("org_1", state, {
        confirmedBy: "user_7",
        confirmedAt,
      });
      // Unconfirmed dimensions are ABSENT from the insert (columns default to
      // NULL = unconfirmed), never written as fabricated "open"/"normal".
      expect(prisma.operationalStateConfirmation.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          staffing: "shortfall",
          confirmedBy: "user_7",
          confirmedAt,
        },
      });
      expect(got.state).toEqual({ staffing: "shortfall" });
      expect(got.confirmedAt).toEqual(confirmedAt);
      expect(got.confirmedBy).toBe("user_7");
    });

    it("rejects an invalid state without touching the database", async () => {
      await expect(
        store.recordConfirmation(
          "org_1",
          { operatingStatus: "closed" } as unknown as OperationalState,
          { confirmedAt: new Date("2026-06-04T09:00:00.000Z") },
        ),
      ).rejects.toThrow();
      expect(prisma.operationalStateConfirmation.create).not.toHaveBeenCalled();
    });

    it("rejects an empty confirmation (no fabricated freshness from contentless rows)", async () => {
      await expect(
        store.recordConfirmation("org_1", {} as unknown as OperationalState, {
          confirmedAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ).rejects.toThrow();
      expect(prisma.operationalStateConfirmation.create).not.toHaveBeenCalled();
    });

    it("rejects a note-only confirmation (a note alone must not create freshness)", async () => {
      await expect(
        store.recordConfirmation("org_1", { note: "all quiet" } as unknown as OperationalState, {
          confirmedAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ).rejects.toThrow();
      expect(prisma.operationalStateConfirmation.create).not.toHaveBeenCalled();
    });
  });

  describe("getLatest", () => {
    it("returns null when the org has no confirmations (honest absence, not a default)", async () => {
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(null);
      expect(await store.getLatest("org_legacy")).toBeNull();
      // Tiebreak rule pinned: confirmedAt, then createdAt, then id. CUID
      // lexical order is not a semantic action order, so createdAt sits
      // before id; id only makes the ordering total.
      expect(prisma.operationalStateConfirmation.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org_legacy" },
        orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
    });

    it("reconstructs the typed state from a row, omitting NULL dimensions", async () => {
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({
          promoWindows: [{ start: "2026-06-01T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      );
      const got = await store.getLatest("org_1");
      expect(got?.state).toEqual({
        operatingStatus: "open",
        promoWindows: [{ start: "2026-06-01T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
      });
      expect(Object.prototype.hasOwnProperty.call(got?.state ?? {}, "staffing")).toBe(false);
    });

    it("degrades a malformed latest row to absence with a warning and does NOT fall back to an older row", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ operatingStatus: "permanently_closed" }),
      );
      expect(await store.getLatest("org_1")).toBeNull();
      expect(warn).toHaveBeenCalled();
      // Single query, honest null: falling back to an older valid row would
      // claim older knowledge as current and overstate freshness.
      expect(prisma.operationalStateConfirmation.findFirst).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe("getConfirmationsOverlappingWindow", () => {
    it("returns the governing confirmation plus in-window confirmations for a past window, oldest first", async () => {
      // The 4c contract: the outcome cron runs AFTER the attribution window
      // closes. The May 20 confirmation governs entry into the June 1-7
      // window (derived validity [May 20, June 3)); June 3 is a mid-window
      // regime change. Anything confirmed after windowEnd is excluded by the
      // query predicates pinned below.
      const windowStart = new Date("2026-06-01T00:00:00.000Z");
      const windowEnd = new Date("2026-06-07T23:59:59.000Z");
      const may20 = makeRow({
        id: "may20",
        confirmedAt: new Date("2026-05-20T08:00:00.000Z"),
        createdAt: new Date("2026-05-20T08:00:00.000Z"),
      });
      const june3 = makeRow({
        id: "june3",
        operatingStatus: null,
        promoWindows: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        confirmedAt: new Date("2026-06-03T09:00:00.000Z"),
        createdAt: new Date("2026-06-03T09:00:00.000Z"),
      });
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(may20);
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([june3]);

      const got = await store.getConfirmationsOverlappingWindow("org_1", windowStart, windowEnd);

      expect(prisma.operationalStateConfirmation.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org_1", confirmedAt: { lte: windowStart } },
        orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      expect(prisma.operationalStateConfirmation.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1", confirmedAt: { gt: windowStart, lte: windowEnd } },
        orderBy: [{ confirmedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      expect(got.map((c) => c.id)).toEqual(["may20", "june3"]);
    });

    it("keeps same-confirmedAt rows in (createdAt, id) order: the later row supersedes at that instant", async () => {
      const at = new Date("2026-06-03T09:00:00.000Z");
      const first = makeRow({
        id: "a",
        confirmedAt: at,
        createdAt: new Date("2026-06-03T09:00:00.100Z"),
      });
      const second = makeRow({
        id: "b",
        operatingStatus: "temporarily_closed",
        confirmedAt: at,
        createdAt: new Date("2026-06-03T09:00:00.200Z"),
      });
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(null);
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([first, second]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_1",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      // Consumers reading the stream in order land on "b" as the superseding
      // state at the shared instant; "a" has a zero-length derived validity
      // interval, which is acceptable and documented.
      expect(got.map((c) => c.id)).toEqual(["a", "b"]);
      expect(got[1]?.state).toEqual({ operatingStatus: "temporarily_closed" });
    });

    it("skips a malformed governing row but keeps valid in-window rows", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ id: "bad-governing", inventory: "plenty" }),
      );
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([
        makeRow({ id: "good-in-window", confirmedAt: new Date("2026-06-03T09:00:00.000Z") }),
      ]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_1",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      expect(got.map((c) => c.id)).toEqual(["good-in-window"]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("returns [] when nothing governs or falls inside the window (unknown, not stable)", async () => {
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(null);
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_legacy",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      expect(got).toEqual([]);
    });

    it("skips malformed rows instead of surfacing fabricated state", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.operationalStateConfirmation.findFirst.mockResolvedValue(
        makeRow({ inventory: "plenty" }),
      );
      prisma.operationalStateConfirmation.findMany.mockResolvedValue([]);
      const got = await store.getConfirmationsOverlappingWindow(
        "org_1",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-07T00:00:00.000Z"),
      );
      expect(got).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
```

- [ ] **Step 2.2: Run the store test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/db test -- prisma-operational-state-store
```

Expected: FAIL with `Cannot find module '../prisma-operational-state-store.js'`.

- [ ] **Step 2.3: Add the Prisma model and hand-write the migration**

In `packages/db/prisma/schema.prisma`, insert between the `ConfigVersion` model and the `// ── AI Agent System: Outcome Tracking ──` banner:

```prisma
// ── Operational State (Riley v3 slice 4a) ──

// Append-only operator confirmations of business operational state
// (open/closed, promo windows, staffing, inventory). A row is NEVER updated:
// every operator confirm INSERTs a new row, so confirmedAt (the spec-7.4
// freshness anchor) is structurally immune to unrelated writes. A
// confirmation's validity interval is DERIVED as
// [confirmedAt, next row's confirmedAt), with same-instant ties broken by
// createdAt then id (the later row supersedes; a zero-length prior interval
// is acceptable). That derivation is what lets the slice-4c outcome path
// check overlap against a PAST attribution window. Zero rows for an org =
// honest absence (unknown); no backfill ever fabricates confirmations for
// existing orgs. No FK to an organization: no Organization model exists in
// this schema; org scoping is enforced at the store/route layer like every
// other org-scoped table (BusinessConfig, RecommendationOutcome).
model OperationalStateConfirmation {
  id             String @id @default(cuid())
  organizationId String

  // Scalar dimensions: NULL = the operator did not confirm that dimension
  // (never a fabricated "open"/"normal"). Value sets are pinned by raw-SQL
  // CHECK constraints (Prisma cannot express CHECKs in-schema; same pattern
  // as 20260604200000_recommendation_outcome_enrichment). Keep in sync:
  // operatingStatus: "open" | "temporarily_closed"
  // staffing:        "normal" | "shortfall"
  // inventory:       "normal" | "outage"
  operatingStatus String?
  staffing        String?
  inventory       String?

  // Bounded conditions with operator-known dates, arrays of
  // { start, end?, label? } ISO instants validated by OperationalStateSchema
  // at the store boundary. NULL = unconfirmed; [] = operator confirmed none.
  promoWindows Json?
  closures     Json?

  // note is 4b display context only: it NEVER satisfies the nonempty-state
  // floor (see the nonempty_state CHECK), so a free-text note alone cannot
  // create a freshness anchor.
  note        String?
  confirmedBy String?
  // Required, no DB default, and a required store parameter: a writer must
  // supply the operator confirmation moment consciously; nothing fabricates
  // one.
  confirmedAt DateTime
  createdAt   DateTime @default(now())

  @@index([organizationId, confirmedAt])
}
```

Create `packages/db/prisma/migrations/20260604233000_operational_state_confirmation/migration.sql`:

```sql
-- Riley v3 slice 4a: append-only operator confirmations of operational state.
-- Rows are never updated; a confirmation's validity is derived as
-- [confirmedAt, next row's confirmedAt), with same-instant ties broken by
-- createdAt then id (the later row supersedes). No backfill: zero rows for an
-- org = honest absence (unknown). The 20260602140000_backfill_business_facts
-- migration is precedent for SHAPE only; fabricating freshness for existing
-- orgs would violate the slice honesty floor, so this migration creates
-- structure only and adds no data rows. CHECK constraints pin the enum value
-- sets AND the nonempty-state floor at the database layer (Prisma cannot
-- express CHECKs in-schema; same pattern as
-- 20260604200000_recommendation_outcome_enrichment).
CREATE TABLE "OperationalStateConfirmation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operatingStatus" TEXT,
    "staffing" TEXT,
    "inventory" TEXT,
    "promoWindows" JSONB,
    "closures" JSONB,
    "note" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalStateConfirmation_pkey" PRIMARY KEY ("id")
);

-- 59 chars, under the PostgreSQL 63-char identifier cap, and matches the
-- name Prisma derives for @@index([organizationId, confirmedAt]).
CREATE INDEX "OperationalStateConfirmation_organizationId_confirmedAt_idx"
    ON "OperationalStateConfirmation"("organizationId", "confirmedAt");

-- The nonempty_state floor deliberately EXCLUDES "note": a free-text note
-- alone must not create a freshness anchor. This mirrors the Zod refine so
-- the floor holds even against hand-written SQL, admin edits, or future bulk
-- tools that bypass the store.
ALTER TABLE "OperationalStateConfirmation"
  ADD CONSTRAINT "OperationalStateConfirmation_operatingStatus_check"
    CHECK ("operatingStatus" IS NULL OR "operatingStatus" IN ('open', 'temporarily_closed')),
  ADD CONSTRAINT "OperationalStateConfirmation_staffing_check"
    CHECK ("staffing" IS NULL OR "staffing" IN ('normal', 'shortfall')),
  ADD CONSTRAINT "OperationalStateConfirmation_inventory_check"
    CHECK ("inventory" IS NULL OR "inventory" IN ('normal', 'outage')),
  ADD CONSTRAINT "OperationalStateConfirmation_nonempty_state_check"
    CHECK (
      "operatingStatus" IS NOT NULL
      OR "staffing" IS NOT NULL
      OR "inventory" IS NOT NULL
      OR "promoWindows" IS NOT NULL
      OR "closures" IS NOT NULL
    );
```

Verify the index identifier length claim before committing:

```bash
echo -n 'OperationalStateConfirmation_organizationId_confirmedAt_idx' | wc -c   # expect 59 (cap is 63)
echo -n 'OperationalStateConfirmation_nonempty_state_check' | wc -c             # expect 50
```

Then regenerate the client so the `operationalStateConfirmation` delegate exists:

```bash
pnpm db:generate
```

- [ ] **Step 2.4: Implement the store**

Create `packages/db/src/stores/prisma-operational-state-store.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import {
  OperationalStateSchema,
  type OperationalState,
  type OperationalStateConfirmation,
} from "@switchboard/schemas";

/**
 * Append-only store for operator confirmations of business operational state
 * (Riley v3 slice 4a; spec sections 2.1 net-new paragraph and 7.4).
 *
 * Sibling of PrismaBusinessFactsStore, NOT an extension of it: BusinessConfig
 * holds durable identity facts written whole-blob by the operator editor, so
 * a freshness anchor stored there would move (or be erased) under unrelated
 * identity edits. Confirmations are INSERT-only; confirmedAt is written once
 * and never updated.
 *
 * Validity is derived, not stored: confirmation i is in force over
 * [confirmedAt_i, confirmedAt_of_next_row), open-ended for the latest row.
 * Same-instant ties are broken by createdAt then id: the later row
 * supersedes, the earlier row's derived interval is zero-length (acceptable),
 * and every read orders by the full (confirmedAt, createdAt, id) triple so
 * the rule is deterministic. getConfirmationsOverlappingWindow returns every
 * confirmation whose derived validity overlaps a (past) attribution window,
 * which is the substrate the slice-4c outcome path needs for
 * businessContextStable / businessContextFreshness. Staleness POLICY (how
 * old a confirmation may be and still vouch) is deliberately NOT encoded
 * here; that is 4c's call.
 *
 * This slice ships capability only: no app code constructs this store yet.
 * The 4b operator editor will call recordConfirmation through the existing
 * org-scoped settings write path (the marketplace business-facts route
 * conventions), never through PlatformIngress (a settings write, not a
 * revenue action).
 */

/** Row shape for OperationalStateConfirmation (matches schema.prisma). */
interface ConfirmationRow {
  id: string;
  organizationId: string;
  operatingStatus: string | null;
  staffing: string | null;
  inventory: string | null;
  promoWindows: unknown;
  closures: unknown;
  note: string | null;
  confirmedBy: string | null;
  confirmedAt: Date;
  createdAt: Date;
}

/**
 * Reassemble the typed state from columns, dropping NULLs (NULL = the
 * operator never confirmed that dimension). A row that fails validation
 * degrades to null with a warning: cron-adjacent read paths must never throw
 * and must never surface fabricated state.
 */
function rowToConfirmation(row: ConfirmationRow): OperationalStateConfirmation | null {
  const state: Record<string, unknown> = {};
  if (row.operatingStatus !== null) state.operatingStatus = row.operatingStatus;
  if (row.staffing !== null) state.staffing = row.staffing;
  if (row.inventory !== null) state.inventory = row.inventory;
  if (row.promoWindows !== null && row.promoWindows !== undefined) {
    state.promoWindows = row.promoWindows;
  }
  if (row.closures !== null && row.closures !== undefined) state.closures = row.closures;
  if (row.note !== null) state.note = row.note;

  const parsed = OperationalStateSchema.safeParse(state);
  if (!parsed.success) {
    console.warn("[OperationalState] malformed confirmation row skipped", {
      id: row.id,
      organizationId: row.organizationId,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    });
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    state: parsed.data,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaOperationalStateStore {
  constructor(private prisma: PrismaClient) {}

  /**
   * Record an operator confirmation (INSERT-only; never updates prior rows).
   * Unconfirmed dimensions are omitted from the insert so their columns stay
   * NULL (= unconfirmed), never a fabricated "open"/"normal". confirmedAt is
   * REQUIRED: the caller supplies the operator confirmation moment
   * consciously; neither the store nor the database fabricates one. 4a ships
   * NO caller: only an explicit operator confirmation (the 4b editor) may
   * create rows.
   */
  async recordConfirmation(
    organizationId: string,
    state: OperationalState,
    opts: { confirmedAt: Date; confirmedBy?: string },
  ): Promise<OperationalStateConfirmation> {
    const parsed = OperationalStateSchema.parse(state);
    const row = await this.prisma.operationalStateConfirmation.create({
      data: {
        organizationId,
        ...(parsed.operatingStatus !== undefined
          ? { operatingStatus: parsed.operatingStatus }
          : {}),
        ...(parsed.staffing !== undefined ? { staffing: parsed.staffing } : {}),
        ...(parsed.inventory !== undefined ? { inventory: parsed.inventory } : {}),
        ...(parsed.promoWindows !== undefined ? { promoWindows: parsed.promoWindows } : {}),
        ...(parsed.closures !== undefined ? { closures: parsed.closures } : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
        ...(opts.confirmedBy !== undefined ? { confirmedBy: opts.confirmedBy } : {}),
        confirmedAt: opts.confirmedAt,
      },
    });
    const confirmation = rowToConfirmation(row);
    if (!confirmation) {
      // Unreachable when the write path validated above; guard regardless so
      // a future schema/column divergence fails loudly at the write, not
      // silently at a 4c read.
      throw new Error("operational-state confirmation failed round-trip validation");
    }
    return confirmation;
  }

  /**
   * Latest confirmation for an org, or null when none exists (honest
   * absence). A malformed latest row degrades to null rather than falling
   * back to an older row: claiming older knowledge as current would
   * overstate freshness.
   */
  async getLatest(organizationId: string): Promise<OperationalStateConfirmation | null> {
    const row = await this.prisma.operationalStateConfirmation.findFirst({
      where: { organizationId },
      orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return row ? rowToConfirmation(row) : null;
  }

  /**
   * Every confirmation whose DERIVED validity interval overlaps the (past)
   * attribution window [windowStart, windowEnd], oldest first. Concretely:
   * the latest confirmation at-or-before windowStart (the state regime in
   * force as the window opened) plus every confirmation inside
   * (windowStart, windowEnd]. Empty array = the org's operational context
   * over that window is unknown (honest absence; legacy orgs have zero rows
   * by construction).
   *
   * Slice 4c builds businessContextStable on top of this set: it can detect
   * disruptive states governing the window, detect mid-window regime changes
   * (a promo starting mid-window breaks pre/post comparability), and apply
   * its own staleness policy using each confirmation's confirmedAt.
   */
  async getConfirmationsOverlappingWindow(
    organizationId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<OperationalStateConfirmation[]> {
    const [governing, inWindow] = await Promise.all([
      this.prisma.operationalStateConfirmation.findFirst({
        where: { organizationId, confirmedAt: { lte: windowStart } },
        orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.operationalStateConfirmation.findMany({
        where: { organizationId, confirmedAt: { gt: windowStart, lte: windowEnd } },
        orderBy: [{ confirmedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const rows = [...(governing ? [governing] : []), ...inWindow];
    return rows
      .map((row) => rowToConfirmation(row))
      .filter((c): c is OperationalStateConfirmation => c !== null);
  }
}
```

Modify `packages/db/src/index.ts`: next to the business-facts store export block (~line 113), add:

```ts
export { PrismaOperationalStateStore } from "./stores/prisma-operational-state-store.js";
```

Do NOT add it to any client-safe surface (`dashboard-client-surface` exports); this store is server-side only.

**Drift gate for the mocked-test blind spot:** the store must compile against the GENERATED Prisma client with zero casts. The constructor takes the real `PrismaClient`; `rowToConfirmation` receives the generated row type by structural assignability (its `promoWindows`/`closures` are typed `unknown` in `ConfirmationRow`, which the generated `JsonValue` satisfies); there is no `as any`/`as never` anywhere in the store source (the only `as never` lives in tests for mock injection). `pnpm db:generate` followed by `pnpm typecheck` therefore catches delegate-name and column-name drift that mocked tests cannot; `pnpm db:check-drift` + local `migrate deploy` catch model-vs-migration drift on the real engine.

- [ ] **Step 2.5: Run the store tests, verify green**

```bash
pnpm --filter @switchboard/db test -- prisma-operational-state-store
```

Expected: PASS (all ~11 new tests).

- [ ] **Step 2.6: Drift check + apply the migration locally**

```bash
pnpm db:check-drift
```

Expected: exit 0, "no drift" (the CHECK constraints are drift-invisible by precedent; the shadow-database replay proves the hand-written SQL reproduces the model).

```bash
cd packages/db
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
cd ../..
```

Expected: `1 migration applied: 20260604233000_operational_state_confirmation`. (Do NOT use `pnpm db:migrate`; it runs `prisma migrate dev`, which needs a TTY. Do NOT `source .env`; the URL contains `&`.)

- [ ] **Step 2.7: Full db + schemas + core test pass, typecheck**

```bash
pnpm --filter @switchboard/db build
pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/db test; pnpm --filter @switchboard/core test
pnpm typecheck
```

Expected: schemas + core green; db green except the pre-existing PG trio (work-trace/ledger/greeting, 9 tests); typecheck clean. Gate = no NEW db failures.

- [ ] **Step 2.8: Commit (model + migration + store + tests, one commit per doctrine)**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/20260604233000_operational_state_confirmation/migration.sql \
        packages/db/src/stores/prisma-operational-state-store.ts \
        packages/db/src/stores/__tests__/prisma-operational-state-store.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): append-only operational-state confirmation store + migration (riley v3 slice 4a)"
```

---

## Task 3: Full verification sweep (consumer sweep, scope-fence proofs, eval gates)

**Files:**

- Modify: `docs/superpowers/plans/2026-06-04-riley-v3-slice4a-operational-state.md` (tick checkboxes, record evidence below)

- [ ] **Step 3.1: Full build + typecheck from clean state**

```bash
pnpm build && pnpm typecheck
```

Expected: all tasks green.

- [ ] **Step 3.2: Full test sweep (schemas, db, core, api as insurance)**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
```

Expected: green everywhere except the known db PG trio. The api run is insurance per the store-tightening lesson (no api test knows this store yet, but the suite must stay green against rebuilt schemas/db dists).

- [ ] **Step 3.3: Eval gates, byte-comparison against baseline**

```bash
pnpm eval:riley > /tmp/post-eval-riley.txt 2>&1; echo "exit: $?"
pnpm eval:governance > /tmp/post-eval-governance.txt 2>&1; echo "exit: $?"
diff /tmp/baseline-eval-riley.txt /tmp/post-eval-riley.txt && echo "riley BYTE-UNCHANGED"
diff /tmp/baseline-eval-governance.txt /tmp/post-eval-governance.txt && echo "governance BYTE-UNCHANGED"
```

Expected: both exit 0, both diffs empty (12+10+6 and 26 cases). Then attempt the alex eval; if the key is still credit-blocked, record the mitigation chain instead:

```bash
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2-) pnpm eval:alex-conversation > /tmp/post-eval-alex.txt 2>&1; echo "exit: $?"; tail -5 /tmp/post-eval-alex.txt
```

- [ ] **Step 3.4: Scope-fence grep proofs (record output in the PR body)**

```bash
git fetch origin main
# 1. The complete diff surface: must list ONLY the files in "File structure":
git diff --stat origin/main...HEAD
# 2. No diff under the fenced trees:
git diff origin/main...HEAD -- packages/ad-optimizer packages/core apps evals | head -5   # expect empty
# 3. The live substrate and the trap schema are byte-untouched:
git diff origin/main...HEAD -- packages/schemas/src/marketplace.ts packages/schemas/src/playbook.ts packages/db/src/stores/prisma-business-facts-store.ts | head -5   # expect empty
# 4. No PlatformIngress caller anywhere in the diff:
git diff origin/main...HEAD | grep -i "platformingress"   # expect no matches (exit 1)
# 5. The migration fabricates nothing (strip SQL comment lines first so prose
#    in comments cannot mask or fake a match):
grep -v '^--' packages/db/prisma/migrations/20260604233000_operational_state_confirmation/migration.sql | grep -iE "INSERT|UPDATE"   # expect no matches (exit 1)
# 6. No app constructs the store yet (capability only):
grep -rn "PrismaOperationalStateStore" apps/ packages/core packages/ad-optimizer --include="*.ts" --include="*.tsx" | grep -v node_modules   # expect no matches
```

- [ ] **Step 3.5: Lint, format, arch-check (separate CI jobs; local lint covers neither)**

```bash
pnpm lint
pnpm format:check
pnpm arch:check
```

Expected: all green.

- [ ] **Step 3.6: Commit the evidence (ticked checkboxes + recorded outputs)**

```bash
git add docs/superpowers/plans/2026-06-04-riley-v3-slice4a-operational-state.md
git commit -m "docs(plans): record slice-4a verification evidence"
```

---

## Task 4: Code review

- [ ] **Step 4.1:** Invoke `superpowers:requesting-code-review` against the branch diff (`git diff origin/main...HEAD`). Review focus: honesty floors (no fabricated defaults anywhere, legacy rows honest-absent), the 4c contract (window query semantics), migration/schema drift, layer rules (schemas module imports zod only), scope fence.
- [ ] **Step 4.2:** Address findings or push back with reasoning (receiving-code-review discipline). Re-run Task 3 gates after any change.

## Task 5: Land the PR

- [ ] **Step 5.1:** `git fetch origin main` and rebase onto live `origin/main`; re-run `pnpm build && pnpm typecheck` and the Task 3 test sweep after any rebase with conflicts or upstream schema/migration movement (new migrations on main = re-run db:check-drift; timestamp must stay ordered after the latest on main, rename the migration dir if main gained a later one).
- [ ] **Step 5.2:** Push branch `riley-v3-slice-4a-operational-state`; open ONE focused PR to main titled `feat(schemas,db): riley v3 slice 4a operational-state confirmations (append-only + window reads)`. Body: decisions A-D summary, honesty-floor proofs, scope-fence grep outputs, eval-gate results incl. the alex-eval environmental blocker + mitigation chain, "4b operator editor / 4c consumption are follow-on slices".
- [ ] **Step 5.3:** Enable auto-merge (squash). Watch required checks. Known noise: chat gateway-bridge-attribution flake (rerun), api-auth prod-hardening flake (rerun), Eval Claim Classifier 401 on main pushes is informational.
- [ ] **Step 5.4:** After merge: verify the first NON-CANCELLED completed main CI run whose tree contains the squash commit (merge-train cancel-supersession).

## Task 6: Teardown + memory + report

- [ ] **Step 6.1:** Same-day teardown: `git worktree remove <path> && git worktree prune`; delete branch local + remote.
- [ ] **Step 6.2:** Update memory: 4a shipped (sibling schema + append-only confirmations decision), 4b operator editor next, 4c flips the unknowns and unlocks `corroborated`.
- [ ] **Step 6.3:** Final report to the user.

---

## Self-review (spec coverage)

- Spec 2.1 net-new paragraph: targets the ACTIVE `BusinessFactsSchema` substrate's store family, not `PlaybookBusinessFactsSchema` → Decision A targets the live family as a sibling; trap file byte-untouched (Task 3.4 proof 3).
- Spec 7.4 freshness = staleness of the input itself → `confirmedAt` set only at explicit confirmation, append-only, no DB default, no `updatedAt` reuse (Decisions B/C).
- Spec 7.4 / plan 4c: validity interval must overlap the FULL past attribution window → derived-validity shape + `getConfirmationsOverlappingWindow` returns governing + in-window confirmations; pinned by the May-20/June-3 store test (Task 2.1).
- Spec 4 item 6: `businessContextFreshness` not a free aggregation; RevenueState carries `unknown` until 4c → reserved consumers byte-untouched (Task 3.4 proofs 2).
- Plan Slice 4a literal scope (schema, store, migration same commit, `pnpm db:check-drift`, shape + round-trip tests) → Tasks 1-2.
- Spec 2.5: `corroborated` stays reserved; nothing here emits it → no core/ad-optimizer diff.
- Honesty floors → schema test "no fabricated defaults", store tests "honest absence"/"contentless rejected"/"note-only rejected"/"malformed degrades", DB nonempty-state CHECK (note excluded), migration data-statement grep (comments stripped).
- Review hardening (2026-06-04 plan review): same-instant tie rule defined (`confirmedAt`, `createdAt`, `id`) and test-pinned; DB-level nonempty CHECK added; note-only confirmations rejected at Zod AND DB; interval `end > start` refine + tests; FK decision documented (no Organization model exists; bare `organizationId` is the repo-wide convention); `confirmedAt` made a required store parameter; malformed-row asymmetry pinned (governing-malformed keeps valid in-window rows; latest-malformed does not fall back, single-query pinned); identifier lengths verified by `wc -c` at execution.
- Placeholder scan: no TBDs; all code complete. Type consistency: `getConfirmationsOverlappingWindow`, `recordConfirmation`, `getLatest` used identically in store, tests, and prose; `OperationalState`/`OperationalStateConfirmation` names consistent across schemas/db.

## Verification evidence (filled during Task 3)

_To be recorded at execution time._
