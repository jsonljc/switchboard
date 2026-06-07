# Riley v3 Slice 4e: Late-Interval Retroactive Stability Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirmations recorded AFTER an attribution window closed contribute their operator-dated promo/closure intervals to the `businessContextStable` derivation as disruption-only evidence, so insert-once outcome rows are judged against all operator facts existing at attribution time.

**Architecture:** A core-only diff. `operational-stability.ts` gains a third internal bucket (late: `confirmedAt > windowEndedAt`) processed by a geometry-only pass that shares one `declaredIntervalsDisrupt` helper with the existing governing/in-window walk; `outcome-attribution.ts` widens the existing reader call's end bound from `postEnd` to the clamped attribution moment. Zero diffs in db (the 4a store is span-parametric already), apps/api (the reader flows through unchanged), ad-optimizer, schemas, and all UI. Zero migrations, zero new env vars, no new enum values.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/core` (Layer 3); Vitest; `pnpm eval:riley` (12+10+6) + `pnpm eval:governance` (26) byte-unchanged gates.

**Consumes:** spec `docs/superpowers/specs/2026-06-07-riley-v3-slice4e-late-interval-stability-design.md` (Decisions A-F; committed on this branch); the 4c plan's Decision B (the recorded 4e deferral); slices 4a (#895), 4c (#915), 4d (#939), 4f (#946) as shipped at `4de03843`.

**Scope fence (4e only):** the two core source files + two new co-located test files + ONE updated call-args pin in the existing orchestrator test + spec + this plan. NO db diff, NO apps/api diff, NO ad-optimizer/schemas/dashboard/chat diff, NO migration, NO new env var or flag, NO summary counter, NO new enum value, NO scalar retroactive inference, NO re-derivation of existing rows. Read-side derivation only: no new mutating surface (`check-routes` baseline stays clean).

---

## Settled design decisions (from the spec, abbreviated)

- **A. Disruption-only asymmetry, structural:** late rows only feed a geometry pass that can set `disrupted = true`; certification reads the governing row exclusively; verdict is monotone toward `"unstable"`. Late evidence flips `unknown -> unstable` and `stable -> unstable`, never anything else.
- **B. Intervals only:** late scalars are never read (validity `[confirmedAt_i, confirmedAt_{i+1})` has zero window overlap; backward reach from an undated scalar is the forbidden inference); the `overlappingSubsetKey` declaration-change detector never runs over late rows.
- **C. Same geometry, one helper:** closure overlap disrupts (no covers-exemption); promo overlap-without-covering disrupts; a late COVERING promo differences out (recorded divergence from the in-window declaration-change case); unparseable bounds disrupt (fail-safe); late declarations are a union (a later late `[]` does not retract).
- **D. Late horizon unbounded to the attribution moment:** dated facts do not expire; rows are insert-once so the attribution moment is the natural bound; volume is operator-paced; any cutoff would silently drop admissible facts for catch-up candidates.
- **E. Read shape = widen the CALL, not the contract:** the orchestrator passes `now` (clamped: `now > postEnd ? now : postEnd`) as the existing span-parametric method's end bound. Zero store/interface diff; the db WHERE pins are untouched.
- **F. Boundary:** late bucket is strictly `confirmedAt > windowEndedAt`; a row AT `windowEndedAt` stays an in-window row (shipped 4c bucketing). Interval geometry is byte-unchanged half-open.

## Known environment gotchas (all hit in recent sessions)

- This worktree was initialized with `pnpm install` + full `pnpm build` already (worktree-init reported "DB not reachable" and skipped them; they were run manually). If typecheck reports missing `@switchboard/*` exports, run `pnpm build` again (NOT just `pnpm reset`, which skips ad-optimizer/creative-pipeline).
- eslint `max-lines` (600, skipBlankLines+skipComments) applies to TEST files; `__tests__/outcome-attribution.test.ts` is at the ceiling (623 raw lines). New tests go in the two NEW files; the one edit to the existing file is line-neutral.
- `arch-check` counts RAW .ts lines (error > 600) and skips tests; `operational-stability.ts` lands ~315 raw lines. Run `pnpm arch:check` before push.
- lint-staged reformats on commit: if a commit reports modified files, `git add` again and re-commit. commitlint: lowercase subject, header <= 100 chars.
- db tests use mocked Prisma (CI has no Postgres). The local-PG trio (work-trace/ledger/greeting) may fail locally without Postgres; gate = no NEW failures.
- Evals: `pnpm eval:riley` and `pnpm eval:governance` from the repo root; byte-diff against baselines captured in Task 1.

## File structure

```
docs/superpowers/specs/2026-06-07-riley-v3-slice4e-late-interval-stability-design.md   (committed)
docs/superpowers/plans/2026-06-07-riley-v3-slice4e-late-interval-stability.md          (this file)
packages/core/src/recommendations/operational-stability.ts                              (modify: +~70 lines -> ~315)
packages/core/src/recommendations/outcome-attribution.ts                                (modify: +~14 lines -> ~400)
packages/core/src/recommendations/__tests__/operational-stability-late-interval.test.ts (create ~300 lines)
packages/core/src/recommendations/__tests__/outcome-attribution-late-interval.test.ts   (create ~230 lines)
packages/core/src/recommendations/__tests__/outcome-attribution.test.ts                 (modify: ONE pin, line-neutral)
```

