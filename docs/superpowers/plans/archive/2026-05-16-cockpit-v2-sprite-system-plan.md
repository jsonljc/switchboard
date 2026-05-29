# Cockpit v2 Sprite System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cockpit's letter-monogram avatars (Identity, EmptyState, ApprovalCard) with the design package's pixel-sprite system, plus 3 small ApprovalCard / Riley page polish items. Frontend-only.

**Architecture:** New module at `apps/dashboard/src/components/cockpit/sprite/` ports the design's sprite engine (`sprite.jsx`, `sprites.jsx`, `riley-sprites.jsx`) into typed TS. Two consumer-facing components (`SpriteFrame`, `SpriteChip`) wrap the engine with letter-monogram fallback. Three cockpit components (`identity.tsx`, `empty-state.tsx`, `approval-card.tsx`) swap their letter renders for sprite components; `riley-cockpit-page.tsx` gets a `today` prop bug-fix. Zero backend / Prisma / env-var changes.

**Tech Stack:** TypeScript, React 18, Next.js 14 App Router, Vitest + React Testing Library, Tailwind CSS (cockpit uses inline `T.*` tokens from `tokens.ts` — not Tailwind utility classes — so no Tailwind work).

**Spec:** `docs/superpowers/specs/2026-05-16-cockpit-v2-sprite-system-design.md` — every task must respect §14 Implementation Guardrail. If a step looks like it would violate one of the explicit "MUST NOT" items there (Settings UI, localStorage, URL toggle, schema column, animation easing, won-state trigger, telemetry, exporting sprite components from the package boundary), STOP and revisit the plan instead of widening scope.

**Audit:** `docs/superpowers/audits/2026-05-16-cockpit-v2-audit.md`

---

## Pre-implementation verification gates

Before Task 1 step 1, run these and confirm reality matches the plan's assumptions. If reality diverges, patch the plan locally rather than executing on stale assumptions.

1. **Branch / worktree state:**

```bash
git branch --show-current && git log --oneline -5
```

Expected: branch is `feat/cockpit-v2-sprite-system`. HEAD line includes `docs(spec): correct Riley variant keys` (`1d857239`); the four commits below it are the spec-fix, the spec, the audit, and the latest origin/main commit. Tree is clean.

2. **Existing cockpit components match plan expectations:**

```bash
grep -n "AvatarFrame\|avatarLetter" apps/dashboard/src/components/cockpit/identity.tsx apps/dashboard/src/components/cockpit/approval-card.tsx apps/dashboard/src/components/cockpit/empty-state.tsx | head -20
```

Expected: `identity.tsx` has `AvatarFrame` local component (~line 33) consumed at ~line 88; `approval-card.tsx` exposes `avatarLetter` prop at ~line 31 used at ~line 70; `empty-state.tsx` renders a literal `"A"` inside a span at ~line 88.

3. **Test framework + threshold:**

```bash
grep -A1 "thresholds" apps/dashboard/vitest.config.ts | head -10
```

Expected: dashboard coverage thresholds are around 40/35/40/40 (per `feedback_dashboard_coverage_threshold` memory). New `sprite/` module should clear 70%+ on its own.

4. **Design source files present:**

```bash
ls "docs/design-prompts/locked/switchboard/project/agent-home-v3/"{sprite.jsx,sprites.jsx,riley-sprites.jsx}
```

Expected: all three files exist and are readable. These are read-only design sources; do not modify them.

5. **`animState` selector already exists:**

```bash
grep -n "function animState" apps/dashboard/src/lib/cockpit/alex-config.ts apps/dashboard/src/lib/cockpit/riley/riley-config.ts
```

Expected: `alex-config.ts` exports `animState(key, halted)` returning `"sleep" | "draft" | "idle"`; `riley/riley-config.ts` either has the same or is missing it. If missing, Task 11 adds it; otherwise reuses what's there.

If any gate fails, fix or patch the plan inline before continuing.

---

## File structure

**New files (all under `apps/dashboard/src/components/cockpit/sprite/`):**

| File                                | Responsibility                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | ---- | ------ |
| `types.ts`                          | `SpriteVariantKey`, `SpriteState`, `Frame`, `Palette`, `VariantBundle`, `VariantDef` type definitions                |
| `build-sprite.ts`                   | `buildSprite(commands)` + `mergeSprite(base, commands)` — frame composition helpers (test-only / future-author-only) |
| `pixel-sprite.tsx`                  | `<PixelSprite rows palette size />` — SVG renderer of one frame                                                      |
| `use-frame-cycle.ts`                | `useFrameCycle(frames, { playing })` — frame swap hook with empty/single/multi/paused semantics                      |
| `animated-sprite.tsx`               | `<AnimatedSprite frames palette size />` — combines cycle + renderer                                                 |
| `sprite-frame.tsx`                  | `<SpriteFrame bundle variant state size accentSoft fallbackLetter />` — consumer-facing rounded frame with fallback  |
| `sprite-chip.tsx`                   | `<SpriteChip bundle variant state ... />` — 22px inline chip variant                                                 |
| `alex-variants.ts`                  | `ALEX_VARIANTS: VariantBundle` exporting `classic                                                                    | operator | cozy | agent` |
| `riley-variants.ts`                 | `RILEY_VARIANTS: VariantBundle` exporting `analyst                                                                   | trader   | bot` |
| `__tests__/build-sprite.test.ts`    | covers builders + variant snapshot per bundle key                                                                    |
| `__tests__/pixel-sprite.test.tsx`   | rect-count + fill-color from palette                                                                                 |
| `__tests__/use-frame-cycle.test.ts` | empty/single/multi/paused cases with fake timers                                                                     |
| `__tests__/sprite-frame.test.tsx`   | sprite render + both fallback paths                                                                                  |
| `__tests__/sprite-chip.test.tsx`    | sprite render + both fallback paths                                                                                  |

**Modified files:**

| File                                                                          | Change                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/cockpit/alex-config.ts`                               | Add `DEFAULT_ALEX_VARIANT` constant; ensure `animState` is exported (already is)                                                                                 |
| `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`                        | Add `DEFAULT_RILEY_VARIANT` constant; add `animState` function (currently missing)                                                                               |
| `apps/dashboard/src/components/cockpit/identity.tsx`                          | Replace `AvatarFrame` with `<SpriteFrame>`; add `bundle` + `variant` props + `state` prop; remove `AvatarFrame` local component                                  |
| `apps/dashboard/src/components/cockpit/empty-state.tsx`                       | Replace 48px literal "A" span (~line 70-89) with `<SpriteFrame bundle={ALEX_VARIANTS} variant={DEFAULT_ALEX_VARIANT} state="idle" ... />`                        |
| `apps/dashboard/src/components/cockpit/approval-card.tsx`                     | Replace 22px letter chip (~line 54-71) with `<SpriteChip>`; add `tertiaryLabel`/`onTertiary`/`campaign` props and rendering                                      |
| `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`                | Pass `today={formatToday(new Date())}` to `<ActivityStream>` (currently omitted)                                                                                 |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx`                      | Pass `bundle={ALEX_VARIANTS}` + `variant={DEFAULT_ALEX_VARIANT}` to `<Identity>` and `<EmptyState>` and per-approval `<ApprovalCard>` (or via `AlexApprovalRow`) |
| `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx`                   | Pass `bundle` / `variant` through to `<ApprovalCard>` (Riley row similarly)                                                                                      |
| `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`           | Add sprite-render case + fallback case                                                                                                                           |
| `apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx`        | Add sprite-render case                                                                                                                                           |
| `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`      | Add sprite-chip case + `tertiaryLabel`/`campaign` cases                                                                                                          |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` | Add `today` prop assertion                                                                                                                                       |

---

## Task 1: Sprite type definitions

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/types.ts`

- [ ] **Step 1.1: Create the types file**

Write `apps/dashboard/src/components/cockpit/sprite/types.ts`:

```typescript
// Sprite type definitions for cockpit v2 pixel avatars.
// All keys are runtime strings; the cockpit hard-codes one variant per agent
// (see DEFAULT_ALEX_VARIANT / DEFAULT_RILEY_VARIANT) so users never type these.

export type SpriteState = "idle" | "draft" | "sleep" | "won";

/** Bundle-scoped variant key. ALEX_VARIANTS has classic/operator/cozy/agent;
 *  RILEY_VARIANTS has analyst/trader/bot. Use `string` at the type level
 *  (callers always pass a literal constant); runtime lookup against the bundle
 *  is the source of truth. */
export type SpriteVariantKey = string;

/** A single frame: 24 strings of 24 chars each. `.` and ` ` = transparent;
 *  other chars are palette keys. Frame builders enforce 24-char rows. */
export type Frame = readonly string[];

/** Palette: single-char key → CSS color string. */
export type Palette = Readonly<Record<string, string>>;

/** One animation frame in a cycle: the frame grid + how long it stays on screen. */
export interface AnimFrame {
  rows: Frame;
  dur: number;
}

export interface VariantDef {
  /** Human-readable name (e.g., "Alex Classic"). Not rendered today; kept for
   *  future Settings / debug surfaces. */
  name: string;
  /** Short blurb explaining the variant. Future Settings copy. */
  blurb: string;
  palette: Palette;
  states: Record<SpriteState, readonly AnimFrame[]>;
}

export type VariantBundle = Readonly<Record<SpriteVariantKey, VariantDef>>;

/** A drawing command for buildSprite / mergeSprite. Test-only / future-author-only;
 *  product code consumes pre-built Frame arrays, not commands. */
export type SpriteCommand =
  | readonly ["rect", number, number, number, number, string]
  | readonly ["row", number, number, string]
  | readonly ["col", number, number, string]
  | readonly ["px", number, number, string]
  | readonly ["clear", number, number, number, number]
  | readonly ["rows", number, number, readonly string[]];
```

