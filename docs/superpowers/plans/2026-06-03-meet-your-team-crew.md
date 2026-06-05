# Meet your team: Mira sprite + Home crew band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw Mira's real 24x24 pixel sprite and wire it into the printed-portrait avatar, then promote Home's 30px team ribbon into a hero-scale crew band with honest live status.

**Architecture:** Mira's sprite is pure frame data in a new `mira-variants.ts` (mirroring `riley-variants.ts`), exposed through `mira-config.ts` and consumed by the existing `SPRITES` map in `PrintedPortraitAvatar`. The band is a new presentational `TeamBand` component that replaces `TeamPulse` in its existing Home composition slot, fed by a corrected per-agent status derivation in `home-page.tsx` (status is keyed by `agentRole`, not a global flag). No new design tokens; no raw hex outside the sprite palette.

**Tech Stack:** Next.js App Router dashboard, React, TypeScript (ESM, no `.js` import extensions in this package), CSS Modules with `hsl(var(--token))` tokens, Vitest + @testing-library/react (jsdom, `css:false`). Spec: `docs/superpowers/specs/2026-06-03-meet-your-team-crew.md`.

**Decisions locked (from brainstorming + two adversarial reviews):** ship Mira's sprite as a true peer; band at one stable 96px everywhere (no JS size hook); honest per-agent status (role-keyed, Mira never inferred working, no "Not set up" while loading); no cumulative value strip in this slice (no honest source); defer the `/mira` cockpit Identity wiring (Mira-only surface, needs a reduced-motion-safe SpriteFrame); keep both parts as separable commits in one impl PR on base #844.

---

## Pre-flight (once, before Task 1)

