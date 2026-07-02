# Safe-Harbor Floor (SH-1..SH-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the universal safe-harbor floor (spec: `docs/superpowers/specs/2026-07-02-safe-harbor-floor.md`, PR #1383, open questions resolved yes/yes/yes), S1 of the one-product-many-doors design (PR #1391): every self-serve agent boots into observe-mode + generic claim boundaries + consent gate, with medspa byte-identical throughout.

**Architecture:** The floor is a configuration of three existing seams, not a new subsystem: (1) the `(vertical, jurisdiction)` loader tables gain a fail-closed fallback, a floor-manifest assertion, and real `generic` tables; (2) the two claim-boundary gates thread `resolveVertical(config)` into the loaders; (3) provisioning gains a `generic` selector case returning a floor observe config, with the api `governanceSeedContext` precedence inverted so a threaded vertical wins. The prompt floor rides `composePackBody` via a pack override.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo), vitest, Zod, Prisma (mocked in tests).

## Global Constraints

- **One PR per SH group** (SH-1..SH-5), branch names `feat/sh-<n>-<slug>`, each independently green.
- **Merge gate on every PR:** `pnpm --filter @switchboard/eval-skill-prompt-golden test` → ZERO snapshot diff (medspa byte-identical). SH-1..SH-4 are golden-green by non-participation; SH-5 by disjoint render.
- **Before every commit:** `pnpm --filter <touched-pkg> exec tsc --noEmit` for EACH touched package (pre-commit hook is eslint+prettier only) and `pnpm --filter <touched-pkg> test`.
- After editing a lower-layer package (`schemas`, `core`, `db`), rebuild its `dist` (`pnpm --filter <pkg> build`) before running a consumer package's tests.
- ESM only: relative imports carry `.js`. No `console.log` (use `console.error`/`console.warn`). No `any`. Every new module gets a co-located test.
- **Medspa invariants (from spec D2/D4):** never touch the `medspa` keys or medspa's merged arrays; `selectPackGovernanceConfig` medspa/SG must keep returning `MEDSPA_PILOT_GOVERNANCE_CONFIG` by reference (`toBe`, not `toEqual`); the floor manifest must pass against medspa's tables with zero edits to them.
- Layer rules: `schemas` imports nothing internal; `core` imports `schemas`; `db` imports `schemas + core`; apps import anything.

---

## PR SH-1 — Fail-closed loader merge (branch `feat/sh-1-fail-closed-loader-merge`, package: core)

### Task 1: Length-aware vertical table fallback helper

**Files:**

- Create: `packages/core/src/governance/vertical-table.ts`
- Test: `packages/core/src/governance/__tests__/vertical-table.test.ts`

**Interfaces:**

- Produces: `resolveVerticalTable<T>(byVertical: Partial<Record<Vertical, ReadonlyArray<T>>>, vertical: Vertical, base: ReadonlyArray<T>): ReadonlyArray<T>` — consumed by both loaders in Tasks 2-3.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/governance/__tests__/vertical-table.test.ts
import { describe, it, expect } from "vitest";
import { resolveVerticalTable } from "../vertical-table.js";

const BASE = [{ id: "base_1" }] as const;