---

## Task 0: Commit the approved plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-07-riley-v3-slice4e-late-interval-stability.md` (this document)

- [ ] **Step 0.1: Verify branch context, then commit the plan doc**

```bash
git branch --show-current   # expect: feat/riley-4e-late-interval-stability
git status --short          # expect: only this plan doc
git add docs/superpowers/plans/2026-06-07-riley-v3-slice4e-late-interval-stability.md
git commit -m "docs(plans): riley v3 slice 4e late-interval retroactive stability read plan"
```

---

## Task 1: Baselines (evals + core suite, captured at the clean branch state)

- [ ] **Step 1.1: Capture eval baselines (BEFORE any code change)**

```bash
mkdir -p /tmp/slice4e-baselines
pnpm eval:riley > /tmp/slice4e-baselines/eval-riley-baseline.txt 2>&1; echo "riley exit: $?"
pnpm eval:governance > /tmp/slice4e-baselines/eval-governance-baseline.txt 2>&1; echo "governance exit: $?"
```

Expected: both exit 0 (12+10+6 riley cases, 26 governance cases green).

- [ ] **Step 1.2: Verify the core suite is green at baseline**

```bash
pnpm --filter @switchboard/core test 2>&1 | tail -5
```

Expected: PASS, zero failures.

---

## Task 2: The late-interval derivation pass (`operational-stability.ts`, pure, TDD)

**Files:**

- Create: `packages/core/src/recommendations/__tests__/operational-stability-late-interval.test.ts`
- Modify: `packages/core/src/recommendations/operational-stability.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `packages/core/src/recommendations/__tests__/operational-stability-late-interval.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { deriveBusinessContextStability } from "../operational-stability.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

// Same window as the shipped 4c matrix: [June 1 .. June 15), a 14-day full
// attribution window. A LATE row is a confirmation with confirmedAt strictly
// after WINDOW_END; attribution runs >= 24h after windowEnd (settlement
// lag), so late rows exist for every live candidate.
const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-06-15T00:00:00.000Z");

/** Operator confirmed every dimension non-disruptive ([] = "confirmed none"). */
const FULL_NORMAL: OperationalState = {
  operatingStatus: "open",
  staffing: "normal",
  inventory: "normal",
  promoWindows: [],
  closures: [],
};