- [ ] **Step 1.2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`

Expected: PASS (no callers yet — the file just declares types).

- [ ] **Step 1.3: Hold the commit until Task 8** — every task in commit #1 piles into the same commit per spec §10.

---

## Task 2: `buildSprite` + `mergeSprite` helpers + tests

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/build-sprite.ts`
- Create: `apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSprite, mergeSprite, SPRITE_SIZE } from "../build-sprite";
import type { SpriteCommand } from "../types";

describe("buildSprite", () => {
  it("returns a 24×24 grid of '.' characters when given no commands", () => {
    const grid = buildSprite([]);
    expect(grid).toHaveLength(SPRITE_SIZE);
    grid.forEach((row) => {
      expect(row).toHaveLength(SPRITE_SIZE);
      expect(row).toBe(".".repeat(SPRITE_SIZE));
    });
  });

  it("applies a rect command", () => {
    const commands: SpriteCommand[] = [["rect", 2, 3, 4, 2, "K"]];
    const grid = buildSprite(commands);
    expect(grid[3].substring(2, 6)).toBe("KKKK");
    expect(grid[4].substring(2, 6)).toBe("KKKK");
    expect(grid[5]).toBe(".".repeat(SPRITE_SIZE)); // outside rect
  });

  it("applies a row command and skips underscore + space placeholders", () => {
    const commands: SpriteCommand[] = [["row", 1, 0, "AB_CD EF"]];
    const grid = buildSprite(commands);
    expect(grid[1].substring(0, 8)).toBe("AB.CD.EF");
  });

  it("applies a col command", () => {
    const commands: SpriteCommand[] = [["col", 3, 1, "XYZ"]];
    const grid = buildSprite(commands);
    expect(grid[1][3]).toBe("X");
    expect(grid[2][3]).toBe("Y");
    expect(grid[3][3]).toBe("Z");
  });

  it("applies a px command", () => {
    const grid = buildSprite([["px", 10, 10, "M"]]);
    expect(grid[10][10]).toBe("M");
    expect(grid[10][9]).toBe(".");
  });

  it("applies a rows multi-row command", () => {
    const grid = buildSprite([["rows", 0, 0, ["AA", "BB", "CC"]]]);
    expect(grid[0].substring(0, 2)).toBe("AA");
    expect(grid[1].substring(0, 2)).toBe("BB");
    expect(grid[2].substring(0, 2)).toBe("CC");
  });

  it("ignores commands that draw off-grid (no crash)", () => {
    const grid = buildSprite([["px", 100, 100, "K"]]);
    expect(grid).toHaveLength(SPRITE_SIZE);
    grid.forEach((row) => expect(row).toBe(".".repeat(SPRITE_SIZE)));
  });
});

describe("mergeSprite", () => {
  it("overlays new pixels on a base grid", () => {
    const base = buildSprite([["rect", 0, 0, 24, 24, "K"]]);
    const merged = mergeSprite(base, [["px", 0, 0, "M"]]);
    expect(merged[0][0]).toBe("M");
    expect(merged[0][1]).toBe("K"); // base preserved
  });

  it("supports the clear command (overlay-only; sets cells to '.')", () => {
    const base = buildSprite([["rect", 0, 0, 24, 24, "K"]]);
    const merged = mergeSprite(base, [["clear", 0, 0, 2, 2]]);
    expect(merged[0][0]).toBe(".");
    expect(merged[0][1]).toBe(".");
    expect(merged[0][2]).toBe("K");
    expect(merged[2][0]).toBe("K");
  });
});
```

- [ ] **Step 2.2: Run the failing test**

Run: `pnpm --filter @switchboard/dashboard test sprite/build-sprite`

Expected: FAIL — `Cannot find module '../build-sprite'`.

- [ ] **Step 2.3: Implement `build-sprite.ts`**

Create `apps/dashboard/src/components/cockpit/sprite/build-sprite.ts`:

```typescript
// Frame composition helpers ported from design's sprite.jsx:5-93.
// Test-only / future-author-only: product code consumes pre-built Frame arrays
// from alex-variants.ts / riley-variants.ts (which were authored by running
// the builders in the design canvas), not buildSprite calls at runtime.

import type { Frame, SpriteCommand } from "./types";

export const SPRITE_SIZE = 24;

function isSkip(ch: string | undefined): boolean {
  return ch === undefined || ch === "_" || ch === " ";
}

function applyCommand(grid: string[][], cmd: SpriteCommand): void {
  const setPx = (x: number, y: number, c: string): void => {
    if (x >= 0 && x < SPRITE_SIZE && y >= 0 && y < SPRITE_SIZE && c) {
      grid[y][x] = c;
    }
  };
  switch (cmd[0]) {
    case "rect": {
      const [, x, y, w, h, c] = cmd;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) setPx(xx, yy, c);
      }
      return;
    }
    case "row": {
      const [, y, x, str] = cmd;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (!isSkip(ch)) setPx(x + i, y, ch);
      }
      return;
    }
    case "col": {
      const [, x, y, str] = cmd;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (!isSkip(ch)) setPx(x, y + i, ch);
      }
      return;
    }
    case "px": {
      const [, x, y, c] = cmd;
      setPx(x, y, c);
      return;
    }
    case "clear": {
      const [, x, y, w, h] = cmd;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) setPx(xx, yy, ".");
      }
      return;
    }
    case "rows": {
      const [, y, x, arr] = cmd;
      for (let i = 0; i < arr.length; i++) {
        const row = arr[i] ?? "";
        for (let j = 0; j < row.length; j++) {
          const ch = row[j];
          if (!isSkip(ch)) setPx(x + j, y + i, ch);
        }
      }
      return;
    }
  }
}

export function buildSprite(commands: readonly SpriteCommand[]): Frame {
  const grid: string[][] = Array.from({ length: SPRITE_SIZE }, () =>
    Array<string>(SPRITE_SIZE).fill("."),
  );
  for (const cmd of commands) applyCommand(grid, cmd);
  return grid.map((row) => row.join(""));
}

export function mergeSprite(base: Frame, commands: readonly SpriteCommand[]): Frame {
  const grid: string[][] = base.map((row) => row.split(""));
  for (const cmd of commands) applyCommand(grid, cmd);
  return grid.map((row) => row.join(""));
}
```

- [ ] **Step 2.4: Run the test, verify pass**

Run: `pnpm --filter @switchboard/dashboard test sprite/build-sprite`

Expected: PASS — all 8 tests green.

---

## Task 3: `<PixelSprite>` renderer + tests

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/pixel-sprite.tsx`
- Create: `apps/dashboard/src/components/cockpit/sprite/__tests__/pixel-sprite.test.tsx`

- [ ] **Step 3.1: Write the failing test**

Create `apps/dashboard/src/components/cockpit/sprite/__tests__/pixel-sprite.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PixelSprite } from "../pixel-sprite";
import type { Palette, Frame } from "../types";

const PAL: Palette = { K: "#000000", S: "#ff0000" };

// Build a tiny test frame: top-left pixel = K, next = S, rest transparent.
function makeFrame(): Frame {
  const blank = ".".repeat(24);
  const top = "KS" + blank.substring(2);
  return [top, ...Array(23).fill(blank)];
}