- [ ] **Confirm base.** You are on an implementation branch created off `origin/worktree-app-aesthetic-direction` (PR #844), which already includes the `PrintedPortraitAvatar` component and the wave-1 token system. Run `git log --oneline -3` and confirm the avatar component exists: `ls apps/dashboard/src/components/agent-avatar/`.
- [ ] **Env.** From the worktree root run `pnpm worktree:init`. Known gotcha (`feedback_worktree_env_sync_corruption`): after it runs, open `apps/dashboard/.env.local` and (a) fix any `DATABASE_URL` concatenated onto one line, (b) uncomment `DEV_BYPASS_AUTH=true`. If Postgres is unreachable, run `pnpm install` instead; only the live-screenshot step needs the dev server.
- [ ] **Baseline green.** Run `pnpm --filter @switchboard/dashboard test` and confirm it passes before changing anything. If it fails, report and stop.

---

## File structure

- **Create** `apps/dashboard/src/components/cockpit/sprite/mira-variants.ts`: Mira's 24x24 frame data + `MIRA_VARIANTS` bundle. One responsibility: the pixel art.
- **Modify** `apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts`: add a `MIRA_VARIANTS` bundle-shape block.
- **Modify** `apps/dashboard/src/lib/cockpit/mira/mira-config.ts`: add `DEFAULT_MIRA_VARIANT` + re-export `MIRA_VARIANTS`.
- **Create** `apps/dashboard/src/lib/cockpit/mira/__tests__/mira-config.test.ts`: accent/copy + variant-resolves guard.
- **Modify** `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`: `SPRITES.mira` gets a bundle; stale comments updated.
- **Modify** `apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx` and `apps/dashboard/src/components/inbox/__tests__/inbox-agent-avatar.test.tsx`: flip the 3 letter-to-svg assertions.
- **Create** `apps/dashboard/src/components/home/team-band.tsx`: the crew band + the pure `teamStatusLabel` helper. One responsibility: render the celebrated crew with honest status.
- **Create** `apps/dashboard/src/components/home/__tests__/team-band.test.tsx`.
- **Modify** `apps/dashboard/src/components/home/types.ts`: add `TeamBandAgent`.
- **Modify** `apps/dashboard/src/components/home/home.module.css`: add `.teamBand*` rules; remove orphaned `.pulseRibbon`/`.agentChip*`.
- **Modify** `apps/dashboard/src/components/home/home-page.tsx`: per-agent status derivation; render `TeamBand` instead of `TeamPulse`.
- **Modify** `apps/dashboard/src/components/home/__tests__/home-page.test.tsx`: band test-ids; role-keyed state fixtures.
- **Delete** `apps/dashboard/src/components/home/team-pulse.tsx` and `apps/dashboard/src/components/home/__tests__/team-pulse.test.tsx`.

---

## Task 1: Mira's sprite frames + bundle-shape test

**Files:**
- Create: `apps/dashboard/src/components/cockpit/sprite/mira-variants.ts`
- Modify: `apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts`

- [ ] **Step 1: Write the failing bundle-shape test.** In `build-sprite.test.ts`, add `MIRA_VARIANTS` to the variants import line (alongside `ALEX_VARIANTS`, `RILEY_VARIANTS`) and add this block next to the existing `RILEY_VARIANTS bundle shape` describe:

```ts
const MIRA_KEYS = ["maker"];
describe("MIRA_VARIANTS bundle shape", () => {
  it("contains maker with all 4 states", () => {
    validateBundle(MIRA_VARIANTS, MIRA_KEYS);
  });
});
```

(Match the exact call style of the existing `ALEX_VARIANTS`/`RILEY_VARIANTS` blocks: they wrap `validateBundle` in an `it`. `validateBundle` checks the key set, 24x24 row lengths, all four states present and non-empty, positive durations, and that every palette key resolves. Add `MIRA_KEYS` next to the existing `ALEX_KEYS`/`RILEY_KEYS` consts.)

- [ ] **Step 2: Run it; verify it fails** with a missing-module/export error.

Run: `pnpm --filter @switchboard/dashboard test build-sprite`
Expected: FAIL (cannot find `MIRA_VARIANTS`).

- [ ] **Step 3: Create `mira-variants.ts`** with this exact content (the locked art, authored and visually verified in a design canvas):

```ts
/* eslint-disable max-lines */
// Mira pixel-sprite variants, 24x24 grids. Creative / UGC agent: short violet
// bob, blunt bangs, viewfinder, chest camera. Authored to match the Alex/Riley
// family discipline; frame literals are pixel-art data, not code, so the
// arch-check eslint-disable above is intentional.
import { mergeSprite } from "./build-sprite";
import type { Frame, Palette, VariantBundle } from "./types";

function R(s: string): string {
  if (s.length !== 24) throw new Error(`sprite row length ${s.length}, expected 24: ${s}`);
  return s;
}

const M_PAL: Palette = {
  K: "#1a1108", // outline
  H: "#6e4bb0", // violet hair main
  E: "#9a72d0", // violet hair highlight
  S: "#f5c79a", // skin (family match)
  D: "#cd8a5a", // skin shadow
  M: "#1a0c06", // eyes / mouth
  C: "#d2628f", // berry lip / cheek
  B: "#7d5bb8", // violet creative top
  L: "#9b7ed0", // top highlight
  W: "#f3ead0", // cream collar
  T: "#241733", // camera body
  G: "#bfe0d8", // camera lens (mint)
  N: "#efe8ff", // glint / highlight
  V: "#b98fe0", // eyeshadow / lash
  Z: "#7c6a48", // sleep Z
  Y: "#f1c34a", // star
  P: "#ffffff", // sparkle
  R: "#d94f7a", // REC dot
};

const M_BASE: Frame = [
  R("........................"),
  R("......KKKKKKKKKKKK......"),
  R(".....KHHHHHHHHHHHHK....."),
  R("....KHHHHHHHHHHHHHHK...."),
  R("...KHHHEHHHHHHHHEHHHK..."),
  R("...KHHHHHEHHHHEHHHHHK..."),
  R("...KHHHHHHHHHHHHHHHHK..."),
  R("...KHHHHHHHHHHHHHHHHK..."),
  R("...KHHHSSSSSSSSSSHHHK..."),
  R("...KHHSSVVSSSSVVSSHHK..."),
  R("...KHHSSMMSSSSMMSSHHK..."),
  R("...KHHSSMMSSSSMMSSHHK..."),
  R("...KHHSCSSSSSSSSCSHHK..."),
  R("...KHHSSSSCMMCSSSSHHK..."),
  R("...KHHSSSSSSSSSSSSHHK..."),
  R(".....KSSSSSSSSSSSSK....."),
  R("......KSSSSSSSSSSK......"),
  R("....KKBBBBBWWWWBBBBKK..."),
  R("...KBBBBLBWWWWBLBBBBK..."),
  R("..KBBBBBBBBBBBBBBBBBK..."),
  R(".KBBBBBBBKKKKKKBBBBBBBK."),
  R("KBBBBBBBBKKGGKKBBBBBBBBK"),
  R("KBBBBBBBBBKKKKBBBBBBBBBK"),
  R("KBBBBBBBBBBBBBBBBBBBBBBK"),
];

const M_BLINK: Frame = mergeSprite(M_BASE, [["row", 10, 0, "...KHHSSSSSSSSSSSSHHK..."]]);

const VIEWFINDER = [
  ["px", 1, 8, "G"], ["px", 2, 8, "G"], ["px", 1, 9, "G"],
  ["px", 22, 8, "G"], ["px", 21, 8, "G"], ["px", 22, 9, "G"],
  ["px", 1, 14, "G"], ["px", 2, 14, "G"], ["px", 1, 13, "G"],
  ["px", 22, 14, "G"], ["px", 21, 14, "G"], ["px", 22, 13, "G"],
] as const;
const M_DRAFT_1: Frame = mergeSprite(M_BASE, [
  ...VIEWFINDER,
  ["row", 13, 0, "...KHHSSSCMMMCSSSSHHK..."],
  ["px", 20, 3, "R"],
]);
const M_DRAFT_2: Frame = mergeSprite(M_BASE, [
  ...VIEWFINDER,
  ["row", 13, 0, "...KHHSSSSCMMCSSSSHHK..."],
]);

const M_SLEEP_1: Frame = mergeSprite(M_BASE, [
  ["row", 10, 0, "...KHHSSSSSSSSSSSSHHK..."],
  ["row", 13, 0, "...KHHSSSSSMMSSSSSHHK..."],
  ["px", 19, 2, "Z"], ["px", 20, 2, "Z"], ["px", 21, 2, "Z"], ["px", 21, 3, "Z"],
  ["px", 20, 4, "Z"], ["px", 19, 5, "Z"], ["px", 20, 5, "Z"], ["px", 21, 5, "Z"],
]);
const M_SLEEP_2: Frame = mergeSprite(M_BASE, [
  ["row", 10, 0, "...KHHSSSSSSSSSSSSHHK..."],
  ["row", 13, 0, "...KHHSSSSSMMSSSSSHHK..."],
  ["px", 18, 0, "Z"], ["px", 19, 0, "Z"], ["px", 20, 0, "Z"], ["px", 20, 1, "Z"],
  ["px", 19, 2, "Z"], ["px", 18, 3, "Z"], ["px", 19, 3, "Z"], ["px", 20, 3, "Z"],
]);

const M_WON: Frame = mergeSprite(M_BASE, [
  ["row", 13, 0, "...KHHSSSCMMMMCSSSHHK..."],
  ["row", 14, 0, "...KHHSSSSCMMCSSSSHHK..."],
  ["px", 8, 10, "P"], ["px", 14, 10, "P"],
  ["row", 21, 0, "KBBBBBBBBKKNNKKBBBBBBBBK"],
]);
const M_WON_STAR_A: Frame = mergeSprite(M_WON, [
  ["px", 2, 5, "Y"], ["px", 1, 6, "Y"], ["px", 3, 6, "Y"], ["px", 2, 7, "Y"],
  ["px", 21, 16, "Y"], ["px", 20, 17, "Y"], ["px", 22, 17, "Y"], ["px", 21, 18, "Y"],
]);
const M_WON_STAR_B: Frame = mergeSprite(M_WON, [
  ["px", 21, 3, "P"], ["px", 2, 16, "P"], ["px", 20, 6, "Y"],
]);

export const MIRA_VARIANTS: VariantBundle = {
  maker: {
    name: "Mira Maker",
    blurb: "Creative and UGC. Short violet bob, viewfinder, chest camera.",
    palette: M_PAL,
    states: {
      idle: [
        { rows: M_BASE, dur: 3200 },
        { rows: M_BLINK, dur: 140 },
        { rows: M_BASE, dur: 2400 },
        { rows: M_BLINK, dur: 120 },
      ],
      draft: [
        { rows: M_DRAFT_1, dur: 220 },
        { rows: M_DRAFT_2, dur: 220 },
      ],
      sleep: [
        { rows: M_SLEEP_1, dur: 900 },
        { rows: M_SLEEP_2, dur: 900 },
      ],
      won: [
        { rows: M_WON_STAR_A, dur: 380 },
        { rows: M_WON_STAR_B, dur: 380 },
        { rows: M_WON, dur: 280 },
      ],
    },
  },
};
```

Note: `mergeSprite` accepts the `SpriteCommand` union (`["px", x, y, c]` / `["row", y, x, str]`). If TypeScript complains about the `as const` tuple widths on `VIEWFINDER`, type it as `const VIEWFINDER: SpriteCommand[] = [...]` and import `SpriteCommand` from `./types`. Verify against `riley-variants.ts` for the exact command typing pattern used in this repo.

- [ ] **Step 4: Run the bundle-shape test; verify it passes.**

Run: `pnpm --filter @switchboard/dashboard test build-sprite`
Expected: PASS (the MIRA block validates 24x24 rows, 4 states, durations, palette keys).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/sprite/mira-variants.ts \
        apps/dashboard/src/components/cockpit/sprite/__tests__/build-sprite.test.ts
git commit -m "feat(dashboard): draw Mira's 24x24 pixel sprite (violet bob, viewfinder, camera)"
```

---

## Task 2: Wire Mira's sprite into the avatar + config + flip letter tests

**Files:**
- Modify: `apps/dashboard/src/lib/cockpit/mira/mira-config.ts`
- Create: `apps/dashboard/src/lib/cockpit/mira/__tests__/mira-config.test.ts`
- Modify: `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`
- Modify: `apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx`
- Modify: `apps/dashboard/src/components/inbox/__tests__/inbox-agent-avatar.test.tsx`

- [ ] **Step 1: Write the failing mira-config test.** Create `apps/dashboard/src/lib/cockpit/mira/__tests__/mira-config.test.ts` (mirror `riley/__tests__/riley-config.test.ts` for the accent assertion, then add the variant guard). Do NOT assert on `MIRA_MISSION_SUBTITLE`: its value differs between the #844 base (which still carries an em-dash) and main (already de-em-dashed by the voice guard), and this slice must not touch it (see Step 3):

```ts
import { describe, it, expect } from "vitest";
import { MIRA_ACCENT, MIRA_VARIANTS, DEFAULT_MIRA_VARIANT } from "../mira-config";

describe("mira-config", () => {
  it("accent consumes the canonical violet token (identity only)", () => {
    expect(MIRA_ACCENT.base).toBe("hsl(var(--agent-mira))");
  });
  it("the default variant resolves inside the bundle (protects the avatar wiring)", () => {
    expect(MIRA_VARIANTS[DEFAULT_MIRA_VARIANT]).toBeDefined();
    expect(MIRA_VARIANTS[DEFAULT_MIRA_VARIANT].states.idle.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it; verify it fails** (missing `MIRA_VARIANTS`/`DEFAULT_MIRA_VARIANT` exports).

Run: `pnpm --filter @switchboard/dashboard test mira-config`
Expected: FAIL.

- [ ] **Step 3: Add the exports to `mira-config.ts` (surgical edit).** At the top add the imports and at the bottom add the exports (mirror `riley-config.ts`). Make this a SURGICAL edit: add only these lines and do NOT touch `MIRA_MISSION_SUBTITLE` or any other existing line. The #844 base still carries an em-dash in that subtitle while main has the de-em-dashed value; leaving the line untouched lets a rebase onto main keep main's fix and prevents this slice from regressing it.

```ts
import { MIRA_VARIANTS } from "@/components/cockpit/sprite/mira-variants";
import type { SpriteVariantKey } from "@/components/cockpit/sprite/types";
```

```ts
/** Hardcoded sprite variant for Mira. Operators do not pick this. */
export const DEFAULT_MIRA_VARIANT: SpriteVariantKey = "maker";

export { MIRA_VARIANTS };
```

- [ ] **Step 4: Run the mira-config test; verify it passes.**

Run: `pnpm --filter @switchboard/dashboard test mira-config`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the SPRITES map.** In `printed-portrait-avatar.tsx`, add the import near the Alex/Riley config imports:

```ts
import { MIRA_VARIANTS, DEFAULT_MIRA_VARIANT } from "@/lib/cockpit/mira/mira-config";
```

Change the `SPRITES` map entry from `mira: { bundle: null },` to:

```ts
  mira: { bundle: MIRA_VARIANTS, variant: DEFAULT_MIRA_VARIANT },
```

Leave `AGENT_LETTER` as-is (the `Record<AgentKey,string>` type requires the `mira` entry; it just stops being reached). Update the now-stale comments that say Mira has no sprite / renders a letter (the file docstring, the `SPRITES` comment, and the inline `only Mira (def === null)` comment).

- [ ] **Step 6: Flip the three letter-to-svg assertions.**
  - In `printed-portrait-avatar.test.tsx`: the test "falls back to an in-frame letter for mira (no sprite bundle)" becomes "renders the pixel sprite for mira" asserting `container.querySelector("svg")` is not null and the "M" letter is absent. The test "keeps Mira's letter even when working (no sprite bundle yet)" becomes a sprite assertion (keep its `dataset.spriteState === "draft"` check, which still holds, but assert an svg renders and the letter does not). Rename the stale titles.
  - In `inbox-agent-avatar.test.tsx`: "falls back to an initial disc for mira (no sprite bundle)" becomes a sprite assertion (svg not null), mirroring the alex/riley case in that file.

- [ ] **Step 7: Run the avatar + inbox-avatar tests; verify they pass.**

Run: `pnpm --filter @switchboard/dashboard test printed-portrait-avatar inbox-agent-avatar`
Expected: PASS.

- [ ] **Step 8: Typecheck + build** (build catches `@/` import and dead-file breaks vitest/typecheck miss).

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: both succeed.

- [ ] **Step 9: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/mira/mira-config.ts \
        apps/dashboard/src/lib/cockpit/mira/__tests__/mira-config.test.ts \
        apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx \
        apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx \
        apps/dashboard/src/components/inbox/__tests__/inbox-agent-avatar.test.tsx
git commit -m "feat(dashboard): render Mira's real sprite everywhere (drop the letter fallback)"
```

(After this commit, the Mira-sprite portion is complete and independently shippable: Mira now renders her sprite in the Home ribbon, Inbox bylines, and the agent panel.)

---

## Task 3: TeamBand component + honest status label

**Files:**
- Modify: `apps/dashboard/src/components/home/types.ts`
- Create: `apps/dashboard/src/components/home/team-band.tsx`
- Create: `apps/dashboard/src/components/home/__tests__/team-band.test.tsx`
- Modify: `apps/dashboard/src/components/home/home.module.css`

- [ ] **Step 1: Add the `TeamBandAgent` type** to `home/types.ts`:

```ts
import type { AgentActivity } from "@/components/agent-avatar/agent-status-visual";

/** One agent in the hero crew band. `status` is the REAL per-agent activity
 *  (idle for agents with no role row, e.g. Mira). `setupLoading` true while
 *  Mira's enablement probe is unresolved (never show "Not set up" then). */
export interface TeamBandAgent {
  key: AgentKey;
  name: string;
  setUp: boolean;
  setupLoading?: boolean;
  status: AgentActivity;
  halted: boolean;
}
```

(`AgentKey` is already imported in that file. `AgentActivity` is the union `"idle" | "working" | "analyzing" | "waiting_approval" | "error"`.)

- [ ] **Step 2: Write the failing test** `team-band.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TeamBand, teamStatusLabel } from "../team-band";
import type { TeamBandAgent } from "../types";

const AGENTS: TeamBandAgent[] = [
  { key: "alex", name: "Alex", setUp: true, status: "working", halted: false },
  { key: "riley", name: "Riley", setUp: true, status: "idle", halted: false },
  { key: "mira", name: "Mira", setUp: false, setupLoading: false, status: "idle", halted: false },
];

describe("teamStatusLabel", () => {
  it("is honest per state and never fabricates", () => {
    expect(teamStatusLabel({ key: "alex", name: "Alex", setUp: true, status: "working", halted: false })).toBe("Working");
    expect(teamStatusLabel({ key: "riley", name: "Riley", setUp: true, status: "idle", halted: false })).toBe("Ready");
    expect(teamStatusLabel({ key: "alex", name: "Alex", setUp: true, status: "waiting_approval", halted: false })).toBe("Needs you");
    expect(teamStatusLabel({ key: "alex", name: "Alex", setUp: true, status: "working", halted: true })).toBe("Asleep");
    expect(teamStatusLabel({ key: "mira", name: "Mira", setUp: false, setupLoading: false, status: "idle", halted: false })).toBe("Not set up yet");
    expect(teamStatusLabel({ key: "mira", name: "Mira", setUp: false, setupLoading: true, status: "idle", halted: false })).toBe("Checking setup");
  });
});

describe("<TeamBand>", () => {
  it("renders all three crew names", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Riley")).toBeInTheDocument();
    expect(screen.getByText("Mira")).toBeInTheDocument();
  });

  it("shows Mira's honest not-set-up status (a trust signal, not a dead end)", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByText("Not set up yet")).toBeInTheDocument();
  });

  it("each tile is a button that opens that agent's panel", () => {
    const onOpen = vi.fn();
    render(<TeamBand agents={AGENTS} onOpenAgent={onOpen} />);
    fireEvent.click(screen.getByTestId("team-mate-mira"));
    expect(onOpen).toHaveBeenCalledWith("mira");
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(onOpen).toHaveBeenCalledWith("alex");
  });

  it("animates exactly one avatar (the first working agent) - the motion budget", () => {
    const two: TeamBandAgent[] = [
      { key: "alex", name: "Alex", setUp: true, status: "working", halted: false },
      { key: "riley", name: "Riley", setUp: true, status: "working", halted: false },
      { key: "mira", name: "Mira", setUp: true, status: "idle", halted: false },
    ];
    const { container } = render(<TeamBand agents={two} />);
    const playing = container.querySelectorAll('[data-playing="true"]');
    expect(playing.length).toBe(1);
    expect((playing[0] as HTMLElement).dataset.agent).toBe("alex");
  });

  it("halt suppresses all motion (no breathing avatar)", () => {
    const halted = AGENTS.map((a) => ({ ...a, halted: true }));
    const { container } = render(<TeamBand agents={halted} />);
    expect(container.querySelectorAll('[data-playing="true"]').length).toBe(0);
  });

  it("renders no tiles for an empty crew", () => {
    const { container } = render(<TeamBand agents={[]} />);
    expect(container.querySelectorAll("[data-testid^='team-mate-']").length).toBe(0);
  });
});
```

- [ ] **Step 3: Run it; verify it fails** (missing module).

Run: `pnpm --filter @switchboard/dashboard test team-band`
Expected: FAIL.

- [ ] **Step 4: Implement `team-band.tsx`:**

```tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import type { TeamBandAgent } from "./types";
import styles from "./home.module.css";

interface TeamBandProps {
  agents: TeamBandAgent[];
  /** Tap a tile to open that agent's panel. All three are tappable, including Mira. */
  onOpenAgent?: (key: AgentKey) => void;
}

/**
 * Honest, calm status word from real per-agent state. No fabricated specifics
 * (no invented client names or counts). Halt wins; loading never reads as
 * "Not set up".
 */
export function teamStatusLabel(a: TeamBandAgent): string {
  if (a.halted) return "Asleep";
  if (!a.setUp) return a.setupLoading ? "Checking setup" : "Not set up yet";
  switch (a.status) {
    case "working":
    case "analyzing":
      return "Working";
    case "waiting_approval":
      return "Needs you";
    default:
      return "Ready";
  }
}

/**
 * TeamBand - the "your team today" hero band. The crew at hero scale (96px) on
 * their identity grounds, with name and honest live status. One breathing
 * focal avatar (the first genuinely-working agent); reduced motion strips it.
 * Each tile opens the agent panel. Agent hues are identity-only (portrait
 * ground + status accent), never on an action surface.
 */
export function TeamBand({ agents, onOpenAgent }: TeamBandProps) {
  const focalKey = agents.find(
    (a) => a.setUp && !a.halted && (a.status === "working" || a.status === "analyzing"),
  )?.key;

  return (
    <section className={styles.teamBand} aria-label="Your team">
      <h2 className={styles.teamBandHeading}>Your team</h2>
      <div className={styles.teamBandGrid} role="list">
        {agents.map((agent) => {
          const { key, name, setUp, halted } = agent;
          return (
            <div key={key} role="listitem">
              <button
                type="button"
                className={styles.teamMate}
                data-agent={key}
                data-disabled={String(!setUp)}
                data-testid={`team-mate-${key}`}
                aria-label={`Open ${name}`}
                onClick={() => onOpenAgent?.(key)}
              >
                <PrintedPortraitAvatar
                  agentKey={key}
                  size={96}
                  status={setUp ? agent.status : "idle"}
                  halted={halted}
                  allowMotion={key === focalKey}
                  showPip
                />
                <span className={styles.teamMateName}>{name}</span>
                <span className={styles.teamMateStatus}>{teamStatusLabel(agent)}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the test; verify it passes.**

Run: `pnpm --filter @switchboard/dashboard test team-band`
Expected: PASS.

- [ ] **Step 6: Add the CSS** to `home.module.css`. Append a TEAM BAND block. Key requirements: a 3-column grid, the heading NOT italic (the shared `.moduleH h2` is italic; do not reuse it), agent hue identity-only (no hue on borders/focus/hover/background), tokens via `hsl(var(--x))` / bare `var(--ink)` per the file's two-convention rule. Use this as the basis and tune spacing live:

```css
/* =========================================================
   TEAM BAND - the crew onstage at hero scale (replaces the ribbon)
   ========================================================= */
.teamBand {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.teamBandHeading {
  font-family: var(--font-home-sans, inherit);
  font-style: normal; /* never italic (the shared .moduleH is italic) */
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin: 0;
}
.teamBandGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.teamMate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 150px; /* reserve geometry so status text wrap never shifts the row */
  padding: 14px 6px;
  background: var(--surface-card, hsl(var(--surface)));
  border: 1px solid var(--hair);
  border-radius: 14px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.18s ease, background 0.18s ease;
}
.teamMate:hover {
  border-color: var(--hair-strong, var(--hair));
}
.teamMate:focus-visible {
  outline: 2px solid hsl(var(--action));
  outline-offset: 2px;
}
.teamMate[data-disabled="true"] {
  opacity: 0.72;
}
.teamMateName {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.teamMateStatus {
  font-size: 11.5px;
  color: var(--ink-3);
}
```

Verify the exact token names against the live `home.module.css` and `globals.css` (use `--ink`, `--ink-3`, `--hair`, `--surface`, `--action`, `--font-home-sans` as they actually exist; adjust any that differ). Do NOT run `prettier` on this CSS file (repo CSS is hand-formatted and a lone prettier pass fails `format:check`).

- [ ] **Step 7: Re-run the test** (still green; css:false so class names are not asserted).

Run: `pnpm --filter @switchboard/dashboard test team-band`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/dashboard/src/components/home/team-band.tsx \
        apps/dashboard/src/components/home/__tests__/team-band.test.tsx \
        apps/dashboard/src/components/home/types.ts \
        apps/dashboard/src/components/home/home.module.css
git commit -m "feat(dashboard): TeamBand component - the crew at hero scale with honest status"
```

---

## Task 4: Wire the band into Home with correct per-agent status; clean up TeamPulse

**Files:**
- Modify: `apps/dashboard/src/components/home/home-page.tsx`
- Modify: `apps/dashboard/src/components/home/__tests__/home-page.test.tsx`
- Delete: `apps/dashboard/src/components/home/team-pulse.tsx`
- Delete: `apps/dashboard/src/components/home/__tests__/team-pulse.test.tsx`
- Modify: `apps/dashboard/src/components/home/home.module.css` (remove orphaned ribbon CSS)

The honesty fix here is the load-bearing part: status must be attributed per agent via `agentRole`, not a global "any working" flag.

- [ ] **Step 1: Replace the team data derivation in `home-page.tsx`.** Remove the `WORKING_STATUSES`-based global `hasWorkingState` usage for the team list. Add a role map and a per-agent status helper near the top of the module:

```ts
import type { TeamBandAgent } from "./types";
import { TeamBand } from "./team-band";
import type { AgentActivity } from "@/components/agent-avatar/agent-status-visual";
import type { DerivedAgentStateEntry } from "@/lib/api-client-types";

/** Canonical key -> legacy agentRole used by /api/agents/state (mira has no row). */
const AGENT_ROLE_FOR_KEY: Partial<Record<AgentKey, string>> = {
  alex: "responder",
  riley: "optimizer",
};

/** Real per-agent activity. Mira (no role row) is never inferred working here. */
function statusForAgent(
  key: AgentKey,
  states: DerivedAgentStateEntry[] | undefined,
): AgentActivity {
  const role = AGENT_ROLE_FOR_KEY[key];
  if (!role) return "idle";
  return states?.find((s) => s.agentRole === role)?.activityStatus ?? "idle";
}
```

Replace the `teamPulseAgents` block with `teamBandAgents` (keep the existing `setUp` derivation, add `setupLoading` for Mira and the per-agent `status`):

```ts
const teamBandAgents: TeamBandAgent[] = (Object.keys(AGENT_REGISTRY) as AgentKey[]).map((key) => {
  const entry = AGENT_REGISTRY[key];
  let setUp: boolean;
  let setupLoading = false;
  if (key === "alex" && alexMission.data) {
    setUp = !coreSetupIncomplete(alexMission.data, "alex");
  } else if (key === "riley" && rileyMission.data) {
    setUp = !coreSetupIncomplete(rileyMission.data, "riley");
  } else if (key === "mira") {
    setUp = miraEnabled.enabled === true;
    setupLoading = miraEnabled.enabled === undefined; // probe unresolved: never flash "Not set up"
  } else {
    setUp = entry.launchTier === "day-one";
  }
  return {
    key,
    name: entry.displayName,
    setUp,
    setupLoading,
    status: statusForAgent(key, agentState.data?.states),
    halted: isHalted,
  };
});
const setUpCount = teamBandAgents.filter((a) => a.setUp).length;
const workingCount = teamBandAgents.filter(
  (a) => a.setUp && !a.halted && (a.status === "working" || a.status === "analyzing"),
).length;
```

Then replace the `teamPulseNode` with the band, keeping the SAME module key and boundary so the composition and bento math are untouched:

```tsx
const teamPulseNode = (
  <HomeModuleBoundary key="team-pulse">
    <TeamBand agents={teamBandAgents} onOpenAgent={setPanelAgent} />
  </HomeModuleBoundary>
);
```

Remove the now-unused `TeamPulse` import, the `WORKING_STATUSES` constant if it is no longer referenced elsewhere (grep first), and the old `hasWorkingState`/`rosterStateAvailable` lines if they become unused after this change (grep; `rosterStateAvailable` may still gate the verdict's working/setUp clause, so keep it if referenced).

- [ ] **Step 2: Fix the test fixtures and test-ids in `home-page.test.tsx`.**
  - The `useAgentState` mock must return `DerivedAgentStateEntry[]` (keyed by `agentRole` with `activityStatus`), not `AgentStateEntry[]`. Provide role-keyed fixtures so the per-agent attribution is actually exercised: at least one variant with `{ agentRole: "responder", activityStatus: "working", lastActionAt: null }` and `{ agentRole: "optimizer", activityStatus: "idle", lastActionAt: null }`.
  - Update every `getByTestId("agent-chip-<key>")` to `getByTestId("team-mate-<key>")` (there are multiple sites: the ACTIVE-order test, the CALM-order test, the degrade test, and the panel-open tests for alex/riley/mira). Preserve each assertion's intent (module order via `compareDocumentPosition`; clicking a tile opens the panel).
  - If any test asserted the old `agent-status-dot` testid or "Not set up" via the ribbon markup, re-point it to the band (`team-mate-mira` shows "Not set up yet"; the band uses the avatar pip, not `agent-status-dot`).

- [ ] **Step 3: Run the home-page tests; fix fallout.**

Run: `pnpm --filter @switchboard/dashboard test home-page compose-verdict verdict`
Expected: PASS. The corrected per-agent attribution makes `workingCount` accurate (only genuinely-working agents), which can change a verdict proof line in fixtures that previously relied on the inflated count. Update any such assertion to the honest count. Do not weaken assertions; make them match the correct attribution.

- [ ] **Step 4: Delete TeamPulse and its orphaned CSS.**

```bash
git rm apps/dashboard/src/components/home/team-pulse.tsx \
       apps/dashboard/src/components/home/__tests__/team-pulse.test.tsx
```

Then `git grep -n "pulseRibbon\|agentChip\|TeamPulse\|TeamPulseAgent" apps/dashboard/src`. Remove the now-orphaned `.pulseRibbon` and `.agentChip*` rule blocks from `home.module.css` (only if no `.tsx` consumer remains). Keep `TeamPulseAgent` in `types.ts` only if something still imports it; otherwise remove it.

- [ ] **Step 5: Full dashboard test + typecheck + build.**

Run: `pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: all green. Build is the gate for `@/` import and dead-file breaks.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/home/home-page.tsx \
        apps/dashboard/src/components/home/__tests__/home-page.test.tsx \
        apps/dashboard/src/components/home/home.module.css \
        apps/dashboard/src/components/home/types.ts
git commit -m "feat(dashboard): bring the crew onstage on Home with honest per-agent status"
```

---

## Task 5: Live verification + full gate

**Files:** none (verification only).

**Gating policy:** Step 1 plus the typecheck and build from Task 4 are HARD gates. Steps 2 to 4 (dev server, live screenshots, the reduced-motion check) are REQUIRED ONLY IF the local dev environment boots. If it does not, report the blocker and proceed (correctness is covered by unit tests + typecheck + build).

- [ ] **Step 1: Full test + format gate.**

Run: `pnpm --filter @switchboard/dashboard test` then `pnpm format:check`.
Expected: tests green; prettier clean. If `format:check` flags a `.ts`/`.tsx` file you wrote, run `pnpm format` and re-add. Do NOT format the CSS module (it is hand-formatted; a lone prettier pass fails the gate).

- [ ] **Step 2: Boot the app detached** (per `reference_dashboard_visual_verification`): API on :3000 via `node --env-file=.env --import tsx apps/api/src/server.ts`, dashboard via `pnpm --filter @switchboard/dashboard dev`, both launched through a Node `child_process.spawn(cmd, args, { detached: true, stdio: [ignore, log, log] }).unref()` script so they survive harness cleanup. Start Postgres first if needed.

- [ ] **Step 3: Screenshot Home with playwright-core + system Chrome** (`waitUntil: "domcontentloaded"` + a fixed wait, never `networkidle`):
  - Home at a 390px mobile viewport: the team band shows three printed portraits at 96px on coral/teal/violet grounds, each with a name and an honest status word; Mira reads as a clear peer with her violet bob; the three fit three-across without overflow.
  - Home at a 1280px desktop viewport: the band sits in its slot and the three portraits fit the bento main column without wrapping or clipping.
  - A working agent's avatar breathes; confirm exactly one does.
  Save to `/tmp/sbshot/team-band-mobile.png` and `team-band-desktop.png` and Read them.

- [ ] **Step 4: Reduced-motion check.** In Chrome devtools emulate `prefers-reduced-motion: reduce`, reload Home, confirm no avatar animates.

- [ ] **Step 5: Final commit** (only if Step 1-4 produced tuning edits, e.g. CSS spacing):

```bash
git add -A apps/dashboard/src
git commit -m "style(dashboard): tune team band spacing from live verification"
```

---

## Self-review (run after the tasks, before handoff)

- **Spec coverage:** Mira's sprite (spec section 2) = Tasks 1-2. The hero band with honest status, no value strip, a11y, motion budget, cleanup (spec section 3) = Tasks 3-4. Cockpit deferral (spec section 2) is honored (untouched). Live verification (spec section 7) = Task 5.
- **Honesty invariants tested:** per-agent status attribution (role-keyed fixtures, Task 4 Step 2), Mira never inferred working (`statusForAgent` returns idle for no-role keys), no "Not set up" while loading (`setupLoading` -> "Checking setup", Task 3 test), one breathing avatar + reduced-motion (Task 3 test).
- **No new tokens / no raw hex outside the sprite palette:** the band CSS uses `hsl(var(--x))` / `var(--ink*)` only; the sprite palette is the established per-variant exception.
- **No em-dashes, no italics:** band heading is `font-style: normal`; status words are plain; the mira-config test guards the subtitle against an em-dash.

---

## Follow-on (out of scope, noted so they are not lost)

1. The cumulative "since you hired your team" value strip, shipped with the lifetime metrics window (`window=all`).
2. A larger desktop hero scale (up to 112px) via a container query or a fluid-size avatar mode.
3. Unifying the `/mira` cockpit desk onto the printed-portrait sprite with a reduced-motion-safe `SpriteFrame`.