describe("resolveVerticalTable", () => {
  it("returns a registered non-empty table verbatim (same reference)", () => {
    const table = [{ id: "medspa_1" }];
    const byVertical = { medspa: table };
    expect(resolveVerticalTable(byVertical, "medspa", BASE)).toBe(table);
  });

  it("falls back to base when the vertical is absent", () => {
    expect(resolveVerticalTable({}, "fitness", BASE)).toBe(BASE);
  });

  it("falls back to base when the registered table is EMPTY (closes the ?? fail-open hole)", () => {
    const byVertical = { fitness: [] as ReadonlyArray<{ id: string }> };
    expect(resolveVerticalTable(byVertical, "fitness", BASE)).toBe(BASE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- vertical-table`
Expected: FAIL — `Cannot find module '../vertical-table.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/governance/vertical-table.ts
import type { Vertical } from "../vertical.js";

/**
 * Fail-closed per-vertical table resolution (spec D4, Hazard 1). `?? base` only
 * falls back on undefined, so a pack registering an EMPTY table (`fitness: []`)
 * would silently drop the floor: `[] ?? base` is `[]`. Length-aware fallback
 * means an absent OR empty table resolves to the base set, so the empty set is
 * unrepresentable. A registered non-empty table resolves verbatim (never
 * re-merged), which is what keeps medspa byte-identical.
 */
export function resolveVerticalTable<T>(
  byVertical: Partial<Record<Vertical, ReadonlyArray<T>>>,
  vertical: Vertical,
  base: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const table = byVertical[vertical];
  return table !== undefined && table.length > 0 ? table : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- vertical-table`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/vertical-table.ts packages/core/src/governance/__tests__/vertical-table.test.ts
git commit -m "feat(core): length-aware vertical table fallback (SH-1)"
```

### Task 2: Floor manifest + load-time coverage assertion

**Files:**

- Create: `packages/core/src/governance/floor-manifest.ts`
- Test: `packages/core/src/governance/__tests__/floor-manifest.test.ts`

**Interfaces:**

- Consumes: `scanForBannedPhrases` from `../scanner/banned-phrase-scanner.js`, `scanForEscalationTriggers` from `../scanner/escalation-trigger-scanner.js` (verify exact export names in those files before writing; they are the same functions the gates import).
- Produces: `assertBannedPhraseFloorCoverage(entries, label)`, `assertEscalationFloorCoverage(entries, label)` — throw `Error` on any unmet requirement. Consumed by the loaders in Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/governance/__tests__/floor-manifest.test.ts
import { describe, it, expect } from "vitest";
import {
  assertBannedPhraseFloorCoverage,
  assertEscalationFloorCoverage,
} from "../floor-manifest.js";
import { loadBannedPhrases, _resetBannedPhraseCache } from "../banned-phrases/loader.js";
import { loadEscalationTriggers } from "../escalation-triggers/loader.js";

describe("floor manifest", () => {
  it("medspa merged tables pass with zero edits (spec D4 acceptance criterion)", () => {
    _resetBannedPhraseCache();
    expect(() =>
      assertBannedPhraseFloorCoverage(loadBannedPhrases("SG", "medspa"), "medspa/SG"),
    ).not.toThrow();
    expect(() =>
      assertEscalationFloorCoverage(loadEscalationTriggers("SG", "medspa"), "medspa/SG"),
    ).not.toThrow();
  });

  it("an EMPTY table fails the manifest (second guard against Hazard 1)", () => {
    expect(() => assertBannedPhraseFloorCoverage([], "empty")).toThrow(/floor manifest/i);
    expect(() => assertEscalationFloorCoverage([], "empty")).toThrow(/floor manifest/i);
  });

  it("a table missing one required category fails and names it", () => {
    const guaranteeOnly = loadBannedPhrases("SG", "medspa").filter(
      (e) => e.category === "guarantee",
    );
    expect(() => assertBannedPhraseFloorCoverage(guaranteeOnly, "partial")).toThrow(/superlative/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- floor-manifest`
Expected: FAIL — `Cannot find module '../floor-manifest.js'`

- [ ] **Step 3: Write minimal implementation**

The manifest is a small set of (category, canonical probe) requirements. Each probe is a sentence that MUST be caught by at least one entry of that category. Probes are chosen so medspa's existing tables pass unedited: `guaranteed results` hits `guarantee_basic` ("guaranteed"), `the best results in town` hits `superlative_best_results`, `this cures acne` hits `medical_cure`, and the escalation probe `I have been diagnosed with anxiety` hits `sensitive_keyword_mental_health`.

```ts
// packages/core/src/governance/floor-manifest.ts
import type { BannedPhraseEntry, BannedPhraseCategory } from "./banned-phrases/types.js";
import type {
  EscalationTriggerEntry,
  EscalationTriggerCategory,
} from "./escalation-triggers/types.js";
import { scanForBannedPhrases } from "./scanner/banned-phrase-scanner.js";
import { scanForEscalationTriggers } from "./scanner/escalation-trigger-scanner.js";

/**
 * The floor manifest (spec D4): the minimum claim-boundary coverage EVERY
 * resolved loader table must provide, regardless of vertical. Asserted at load
 * time inside the loaders; a violation THROWS (fail-closed at preflight, the
 * composePackBody posture). Authored as a strict subset of what medspa already
 * bans, so medspa passes with zero edits; boundaries that are affirmative or
 * not pattern-scannable (disclose AI, financial/legal advice) ride the prompt
 * floor (SH-5), never this manifest.
 */
interface BannedPhraseRequirement {
  category: BannedPhraseCategory;
  probe: string;
}
interface EscalationRequirement {
  category: EscalationTriggerCategory;
  probe: string;
}

export const BANNED_PHRASE_FLOOR_MANIFEST: ReadonlyArray<BannedPhraseRequirement> = [
  { category: "guarantee", probe: "Your results are guaranteed with us." },
  { category: "superlative", probe: "We deliver the best results in town." },
  { category: "medical_claim", probe: "This treatment cures acne for good." },
];

export const ESCALATION_FLOOR_MANIFEST: ReadonlyArray<EscalationRequirement> = [
  { category: "sensitive_keyword", probe: "I have been diagnosed with anxiety." },
];

export function assertBannedPhraseFloorCoverage(
  entries: ReadonlyArray<BannedPhraseEntry>,
  label: string,
): void {
  for (const req of BANNED_PHRASE_FLOOR_MANIFEST) {
    const matches = scanForBannedPhrases(req.probe, entries);
    if (!matches.some((m) => m.entry.category === req.category)) {
      throw new Error(
        `Banned-phrase table "${label}" fails the floor manifest: no ${req.category} entry catches the canonical probe. A pack may add boundaries but never remove floor coverage.`,
      );
    }
  }
}

export function assertEscalationFloorCoverage(
  entries: ReadonlyArray<EscalationTriggerEntry>,
  label: string,
): void {
  for (const req of ESCALATION_FLOOR_MANIFEST) {
    const matches = scanForEscalationTriggers(req.probe, entries);
    if (!matches.some((m) => m.entry.category === req.category)) {
      throw new Error(
        `Escalation-trigger table "${label}" fails the floor manifest: no ${req.category} entry catches the canonical probe. A pack may add boundaries but never remove floor coverage.`,
      );
    }
  }
}
```

If the scanner export names or match shapes differ (check `packages/core/src/governance/scanner/banned-phrase-scanner.ts` and `escalation-trigger-scanner.ts`: the gates destructure `matches[0].entry`), adjust the two `scanFor...` calls to the real signatures; do NOT reimplement pattern matching here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- floor-manifest`
Expected: PASS (3 tests). If the medspa-passes test fails, fix the PROBE STRINGS (never the medspa tables) until each probe hits an existing entry of its category.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/floor-manifest.ts packages/core/src/governance/__tests__/floor-manifest.test.ts
git commit -m "feat(core): floor-manifest coverage assertion (SH-1)"
```

### Task 3: Wire fallback + assertion into both loaders

**Files:**

- Modify: `packages/core/src/governance/banned-phrases/loader.ts:41-45` (the three `??` fallbacks)
- Modify: `packages/core/src/governance/escalation-triggers/loader.ts` (same pattern, ~L44-49)
- Test: `packages/core/src/governance/banned-phrases/__tests__/loader-fail-closed.test.ts`
- Test: `packages/core/src/governance/escalation-triggers/__tests__/loader-fail-closed.test.ts`

**Interfaces:**

- Consumes: `resolveVerticalTable` (Task 1), `assertBannedPhraseFloorCoverage` / `assertEscalationFloorCoverage` (Task 2).
- Produces: unchanged loader signatures; merged medspa arrays byte-identical (same entries, same order, same frozen instance per cache key).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/governance/banned-phrases/__tests__/loader-fail-closed.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadBannedPhrases, _resetBannedPhraseCache } from "../loader.js";

describe("loadBannedPhrases fail-closed merge (SH-1)", () => {
  beforeEach(() => _resetBannedPhraseCache());

  it("medspa/SG merged set is unchanged: same ids in the same order as before SH-1", () => {
    const entries = loadBannedPhrases("SG", "medspa");
    const single = loadBannedPhrases("SG");
    expect(entries.map((e) => e.id)).toEqual(single.map((e) => e.id));
    expect(entries).toBe(single); // same frozen cache instance
  });

  it("an unregistered vertical (fitness) resolves the base tables, never an empty set", () => {
    const entries = loadBannedPhrases("SG", "fitness");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every resolvable (vertical, jurisdiction) pair satisfies the floor manifest (loader throws otherwise, so loading is the assertion)", () => {
    for (const v of ["medspa", "dental", "fitness", "generic"] as const) {
      for (const j of ["SG", "MY"] as const) {
        expect(() => loadBannedPhrases(j, v)).not.toThrow();
      }
    }
  });
});
```

Mirror the same three cases for `loadEscalationTriggers` in `packages/core/src/governance/escalation-triggers/__tests__/loader-fail-closed.test.ts` (that loader's cache-reset helper is `_resetEscalationTriggerCache`; verify the exact name in its `loader.ts` and use it).

- [ ] **Step 2: Run tests to verify the new files run (order/instance cases pass already; manifest case fails only after wiring below if a probe misses)**

Run: `pnpm --filter @switchboard/core test -- loader-fail-closed`
Expected: PASS or FAIL depending on wiring state — the point of the run is a baseline before the edit.

- [ ] **Step 3: Implement in `banned-phrases/loader.ts`**

Replace lines 41-45 with:

```ts
const common = resolveVerticalTable(
  COMMON_BANNED_PHRASES_BY_VERTICAL,
  vertical,
  COMMON_BANNED_PHRASES,
);
const jurisdictionTable =
  jurisdiction === "SG"
    ? resolveVerticalTable(SG_BANNED_PHRASES_BY_VERTICAL, vertical, SG_BANNED_PHRASES)
    : resolveVerticalTable(MY_BANNED_PHRASES_BY_VERTICAL, vertical, MY_BANNED_PHRASES);
```

Add imports `import { resolveVerticalTable } from "../vertical-table.js";` and `import { assertBannedPhraseFloorCoverage } from "../floor-manifest.js";`. Then, immediately after the existing id-uniqueness assert (after loader.ts:58), add:

```ts
// Floor manifest (SH-1): a resolved table that lost floor coverage is a bug
// in table authoring; fail closed at load rather than run under-protected.
assertBannedPhraseFloorCoverage(merged, `${vertical}/${jurisdiction}`);
```

Apply the identical two changes (resolveVerticalTable on all three fallbacks + assertEscalationFloorCoverage after its uniqueness assert) in `escalation-triggers/loader.ts`.

- [ ] **Step 4: Run the full core suite**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS, including all pre-existing loader tests (byte-identity) and both new files.

- [ ] **Step 5: Typecheck, golden gate, commit, PR**

```bash
pnpm --filter @switchboard/core exec tsc --noEmit
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/eval-skill-prompt-golden test   # expect ZERO diff
git add -A packages/core
git commit -m "feat(core): fail-closed loader merge + floor-manifest gate in loaders (SH-1)"
```

Open PR `feat/sh-1-fail-closed-loader-merge` → main. PR body must state the D2 argument: golden-green by non-participation; medspa arrays proven unchanged by unit test.

---

## PR SH-2 — `generic` floor tables + `resolveVertical` (branch `feat/sh-2-generic-floor-tables`, package: core)

### Task 4: `resolveVertical(config)` fail-safe marker read

**Files:**

- Modify: `packages/core/src/vertical.ts`
- Test: `packages/core/src/__tests__/vertical.test.ts`

**Interfaces:**

- Produces: `VERTICALS` const array; `resolveVertical(config: Record<string, unknown> | null | undefined): Vertical`. Consumed by both gates (SH-3). `Vertical`/`DEFAULT_VERTICAL` unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/vertical.test.ts
import { describe, it, expect } from "vitest";
import { resolveVertical, DEFAULT_VERTICAL } from "../vertical.js";

describe("resolveVertical (SH-2)", () => {
  it("absence -> medspa (what keeps existing configs byte-identical)", () => {
    expect(resolveVertical(null)).toBe(DEFAULT_VERTICAL);
    expect(resolveVertical(undefined)).toBe(DEFAULT_VERTICAL);
    expect(resolveVertical({ jurisdiction: "SG" })).toBe(DEFAULT_VERTICAL);
  });

  it("a valid marker resolves verbatim", () => {
    expect(resolveVertical({ vertical: "generic" })).toBe("generic");
    expect(resolveVertical({ vertical: "medspa" })).toBe("medspa");
  });

  it("corruption -> medspa (over-restrictive, safe direction), never a throw", () => {
    expect(resolveVertical({ vertical: "yoga-studio" })).toBe(DEFAULT_VERTICAL);
    expect(resolveVertical({ vertical: 42 })).toBe(DEFAULT_VERTICAL);
    expect(resolveVertical({ vertical: { nested: true } })).toBe(DEFAULT_VERTICAL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- src/__tests__/vertical`
Expected: FAIL — `resolveVertical` is not exported.

- [ ] **Step 3: Implement in `vertical.ts`**

Re-derive the type from a const array (type is unchanged), then add the resolver, mirroring `resolveConsentStateConfig`'s fail-safe posture without a zod dependency:

```ts
export const VERTICALS = ["medspa", "dental", "fitness", "generic"] as const;
export type Vertical = (typeof VERTICALS)[number];
export const DEFAULT_VERTICAL: Vertical = "medspa";

/**
 * Read the passthrough `vertical` marker off a governance config (spec D1.4).
 * Fail-safe: absence -> medspa (existing configs stay byte-identical);
 * corruption -> medspa (over-restrictive is the safe direction). Never throws:
 * this runs on the reply hot path. Logs type-only (never the raw value).
 */
export function resolveVertical(config: Record<string, unknown> | null | undefined): Vertical {
  const raw = config?.vertical;
  if (raw === undefined || raw === null) return DEFAULT_VERTICAL;
  if (typeof raw === "string" && (VERTICALS as readonly string[]).includes(raw)) {
    return raw as Vertical;
  }
  console.error("[vertical] corrupt vertical marker; failing safe to medspa (over-restrict)", {
    rawType: typeof raw,
  });
  return DEFAULT_VERTICAL;
}
```

- [ ] **Step 4: Run test + full core suite to verify**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/vertical.ts packages/core/src/__tests__/vertical.test.ts
git commit -m "feat(core): resolveVertical fail-safe config marker read (SH-2)"
```

### Task 5: Author the `generic` floor tables

**Files:**

- Modify: `packages/core/src/governance/banned-phrases/common.ts` (the `_BY_VERTICAL` map at the bottom)
- Modify: `packages/core/src/governance/escalation-triggers/common.ts` (same)
- Test: `packages/core/src/governance/__tests__/generic-floor-tables.test.ts`

**Interfaces:**

- Produces: `GENERIC_BANNED_PHRASES`, `GENERIC_ESCALATION_TRIGGERS` exported from the two `common.ts` files; `generic` keys registered in both `COMMON_..._BY_VERTICAL` maps.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/governance/__tests__/generic-floor-tables.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadBannedPhrases, _resetBannedPhraseCache } from "../banned-phrases/loader.js";
import { loadEscalationTriggers } from "../escalation-triggers/loader.js";
import { COMMON_BANNED_PHRASES } from "../banned-phrases/common.js";

describe("generic floor tables (SH-2)", () => {
  beforeEach(() => _resetBannedPhraseCache());

  it("generic resolves its OWN intended tables, not the accidental medspa fallback", () => {
    const generic = loadBannedPhrases("SG", "generic");
    const medspa = loadBannedPhrases("SG", "medspa");
    expect(generic).not.toBe(medspa);
    expect(generic.length).toBeGreaterThan(0);
  });

  it("generic banned-phrase common floor is the vertical-agnostic claim-boundary base", () => {
    const generic = loadBannedPhrases("SG", "generic");
    for (const entry of COMMON_BANNED_PHRASES) {
      expect(generic.some((e) => e.id === entry.id)).toBe(true);
    }
  });

  it("generic escalation floor keeps universal categories and drops medical-vertical ones", () => {
    const cats = new Set(loadEscalationTriggers("SG", "generic").map((e) => e.category));
    expect(cats.has("sensitive_keyword")).toBe(true);
    expect(cats.has("anticoagulant_use")).toBe(false);
  });

  it("medspa is untouched: same instance and ids as the single-arg call", () => {
    expect(loadBannedPhrases("SG", "medspa")).toBe(loadBannedPhrases("SG"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- generic-floor-tables`
Expected: FAIL — generic currently falls back to the medspa base tables (first assertion `not.toBe` fails).

- [ ] **Step 3: Implement**

In `banned-phrases/common.ts`, after `COMMON_BANNED_PHRASES`, add (the common table IS the vertical-agnostic claim-boundary floor; medspa-specific entries live in the SG/MY tables, which generic inherits via the SH-1 fallback, over-restrict = safe):

```ts
/**
 * The generic (safe-harbor floor) banned-phrase table: the vertical-agnostic
 * claim-boundary base, aliased under its own key so `generic` resolves INTENDED
 * content rather than the accidental medspa fallback. A distinct array instance
 * (not the same reference) so floor evolution can never mutate medspa's table.
 */
export const GENERIC_BANNED_PHRASES: ReadonlyArray<BannedPhraseEntry> = [...COMMON_BANNED_PHRASES];

export const COMMON_BANNED_PHRASES_BY_VERTICAL: Partial<
  Record<Vertical, ReadonlyArray<BannedPhraseEntry>>
> = {
  medspa: COMMON_BANNED_PHRASES,
  generic: GENERIC_BANNED_PHRASES,
};
```

In `escalation-triggers/common.ts`, add the universal-category subset and register it:

```ts
/** Universal escalation categories every vertical floor keeps (spec D4): the
 * pattern-scannable ones that are not medical-vertical-specific. */
const GENERIC_ESCALATION_CATEGORIES: ReadonlySet<EscalationTriggerCategory> = new Set([
  "sensitive_keyword",
  "prior_complaint",
  "competitor_negative",
]);

export const GENERIC_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> =
  COMMON_ESCALATION_TRIGGERS.filter((e) => GENERIC_ESCALATION_CATEGORIES.has(e.category));

export const COMMON_ESCALATION_TRIGGERS_BY_VERTICAL: Partial<
  Record<Vertical, ReadonlyArray<EscalationTriggerEntry>>
> = {
  medspa: COMMON_ESCALATION_TRIGGERS,
  generic: GENERIC_ESCALATION_TRIGGERS,
};
```

- [ ] **Step 4: Run the full core suite (the SH-1 manifest test now also exercises generic's own tables)**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS. If the floor-manifest loader test fails for `generic`, the generic table is missing a required category — fix the GENERIC table content (never the manifest, never medspa).

- [ ] **Step 5: Typecheck, golden gate, commit, PR**

```bash
pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/core build
pnpm --filter @switchboard/eval-skill-prompt-golden test   # expect ZERO diff
git add -A packages/core
git commit -m "feat(core): generic floor tables for banned phrases + escalation triggers (SH-2)"
```

Open PR `feat/sh-2-generic-floor-tables` → main (requires SH-1 merged).

---

## PR SH-3 — Thread vertical through the gates (branch `feat/sh-3-thread-vertical-gates`, package: core)

### Task 6: Posture cache carries `vertical`; output gate threads it

**Files:**

- Modify: `packages/core/src/governance/posture-cache.ts` (add `vertical: Vertical` to `GovernancePosture`)
- Modify: `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts:51` (dep type), `:124-128` (remember), `:134` and `:240` (loader calls)
- Test: `packages/core/src/skill-runtime/hooks/__tests__/deterministic-safety-gate-vertical.test.ts`

**Interfaces:**

- Consumes: `resolveVertical` (Task 4).
- Produces: `GovernancePosture` gains required `vertical: Vertical`; `bannedPhraseLoader` dep type becomes `(jurisdiction: "SG" | "MY", vertical?: Vertical) => ReadonlyArray<BannedPhraseEntry>` (the by-reference `loadBannedPhrases` wiring still typechecks).

- [ ] **Step 1: Write the failing test**

Follow the arrange/act pattern of the existing suite in `packages/core/src/skill-runtime/hooks/__tests__/` (reuse its fake stores/resolver builders if exported; otherwise construct minimal fakes inline exactly as that suite does). The new assertions:

```ts
// packages/core/src/skill-runtime/hooks/__tests__/deterministic-safety-gate-vertical.test.ts
import { describe, it, expect, vi } from "vitest";
// import the suite's existing helpers / hook class as the neighboring tests do

describe("DeterministicSafetyGateHook vertical threading (SH-3)", () => {
  it("threads resolveVertical(config) into the loader: generic config -> ('SG','generic')", async () => {
    const loader = vi.fn().mockReturnValue([]);
    // arrange hook with a resolver returning an observe config carrying vertical:"generic", jurisdiction:"SG"
    // act: afterSkill(ctx, resultWithCleanResponse)
    expect(loader).toHaveBeenCalledWith("SG", "generic");
  });

  it("a config with NO marker threads medspa (byte-identical legacy path)", async () => {
    const loader = vi.fn().mockReturnValue([]);
    // arrange with a legacy config (no vertical field)
    expect(loader).toHaveBeenCalledWith("SG", "medspa");
  });

  it("cached-enforce fail-closed path threads the CACHED vertical", async () => {
    const loader = vi.fn().mockReturnValue([]);
    // arrange: postureCache.lastKnown returns { mode:"enforce", jurisdiction:"MY", clinicType:"nonMedical", vertical:"generic" };
    // resolver returns { status:"error" }
    expect(loader).toHaveBeenCalledWith("MY", "generic");
  });
});
```

(The comment lines above are instructions to the implementer: replace each with the concrete arrange/act code copied from the neighboring suite's pattern. The three `expect` lines are the contract.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- deterministic-safety-gate-vertical`
Expected: FAIL — loader called with one argument.

- [ ] **Step 3: Implement**

In `posture-cache.ts`:

```ts
import type { Vertical } from "../vertical.js";

export type GovernancePosture = {
  mode: GovernanceMode;
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
  vertical: Vertical;
};
```

In `deterministic-safety-gate.ts`: widen the dep type at L51 to `(jurisdiction: "SG" | "MY", vertical?: Vertical) => ReadonlyArray<BannedPhraseEntry>`; at the resolved path compute `const vertical = resolveVertical(config as Record<string, unknown>);` once, include `vertical` in `postureCache.remember(...)` (L124-128), and call `bannedPhraseLoader(config.jurisdiction, vertical)` (L134); at the cached path call `bannedPhraseLoader(posture.jurisdiction, posture.vertical)` (L240). Fix every other `remember(...)` call site the compiler now flags (tests included) by adding `vertical: "medspa"` or the threaded value.

- [ ] **Step 4: Run full core suite + typecheck (the compiler is the sweep for missed `remember` sites)**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages/core
git commit -m "feat(core): thread vertical through posture cache + output gate (SH-3)"
```

### Task 7: Pre-input gate threads vertical

**Files:**

- Modify: `packages/core/src/channel-gateway/pre-input-gate.ts:91-95` (remember), `:101` (loader call), cached path ~`:263`; the `escalationTriggerLoader` type in `packages/core/src/channel-gateway/types.ts`
- Test: `packages/core/src/channel-gateway/__tests__/pre-input-gate-vertical.test.ts`

**Interfaces:**

- Consumes: `resolveVertical`, updated `GovernancePosture`.
- Produces: `escalationTriggerLoader: (jurisdiction: "SG" | "MY", vertical?: Vertical) => ReadonlyArray<EscalationTriggerEntry>` in `ChannelGatewayConfig`.

- [ ] **Step 1: Write the failing test** — mirror Task 6's three cases against `runPreInputGate` (fake config with recording `escalationTriggerLoader`; assert `("SG","generic")`, legacy `("SG","medspa")`, and the cached-posture path `("MY","generic")`), following the arrange pattern of the existing `packages/core/src/channel-gateway/__tests__` pre-input gate suite.

- [ ] **Step 2: Run to verify FAIL**: `pnpm --filter @switchboard/core test -- pre-input-gate-vertical`

- [ ] **Step 3: Implement** — same three edits as Task 6: compute `const vertical = resolveVertical(governance as Record<string, unknown>)`, add to `postureCache.remember`, thread into both `escalationTriggerLoader(...)` calls, widen the loader type in `types.ts`.

- [ ] **Step 4: Verify**: `pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/core test` → PASS.

- [ ] **Step 5: Golden gate, commit, PR**

```bash
pnpm --filter @switchboard/core build && pnpm --filter @switchboard/eval-skill-prompt-golden test
git add -A packages/core
git commit -m "feat(core): thread vertical through the pre-input gate (SH-3)"
```

Open PR `feat/sh-3-thread-vertical-gates` → main. Also run `pnpm --filter @switchboard/api exec tsc --noEmit && pnpm --filter @switchboard/chat exec tsc --noEmit` before the PR (consumer packages wire these gates; the widened optional param must not break them).

---

## PR SH-4 — Floor observe config + provisioning case (branch `feat/sh-4-floor-provisioning`, packages: schemas, db, api)

### Task 8: `buildSafeHarborFloorConfig` in schemas

**Files:**

- Modify: `packages/schemas/src/governance-config.ts` (after `buildObserveGovernanceConfig`, ~L303)
- Test: `packages/schemas/src/__tests__/safe-harbor-floor-config.test.ts` (match the schemas package's existing test location convention; if tests are co-located without `__tests__`, follow that instead)

**Interfaces:**

- Produces: `type SafeHarborFloorConfig = ObserveGovernanceConfig & { vertical: "generic" }`; `buildSafeHarborFloorConfig(input: { jurisdiction: Jurisdiction }): SafeHarborFloorConfig`. Export both from the package index if `governance-config.ts` is re-exported selectively.

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/__tests__/safe-harbor-floor-config.test.ts
import { describe, it, expect } from "vitest";
import {
  buildSafeHarborFloorConfig,
  buildObserveGovernanceConfig,
  GovernanceConfigSchema,
} from "../governance-config.js";

describe("buildSafeHarborFloorConfig (SH-4)", () => {
  it("is the observe posture + nonMedical + the generic vertical marker", () => {
    const floor = buildSafeHarborFloorConfig({ jurisdiction: "SG" });
    expect(floor).toEqual({
      ...buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "nonMedical" }),
      vertical: "generic",
    });
  });

  it("parses through GovernanceConfigSchema (passthrough carries the marker)", () => {
    const parsed = GovernanceConfigSchema.parse(buildSafeHarborFloorConfig({ jurisdiction: "MY" }));
    expect((parsed as Record<string, unknown>).vertical).toBe("generic");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**: `pnpm --filter @switchboard/schemas test -- safe-harbor-floor`

- [ ] **Step 3: Implement**

```ts
/** The universal safe-harbor floor posture (S1 of the one-product-many-doors
 * design): all gates observe, clinicType nonMedical (the less-medical-assuming
 * pre-L1 placeholder), plus the passthrough `vertical: "generic"` marker the
 * gates read (via core's resolveVertical) to thread the generic loader tables.
 * At L1 this becomes the default profile the registry returns (spec D5). */
export type SafeHarborFloorConfig = ObserveGovernanceConfig & { vertical: "generic" };

export function buildSafeHarborFloorConfig(input: {
  jurisdiction: Jurisdiction;
}): SafeHarborFloorConfig {
  return {
    ...buildObserveGovernanceConfig({ jurisdiction: input.jurisdiction, clinicType: "nonMedical" }),
    vertical: "generic",
  };
}
```

- [ ] **Step 4: Verify**: `pnpm --filter @switchboard/schemas exec tsc --noEmit && pnpm --filter @switchboard/schemas test` → PASS, then `pnpm --filter @switchboard/schemas build`.

- [ ] **Step 5: Commit**: `git add -A packages/schemas && git commit -m "feat(schemas): buildSafeHarborFloorConfig floor posture factory (SH-4)"`

### Task 9: `generic` provisioning case in the pack selector

**Files:**

- Modify: `packages/db/src/seed/pack-governance-config.ts:15` (union) and `:61-75` (switch)
- Test: `packages/db/src/seed/__tests__/pack-governance-config-generic.test.ts`

**Interfaces:**

- Produces: `ProvisioningVertical = "medspa" | "generic"`; `selectPackGovernanceConfig({ vertical: "generic", market })` returns `buildSafeHarborFloorConfig({ jurisdiction: market })`. Declared return type stays `ObserveGovernanceConfig` (`SafeHarborFloorConfig` is structurally assignable; the marker rides through as a passthrough property).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/seed/__tests__/pack-governance-config-generic.test.ts
import { describe, it, expect } from "vitest";
import { selectPackGovernanceConfig } from "../pack-governance-config.js";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "../medspa-governance-config.js";
import { buildSafeHarborFloorConfig } from "@switchboard/schemas";

describe("selectPackGovernanceConfig generic case (SH-4)", () => {
  it("generic/SG returns the safe-harbor floor with the vertical marker", () => {
    expect(selectPackGovernanceConfig({ vertical: "generic", market: "SG" })).toEqual(
      buildSafeHarborFloorConfig({ jurisdiction: "SG" }),
    );
  });

  it("generic/MY threads the market", () => {
    const config = selectPackGovernanceConfig({ vertical: "generic", market: "MY" });
    expect(config.jurisdiction).toBe("MY");
    expect(config.clinicType).toBe("nonMedical");
  });

  it("medspa/SG default is UNCHANGED: the exact constant by reference", () => {
    expect(selectPackGovernanceConfig()).toBe(MEDSPA_PILOT_GOVERNANCE_CONFIG);
    expect(selectPackGovernanceConfig({ vertical: "medspa", market: "SG" })).toBe(
      MEDSPA_PILOT_GOVERNANCE_CONFIG,
    );
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (type error on `vertical: "generic"`): `pnpm --filter @switchboard/db exec tsc --noEmit`

- [ ] **Step 3: Implement** — extend the union and add the case above the exhaustiveness default:

```ts
export type ProvisioningVertical = "medspa" | "generic";
```

```ts
    case "generic":
      // The universal safe-harbor floor (S1): observe posture + generic
      // claim-boundary tables via the vertical marker. The self-serve default
      // for any onboarding that selects no vetted pack.
      return buildSafeHarborFloorConfig({ jurisdiction: market });
```

(add `buildSafeHarborFloorConfig` to the existing `@switchboard/schemas` import). The db twin seeder `ensureAlexForOrg` (`packages/db/src/seed/provision-org-agents.ts`) already routes through this selector post-#1380; verify with `grep -n "selectPackGovernanceConfig" packages/db/src/seed/provision-org-agents.ts` that it threads its input, and only if it hardcodes medspa, thread the vertical/market params through — both seeders MUST expose the generic path (dual-seeder gotcha).

- [ ] **Step 4: Verify**: `pnpm --filter @switchboard/db exec tsc --noEmit && pnpm --filter @switchboard/db test` → PASS, then `pnpm --filter @switchboard/db build`.

- [ ] **Step 5: Commit**: `git add -A packages/db && git commit -m "feat(db): generic safe-harbor provisioning case in the pack selector (SH-4)"`

### Task 10: Invert the api `governanceSeedContext` precedence (the D5 trap)

**Files:**

- Modify: `apps/api/src/lib/ensure-alex-listing.ts:75-80`
- Test: `apps/api/src/__tests__/ensure-alex-listing-precedence.test.ts` (flat in `__tests__`, mirroring `api-organizations.test.ts` fakes)

**Interfaces:**

- Consumes: `selectPackGovernanceConfig` (Task 9). Options interface unchanged (both fields stay optional).
- Produces: precedence contract — an explicit `opts.vertical` ALWAYS routes through the pack selector, even when `governanceSeedContext` is also present; no vertical + seedContext keeps today's behavior; neither keeps the medspa/SG default.

- [ ] **Step 1: Write the failing test** — three cases using the same mocked-Prisma pattern as `api-organizations.test.ts` (db tests mock Prisma; capture the `governanceConfig` passed to `agentDeployment.upsert`):

```ts
// the three contracts to assert on the captured create.governanceConfig:
// 1. { vertical: "generic", market: "MY", governanceSeedContext: {jurisdiction:"SG",clinicType:"medical"} }
//    -> vertical wins: config.vertical === "generic", config.jurisdiction === "MY", clinicType === "nonMedical"
// 2. { governanceSeedContext: {jurisdiction:"MY",clinicType:"medical"} } (the organizations.ts hot path)
//    -> unchanged legacy: config.jurisdiction === "MY", clinicType === "medical", config.vertical === undefined
// 3. {} -> the medspa/SG pilot constant shape (jurisdiction "SG", clinicType "medical")
```

Write these as real vitest cases with the suite's fake `db` object; the comment block is the contract each case asserts.

- [ ] **Step 2: Run to verify case 1 FAILS** (today seedContext shadows the selector): `pnpm --filter @switchboard/api test -- ensure-alex-listing-precedence`

- [ ] **Step 3: Implement** — replace the ternary at `ensure-alex-listing.ts:78-80`:

```ts
// Precedence (spec D5): an EXPLICIT onboarding vertical always routes through the
// shared pack/floor selector; the timezone-derived seed context only fills the gap
// when no vertical is threaded. Without this inversion the organizations.ts hot path
// (which always passes a seed context) would silently stamp a self-serve generic
// agent with a medspa-medical observe config.
const governanceConfig = opts.vertical
  ? selectPackGovernanceConfig({ vertical: opts.vertical, market: opts.market })
  : opts.governanceSeedContext
    ? buildObserveGovernanceConfig(opts.governanceSeedContext)
    : selectPackGovernanceConfig({ vertical: opts.vertical, market: opts.market });
```

- [ ] **Step 4: Verify** — rebuild lower layers first, then: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/db build && pnpm --filter @switchboard/api exec tsc --noEmit && pnpm --filter @switchboard/api test` → PASS including the untouched `api-organizations.test.ts` (proves the hot path is byte-identical).

- [ ] **Step 5: Golden gate, commit, PR**

```bash
pnpm --filter @switchboard/eval-skill-prompt-golden test
git add -A apps/api
git commit -m "fix(api): explicit provisioning vertical wins over governanceSeedContext (SH-4)"
```

Open PR `feat/sh-4-floor-provisioning` → main (requires SH-2 merged for the marker consumers to exist; SH-3 recommended first so a generic config is enforced-correctly end to end).

---

## PR SH-5 — Prompt floor via pack override (branch `feat/sh-5-prompt-floor`, packages: core + skills)

### Task 11: `loadSkill` pack override

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-loader.ts:192` (signature) and `:234` (packDir)
- Test: `packages/core/src/skill-runtime/__tests__/skill-loader-pack-override.test.ts`

**Interfaces:**

- Produces: `loadSkill(slug: string, skillsDir: string, options?: { packOverride?: string }): SkillDefinition`. Omitted options → byte-identical to today (frontmatter `pack:` wins). The override selects `<skillsDir>/<slug>/packs/<packOverride>/` and inherits composePackBody's fail-closed behavior for a missing/empty pack dir.

- [ ] **Step 1: Write the failing test** — use a temp-dir fixture skill (mirror the existing skill-loader test fixtures pattern in `packages/core/src/skill-runtime/__tests__/`): a SKILL.md with `pack: medspa` frontmatter and one `<!-- @pack:safety-escalation -->` marker, plus `packs/medspa/safety-escalation.md` ("MEDSPA BLOCK") and `packs/generic/safety-escalation.md` ("GENERIC BLOCK"). Assert:

```ts
it("no options -> frontmatter pack (byte-identical)", () => {
  expect(loadSkill("fixture", dir).body).toContain("MEDSPA BLOCK");
});
it("packOverride selects the generic pack dir", () => {
  const body = loadSkill("fixture", dir, { packOverride: "generic" }).body;
  expect(body).toContain("GENERIC BLOCK");
  expect(body).not.toContain("MEDSPA BLOCK");
});
it("override to a missing pack dir fails closed (SkillValidationError)", () => {
  expect(() => loadSkill("fixture", dir, { packOverride: "nope" })).toThrow(/does not exist/);
});
```

- [ ] **Step 2: Run to verify FAIL**: `pnpm --filter @switchboard/core test -- skill-loader-pack-override`

- [ ] **Step 3: Implement** — signature `export function loadSkill(slug: string, skillsDir: string, options?: { packOverride?: string }): SkillDefinition` and:

```ts
const packName = options?.packOverride ?? frontmatter.pack;
const packDir = packName ? join(skillsDir, slug, "packs", packName) : undefined;
```

- [ ] **Step 4: Verify**: `pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/core test` → PASS.

- [ ] **Step 5: Commit**: `git add -A packages/core && git commit -m "feat(core): loadSkill pack override for per-deployment pack selection (SH-5)"`

### Task 12: Author the generic floor block

**Files:**

- Create: `skills/alex/packs/generic/safety-escalation.md`
- Test: extend `packages/core/src/skill-runtime/__tests__/skill-loader-pack-override.test.ts` with one case loading the REAL alex skill

**Interfaces:**

- Produces: the floor persona block. Content contract (the affirmative boundaries that ride the prompt floor, spec D3): always disclose AI when asked or when it materially matters; never diagnose or give medical advice; never guarantee outcomes; never give financial or legal advice; on any regulated topic (medical, financial, legal, insurance-product specifics) escalate to the human owner and say so plainly.

- [ ] **Step 1: Write the failing test**

```ts
it("the real alex skill renders the generic floor block under packOverride", () => {
  // skillsDir: resolve the repo's skills/ dir the same way the golden harness fixtures do
  const def = loadSkill("alex", repoSkillsDir, { packOverride: "generic" });
  expect(def.body).toContain("never diagnose");
  expect(def.body).toContain("financial or legal advice");
});
```

- [ ] **Step 2: Run to verify FAIL** (missing pack file, composePackBody throws): `pnpm --filter @switchboard/core test -- skill-loader-pack-override`

- [ ] **Step 3: Author `skills/alex/packs/generic/safety-escalation.md`** with the floor block. Match the register and formatting of `skills/alex/packs/medspa/safety-escalation.md` (read it first; keep the same heading depth and instruction voice). Content must express, in the skill's house style: AI disclosure, never diagnose / no medical advice, never guarantee outcomes, no financial or legal advice, escalate regulated topics to the human owner. Do not copy medspa-specific procedures or SG/MY clinical references into it.

- [ ] **Step 4: Verify + golden gate** — `pnpm --filter @switchboard/core test` then `pnpm --filter @switchboard/eval-skill-prompt-golden test`. Golden MUST be zero-diff: the four medspa fixtures never reference the generic pack (disjoint render, spec D2).

- [ ] **Step 5: Commit, PR**

```bash
git add skills/alex/packs/generic packages/core
git commit -m "feat(core,skills): generic safe-harbor prompt floor block (SH-5)"
```

Open PR `feat/sh-5-prompt-floor` → main. PR body must note: live per-deployment wiring (deployment vertical → `packOverride`) lands with S3 self-serve signup provisioning; SH-5 delivers the mechanism, content, and fail-closed tests.

---

## Out of scope (do not bundle into any SH PR)

The L1 open-profile refactor (rescoped per PR #1391 Section 8, its own plan), fitness door content, self-serve signup/onboarding (S3), Stripe payment link (S5), ad kit (S6), any new regulatory profile, and the S3 wiring that passes a deployment's vertical into `loadSkill`'s `packOverride`.