describe("<PixelSprite>", () => {
  it("renders one <rect> per non-transparent pixel using the palette color", () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size={48} />);
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(2);
    expect(rects[0].getAttribute("fill")).toBe("#000000");
    expect(rects[1].getAttribute("fill")).toBe("#ff0000");
  });

  it("emits an svg with viewBox 0 0 24 24 and crispEdges rendering", () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg?.getAttribute("width")).toBe("48");
    expect(svg?.getAttribute("height")).toBe("48");
  });

  it("treats palette keys not in the palette object as transparent (skipped)", () => {
    const partial: Palette = { K: "#000000" }; // S deliberately missing
    const { container } = render(<PixelSprite rows={makeFrame()} palette={partial} size={48} />);
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(1); // S skipped because not in palette
    expect(rects[0].getAttribute("fill")).toBe("#000000");
  });

  it("is aria-hidden by default (decorative)", () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 3.2: Run, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test sprite/pixel-sprite`

Expected: FAIL — `Cannot find module '../pixel-sprite'`.

- [ ] **Step 3.3: Implement `pixel-sprite.tsx`**

Create `apps/dashboard/src/components/cockpit/sprite/pixel-sprite.tsx`:

```typescript
import type { CSSProperties } from "react";
import type { Frame, Palette } from "./types";
import { SPRITE_SIZE } from "./build-sprite";

export interface PixelSpriteProps {
  rows: Frame;
  palette: Palette;
  size: number;
  style?: CSSProperties;
}

/** SVG renderer for one 24×24 sprite frame. One `<rect>` per opaque pixel.
 *  Decorative; always aria-hidden. */
export function PixelSprite({ rows, palette, size, style }: PixelSpriteProps) {
  const rects: JSX.Element[] = [];
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const ch = row[x];
      if (!ch || ch === "." || ch === " ") continue;
      const color = palette[ch];
      if (!color) continue;
      rects.push(<rect key={`${x}_${y}`} x={x} y={y} width={1.02} height={1.02} fill={color} />);
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: "block", ...style }}
    >
      {rects}
    </svg>
  );
}
```

- [ ] **Step 3.4: Run, verify pass**

Run: `pnpm --filter @switchboard/dashboard test sprite/pixel-sprite`

Expected: PASS — 4 tests green.

---

## Task 4: `useFrameCycle` hook + tests

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/use-frame-cycle.ts`
- Create: `apps/dashboard/src/components/cockpit/sprite/__tests__/use-frame-cycle.test.ts`

This task implements the tightened semantics from spec §5.3 — empty/single/multi/paused/unmount cases must all behave deterministically.

- [ ] **Step 4.1: Write the failing test**

Create `apps/dashboard/src/components/cockpit/sprite/__tests__/use-frame-cycle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFrameCycle } from "../use-frame-cycle";
import type { AnimFrame } from "../types";

const F1: AnimFrame = { rows: ["a".repeat(24)], dur: 600 };
const F2: AnimFrame = { rows: ["b".repeat(24)], dur: 600 };

describe("useFrameCycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns null when frames is empty", () => {
    const { result } = renderHook(() => useFrameCycle([], {}));
    expect(result.current).toBeNull();
  });

  it("returns the single frame statically when frames.length === 1 (no timer scheduled)", () => {
    const { result } = renderHook(() => useFrameCycle([F1], {}));
    expect(result.current).toBe(F1.rows);
    // Advance timer beyond any plausible dur — should still be F1.
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(F1.rows);
  });

  it("cycles through frames according to each frame's dur", () => {
    const { result } = renderHook(() => useFrameCycle([F1, F2], {}));
    expect(result.current).toBe(F1.rows);
    act(() => vi.advanceTimersByTime(F1.dur));
    expect(result.current).toBe(F2.rows);
    act(() => vi.advanceTimersByTime(F2.dur));
    expect(result.current).toBe(F1.rows); // wraps
  });

  it("returns the first frame statically when playing=false (no timer)", () => {
    const { result } = renderHook(() => useFrameCycle([F1, F2], { playing: false }));
    expect(result.current).toBe(F1.rows);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(F1.rows);
  });

  it("clears the timer on unmount (no leftover callbacks)", () => {
    const { unmount } = renderHook(() => useFrameCycle([F1, F2], {}));
    unmount();
    // If timer leaked, vi would warn; advancing time after unmount is a no-op.
    act(() => vi.advanceTimersByTime(60_000));
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 4.2: Run, verify fail**

Run: `pnpm --filter @switchboard/dashboard test sprite/use-frame-cycle`

Expected: FAIL — `Cannot find module '../use-frame-cycle'`.

- [ ] **Step 4.3: Implement `use-frame-cycle.ts`**

Create `apps/dashboard/src/components/cockpit/sprite/use-frame-cycle.ts`:

```typescript
import { useEffect, useState } from "react";
import type { AnimFrame, Frame } from "./types";

export interface UseFrameCycleOptions {
  playing?: boolean;
}

/** Frame-swap hook. Semantics (spec §5.3):
 *  - frames.length === 0 → returns null. No timer.
 *  - frames.length === 1 → returns frames[0].rows statically. No timer.
 *  - frames.length >= 2 → cycles via setTimeout per frame.dur. Timer cleared on unmount.
 *  - playing === false → returns frames[0].rows statically regardless of count. No timer. */
export function useFrameCycle(
  frames: readonly AnimFrame[],
  { playing = true }: UseFrameCycleOptions = {},
): Frame | null {
  const [idx, setIdx] = useState(0);
  const length = frames.length;
  const shouldCycle = playing && length >= 2;
  useEffect(() => {
    if (!shouldCycle) return;
    const f = frames[idx % length];
    const t = setTimeout(() => setIdx((i) => (i + 1) % length), f?.dur ?? 400);
    return () => clearTimeout(t);
  }, [idx, frames, shouldCycle, length]);
  if (length === 0) return null;
  return frames[idx % length]?.rows ?? frames[0]!.rows;
}
```

- [ ] **Step 4.4: Run, verify pass**

Run: `pnpm --filter @switchboard/dashboard test sprite/use-frame-cycle`

Expected: PASS — 5 tests green.

---

## Task 5: `<AnimatedSprite>` wrapper (no separate test)

Combines `useFrameCycle` and `PixelSprite`. Coverage comes from `sprite-frame.test.tsx` (Task 9) which exercises this component via the public consumer.

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/animated-sprite.tsx`

- [ ] **Step 5.1: Implement `animated-sprite.tsx`**

```typescript
import type { CSSProperties } from "react";
import type { AnimFrame, Palette } from "./types";
import { PixelSprite } from "./pixel-sprite";
import { useFrameCycle } from "./use-frame-cycle";

export interface AnimatedSpriteProps {
  frames: readonly AnimFrame[];
  palette: Palette;
  size: number;
  playing?: boolean;
  style?: CSSProperties;
}

export function AnimatedSprite({ frames, palette, size, playing, style }: AnimatedSpriteProps) {
  const rows = useFrameCycle(frames, { playing });
  if (!rows) return null;
  return <PixelSprite rows={rows} palette={palette} size={size} style={style} />;
}
```

- [ ] **Step 5.2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`

Expected: PASS.

---

## Task 6: Port Alex variant data

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/alex-variants.ts`

This is the bulk of the LOC. The frames are byte-identical to the design's `sprites.jsx` — the port just:

- Removes the `R(s)` dev sanity helper (or imports it locally)
- Replaces `buildSprite(...)` / `mergeSprite(...)` calls with the typed imports
- Removes the `Object.assign(window, { ALEX_VARIANTS })` line and replaces with `export const ALEX_VARIANTS`
- Adds `import type { VariantBundle } from "./types"` + `import { buildSprite, mergeSprite } from "./build-sprite"`

- [ ] **Step 6.1: Copy the design's sprites.jsx structure to alex-variants.ts**

Read the design file:

```bash
wc -l docs/design-prompts/locked/switchboard/project/agent-home-v3/sprites.jsx
```

Expected: ~500 lines.

Create `apps/dashboard/src/components/cockpit/sprite/alex-variants.ts`. Skeleton:

```typescript
// Alex pixel-sprite variants — 24×24 grids.
// Ported byte-identical from docs/design-prompts/locked/switchboard/project/agent-home-v3/sprites.jsx.
// Frame literals are NOT to be edited; if the design updates, re-port the file.

import { buildSprite, mergeSprite } from "./build-sprite";
import type { Frame, Palette, VariantBundle } from "./types";

// Inline row-length sanity check. Throws in dev, silently passes the string in prod.
// (Design's sprites.jsx uses console.warn; we throw because a malformed row is a bug.)
function R(s: string): string {
  if (s.length !== 24) throw new Error(`sprite row length ${s.length}, expected 24: ${s}`);
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// Variant A — ALEX CLASSIC (sales pro with headset)
// ═══════════════════════════════════════════════════════════════════
const A_PAL: Palette = {
  // ...byte-identical copy from sprites.jsx:17-35
};

const A_BASE: Frame = [
  // ...byte-identical copy from sprites.jsx:37-64 (24 R(...) calls)
];

const A_BLINK: Frame = mergeSprite(A_BASE, [
  // ...byte-identical copy from sprites.jsx:66-71
]);

// ... continues for A_DRAFT_*, A_SLEEP, A_SLEEP_2, A_WON, A_WON_STAR_*

// Repeat for variants B (OPERATOR), C (COZY), D (AGENT) — sprites.jsx ~250-440.

export const ALEX_VARIANTS: VariantBundle = {
  classic: {
    name: "Alex Classic",
    blurb: "Friendly nerd × sales pro. Headset, glasses, navy blazer + red tie.",
    palette: A_PAL,
    states: {
      idle: [
        { rows: A_BASE, dur: 3200 },
        { rows: A_BLINK, dur: 140 },
        { rows: A_BASE, dur: 2400 },
        { rows: A_BLINK, dur: 120 },
      ],
      draft: [
        { rows: A_DRAFT_1, dur: 220 },
        { rows: A_DRAFT_2, dur: 220 },
      ],
      sleep: [
        { rows: A_SLEEP, dur: 900 },
        { rows: A_SLEEP_2, dur: 900 },
      ],
      won: [
        { rows: A_WON_STAR_A, dur: 380 },
        { rows: A_WON_STAR_B, dur: 380 },
        { rows: A_WON, dur: 280 },
      ],
    },
  },
  operator: {
    /* B_* */
  },
  cozy: {
    /* C_* */
  },
  agent: {
    /* D_* */
  },
};
```