let seq = 0;
function confirm(confirmedAt: string, state: OperationalState): OperationalStateConfirmation {
  seq += 1;
  return {
    id: `osc_late_${seq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

function derive(confirmations: OperationalStateConfirmation[]) {
  return deriveBusinessContextStability({
    confirmations,
    windowStartedAt: WINDOW_START,
    windowEndedAt: WINDOW_END,
  });
}

/** Fresh, complete, non-disruptive governing row: certifies stable alone. */
function governingStable(): OperationalStateConfirmation {
  return confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL);
}

describe("late-interval admission: disruption-only asymmetry (slice 4e)", () => {
  it("flips a certified-stable window to unstable on a late closure overlapping it", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flips a certified-stable window to unstable on a late promo partially overlapping it", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flips an ungoverned (unknown) window to unstable on a late overlapping closure", () => {
    expect(
      derive([
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flips a stale-governed (unknown) window to unstable on a late partial promo", () => {
    expect(
      derive([
        confirm("2026-04-01T09:00:00.000Z", FULL_NORMAL), // stale at window entry
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("never certifies from late evidence: a late full-normal confirmation on an ungoverned window stays unknown", () => {
    expect(derive([confirm("2026-06-16T09:00:00.000Z", FULL_NORMAL)])).toBe("unknown");
  });

  it("never restores freshness from late evidence: a late full-normal confirmation cannot rescue a stale governing row", () => {
    expect(
      derive([
        confirm("2026-04-01T09:00:00.000Z", FULL_NORMAL), // stale governing
        confirm("2026-06-16T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unknown");
  });

  it("is monotone: late benign rows cannot flip an in-window-disrupted window away from unstable", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
        confirm("2026-06-16T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unstable");
  });
});

describe("late-interval admission: intervals only, never scalar inference", () => {
  it("ignores a late scalar-only staffing shortfall: stable stays stable", () => {
    expect(
      derive([governingStable(), confirm("2026-06-16T09:00:00.000Z", { staffing: "shortfall" })]),
    ).toBe("stable");
  });

  it("ignores a late scalar-only temporarily_closed with no dated closure interval (only dated facts reach back)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", { operatingStatus: "temporarily_closed" }),
      ]),
    ).toBe("stable");
  });

  it("does not treat a late scalar flip against the governing value as a transition", () => {
    expect(
      derive([
        governingStable(), // staffing: "normal"
        confirm("2026-06-16T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("stable");
  });

  it("leaves an ungoverned window unknown under late scalar-only rows", () => {
    expect(derive([confirm("2026-06-16T09:00:00.000Z", { inventory: "outage" })])).toBe("unknown");
  });

  it("does not run the declaration-change detector over late rows: a late COVERING promo against a governing [] stays stable", () => {
    // The same dated content declared by an IN-WINDOW row trips the
    // overlappingSubsetKey change detector (pinned in the 4c matrix);
    // arriving late it is geometry-only, and a promo covering the entire
    // window is constant background that differences out.
    expect(
      derive([
        governingStable(), // promoWindows: []
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("still disrupts on a late PARTIAL promo against a governing [] (geometry, not change-detection)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-12T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });
});

describe("late-interval admission: boundary doctrine", () => {
  it("ignores a late closure starting exactly at windowEnd (half-open window; that instant is never measured)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("ignores a late closure ending exactly at windowStart (half-open interval excludes its own end)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-05-20T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("disrupts on a late closure ending exactly at windowEnd (covers measured instants)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "2026-06-10T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("treats a late covering promo ending exactly at windowEnd as covering (stable)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("keeps a confirmation AT windowEnd an in-window row (scalar transition applies; shipped 4c bucketing)", () => {
    expect(
      derive([
        governingStable(), // staffing: "normal"
        confirm("2026-06-15T00:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("unstable");
  });

  it("treats the same scalar flip 1ms after windowEnd as a late row (no transition inference)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-15T00:00:00.001Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("stable");
  });
});

describe("late-interval admission: union, fail-safe, inertness, order", () => {
  it("does not retract: a later late [] re-confirm cannot erase a previously late-declared overlapping promo", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-10T00:00:00.000Z" }],
        }),
        confirm("2026-06-17T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unstable");
  });

  it("fails toward unstable on a late interval with unparseable bounds (direct-caller guard)", () => {
    expect(
      derive([
        governingStable(),
        confirm("2026-06-16T09:00:00.000Z", {
          closures: [{ start: "not-a-date", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("keeps benign late rows inert across all three base verdicts", () => {
    const benignLate = () =>
      confirm("2026-06-16T09:00:00.000Z", {
        staffing: "shortfall", // scalar: never read on late rows
        promoWindows: [{ start: "2026-06-20T00:00:00.000Z", end: "2026-06-25T00:00:00.000Z" }],
        closures: [{ start: "2026-05-01T00:00:00.000Z", end: "2026-05-10T00:00:00.000Z" }],
      });
    expect(derive([governingStable(), benignLate()])).toBe("stable");
    expect(derive([benignLate()])).toBe("unknown");
    expect(
      derive([
        governingStable(),
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, inventory: "outage" }),
        benignLate(),
      ]),
    ).toBe("unstable");
  });

  it("derives the same verdict from a shuffled set including late rows (defensive sort)", () => {
    const governing = governingStable();
    const inWindow = confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL);
    const late = confirm("2026-06-16T09:00:00.000Z", {
      closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
    });
    expect(derive([late, inWindow, governing])).toBe("unstable");
    expect(derive([governing, late, inWindow])).toBe("unstable");
  });
});
```

- [ ] **Step 2.2: Run, verify the new tests fail (late rows are silently dropped today)**

```bash
pnpm --filter @switchboard/core test -- operational-stability-late-interval
```

Expected: FAIL. Every disruption-asymmetry/boundary-disrupt/union/fail-safe test asserting `"unstable"` from a late row gets `"stable"` or `"unknown"` (late rows fall in neither shipped bucket). The intervals-only and inertness tests may already pass (they pin today's ignore-behavior); that is correct and they stay as regression pins.

- [ ] **Step 2.3: Implement the late pass**

In `packages/core/src/recommendations/operational-stability.ts`, make five edits:

(1) In the module header doc comment, directly after the sentence ending `* pre/post span.` (the end of the input-contract paragraph, ~line 24), add:

```ts
 *
 * Since slice 4e the input may ALSO contain confirmations recorded after
 * windowEndedAt (the orchestrator widens the read's end bound to the
 * attribution moment). Such late rows are bucketed out internally and admit
 * DISRUPTION-ONLY evidence through their dated promo/closure intervals:
 * geometry alone, never scalars, never the declaration-change detector,
 * never certification. The asymmetry is structural, not policed:
 * certification reads only the governing row, and a late row can never
 * govern (governing requires confirmedAt <= windowStartedAt).
```

(2) Replace the input-field doc:

```ts
  /** Confirmations overlapping the window (governing + in-window, oldest first). */
  confirmations: OperationalStateConfirmation[];
```

with:

```ts
  /**
   * Confirmations overlapping the window (governing + in-window, oldest
   * first) plus, since slice 4e, any rows recorded after windowEndedAt that
   * exist at attribution time (the widened orchestrator read). Bucketing is
   * internal; late rows contribute dated-interval disruption evidence only.
   */
  confirmations: OperationalStateConfirmation[];
```

(3) Directly after the `overlappingSubsetKey` function, add the shared helper:

```ts
/**
 * Interval-geometry disruption rules, shared verbatim by the
 * governing/in-window walk and the slice-4e late pass so the two can never
 * drift:
 * - a closure interval overlapping the window disrupts (the closure
 *   carve-out has no covers-exemption: a closed business transacts nothing,
 *   so constancy does not rescue it);
 * - a promo interval overlapping but NOT covering the window disrupts
 *   (partial overlap breaks pre/post comparability), while a promo covering
 *   the ENTIRE window is constant background that differences out;
 * - an interval with unparseable bounds disrupts (fail-safe toward
 *   "unstable", never toward fabricated stability; see hasParseableBounds).
 */
function declaredIntervalsDisrupt(state: OperationalState, wsMs: number, weMs: number): boolean {
  for (const closure of state.closures ?? []) {
    if (!hasParseableBounds(closure) || overlapsWindow(closure, wsMs, weMs)) return true;
  }
  for (const promo of state.promoWindows ?? []) {
    if (
      !hasParseableBounds(promo) ||
      (overlapsWindow(promo, wsMs, weMs) && !coversWindow(promo, wsMs, weMs))
    ) {
      return true;
    }
  }
  return false;
}
```

(4) Add the late bucket. Replace:

```ts
const inWindow = sorted.filter((c) => {
  const t = c.confirmedAt.getTime();
  return t > wsMs && t <= weMs;
});
const ordered = [...(governing ? [governing] : []), ...inWindow];
```

with:

```ts
const inWindow = sorted.filter((c) => {
  const t = c.confirmedAt.getTime();
  return t > wsMs && t <= weMs;
});
// Slice 4e: rows recorded after the window closed, STRICTLY after
// windowEndedAt (a row AT windowEndedAt is an in-window row, the shipped
// 4c bucketing; the buckets partition with no gap and no double-count).
// Processed by the late pass below only: never walked, never governing.
const late = sorted.filter((c) => c.confirmedAt.getTime() > weMs);
const ordered = [...(governing ? [governing] : []), ...inWindow];
```

(5) Replace the first walk's rules 1-2 with the scalar leg + shared helper:

```ts
for (const c of ordered) {
  // 1. Closure carve-out. Every row in the walked set has derived validity
  //    overlapping the window (governing row or in-window row), so any
  //    temporarily_closed declaration was in force over part of it; a
  //    closure interval is checked against its own operator-declared
  //    bounds (it may lie entirely outside the window).
  if (c.state.operatingStatus === "temporarily_closed") disrupted = true;
  for (const closure of c.state.closures ?? []) {
    if (!hasParseableBounds(closure) || overlapsWindow(closure, wsMs, weMs)) disrupted = true;
  }
  // 2. Promo comparability: overlapping the window is fine ONLY when the
  //    promo covers the ENTIRE window (running throughout pre and post);
  //    starting or ending inside it breaks the delta.
  for (const promo of c.state.promoWindows ?? []) {
    if (
      !hasParseableBounds(promo) ||
      (overlapsWindow(promo, wsMs, weMs) && !coversWindow(promo, wsMs, weMs))
    ) {
      disrupted = true;
    }
  }
}
```

with:

```ts
for (const c of ordered) {
  // 1. Closure carve-out, scalar leg. Every row in the walked set has
  //    derived validity overlapping the window (governing row or in-window
  //    row), so any temporarily_closed declaration was in force over part
  //    of it.
  if (c.state.operatingStatus === "temporarily_closed") disrupted = true;
  // 2. Declared-interval geometry (closure overlap always disrupts; a
  //    promo disrupts unless it covers the ENTIRE window), shared verbatim
  //    with the slice-4e late pass below so the two can never drift.
  if (declaredIntervalsDisrupt(c.state, wsMs, weMs)) disrupted = true;
}
```

(6) Directly after the closing brace of the second walk (the `// 3. Mid-window regime changes` loop) and BEFORE `if (disrupted) return "unstable";`, add the late pass, and renumber the certification comment from `// 4.` to `// 5.`:

```ts
// 4. Late-interval retroactive evidence (slice 4e). A confirmation
//    recorded AFTER windowEnd has zero validity overlap with the window,
//    but its promoWindows/closures are operator-DATED facts whose spans
//    may reach back into the measured window ("promo ran June 1-7",
//    confirmed June 16; attribution runs >= 24h after windowEnd, so late
//    rows exist for every live candidate). Admission is geometry-only and
//    disruption-only: scalars are never read (they describe the regime
//    from confirmedAt forward, and backward reach from an undated scalar
//    is the forbidden retroactive transition inference); the
//    declaration-change detector never runs here (a late declaration
//    change happened after the window, not inside it); certification
//    below reads only the governing row. Late evidence can therefore flip
//    unknown -> unstable and stable -> unstable, never the reverse.
for (const c of late) {
  if (declaredIntervalsDisrupt(c.state, wsMs, weMs)) disrupted = true;
}
```

- [ ] **Step 2.4: Run, verify green (new file AND the untouched 4c matrix)**

```bash
pnpm --filter @switchboard/core test -- operational-stability
```

Expected: PASS for BOTH `operational-stability.test.ts` (untouched, the refactor-safety pin) and `operational-stability-late-interval.test.ts`.

- [ ] **Step 2.5: Run the full core suite + typecheck**

```bash
pnpm --filter @switchboard/core test && pnpm typecheck
```

Expected: PASS (the orchestrator still passes `postEnd`, so the widened-read behavior is not yet live; all existing tests green).

- [ ] **Step 2.6: Commit**

```bash
git branch --show-current   # expect: feat/riley-4e-late-interval-stability
git add packages/core/src/recommendations/operational-stability.ts \
        packages/core/src/recommendations/__tests__/operational-stability-late-interval.test.ts
git commit -m "feat(core): late-interval retroactive disruption evidence in stability derivation (riley v3 slice 4e)"
```

---

## Task 3: The widened orchestrator read (`outcome-attribution.ts`, TDD)

**Files:**

- Create: `packages/core/src/recommendations/__tests__/outcome-attribution-late-interval.test.ts`
- Modify: `packages/core/src/recommendations/outcome-attribution.ts`
- Modify: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts` (ONE pin)

- [ ] **Step 3.1: Write the failing tests**

Create `packages/core/src/recommendations/__tests__/outcome-attribution-late-interval.test.ts` with exactly:

```ts
import { describe, it, expect, vi } from "vitest";
import { attributeOneRecommendation, runRileyOutcomeAttribution } from "../outcome-attribution.js";
import type {
  AttributableRecommendation,
  MetaInsightsProvider,
  RileyOutcomeRow,
  WindowMetrics,
} from "../outcome-attribution-types.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

// Pause candidate: windowDays = 7, anchor 2026-05-01T12:00Z, so the full
// attribution window is [2026-04-24T12:00Z, 2026-05-08T12:00Z) and NOW sits
// past the 24h settlement lag, like every live candidate.
const REC: AttributableRecommendation = {
  id: "rec-late-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
  executableWorkUnitId: null,
};
const NOW = new Date("2026-05-10T12:00:00Z");
const WINDOW_START = new Date("2026-04-24T12:00:00Z");
const WINDOW_END = new Date("2026-05-08T12:00:00Z");

const FULL_NORMAL: OperationalState = {
  operatingStatus: "open",
  staffing: "normal",
  inventory: "normal",
  promoWindows: [],
  closures: [],
};

let seq = 0;
function confirm(confirmedAt: string, state: OperationalState): OperationalStateConfirmation {
  seq += 1;
  return {
    id: `osc_orch_${seq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

/** Governing row 3 days before window entry: certifies stable alone. */
function governing(): OperationalStateConfirmation {
  return confirm("2026-04-21T12:00:00Z", FULL_NORMAL);
}

/** Late closure overlapping the measured window, recorded after windowEnd. */
function lateClosure(): OperationalStateConfirmation {
  return confirm("2026-05-09T12:00:00Z", {
    closures: [{ start: "2026-04-28T00:00:00Z", end: "2026-05-02T00:00:00Z" }],
  });
}

function w(spendCents: number, ctr = 0.02, dailyRowCount = 7): WindowMetrics {
  return { spendCents, ctr, dailyRowCount };
}

function makeDeps(confirmations: OperationalStateConfirmation[]) {
  const inserted: RileyOutcomeRow[] = [];
  const insightsProvider: MetaInsightsProvider = {
    getWindowMetrics: vi.fn().mockResolvedValueOnce(w(10000)).mockResolvedValueOnce(w(800)),
  };
  return {
    recommendationStore: {
      findAttributableCandidates: vi.fn().mockResolvedValue([REC]),
      findOverlapsForCampaign: vi.fn().mockResolvedValue([]),
    },
    insightsProvider,
    outcomeStore: {
      insert: vi.fn(async (row: RileyOutcomeRow) => {
        inserted.push(row);
      }),
      existsByRecommendationId: vi.fn().mockResolvedValue(false),
    },
    reader: {
      getConfirmationsOverlappingWindow: vi.fn().mockResolvedValue(confirmations),
    },
    inserted,
  };
}

async function run(deps: ReturnType<typeof makeDeps>, now = NOW) {
  return runRileyOutcomeAttribution({
    recommendationStore: deps.recommendationStore,
    insightsProvider: deps.insightsProvider,
    outcomeStore: deps.outcomeStore,
    operationalStateReader: deps.reader,
    orgId: "org-1",
    now,
  });
}

describe("runRileyOutcomeAttribution: the slice-4e widened operational-state read", () => {
  it("calls the reader with the attribution moment as the end bound (late rows admissible)", async () => {
    const deps = makeDeps([governing()]);
    await run(deps);
    expect(deps.reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
      "org-1",
      WINDOW_START,
      NOW,
    );
  });

  it("never narrows below the 4c read: a now before postEnd clamps to postEnd", async () => {
    // Unreachable from the live candidate store (settlement lag enforces
    // now >= postEnd + 24h); the clamp protects direct callers regardless.
    const deps = makeDeps([]);
    await run(deps, new Date("2026-05-08T00:00:00Z"));
    expect(deps.reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
      "org-1",
      WINDOW_START,
      WINDOW_END,
    );
  });

  it("records unstable + trustDelta none when a late closure overlaps the measured window", async () => {
    const deps = makeDeps([governing(), lateClosure()]);
    const summary = await run(deps);
    expect(summary.outcomesWritten).toBe(1);
    expect(deps.inserted).toHaveLength(1);
    expect(deps.inserted[0]?.businessContextStable).toBe("unstable");
    // The delta is real; only the trust suffix is suppressed (4c demotion).
    expect(deps.inserted[0]?.trustDelta).toBe("none");
    expect(deps.inserted[0]?.cockpitRenderable).toBe(true);
  });

  it("keeps stable + trustDelta up when the only late row is scalar-only", async () => {
    const deps = makeDeps([
      governing(),
      confirm("2026-05-09T12:00:00Z", { staffing: "shortfall" }),
    ]);
    await run(deps);
    expect(deps.inserted[0]?.businessContextStable).toBe("stable");
    expect(deps.inserted[0]?.trustDelta).toBe("up");
  });
});

describe("attributeOneRecommendation: late evidence reaches corroboration P4 (slice 4d ordering)", () => {
  // Inputs that pass every corroboration gate when the window is stable:
  // P1 pause, P2 clean -92% delta, P3 favorable, F1 reader+spend present,
  // F2 5 bookings each window, F3 post/pre account spend 0.8 in [0.5, 1.5],
  // A1 postRatio 2.375 >= 0.8 * preRatio 2.0.
  const corroborationInputs = {
    preWindow: { ...w(10000), accountSpendCents: 50000 },
    postWindow: { ...w(800), accountSpendCents: 40000 },
    orgBookedStats: {
      preWindow: { bookedValueCents: 100000, bookedCount: 5 },
      postWindow: { bookedValueCents: 95000, bookedCount: 5 },
    },
  };

  it("emits corroborated when the window is late-undisturbed (the control)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      ...corroborationInputs,
      overlaps: [],
      operationalStateConfirmations: [governing()],
    });
    expect(row.businessContextStable).toBe("stable");
    expect(row.causalStrength).toBe("corroborated");
  });

  it("demotes to directional when a late closure disrupts the window (P4 consumes the post-late-read verdict)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      ...corroborationInputs,
      overlaps: [],
      operationalStateConfirmations: [governing(), lateClosure()],
    });
    expect(row.businessContextStable).toBe("unstable");
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("none");
  });

  it("leaves corroborated earnable when the late row is scalar-only (intervals-only negative)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      ...corroborationInputs,
      overlaps: [],
      operationalStateConfirmations: [
        governing(),
        confirm("2026-05-09T12:00:00Z", { operatingStatus: "temporarily_closed" }),
      ],
    });
    expect(row.businessContextStable).toBe("stable");
    expect(row.causalStrength).toBe("corroborated");
  });

  it("byte-identity: benign late rows leave the entire row deep-equal", () => {
    const base = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000),
      postWindow: w(800),
      overlaps: [],
      operationalStateConfirmations: [governing()],
    });
    const withBenignLate = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000),
      postWindow: w(800),
      overlaps: [],
      operationalStateConfirmations: [
        governing(),
        confirm("2026-05-09T12:00:00Z", {
          staffing: "shortfall",
          closures: [{ start: "2026-05-20T00:00:00Z", end: "2026-05-25T00:00:00Z" }],
        }),
      ],
    });
    expect(withBenignLate).toEqual(base);
  });
});
```

- [ ] **Step 3.2: Run, verify the right failures**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution-late-interval
```

Expected: the two widened-read pins FAIL (reader still called with `postEnd`: the first gets `2026-05-08T12:00:00Z` where `NOW` is expected). The orchestrator-level unstable test FAILS only if the mock reader were span-filtered (it is not; it returns the array verbatim), so it may already PASS through the Task-2 derivation; that is expected. The direct `attributeOneRecommendation` tests should PASS already (Task 2 made the derivation late-aware). The failing pins are precisely the wire-level change this task makes.

- [ ] **Step 3.3: Implement the widened read**

In `packages/core/src/recommendations/outcome-attribution.ts`, make three edits:

(1) Replace the `operationalStateConfirmations` input doc on `AttributeOneInput`:

```ts
/**
 * Slice-4c: operator operational-state confirmations overlapping the FULL
 * attribution window (the getConfirmationsOverlappingWindow contract:
 * governing + in-window, oldest first). undefined = no source wired; [] =
 * source wired, zero confirmations. Both derive "unknown" (honest absence).
 */
```

with:

```ts
/**
 * Slice-4c: operator operational-state confirmations overlapping the FULL
 * attribution window (the getConfirmationsOverlappingWindow contract:
 * governing + in-window, oldest first). Slice-4e: plus any confirmations
 * recorded after windowEndedAt up to the attribution moment (the widened
 * orchestrator read); the derivation admits their dated intervals as
 * disruption-only evidence. undefined = no source wired; [] = source
 * wired, zero confirmations. Both derive "unknown" (honest absence).
 */
```

(2) Replace the `operationalStateReader` doc on `RunRileyOutcomeAttributionInput`:

```ts
/**
 * Optional (slice 4c). The 4a operational-state window read; absent ⇒
 * every row records businessContextStable "unknown" (honest absence).
 */
```

with:

```ts
/**
 * Optional (slice 4c). The 4a operational-state window read; absent ⇒
 * every row records businessContextStable "unknown" (honest absence).
 * Slice 4e: the call's end bound is the attribution moment (clamped to
 * never fall below postEnd), admitting late-recorded confirmations as
 * disruption-only evidence.
 */
```

(3) Replace the read itself:

```ts
// Slice 4c: operational-state confirmations overlapping the FULL
// attribution window; fetched BEFORE the quota-bearing Meta calls (cheap
// indexed DB read first). A read failure PROPAGATES like every other
// provider error here: outcome rows are insert-once, so writing "unknown"
// on a transient blip would freeze it forever; the Inngest retry derives
// it right instead.
const operationalStateConfirmations = operationalStateReader
  ? await operationalStateReader.getConfirmationsOverlappingWindow(orgId, preStart, postEnd)
  : undefined;
```

with:

```ts
// Slice 4c: operational-state confirmations overlapping the FULL
// attribution window; fetched BEFORE the quota-bearing Meta calls (cheap
// indexed DB read first). A read failure PROPAGATES like every other
// provider error here: outcome rows are insert-once, so writing "unknown"
// on a transient blip would freeze it forever; the Inngest retry derives
// it right instead.
// Slice 4e: the read's end bound widens from postEnd to the attribution
// moment, so confirmations recorded AFTER the window closed (the
// settlement lag guarantees >= 24h of post-window time for every live
// candidate) are admitted: their dated promo/closure intervals may reach
// back into the measured window. The derivation buckets rows by
// confirmedAt and admits late rows as disruption-only interval evidence.
// Clamped so the read is never narrower than the shipped 4c read, even
// for a direct caller violating the settlement-lag invariant.
const lateHorizon = now.getTime() > postEnd.getTime() ? now : postEnd;
const operationalStateConfirmations = operationalStateReader
  ? await operationalStateReader.getConfirmationsOverlappingWindow(orgId, preStart, lateHorizon)
  : undefined;
```

- [ ] **Step 3.4: Update the ONE existing call-args pin**

In `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts` (~line 560), replace:

```ts
// The read is the 4a contract verbatim: (org, windowStartedAt, windowEndedAt),
// the full pre+post span (anchor ± windowDays).
expect(reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
  "org-1",
  new Date("2026-04-24T12:00:00Z"),
  new Date("2026-05-08T12:00:00Z"),
);
```

with:

```ts
// The read spans (windowStartedAt, now]: the 4a span-parametric contract
// with the slice-4e late horizon, so confirmations recorded after the
// window closed are admissible as disruption-only evidence.
expect(reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
  "org-1",
  new Date("2026-04-24T12:00:00Z"),
  new Date("2026-05-10T12:00:00Z"),
);
```

(The `now` in that test is `2026-05-10T12:00:00Z`; the expectation moves from `postEnd` to `now`. This is the slice's entire wire-level change, restated honestly. No other test in the file pins the call args; the mock readers return fixed arrays regardless of span.)

- [ ] **Step 3.5: Run, verify green across the package + typecheck**

```bash
pnpm --filter @switchboard/core test && pnpm typecheck
```

Expected: PASS, including `outcome-attribution.test.ts` (one updated pin), `outcome-attribution-corroboration.test.ts` and `outcome-attribution-linkage.test.ts` (no reader call-arg pins, byte-untouched), and both new files.

- [ ] **Step 3.6: Commit**

```bash
git branch --show-current   # expect: feat/riley-4e-late-interval-stability
git add packages/core/src/recommendations/outcome-attribution.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution-late-interval.test.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution.test.ts
git commit -m "feat(core): widen operational-state read to the attribution moment (riley v3 slice 4e)"
```

---

## Task 4: Full verification + scope-fence proofs

- [ ] **Step 4.1: Full repo gates**

```bash
pnpm test 2>&1 | tail -15
pnpm typecheck 2>&1 | tail -5
pnpm format:check 2>&1 | tail -5
pnpm arch:check 2>&1 | tail -10
pnpm lint 2>&1 | tail -5
```

Expected: all green (known local-PG trio failures in db tests are pre-existing if Postgres is down; gate = no NEW failures). `operational-stability.ts` stays under the 600-line arch error tier (~315 raw lines).

- [ ] **Step 4.2: Eval byte-identity**

```bash
pnpm eval:riley > /tmp/slice4e-baselines/eval-riley-after.txt 2>&1; echo "exit: $?"
diff /tmp/slice4e-baselines/eval-riley-baseline.txt /tmp/slice4e-baselines/eval-riley-after.txt && echo "riley BYTE-UNCHANGED"
pnpm eval:governance > /tmp/slice4e-baselines/eval-governance-after.txt 2>&1; echo "exit: $?"
diff /tmp/slice4e-baselines/eval-governance-baseline.txt /tmp/slice4e-baselines/eval-governance-after.txt && echo "governance BYTE-UNCHANGED"
```

Expected: both diffs empty.

- [ ] **Step 4.3: Scope-fence greps (three-dot against origin/main)**

```bash
git fetch origin main
git diff --stat origin/main...HEAD
# Expected files ONLY:
#   docs/superpowers/specs/2026-06-07-riley-v3-slice4e-late-interval-stability-design.md
#   docs/superpowers/plans/2026-06-07-riley-v3-slice4e-late-interval-stability.md
#   packages/core/src/recommendations/operational-stability.ts
#   packages/core/src/recommendations/outcome-attribution.ts
#   packages/core/src/recommendations/__tests__/operational-stability-late-interval.test.ts
#   packages/core/src/recommendations/__tests__/outcome-attribution-late-interval.test.ts
#   packages/core/src/recommendations/__tests__/outcome-attribution.test.ts
git diff origin/main...HEAD -- packages/db packages/schemas packages/ad-optimizer apps/ | wc -l   # expect: 0
git diff origin/main...HEAD -- packages/db/prisma | wc -l                                          # expect: 0 (zero migrations)
grep -rn "RILEY_OUTCOME_ATTRIBUTION_ENABLED\|RILEY_PAUSE" packages/core/src/recommendations/outcome-attribution.ts | wc -l  # expect: 0 (flags untouched)
```

- [ ] **Step 4.4: check-routes baseline (read-side slice, no new mutating surface)**

```bash
cd .agent/tools && ./check-routes 2>&1 | tail -3 && cd ../..
```

Expected: same as the branch-clean baseline ("102 findings suppressed by allowlist", zero new findings).

- [ ] **Step 4.5: db:check-drift (zero-migration proof, requires local Postgres)**

```bash
pnpm db:check-drift 2>&1 | tail -3
```

Expected: clean (no drift; this slice has no schema diff). If Postgres is unreachable locally, record that and rely on the CI drift job.

---

## Task 5: PR

- [ ] **Step 5.1: Push and open ONE focused PR**

```bash
git push -u origin feat/riley-4e-late-interval-stability
```

Title: `feat(core): riley v3 slice 4e late-interval retroactive stability read`

Body must include: the one-paragraph what (late operator-dated intervals admitted as disruption-only evidence); Decisions A-F summary; the consumer-sweep table (P4/trustDelta receive the post-late-read verdict; read model and feed translator unaffected; audit freshness path byte-untouched); the do-no-harm byte-identity argument + the single updated call-args pin; scope-fence grep outputs (zero db/api/ad-optimizer/schemas/UI diff, zero migrations, zero flag changes); eval byte-unchanged results; "read-side derivation work, no new mutating surface; check-routes baseline clean"; spec + plan ride in this PR (the 4c/4d/4f pattern).

- [ ] **Step 5.2: Code review (standard + adversarial)**

Dispatch superpowers:requesting-code-review per the slice process, plus a SECOND adversarial reviewer hunting truth violations specifically:

1. Any path where late evidence CERTIFIES or restores `"stable"` (including via the governing-row selection or freshness vouch).
2. Retroactive scalar inference from a late row (any read of `operatingStatus`/`staffing`/`inventory` on a `confirmedAt > windowEndedAt` row).
3. windowEnd off-by-one or double-count between the in-window bucket `(ws, we]` and the late bucket `(we, now]`.
4. Corroboration consuming pre-late-read stability (ordering inside `attributeOneRecommendation`).
5. Byte-identity break with zero late rows (any existing-test behavior change beyond the one call-args pin).
6. The clamp: any path where the widened read is NARROWER than the 4c read.

Fix all findings in-branch before merge (ship clean, no follow-up deferrals).

- [ ] **Step 5.3: Merge on green CI (squash), same-day teardown**

Known CI flakes (rerun before investigating): api-auth prod-hardening, pg_advisory_xact_lock trio, bootstrap-smoke npm-warn, chat gateway-bridge-attribution under parallel turbo load, docker-job registry timeouts. Eval Claim Classifier 401 on main pushes is informational (dead secret, user-owned).

```bash
gh pr merge --squash
cd /Users/jasonli/switchboard
git worktree remove .claude/worktrees/riley-4e-late-interval-stability && git worktree prune
```

- [ ] **Step 5.4: Update memory** (`project_riley_v3_control_plane.md`): 4e shipped; record the four decisions (disruption-only asymmetry, intervals-only, widened-call read shape, unbounded-to-attribution-moment horizon, at-we stays in-window), the residual post-attribution invisibility gap, and that remaining Riley v3 work = pilot flip.

---

## Self-review (run after writing, fixed inline)

- **Spec coverage:** Decision A (Task 2 asymmetry tests + structural impl), B (intervals-only tests + late pass reading no scalars), C (shared helper + geometry tests incl. covering-promo divergence + union + fail-safe), D (unbounded horizon = the widened call in Task 3; no cutoff code exists to test), E (Task 3 widened call + clamp + the one pin update; zero db/api diff proven in Task 4.3), F (boundary tests at we and we+1ms in Task 2; geometry edges both sides). Ordering/consumer sweep: Task 3 P4 e2e tests + Task 4.3 greps. Do-no-harm: untouched 4c matrix + deep-equality tests + eval byte-diffs.
- **Placeholder scan:** none; every step carries complete code/commands.
- **Type consistency:** `declaredIntervalsDisrupt(state, wsMs, weMs)` defined in Task 2 step 2.3(3), used in 2.3(5) and 2.3(6); `lateHorizon` only in Task 3 step 3.3(3); test helper names (`governingStable`, `governing`, `lateClosure`, `confirm`, `derive`, `w`, `makeDeps`, `run`) are file-local and consistent within each file.