**Concrete porting procedure:**

1. Open `docs/design-prompts/locked/switchboard/project/agent-home-v3/sprites.jsx` and the new `apps/dashboard/src/components/cockpit/sprite/alex-variants.ts` side by side.
2. Replace the top JSX-only `R` helper with the TS version above.
3. For each palette object literal (`A_PAL`, `B_PAL`, `C_PAL`, `D_PAL`), copy verbatim and add `: Palette` type annotation.
4. For each `_BASE` / `_DRAFT_*` / `_SLEEP*` / `_WON*` definition, copy verbatim — they use `R(...)` for each row and that helper now ships at the top of the file.
5. For each `mergeSprite(base, [...])` call, the import resolves to the new typed import.
6. Replace the final `Object.assign(window, { ALEX_VARIANTS })` with `export const ALEX_VARIANTS: VariantBundle = {...}` using the structure shown above.
7. Verify no remaining `window.*` references.

- [ ] **Step 6.2: Run typecheck + immediately confirm the file compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`

Expected: PASS. If the typecheck fails on row literals, the most likely cause is a 23- or 25-char row from a copy-paste glitch — the `R(...)` helper will throw the offending row at runtime, but TS will surface the structural error sooner.

(No separate test for this file yet — Task 8's bundle-shape test covers it.)

---

## Task 7: Port Riley variant data

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/riley-variants.ts`

Same porting procedure as Task 6, against `docs/design-prompts/locked/switchboard/project/agent-home-v3/riley-sprites.jsx`. The bundle keys for Riley are `analyst | trader | bot` (NOT the `terminal | agent` strings from `riley-config.jsx`'s `variantOptions` — those are design-canvas-only labels that drifted from bundle keys; see spec §6.1).

- [ ] **Step 7.1: Create `riley-variants.ts`**

Skeleton:

```typescript
// Riley pixel-sprite variants — 24×24 grids.
// Ported byte-identical from docs/design-prompts/locked/switchboard/project/agent-home-v3/riley-sprites.jsx.

import { mergeSprite } from "./build-sprite";
import type { Frame, Palette, VariantBundle } from "./types";

function R(s: string): string {
  if (s.length !== 24) throw new Error(`sprite row length ${s.length}, expected 24: ${s}`);
  return s;
}

// Variant RA — RILEY ANALYST (lavender blouse, ponytail, big round glasses)
const RA_PAL: Palette = {
  /* from riley-sprites.jsx */
};
const RA_BASE: Frame = [
  /* from riley-sprites.jsx */
];
// ...RA_BLINK, RA_DRAFT_*, RA_SLEEP*, RA_WON*, RC_*, RD_*

export const RILEY_VARIANTS: VariantBundle = {
  analyst: {
    name: "Riley Analyst",
    blurb: "...",
    palette: RA_PAL,
    states: {
      /* ... */
    },
  },
  trader: {
    name: "Riley Pixel Trader",
    blurb: "...",
    palette: RC_PAL,
    states: {
      /* ... */
    },
  },
  bot: {
    name: "Riley Bot",
    blurb: "...",
    palette: RD_PAL,
    states: {
      /* ... */
    },
  },
};
```

- [ ] **Step 7.2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`

Expected: PASS.

---

## Task 8: Bundle-shape snapshot tests + commit foundation

**Files:**

- Append to: `apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts`

This test validates every variant in both bundles has all four states and that every frame has valid palette keys.

- [ ] **Step 8.1: Append the bundle-shape tests**

Add to the bottom of `apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts`:

```typescript
import { ALEX_VARIANTS } from "../alex-variants";
import { RILEY_VARIANTS } from "../riley-variants";
import type { SpriteState, VariantBundle } from "../types";

const STATES: readonly SpriteState[] = ["idle", "draft", "sleep", "won"];
const ALEX_KEYS = ["classic", "operator", "cozy", "agent"] as const;
const RILEY_KEYS = ["analyst", "trader", "bot"] as const;

function validateBundle(bundle: VariantBundle, expectedKeys: readonly string[]): void {
  expect(Object.keys(bundle).sort()).toEqual([...expectedKeys].sort());
  for (const key of expectedKeys) {
    const variant = bundle[key];
    expect(variant, `${key} variant missing`).toBeDefined();
    expect(typeof variant.name).toBe("string");
    expect(typeof variant.blurb).toBe("string");
    expect(Object.keys(variant.palette).length).toBeGreaterThan(0);
    for (const state of STATES) {
      const frames = variant.states[state];
      expect(frames, `${key}.${state} frames missing`).toBeDefined();
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.rows).toHaveLength(24);
        for (const row of frame.rows) expect(row).toHaveLength(24);
        expect(typeof frame.dur).toBe("number");
        expect(frame.dur).toBeGreaterThan(0);
        // Every non-transparent palette key in the frame must resolve.
        for (const row of frame.rows) {
          for (const ch of row) {
            if (ch === "." || ch === " ") continue;
            expect(
              variant.palette[ch],
              `${key}.${state}: unknown palette key '${ch}'`,
            ).toBeDefined();
          }
        }
      }
    }
  }
}

describe("ALEX_VARIANTS bundle shape", () => {
  it("contains classic | operator | cozy | agent with all 4 states each", () => {
    validateBundle(ALEX_VARIANTS, ALEX_KEYS);
  });
});

describe("RILEY_VARIANTS bundle shape", () => {
  it("contains analyst | trader | bot with all 4 states each (incl. dormant won state)", () => {
    validateBundle(RILEY_VARIANTS, RILEY_KEYS);
  });
});
```

- [ ] **Step 8.2: Run the bundle tests**

Run: `pnpm --filter @switchboard/dashboard test sprite/build-sprite`

Expected: PASS — original 8 + 2 new = 10 tests green. If a bundle test fails, the most likely cause is a 23/25-char row in one of the variant files; the assertion will name the offending `<key>.<state>` so go fix it.

- [ ] **Step 8.3: Run the full sprite-module suite**

Run: `pnpm --filter @switchboard/dashboard test sprite/`

Expected: PASS — build-sprite (10) + pixel-sprite (4) + use-frame-cycle (5) = 19 tests green.

- [ ] **Step 8.4: Commit the foundation**

```bash
git add apps/dashboard/src/components/cockpit/sprite/
git commit -m "$(cat <<'EOF'
feat(cockpit): add sprite foundation — types, builders, renderer, frame cycle, variants, animated sprite

Adds apps/dashboard/src/components/cockpit/sprite/ module:

- types.ts — SpriteVariantKey, SpriteState, Frame, Palette, AnimFrame,
  VariantDef, VariantBundle, SpriteCommand
- build-sprite.ts — buildSprite + mergeSprite helpers (test-only;
  product code consumes pre-built frame literals from the variant files)
- pixel-sprite.tsx — SVG renderer; one <rect> per opaque pixel;
  aria-hidden; viewBox 0 0 24 24 with shapeRendering="crispEdges"
- use-frame-cycle.ts — frame-swap hook with explicit empty/single/multi/
  paused/unmount semantics per spec §5.3
- animated-sprite.tsx — combines cycle + renderer
- alex-variants.ts — ALEX_VARIANTS: classic | operator | cozy | agent;
  ports docs/design-prompts/.../sprites.jsx verbatim (frame literals
  byte-identical; only the JSX→TS module shape changes)
- riley-variants.ts — RILEY_VARIANTS: analyst | trader | bot;
  bundle keys are the canonical truth (NOT the variantOption labels in
  riley-config.jsx, which drifted to terminal | agent)

19 tests cover the engine + bundle shape + every (variant, state) tuple
has valid palette keys and 24-char rows.

No product consumers yet — wired up in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<SpriteFrame>` + `<SpriteChip>` consumer components

**Files:**

- Create: `apps/dashboard/src/components/cockpit/sprite/sprite-frame.tsx`
- Create: `apps/dashboard/src/components/cockpit/sprite/sprite-chip.tsx`
- Create: `apps/dashboard/src/components/cockpit/sprite/__tests__/sprite-frame.test.tsx`
- Create: `apps/dashboard/src/components/cockpit/sprite/__tests__/sprite-chip.test.tsx`

- [ ] **Step 9.1: Write SpriteFrame tests**

Create `apps/dashboard/src/components/cockpit/sprite/__tests__/sprite-frame.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SpriteFrame } from "../sprite-frame";
import { ALEX_VARIANTS } from "../alex-variants";

describe("<SpriteFrame>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the AnimatedSprite SVG when the bundle/variant/state path resolves", () => {
    const { container } = render(
      <SpriteFrame
        bundle={ALEX_VARIANTS}
        variant="classic"
        state="idle"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    // Frame contains some rects from the sprite (palette has many opaque pixels).
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("falls back to the letter monogram when the variant key is missing from the bundle", () => {
    const { container, getByText } = render(
      <SpriteFrame
        bundle={ALEX_VARIANTS}
        variant="does-not-exist"
        state="idle"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("falls back to the letter monogram when the state is missing on the bundle entry", () => {
    // Construct a synthetic minimal bundle to exercise the missing-state branch
    // without mutating the real ALEX_VARIANTS bundle.
    const stub = {
      classic: {
        name: "stub",
        blurb: "stub",
        palette: { K: "#000" },
        states: { idle: [{ rows: Array(24).fill("K".repeat(24)), dur: 1000 }] },
      },
    } as unknown as typeof ALEX_VARIANTS;
    // `draft` is absent on the stub; SpriteFrame should fall back.
    const { container, getByText } = render(
      <SpriteFrame
        bundle={stub}
        variant="classic"
        state="draft"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not write to console on fallback (silent fallback per spec §8)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <SpriteFrame
        bundle={ALEX_VARIANTS}
        variant="does-not-exist"
        state="idle"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 9.2: Run, verify fail**

Run: `pnpm --filter @switchboard/dashboard test sprite/sprite-frame`

Expected: FAIL — `Cannot find module '../sprite-frame'`.

- [ ] **Step 9.3: Implement `sprite-frame.tsx`**

Create `apps/dashboard/src/components/cockpit/sprite/sprite-frame.tsx`:

```typescript
import { T } from "../tokens";
import { AnimatedSprite } from "./animated-sprite";
import type { SpriteState, SpriteVariantKey, VariantBundle } from "./types";

export interface SpriteFrameProps {
  bundle: VariantBundle;
  variant: SpriteVariantKey;
  state: SpriteState;
  size: number;
  /** Background color of the rounded frame (e.g., T.amberSoft for Alex). */
  accentSoft: string;
  /** Color of the fallback letter glyph (e.g., T.amberDeep for Alex). */
  fallbackDeep?: string;
  /** Letter rendered if variant/state lookup fails. "A" / "R" / etc. */
  fallbackLetter: string;
}

function frameStyle(size: number, accentSoft: string): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.18),
    background: accentSoft,
    border: `1px solid ${T.hair}`,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    boxShadow: "inset 0 -8px 14px rgba(14,12,10,0.04)",
    overflow: "hidden",
  };
}

export function SpriteFrame({
  bundle,
  variant,
  state,
  size,
  accentSoft,
  fallbackDeep = T.ink,
  fallbackLetter,
}: SpriteFrameProps) {
  const frames = bundle[variant]?.states[state];
  const palette = bundle[variant]?.palette;
  if (!frames || frames.length === 0 || !palette) {
    return (
      <div style={frameStyle(size, accentSoft)}>
        <span style={{ fontWeight: 700, fontSize: size * 0.42, color: fallbackDeep }}>
          {fallbackLetter}
        </span>
      </div>
    );
  }
  return (
    <div style={frameStyle(size, accentSoft)}>
      <AnimatedSprite frames={frames} palette={palette} size={size - 6} />
    </div>
  );
}
```

- [ ] **Step 9.4: Run, verify pass**

Run: `pnpm --filter @switchboard/dashboard test sprite/sprite-frame`

Expected: PASS — 4 tests green.

- [ ] **Step 9.5: Write SpriteChip tests**

Create `apps/dashboard/src/components/cockpit/sprite/__tests__/sprite-chip.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SpriteChip } from "../sprite-chip";
import { ALEX_VARIANTS } from "../alex-variants";

describe("<SpriteChip>", () => {
  it("renders the AnimatedSprite SVG when path resolves", () => {
    const { container } = render(
      <SpriteChip
        bundle={ALEX_VARIANTS}
        variant="classic"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to a 22px letter chip when variant is missing", () => {
    const { container, getByText } = render(
      <SpriteChip
        bundle={ALEX_VARIANTS}
        variant="nope"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("uses default size 22", () => {
    const { container } = render(
      <SpriteChip
        bundle={ALEX_VARIANTS}
        variant="classic"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("22px");
    expect(wrapper.style.height).toBe("22px");
  });
});
```

- [ ] **Step 9.6: Run, verify fail**

Run: `pnpm --filter @switchboard/dashboard test sprite/sprite-chip`

Expected: FAIL — `Cannot find module '../sprite-chip'`.

- [ ] **Step 9.7: Implement `sprite-chip.tsx`**

Create `apps/dashboard/src/components/cockpit/sprite/sprite-chip.tsx`:

```typescript
import { T } from "../tokens";
import { AnimatedSprite } from "./animated-sprite";
import type { SpriteState, SpriteVariantKey, VariantBundle } from "./types";

export interface SpriteChipProps {
  bundle: VariantBundle;
  variant: SpriteVariantKey;
  state: SpriteState;
  size?: number;
  accentSoft: string;
  fallbackDeep?: string;
  fallbackLetter: string;
}

function chipStyle(size: number, accentSoft: string): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: 4,
    background: accentSoft,
    display: "inline-grid",
    placeItems: "center",
    overflow: "hidden",
    verticalAlign: "middle",
    flexShrink: 0,
  };
}

export function SpriteChip({
  bundle,
  variant,
  state,
  size = 22,
  accentSoft,
  fallbackDeep = T.ink,
  fallbackLetter,
}: SpriteChipProps) {
  const frames = bundle[variant]?.states[state];
  const palette = bundle[variant]?.palette;
  if (!frames || frames.length === 0 || !palette) {
    return (
      <span style={chipStyle(size, accentSoft)}>
        <span style={{ fontWeight: 700, fontSize: 11, color: fallbackDeep }}>{fallbackLetter}</span>
      </span>
    );
  }
  return (
    <span style={chipStyle(size, accentSoft)}>
      <AnimatedSprite frames={frames} palette={palette} size={size - 2} />
    </span>
  );
}
```

- [ ] **Step 9.8: Run, verify pass**

Run: `pnpm --filter @switchboard/dashboard test sprite/sprite-chip`

Expected: PASS — 3 tests green.

- [ ] **Step 9.9: Commit consumer components**

```bash
git add apps/dashboard/src/components/cockpit/sprite/sprite-frame.tsx \
        apps/dashboard/src/components/cockpit/sprite/sprite-chip.tsx \
        apps/dashboard/src/components/cockpit/sprite/__tests__/sprite-frame.test.tsx \
        apps/dashboard/src/components/cockpit/sprite/__tests__/sprite-chip.test.tsx
git commit -m "$(cat <<'EOF'
feat(cockpit): add SpriteFrame + SpriteChip consumer components with letter fallback

SpriteFrame (48–64px rounded frame for Identity / EmptyState) and
SpriteChip (22px inline chip for ApprovalCard) wrap the sprite engine
with a letter-monogram fallback path. If bundle[variant]?.states[state]
returns nothing (typo'd variant key, missing state on a stub bundle),
both components render the existing letter-monogram visual that ships
on main today — silent, no console.error, no throw.

Bundle is passed explicitly as a prop (no hidden global lookup). The
plan's two consumers (Identity / EmptyState) will pass ALEX_VARIANTS or
RILEY_VARIANTS at the call site.

7 tests cover both components: happy path (svg rendered), variant-miss
fallback, state-miss fallback, no-console-side-effects on fallback,
default chip size = 22px.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire Identity sprite avatar

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/alex-config.ts` — add `DEFAULT_ALEX_VARIANT`
- Modify: `apps/dashboard/src/lib/cockpit/riley/riley-config.ts` — add `animState` + `DEFAULT_RILEY_VARIANT`
- Modify: `apps/dashboard/src/components/cockpit/identity.tsx` — replace `AvatarFrame` with `<SpriteFrame>`; expose `bundle` / `variant` / `state` props
- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx` — pass `bundle={ALEX_VARIANTS}` + `variant={DEFAULT_ALEX_VARIANT}` to `<Identity>`
- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — pass `bundle={RILEY_VARIANTS}` + `variant={DEFAULT_RILEY_VARIANT}` to `<Identity>`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx` — add sprite + fallback cases

- [ ] **Step 10.1: Add `DEFAULT_ALEX_VARIANT` to `alex-config.ts`**

Append to `apps/dashboard/src/lib/cockpit/alex-config.ts` (current file is ~42 lines; just append):

```typescript
import { ALEX_VARIANTS } from "@/components/cockpit/sprite/alex-variants";
import type { SpriteVariantKey } from "@/components/cockpit/sprite/types";

/** Hardcoded sprite variant for Alex — see spec §6.3 (intentional, not a missing
 *  Settings feature). Operators do not pick this; a future per-operator picker
 *  is post-launch. */
export const DEFAULT_ALEX_VARIANT: SpriteVariantKey = "classic";

export { ALEX_VARIANTS };
```

(Re-export `ALEX_VARIANTS` so consumers don't need a second import.)

- [ ] **Step 10.2: Add `animState` and `DEFAULT_RILEY_VARIANT` to riley-config**

Append to `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`:

```typescript
import { RILEY_VARIANTS } from "@/components/cockpit/sprite/riley-variants";
import type { SpriteVariantKey } from "@/components/cockpit/sprite/types";

/** Hardcoded sprite variant for Riley — see spec §6.3. */
export const DEFAULT_RILEY_VARIANT: SpriteVariantKey = "analyst";

export { RILEY_VARIANTS };

/** Map Riley's CockpitStatus into a sprite animation state.
 *  Mirrors alex-config.ts animState; WATCHING/REVIEWING get "draft" because
 *  Riley is actively working; IDLE/WAITING/HALTED other cases handled by the
 *  fallback. (won state is dormant per spec §5.4 — never returned.) */
export function animState(key: CockpitStatus, halted: boolean): "sleep" | "draft" | "idle" {
  if (halted) return "sleep";
  if (key === "WATCHING" || key === "REVIEWING" || key === "WAITING") return "draft";
  return "idle";
}
```

(Verify `CockpitStatus` is already imported at the top of riley-config.ts; the verification gate confirmed it is.)

- [ ] **Step 10.3: Update Identity tests with sprite + fallback cases**

Read the existing test file first:

```bash
sed -n '1,30p' apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
```

Append three new test cases to the existing `describe(...)` block in `identity.test.tsx`:

```typescript
import { ALEX_VARIANTS } from "@/components/cockpit/sprite/alex-variants";

// existing tests preserved above…

it("renders a sprite SVG when bundle + variant + spriteState are passed", () => {
  const { container } = render(
    <Identity
      statusKey="WORKING"
      halted={false}
      subtitle="SDR · Consultations pipeline"
      line={null}
      onHaltToggle={() => {}}
      bundle={ALEX_VARIANTS}
      variant="classic"
      spriteState="draft"
    />,
  );
  expect(container.querySelector("svg")).not.toBeNull();
});

it("falls back to the letter avatar when bundle/variant doesn't resolve", () => {
  const { container, getByText } = render(
    <Identity
      statusKey="WORKING"
      halted={false}
      subtitle="…"
      line={null}
      onHaltToggle={() => {}}
      bundle={ALEX_VARIANTS}
      variant="does-not-exist"
      spriteState="idle"
    />,
  );
  expect(getByText("A")).toBeInTheDocument();
  expect(container.querySelector("svg")).toBeNull();
});

it("falls back to the letter avatar when bundle is omitted entirely (pre-migration callers)", () => {
  const { container, getByText } = render(
    <Identity
      statusKey="WORKING"
      halted={false}
      subtitle="…"
      line={null}
      onHaltToggle={() => {}}
    />,
  );
  expect(getByText("A")).toBeInTheDocument();
  expect(container.querySelector("svg")).toBeNull();
});
```

- [ ] **Step 10.4: Run, verify the new Identity cases fail**

Run: `pnpm --filter @switchboard/dashboard test identity.test`

Expected: FAIL — `Identity` doesn't accept `bundle` / `variant` props yet.

- [ ] **Step 10.5: Replace `AvatarFrame` in `identity.tsx`**

Modify `apps/dashboard/src/components/cockpit/identity.tsx`:

1. At the top, add imports (note: NO `animState` import here — Identity is shared between Alex and Riley pages, and each page passes its own pre-computed `spriteState` because the two agents have different `CockpitStatus` unions and different `animState` mappings):

```typescript
import { SpriteFrame } from "./sprite/sprite-frame";
import type { SpriteState, SpriteVariantKey, VariantBundle } from "./sprite/types";
```

2. Remove the entire `AvatarFrame` local function (lines 33-62) — it's replaced by `<SpriteFrame>`.

3. Extend `IdentityProps`:

```typescript
export interface IdentityProps {
  // ...existing props preserved…
  /** Sprite bundle (ALEX_VARIANTS or RILEY_VARIANTS). When omitted, the frame
   *  renders the letter-monogram fallback. */
  bundle?: VariantBundle;
  /** Sprite variant key into the bundle. Required only when `bundle` is set. */
  variant?: SpriteVariantKey;
  /** Sprite animation state. Pages compute this from their own agent-specific
   *  animState() because Alex and Riley map different CockpitStatus values
   *  (Alex has WORKING/TALKING/WAITING; Riley has WATCHING/REVIEWING/WAITING).
   *  Identity stays agent-agnostic by accepting the result, not the mapper. */
  spriteState?: SpriteState;
}
```

4. Replace the `<AvatarFrame ... />` call (line 88-93) with:

```typescript
<SpriteFrame
  bundle={bundle ?? {}}
  variant={variant ?? "__none__"}
  state={spriteState ?? "idle"}
  size={compact ? 52 : 64}
  accentSoft={avatarAccent.soft}
  fallbackDeep={avatarAccent.deep}
  fallbackLetter={avatarLetter}
/>
```

(When `bundle` is undefined, we pass `{}` and a sentinel variant key — SpriteFrame's first lookup fails and it falls back to the letter, preserving the existing behavior for any pre-v2 caller that hasn't been updated yet.)

- [ ] **Step 10.6: Run, verify Identity tests pass**

Run: `pnpm --filter @switchboard/dashboard test identity.test`

Expected: PASS — all existing tests still pass + 2 new tests pass.

- [ ] **Step 10.7: Wire Alex page to pass bundle + variant + spriteState**

Read `cockpit-page.tsx` to locate the `<Identity>` call:

```bash
grep -n "<Identity" apps/dashboard/src/components/cockpit/cockpit-page.tsx
```

At the top of the file, extend the existing alex-config import (animState is already exported from alex-config):

```typescript
import { animState, ALEX_VARIANTS, DEFAULT_ALEX_VARIANT } from "@/lib/cockpit/alex-config";
```

At the `<Identity ... />` JSX site, add three new props:

```jsx
bundle={ALEX_VARIANTS}
variant={DEFAULT_ALEX_VARIANT}
spriteState={animState(statusKey, haltCtx.halted)}
```

(Replace `statusKey` / `haltCtx.halted` with the exact identifiers already in scope at that call site — `grep` confirmed they exist.)

- [ ] **Step 10.8: Wire Riley page to pass bundle + variant + spriteState**

In `riley-cockpit-page.tsx`, locate the `<Identity ... />` (around line 143). Add three new props:

```jsx
bundle={RILEY_VARIANTS}
variant={DEFAULT_RILEY_VARIANT}
spriteState={animState(statusKey, haltCtx.halted)}
```

Extend the existing riley-config import (animState was added by step 10.2):

```typescript
import {
  RILEY_ACCENT,
  RILEY_COMMANDS,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_MISSION_SUBTITLE,
  RILEY_TABS,
  statusColor,
  statusPulse,
  animState,
  RILEY_VARIANTS,
  DEFAULT_RILEY_VARIANT,
} from "@/lib/cockpit/riley/riley-config";
```

- [ ] **Step 10.9: Run all cockpit tests**

Run: `pnpm --filter @switchboard/dashboard test cockpit`

Expected: PASS — all existing cockpit tests + new Identity tests.

- [ ] **Step 10.10: Commit**

```bash
git add apps/dashboard/src/lib/cockpit/alex-config.ts \
        apps/dashboard/src/lib/cockpit/riley/riley-config.ts \
        apps/dashboard/src/components/cockpit/identity.tsx \
        apps/dashboard/src/components/cockpit/cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
git commit -m "$(cat <<'EOF'
feat(cockpit): wire sprite avatar to Identity row for /alex + /riley

Identity now consumes <SpriteFrame> with hardcoded default variant
(Alex='classic', Riley='analyst') and derives animation state via
animState(statusKey, halted). The local AvatarFrame letter-monogram
component is removed from identity.tsx; the same letter behavior is
preserved as SpriteFrame's fallback branch (no visible regression if
bundle/variant fail to resolve at runtime).

alex-config.ts exports ALEX_VARIANTS + DEFAULT_ALEX_VARIANT. riley-config.ts
adds animState() (previously only on alex-config) plus RILEY_VARIANTS +
DEFAULT_RILEY_VARIANT.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire EmptyState sprite avatar

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/empty-state.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx`

- [ ] **Step 11.1: Add sprite-render test to existing EmptyState test file**

Append to `apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx`:

```typescript
import { ALEX_VARIANTS } from "@/components/cockpit/sprite/alex-variants";

it("renders a sprite SVG in the narrator block when bundle is provided", () => {
  const { container } = render(
    <EmptyState
      rules={null}
      setup={[{ key: "meta", done: false, primary: true }]}
      onConnect={() => {}}
      bundle={ALEX_VARIANTS}
      variant="classic"
    />,
  );
  // The 48px sprite frame is the first <svg> inside the narrator block.
  expect(container.querySelector("svg")).not.toBeNull();
});

it("falls back to the literal 'A' letter when bundle is omitted (current behavior)", () => {
  const { getByText } = render(
    <EmptyState
      rules={null}
      setup={[{ key: "meta", done: false, primary: true }]}
      onConnect={() => {}}
    />,
  );
  expect(getByText("A")).toBeInTheDocument();
});
```

- [ ] **Step 11.2: Run, verify the new test fails (props don't exist yet)**

Run: `pnpm --filter @switchboard/dashboard test empty-state.test`

Expected: FAIL — `EmptyState` doesn't accept `bundle` / `variant` yet.

- [ ] **Step 11.3: Update `empty-state.tsx`**

Modify `apps/dashboard/src/components/cockpit/empty-state.tsx`:

1. Add imports at the top:

```typescript
import { SpriteFrame } from "./sprite/sprite-frame";
import type { SpriteVariantKey, VariantBundle } from "./sprite/types";
```

2. Extend `Props`:

```typescript
type Props = {
  rules: MissionAggregatorResponse["mission"]["rules"];
  setup: MissionAggregatorResponse["setup"];
  onConnect: (key: MissionAggregatorResponse["setup"][number]["key"]) => void;
  /** Sprite bundle for the narrator avatar. When omitted, renders letter "A". */
  bundle?: VariantBundle;
  /** Sprite variant key into the bundle. */
  variant?: SpriteVariantKey;
};
```

3. Replace the 48px literal letter span (currently at lines 71-89) with:

```typescript
{bundle && variant ? (
  <SpriteFrame
    bundle={bundle}
    variant={variant}
    state="idle"
    size={48}
    accentSoft={T.amberSoft}
    fallbackDeep={T.amberDeep}
    fallbackLetter="A"
  />
) : (
  <span
    aria-hidden="true"
    style={{
      width: 48,
      height: 48,
      borderRadius: 9,
      background: T.amberSoft,
      border: `1px solid ${T.hair}`,
      display: "grid",
      placeItems: "center",
      color: T.amberDeep,
      fontSize: 22,
      fontWeight: 700,
      flexShrink: 0,
      boxShadow: "inset 0 -8px 14px rgba(14,12,10,0.04)",
    }}
  >
    A
  </span>
)}
```

(The legacy letter branch is preserved so any caller that hasn't been migrated continues to render the existing visual. SpriteFrame's own fallback also catches typos.)

- [ ] **Step 11.4: Wire Alex cockpit-page to pass bundle + variant to EmptyState**

In `cockpit-page.tsx`, locate the `<EmptyState ... />` render. Add:

```jsx
bundle = { ALEX_VARIANTS };
variant = { DEFAULT_ALEX_VARIANT };
```

(Imports were already added in Task 10 Step 10.7.)

- [ ] **Step 11.5: Run all cockpit tests**

Run: `pnpm --filter @switchboard/dashboard test cockpit`

Expected: PASS — all green.

- [ ] **Step 11.6: Commit**

```bash
git add apps/dashboard/src/components/cockpit/empty-state.tsx \
        apps/dashboard/src/components/cockpit/cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx
git commit -m "$(cat <<'EOF'
feat(cockpit): wire sprite to EmptyState narrator (Alex day-1 cold state)

The 48px letter monogram inside EmptyState's narrator block now renders
the Alex sprite (variant=classic, state=idle) when a bundle is passed,
falling back to the literal "A" when omitted (pre-migration callers).
Riley does not use EmptyState by scope decision (cold state is the
fake-activity-row pattern), so this commit only affects /alex.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire ApprovalCard sprite chip + tertiaryLabel + campaign

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/approval-card.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`
- Modify: `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx` — pass bundle/variant through to ApprovalCard
- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — pass bundle/variant through `RileyApprovalRow` to ApprovalCard

This commit does three things in one PR-per-file boundary (all touch `approval-card.tsx`):

1. Sprite chip swap (22px letter → `<SpriteChip>`).
2. `tertiaryLabel` button (+`onTertiary` handler).
3. `campaign` line rendering when `RileyApprovalView.campaign` is set.

- [ ] **Step 12.1: Add three new test cases to ApprovalCard tests**

Append to `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`:

```typescript
import { ALEX_VARIANTS } from "@/components/cockpit/sprite/alex-variants";
import { fireEvent } from "@testing-library/react";

const baseAlexApproval = {
  // re-use whatever existing test factory the file has; minimal shape:
  id: "appr_1",
  urgency: "immediate" as const,
  askedAt: "5 min ago",
  title: "Adjust pricing on quote QA-42",
  presentation: { primaryLabel: "Accept & send", dismissLabel: "Decline" },
  primary: "Accept & send",
  secondary: "Decline",
  kind: "pricing" as const,
  primaryAction: { kind: "respond" as const, bindingHash: "abc", verdict: "accept" as const },
};

it("renders the sprite chip when bundle + variant are provided", () => {
  const { container } = render(
    <ApprovalCard
      data={baseAlexApproval as never}
      idx={0}
      total={1}
      onResolve={() => {}}
      bundle={ALEX_VARIANTS}
      variant="classic"
    />,
  );
  // The 22px sprite chip is the first svg before the title.
  expect(container.querySelector("svg")).not.toBeNull();
});

it("renders the tertiaryLabel button and fires onTertiary when clicked", () => {
  const onTertiary = vi.fn();
  const { getByText } = render(
    <ApprovalCard
      data={{ ...baseAlexApproval, tertiaryLabel: "Ask Alex to draft" } as never}
      idx={0}
      total={1}
      onResolve={() => {}}
      onTertiary={onTertiary}
    />,
  );
  fireEvent.click(getByText("Ask Alex to draft"));
  expect(onTertiary).toHaveBeenCalledTimes(1);
});

it("renders the campaign line when data.campaign is set (Riley shape)", () => {
  const rileyApproval = {
    ...baseAlexApproval,
    campaign: { kind: "campaign", name: "Cold Interests", id: "c_1" },
  };
  const { getByText } = render(
    <ApprovalCard data={rileyApproval as never} idx={0} total={1} onResolve={() => {}} />,
  );
  expect(getByText(/Cold Interests/)).toBeInTheDocument();
});
```

- [ ] **Step 12.2: Run, verify new tests fail**

Run: `pnpm --filter @switchboard/dashboard test approval-card.test`

Expected: FAIL — `bundle`, `onTertiary` props don't exist; campaign line not rendered.

- [ ] **Step 12.3: Update `approval-card.tsx`**

Modify `apps/dashboard/src/components/cockpit/approval-card.tsx`:

1. Add imports:

```typescript
import { SpriteChip } from "./sprite/sprite-chip";
import type { SpriteVariantKey, VariantBundle } from "./sprite/types";
import type { RileyApprovalView } from "./types";
```

2. Extend `ApprovalCardProps`:

```typescript
export interface ApprovalCardProps {
  data: ApprovalView;
  idx: number;
  total: number;
  onResolve: (verdict: "accept" | "decline", idx: number) => void;
  compact?: boolean;
  accent?: ApprovalAccent;
  senderLabel?: string;
  avatarLetter?: string;
  /** Sprite bundle for the avatar chip. When omitted, renders letter chip. */
  bundle?: VariantBundle;
  /** Sprite variant key. */
  variant?: SpriteVariantKey;
  /** Optional tertiary button label (e.g., "Ask Alex to draft"). */
  onTertiary?: () => void;
}
```

3. Replace the 22px letter chip span (~lines 53-71) with a conditional sprite-or-letter render:

```typescript
{bundle && variant ? (
  <SpriteChip
    bundle={bundle}
    variant={variant}
    state="draft"
    accentSoft={accent.soft}
    fallbackDeep={accent.deep}
    fallbackLetter={avatarLetter}
  />
) : (
  <span
    data-testid="approval-card-avatar-chip"
    aria-hidden="true"
    style={{
      width: 22,
      height: 22,
      borderRadius: 4,
      background: accent.soft,
      display: "inline-grid",
      placeItems: "center",
      color: accent.deep,
      fontWeight: 700,
      fontSize: 11,
      flexShrink: 0,
    }}
  >
    {avatarLetter}
  </span>
)}
```

4. Render the `campaign` line under the title — add this block immediately after the `<h2>...{data.title}</h2>` and before the `data.body` block:

```typescript
{"campaign" in data && data.campaign ? (
  <div
    style={{
      marginTop: 6,
      fontFamily: "JetBrains Mono",
      fontSize: 11,
      color: accent.deep,
      letterSpacing: "0.02em",
    }}
  >
    · {data.campaign.kind === "campaign" ? data.campaign.name : `${data.campaign.pixelId} (${data.campaign.breaches} breaches)`}
  </div>
) : null}
```

5. Render the `tertiaryLabel` button — extend the button row (currently `accept` + `decline`) to include a third button when `data.tertiaryLabel` is set and `onTertiary` is provided:

```typescript
{data.tertiaryLabel && onTertiary && (
  <button
    onClick={onTertiary}
    style={{
      background: "transparent",
      color: T.ink3,
      border: "none",
      padding: "8px 8px",
      borderRadius: 4,
      fontSize: 12.5,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: "inherit",
    }}
  >
    {data.tertiaryLabel}
  </button>
)}
```

- [ ] **Step 12.4: Run, verify ApprovalCard tests pass**

Run: `pnpm --filter @switchboard/dashboard test approval-card.test`

Expected: PASS — existing tests still pass + 3 new tests pass.

- [ ] **Step 12.5: Wire AlexApprovalRow to pass bundle/variant**

Read `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx`. Locate the `<ApprovalCard ... />` JSX site and add:

```jsx
bundle = { ALEX_VARIANTS };
variant = { DEFAULT_ALEX_VARIANT };
```

Add the import at the top:

```typescript
import { ALEX_VARIANTS, DEFAULT_ALEX_VARIANT } from "@/lib/cockpit/alex-config";
```

(`onTertiary` is not wired for Alex in v2 — no current Alex action produces a `tertiaryLabel`; the slot stays unrendered.)

- [ ] **Step 12.6: Wire RileyApprovalRow to pass bundle/variant**

In `riley-cockpit-page.tsx`, locate `RileyApprovalRow`'s `<ApprovalCard ... />` (around line 72). Add:

```jsx
bundle = { RILEY_VARIANTS };
variant = { DEFAULT_RILEY_VARIANT };
avatarLetter = "R";
```

(Imports `RILEY_VARIANTS, DEFAULT_RILEY_VARIANT` were added in Task 10 Step 10.8.)

- [ ] **Step 12.7: Run all cockpit tests**

Run: `pnpm --filter @switchboard/dashboard test cockpit`

Expected: PASS.

- [ ] **Step 12.8: Commit**

```bash
git add apps/dashboard/src/components/cockpit/approval-card.tsx \
        apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx \
        apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx \
        apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
git commit -m "$(cat <<'EOF'
feat(cockpit): wire sprite chip + tertiaryLabel + campaign field to ApprovalCard

Three additions on ApprovalCard, all touching the same file:

1. The 22px letter monogram in the avatar chip slot becomes <SpriteChip>
   when bundle + variant are provided. Per-row sprite state is constant
   "draft" (cards represent active operator interaction). Falls back to
   the existing letter chip when bundle is omitted.

2. New tertiaryLabel button (rendered only when both data.tertiaryLabel
   AND onTertiary are set). Transparent ghost-style button matching the
   design's btnGhost pattern at cockpit.jsx:181-185.

3. RileyApprovalView.campaign line rendering — when the approval data
   includes a campaign field, render a mono-font line under the title.
   "campaign" kind shows the campaign name; "account" kind shows pixelId
   + breach count. Already-typed in types.ts; just no UI consumed it.

AlexApprovalRow + RileyApprovalRow updated to pass the appropriate
bundle/variant pair down. Alex doesn't emit campaign or tertiaryLabel
today, so its visual is unchanged except the chip becomes the sprite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Pass `today` eyebrow to Riley ActivityStream

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

This is the smallest commit. Alex's cockpit page already passes `today={formatToday(now)}` to `<ActivityStream>`; Riley does not, so /riley shows the legacy "Activity" eyebrow instead of "Today · Mon May 12". Closing the gap.

- [ ] **Step 13.1: Add assertion to riley-cockpit-page test**

Append to `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`:

```typescript
it("passes a `today` string prop to <ActivityStream> so the eyebrow shows the date", () => {
  // The ActivityStream renders "Today · {today}" when today is set.
  // We assert the rendered DOM contains the prefix "Today ·" rather than
  // mocking the child component — keeps the test robust to internal renames.
  const { getByText } = renderRileyCockpitPage();
  expect(getByText(/^Today · /)).toBeInTheDocument();
});
```

(Re-use the existing `renderRileyCockpitPage` helper in the test file; if no helper exists, follow the pattern of the existing tests in the same file.)

- [ ] **Step 13.2: Run, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test riley-cockpit-page.test`

Expected: FAIL — "Unable to find an element with the text: /^Today · /".

- [ ] **Step 13.3: Pass `today` in `riley-cockpit-page.tsx`**

Locate the `<ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />` call (around line 187). Update to:

```typescript
<ActivityStream
  rows={activityRows}
  filter={filter}
  setFilter={setFilter}
  today={formatToday(new Date())}
/>
```

Add the import at the top (mirror Alex's import):

```typescript
import { formatToday } from "@/lib/cockpit/format-today";
```

(If `formatToday` lives at a different path, follow Alex's pattern — `grep -n "formatToday" apps/dashboard/src/components/cockpit/cockpit-page.tsx` reveals the import line to mirror.)

- [ ] **Step 13.4: Run, verify the new test passes**

Run: `pnpm --filter @switchboard/dashboard test riley-cockpit-page.test`

Expected: PASS — the test sees "Today · " in the rendered output.

- [ ] **Step 13.5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(cockpit): pass today eyebrow to Riley ActivityStream

Riley's page now passes today={formatToday(new Date())} to ActivityStream
so the eyebrow renders "Today · Mon May 12" instead of the legacy
"Activity" placeholder. Mirrors Alex's cockpit-page pattern; closes
one of the per-agent asymmetries flagged in the v2 audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification gates

After Task 13's commit:

- [ ] **Full dashboard test suite green**

Run: `pnpm --filter @switchboard/dashboard test`

Expected: PASS. New sprite tests + extended cockpit-component tests. Coverage ≥ 40/35/40/40 dashboard threshold; sprite module should clear 70%+ on its own (`pnpm --filter @switchboard/dashboard test --coverage` if you want to confirm).

- [ ] **Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`

Expected: PASS.

- [ ] **Lint**

Run: `pnpm --filter @switchboard/dashboard lint`

Expected: PASS. No `console.log`, no `any`, no unused vars without `_` prefix.

- [ ] **Format check (CI runs this; local pnpm lint does not)**

Run: `pnpm format:check`

Expected: PASS. If FAIL, run `pnpm format` and re-stage.

- [ ] **Dashboard build (CI does NOT run this — mandatory local check per `feedback_dashboard_build_not_in_ci`)**

Run: `pnpm --filter @switchboard/dashboard build`

Expected: PASS. This catches `.js` extension regressions and Next.js-specific issues that typecheck misses.

- [ ] **API test sanity gate (no api changes expected; this catches accidental cross-package edits)**

Run: `pnpm --filter @switchboard/api test`

Expected: PASS.

- [ ] **Manual smoke**

Postgres needs to be running locally for the dashboard to serve real data. Per the worktree-init output, run `pnpm local:setup` after starting Postgres.

```bash
pnpm dev
# open http://localhost:3002/alex
```

Verify on `/alex`:

- Identity row shows an animated sprite (Alex classic) — pixel-art SVG, idle blink cycle every ~3s.
- Trigger `Halt` — sprite swaps to `sleep` state (Z particles).
- Trigger `Resume` — sprite returns to `idle`.
- If an approval row is present: 22px sprite chip in the avatar slot (Alex classic, draft state).
- If on day-1 cold state (no connections wired): EmptyState narrator block shows 48px sprite (Alex classic, idle).

Verify on `/riley`:

- Identity row shows an animated sprite (Riley analyst).
- Activity feed eyebrow reads "Today · {date}" not "Activity".
- If approvals present: chip shows Riley analyst sprite. If a Riley approval includes a `campaign` field: a mono-font campaign-name line renders under the title.

If any of the above fails: capture browser console errors, name the failing block, and revisit the relevant task's tests.

---

## PR strategy (per spec §11)

**Docs PR first.** Land the audit + spec + plan on main as a single docs PR before the implementation PR. From this worktree:

```bash
git push -u origin feat/cockpit-v2-sprite-system
# Then open the docs PR using just the 4 docs commits at the top of HEAD.
```

Two options for splitting docs vs implementation:

- **Option A (split):** After implementation commits land on this branch, create a separate `docs/cockpit-v2-sprite-system` branch with just the 4 docs commits cherry-picked, open the docs PR off that, merge it, then rebase this branch on the new main and open the implementation PR. Cleaner review.
- **Option B (bundled):** Open one PR with everything (4 docs + 6 implementation commits). Reviewer sees the full context in one place. Faster path; less ceremony.

Recommend Option B for this surface size (~1500 LOC, mostly data, single workstream).

---

## Out-of-scope reminders (spec §3)

If during implementation any step appears to require any of the following, STOP and re-read spec §14:

- Prisma migration / new column / schema change
- localStorage / cookie / session preference for sprite variant
- URL param (`?variant=cozy`)
- Settings UI affordance for variant selection
- Animation easing / cross-fade between sprite states
- Event-based `won` state trigger
- Telemetry on sprite variant usage
- Exporting SpriteFrame / SpriteChip from the dashboard package boundary
- API route / backend wire of sprite variant
- Critical #3 (approval kind classifier producer)
- OAuth → Connection dual-write
- Env-flag flip
- `metaDone` strict-semantic
- `SERVICE_IDS` constants module
- Riley `body` slot rendering on ApprovalCard (different from `campaign`)

Each of those is tracked separately and explicitly out of scope for v2.
