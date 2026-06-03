# Printed-Portrait Agent Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared `PrintedPortraitAvatar` component that renders every agent (Alex, Riley, Mira) in a single "printed-portrait" frame (identity-hue ground + 1px ink-offset halo + crisp pixel sprite + optional status pip), and replace the three fragmented avatar systems with it.

**Architecture:** A presentational component wraps the existing sprite renderer (`AnimatedSprite`) in a tokenized CSS frame. It is status-capable through props (no data fetching inside), so callers pass the live status they already hold. A pure mapping util turns activity status into a sprite animation state, a pip color, and a "should it animate" flag (honoring the one-breathing-avatar motion budget). `InboxAgentAvatar` becomes a thin adapter over it (preserving its API so its 6 call sites and the agent-panel mock are untouched), and Home's `TeamPulse` swaps its flat letter disc for it, wired to the `useAgentState()` status it already computes.

**Tech Stack:** Next.js (App Router) dashboard, React, TypeScript (ESM, no `.js` import extensions in this package), CSS Modules with `hsl(var(--token))` design tokens, Vitest + @testing-library/react (jsdom, `css:false`).

**Decisions locked (from brainstorming):** keep the shipped agent hues (Alex coral, Riley teal, Mira violet); no font swap; no italics; Mira keeps NO sprite for now (graceful in-frame letter fallback, her real 24x24 sprite is a separate deliverable). Spec: `docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`.

---

## File structure

- **Create** `apps/dashboard/src/components/agent-avatar/agent-status-visual.ts`: pure status mapping (activity + halted -> sprite state, pip, playing). One responsibility: status semantics.
- **Create** `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`: the shared component. One responsibility: render the framed portrait.
- **Create** `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.module.css`: the frame, ground, ink-offset halo, plate, letter, pip, pulse. One responsibility: the printed-portrait look, fully tokenized.
- **Create** `apps/dashboard/src/components/agent-avatar/__tests__/agent-status-visual.test.ts`: maps every status.
- **Create** `apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx`: render branches + data attributes.
- **Modify** `apps/dashboard/src/components/inbox/inbox-agent-avatar.tsx`: re-implement as a thin adapter over `PrintedPortraitAvatar` (same `{ agentKey, size }` API). Its 6 callers and the agent-panel test mock stay untouched.
- **Modify** `apps/dashboard/src/components/home/team-pulse.tsx`: replace the `.agentChipAv` letter disc with `PrintedPortraitAvatar`, passing the `status` it already has. Keep the existing `.agentChipStatus` dot.
- **Possibly modify** `apps/dashboard/src/components/inbox/__tests__/inbox-agent-avatar.test.tsx` and a Home `team-pulse` test if one asserts the old letter markup (verify in-task, only touch if red).

Why a new `agent-avatar/` directory: the component is cross-surface (Home, Inbox, agent-panel), so it should not live under `inbox/` or `cockpit/`. `OperatorCharacter` and `AgentMark` under `character/` are unrelated (full-body operator preview and abstract brand marks); do not extend them.

---

## Pre-flight (once, before Task A1)

- [ ] **Confirm worktree + base.** You are in `.claude/worktrees/app-aesthetic-direction` on `worktree-app-aesthetic-direction`, based off `main` (which already includes #832 wave-1 token unification). Run `git -C . log --oneline -1` and confirm it is at or after `f7dc170f` (the token keystone). The tokens this plan consumes (`--agent-alex`, `--agent-riley`, `--agent-mira` and their `-deep`/`-tint`, plus `--agent-active/idle/attention/locked`) already exist in `apps/dashboard/src/app/globals.css`.
- [ ] **Env setup.** From the worktree root run `pnpm worktree:init`. Known gotcha (`feedback_worktree_env_sync_corruption`): after it runs, open `apps/dashboard/.env.local` and (a) fix any `DATABASE_URL` that got concatenated onto one line, (b) uncomment `DEV_BYPASS_AUTH=true`. If Postgres is unreachable, run `pnpm install` instead; tests do not need Postgres, only the live-screenshot step (A5) needs the dev server.
- [ ] **Baseline test green.** Run `pnpm --filter @switchboard/dashboard test` and confirm it passes before changing anything. If it fails, report and stop (do not build on a red baseline).
- [ ] **Confirm token formats** (the avatar CSS depends on them): run `git grep -nE "^\s*--(ink|hair|agent-alex-tint|agent-alex-deep|surface|agent-active):" apps/dashboard/src/app/globals.css`. Confirm `--ink` and `--hair` are FULL colors (used bare as `var(--ink)` / `var(--hair)`), while `--agent-*-tint/-deep`, `--surface`, and `--agent-active` are raw HSL triples (used as `hsl(var(--x))`). The CSS in Task A2 uses each form accordingly; if any format differs, adjust the wrapping before writing the CSS.

---

## Task A1: Status -> visual mapping util

**Files:**
- Create: `apps/dashboard/src/components/agent-avatar/agent-status-visual.ts`
- Test: `apps/dashboard/src/components/agent-avatar/__tests__/agent-status-visual.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/src/components/agent-avatar/__tests__/agent-status-visual.test.ts
import { describe, it, expect } from "vitest";
import { agentVisualState } from "../agent-status-visual";

describe("agentVisualState", () => {
  it("halted overrides everything -> sleep / locked / not playing", () => {
    expect(agentVisualState("working", true)).toEqual({
      spriteState: "sleep",
      pip: "locked",
      playing: false,
    });
  });

  it("working and analyzing -> draft / active / playing", () => {
    expect(agentVisualState("working", false)).toEqual({
      spriteState: "draft",
      pip: "active",
      playing: true,
    });
    expect(agentVisualState("analyzing", false)).toEqual({
      spriteState: "draft",
      pip: "active",
      playing: true,
    });
  });

  it("waiting_approval -> idle sprite / attention pip / not playing", () => {
    expect(agentVisualState("waiting_approval", false)).toEqual({
      spriteState: "idle",
      pip: "attention",
      playing: false,
    });
  });

  it("error -> idle sprite / attention pip / not playing", () => {
    expect(agentVisualState("error", false)).toEqual({
      spriteState: "idle",
      pip: "attention",
      playing: false,
    });
  });

  it("idle -> idle / idle / not playing", () => {
    expect(agentVisualState("idle", false)).toEqual({
      spriteState: "idle",
      pip: "idle",
      playing: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test agent-status-visual`
Expected: FAIL with "Cannot find module '../agent-status-visual'".

- [ ] **Step 3: Write the implementation**

```ts
// apps/dashboard/src/components/agent-avatar/agent-status-visual.ts
import type { SpriteState } from "@/components/cockpit/sprite/types";
import type { DerivedAgentStateEntry } from "@/lib/api-client-types";

/**
 * Live activity status, DERIVED from the API type so the union cannot silently
 * drift if the backend adds a status. Returned by `useAgentState()` as
 * `DerivedAgentStateEntry.activityStatus` (a non-nullable union today; the
 * `NonNullable` is a no-op now and a guard so callers stay type-safe if the API
 * ever goes nullable). Any unknown future value falls through `agentVisualState`'s
 * `default` branch to a calm idle.
 */
export type AgentActivity = NonNullable<DerivedAgentStateEntry["activityStatus"]>;

/** Status pip color keys, mapping to globals.css `--agent-*` status tokens. */
export type StatusPip = "active" | "idle" | "attention" | "locked";

export interface AgentVisualState {
  /** Which sprite animation cycle to show. */
  spriteState: SpriteState;
  /** Status dot color key. */
  pip: StatusPip;
  /**
   * Whether the sprite should animate. Motion budget: only an actively working
   * agent breathes; everything else holds a static frame.
   */
  playing: boolean;
}

/**
 * Pure mapping from live status to the avatar's visual state. `halted` (from the
 * workspace-level halt) wins over any activity. Identity-only: never affects an
 * action control.
 */
export function agentVisualState(status: AgentActivity, halted: boolean): AgentVisualState {
  if (halted) {
    return { spriteState: "sleep", pip: "locked", playing: false };
  }
  switch (status) {
    case "working":
    case "analyzing":
      return { spriteState: "draft", pip: "active", playing: true };
    case "waiting_approval":
    case "error":
      return { spriteState: "idle", pip: "attention", playing: false };
    case "idle":
    default:
      return { spriteState: "idle", pip: "idle", playing: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test agent-status-visual`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-avatar/agent-status-visual.ts \
        apps/dashboard/src/components/agent-avatar/__tests__/agent-status-visual.test.ts
git commit -m "feat(dashboard): agent status-to-visual mapping util for the printed-portrait avatar"
```

---

## Task A2: The PrintedPortraitAvatar component

**Files:**
- Create: `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`
- Create: `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.module.css`
- Test: `apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PrintedPortraitAvatar } from "../printed-portrait-avatar";

describe("<PrintedPortraitAvatar>", () => {
  it("renders the pixel sprite SVG for alex and riley", () => {
    const alex = render(<PrintedPortraitAvatar agentKey="alex" />);
    expect(alex.container.querySelector("svg")).not.toBeNull();
    const riley = render(<PrintedPortraitAvatar agentKey="riley" />);
    expect(riley.container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to an in-frame letter for mira (no sprite bundle)", () => {
    const { container, getByText } = render(<PrintedPortraitAvatar agentKey="mira" />);
    expect(getByText("M")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("exposes resolved sprite-state and pip as data attributes from status", () => {
    const { container } = render(
      <PrintedPortraitAvatar agentKey="alex" status="working" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.spriteState).toBe("draft");
    expect(root.dataset.pip).toBe("active");
    expect(root.dataset.agent).toBe("alex");
  });

  it("halted overrides status -> sleep + locked pip", () => {
    const { container } = render(
      <PrintedPortraitAvatar agentKey="riley" status="working" halted />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.spriteState).toBe("sleep");
    expect(root.dataset.pip).toBe("locked");
  });

  it("renders a status pip element by default and omits it when showPip is false", () => {
    // both the root and the pip element carry data-pip, so count the elements:
    const withPip = render(<PrintedPortraitAvatar agentKey="alex" status="idle" />);
    expect(withPip.container.querySelectorAll("[data-pip]").length).toBe(2);
    const noPip = render(
      <PrintedPortraitAvatar agentKey="alex" status="idle" showPip={false} />,
    );
    expect(noPip.container.querySelectorAll("[data-pip]").length).toBe(1);
  });

  it("data-playing reflects status and the one-breathing-avatar budget", () => {
    const working = render(<PrintedPortraitAvatar agentKey="alex" status="working" />);
    expect((working.container.firstElementChild as HTMLElement).dataset.playing).toBe("true");
    const idle = render(<PrintedPortraitAvatar agentKey="alex" status="idle" />);
    expect((idle.container.firstElementChild as HTMLElement).dataset.playing).toBe("false");
    const halted = render(<PrintedPortraitAvatar agentKey="alex" status="working" halted />);
    expect((halted.container.firstElementChild as HTMLElement).dataset.playing).toBe("false");
    const budgeted = render(
      <PrintedPortraitAvatar agentKey="alex" status="working" allowMotion={false} />,
    );
    expect((budgeted.container.firstElementChild as HTMLElement).dataset.playing).toBe("false");
  });

  it("holds still under prefers-reduced-motion even when working", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<PrintedPortraitAvatar agentKey="alex" status="working" />);
      await waitFor(() =>
        expect((container.firstElementChild as HTMLElement).dataset.playing).toBe("false"),
      );
    } finally {
      window.matchMedia = original;
    }
  });

  it("applies the requested size to the root box", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" size={44} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("44px");
    expect(root.style.height).toBe("44px");
  });

  it("is decorative (root aria-hidden) so adjacent name text is not duplicated", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test printed-portrait-avatar`
Expected: FAIL with "Cannot find module '../printed-portrait-avatar'".

- [ ] **Step 3: Write the CSS module**

```css
/* apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.module.css */
/* The printed-portrait frame: identity-hue ground + 1px ink-offset "registration"
   halo + crisp pixel plate + status pip. Fully tokenized (hsl(var(--agent-*))). */

.portrait {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 22%;
}
/* identity ground + a hard 1px ink-offset "registration" shadow (the riso
   through-line) + a hairline. A real box-shadow needs no z-index, so it cannot be
   lost behind an ancestor stacking context the way a negative-z ::before can. */
.alex {
  background: hsl(var(--agent-alex-tint));
  box-shadow: 1px 1px 0 0 hsl(var(--agent-alex-deep)), inset 0 0 0 1px var(--hair);
}
.riley {
  background: hsl(var(--agent-riley-tint));
  box-shadow: 1px 1px 0 0 hsl(var(--agent-riley-deep)), inset 0 0 0 1px var(--hair);
}
.mira {
  background: hsl(var(--agent-mira-tint));
  box-shadow: 1px 1px 0 0 hsl(var(--agent-mira-deep)), inset 0 0 0 1px var(--hair);
}

.plate {
  display: grid;
  place-items: end center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
}
.plate :global(svg) {
  image-rendering: pixelated;
}

.letter {
  font-family: var(--serif);
  font-weight: 600;
  font-style: normal; /* never italic */
  line-height: 1;
}
.alex .letter {
  color: hsl(var(--agent-alex-deep));
}
.riley .letter {
  color: hsl(var(--agent-riley-deep));
}
.mira .letter {
  color: hsl(var(--agent-mira-deep));
}

.pip {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 28%;
  height: 28%;
  min-width: 6px;
  min-height: 6px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px hsl(var(--surface));
}
.pip[data-pip="active"] {
  background: hsl(var(--agent-active));
}
.pip[data-pip="idle"] {
  background: hsl(var(--agent-idle));
}
.pip[data-pip="attention"] {
  background: hsl(var(--agent-attention));
}
.pip[data-pip="locked"] {
  background: hsl(var(--agent-locked));
}

.portrait[data-playing="true"] .pip[data-pip="active"] {
  animation: pp-pulse 2.6s ease-in-out infinite;
}
@keyframes pp-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
@media (prefers-reduced-motion: reduce) {
  .portrait .pip {
    animation: none;
  }
}
```

- [ ] **Step 4: Write the component**

```tsx
// apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx
"use client";

import { useEffect, useState } from "react";
import type { AgentKey } from "@switchboard/schemas";
import { AnimatedSprite } from "@/components/cockpit/sprite/animated-sprite";
import type { SpriteVariantKey, VariantBundle } from "@/components/cockpit/sprite/types";
import { ALEX_VARIANTS, DEFAULT_ALEX_VARIANT } from "@/lib/cockpit/alex-config";
import { RILEY_VARIANTS, DEFAULT_RILEY_VARIANT } from "@/lib/cockpit/riley/riley-config";
import { agentVisualState, type AgentActivity } from "./agent-status-visual";
import styles from "./printed-portrait-avatar.module.css";

interface SpriteRef {
  bundle: VariantBundle | null;
  /** Omitted for agents without a sprite (Mira); `bundle: null` is the real signal. */
  variant?: SpriteVariantKey;
}

/** Mira has no sprite bundle yet (her real 24x24 sprite is a separate deliverable). */
const SPRITES: Record<AgentKey, SpriteRef> = {
  alex: { bundle: ALEX_VARIANTS, variant: DEFAULT_ALEX_VARIANT },
  riley: { bundle: RILEY_VARIANTS, variant: DEFAULT_RILEY_VARIANT },
  mira: { bundle: null },
};

/** Explicit per-agent class map: Record<AgentKey> forces an entry when AgentKey grows, keeping agent styling centralized. */
const AGENT_CLASS: Record<AgentKey, string> = {
  alex: styles.alex,
  riley: styles.riley,
  mira: styles.mira,
};

/** Decorative one-letter fallback (only Mira renders it; Alex/Riley show sprites). */
const AGENT_LETTER: Record<AgentKey, string> = {
  alex: "A",
  riley: "R",
  mira: "M",
};

/** Local reduced-motion read so the sprite holds still when the OS asks. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    // optional-chained so the jsdom matchMedia mock (which may omit the listener
    // API) does not throw in tests:
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export interface PrintedPortraitAvatarProps {
  agentKey: AgentKey;
  /** Box size in px. Small (chip) ~22-44, hero ~96-120. Default 28. */
  size?: number;
  /** Live activity. Default "idle" (static). */
  status?: AgentActivity;
  /** Workspace halt. Overrides status -> sleeping. Default false. */
  halted?: boolean;
  /** Show the status pip. Default true. */
  showPip?: boolean;
  /**
   * Whether this avatar may animate. Default true. Callers enforce the
   * one-breathing-avatar-per-viewport budget by passing false to all but the
   * single focal (e.g. first working) agent.
   */
  allowMotion?: boolean;
  className?: string;
}

/**
 * The one agent avatar for every surface: the agent's pixel sprite (Alex/Riley)
 * or an in-frame identity letter (Mira), inside a printed-portrait frame
 * (identity-hue ground + ink-offset halo) with an optional live status pip.
 * Decorative (aria-hidden): always rendered beside the agent's name in text.
 * Identity-only: never colors an action control.
 */
export function PrintedPortraitAvatar({
  agentKey,
  size = 28,
  status = "idle",
  halted = false,
  showPip = true,
  allowMotion = true,
  className,
}: PrintedPortraitAvatarProps) {
  const reduced = usePrefersReducedMotion();
  const { bundle, variant } = SPRITES[agentKey];
  const visual = agentVisualState(status, halted);
  const def = bundle && variant ? (bundle[variant] ?? null) : null;
  // Alex/Riley always render a sprite (fall back to idle frames if a state is
  // missing); only Mira (def === null) shows the in-frame identity letter.
  const frames = def ? (def.states[visual.spriteState] ?? def.states.idle) : null;
  const playing = allowMotion && visual.playing && !reduced;
  const inner = Math.round(size * 0.82);

  return (
    <span
      className={`${styles.portrait} ${AGENT_CLASS[agentKey]}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      data-agent={agentKey}
      data-sprite-state={visual.spriteState}
      data-pip={visual.pip}
      data-playing={playing ? "true" : "false"}
      aria-hidden="true"
    >
      <span className={styles.plate}>
        {frames && def ? (
          <AnimatedSprite frames={frames} palette={def.palette} size={inner} playing={playing} />
        ) : (
          <span className={styles.letter} style={{ fontSize: Math.round(size * 0.4) }}>
            {AGENT_LETTER[agentKey]}
          </span>
        )}
      </span>
      {showPip && <span className={styles.pip} data-pip={visual.pip} />}
    </span>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test printed-portrait-avatar`
Expected: PASS (9 tests). If the "size" test fails on `root.style.width`, confirm the inline `style={{ width: size, height: size }}` is on the root span (it is in the code above).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: no errors. (If it reports a missing `AnimatedSprite`/variant export, confirm the import paths against the real files; they were verified to exist.)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx \
        apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.module.css \
        apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx
git commit -m "feat(dashboard): shared printed-portrait agent avatar (sprite + ink-offset frame + status pip)"
```

---

## Task A3: InboxAgentAvatar becomes a thin adapter

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox-agent-avatar.tsx` (full rewrite of the body)
- Verify: `apps/dashboard/src/components/inbox/__tests__/inbox-agent-avatar.test.tsx` (should pass unchanged)

Goal: every existing `InboxAgentAvatar` caller (inbox-decision-card, inbox-filter-row, approval-detail-sheet, handoff-detail-sheet, agent-panel) gets the new printed-portrait look with zero call-site edits. No status pip here (these surfaces do not pass live status yet), so identity-only.

- [ ] **Step 1: Replace the file contents**

```tsx
// apps/dashboard/src/components/inbox/inbox-agent-avatar.tsx
import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";

export interface InboxAgentAvatarProps {
  agentKey: AgentKey;
  /** Pixel size of the avatar. Defaults to 22 (matches the cockpit chip). */
  size?: number;
}

/**
 * Identity-only agent avatar for the inbox surfaces. Thin adapter over the shared
 * `PrintedPortraitAvatar` (no live status here, so no pip). Kept as a named export
 * so its existing call sites and test mocks are untouched. NEVER colors an action.
 */
export function InboxAgentAvatar({ agentKey, size = 22 }: InboxAgentAvatarProps) {
  return <PrintedPortraitAvatar agentKey={agentKey} size={size} showPip={false} />;
}
```

- [ ] **Step 2: Run the existing inbox-agent-avatar test (unchanged)**

Run: `pnpm --filter @switchboard/dashboard test inbox-agent-avatar`
Expected: PASS. Its three assertions still hold: alex/riley render an `svg`; mira renders text `M` and no `svg`. If the mira assertion fails because the letter is queried differently, confirm `getByText("M")` still matches (the letter span renders "M").

- [ ] **Step 3: Run the agent-panel test (it mocks InboxAgentAvatar)**

Run: `pnpm --filter @switchboard/dashboard test agent-panel`
Expected: PASS (the mock replaces the import, so the internal change is invisible to it).

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: both succeed. `build` is required to catch any `@/` import or dead-file break that typecheck and vitest miss (`feedback_build_typechecks_dead_files`, `feedback_dashboard_no_js_on_any_import`).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/inbox/inbox-agent-avatar.tsx
git commit -m "feat(dashboard): route inbox/agent-panel avatars through the printed-portrait avatar"
```

---

## Task A4: Home TeamPulse uses the printed portrait, status-wired

**Files:**
- Modify: `apps/dashboard/src/components/home/team-pulse.tsx`
- Verify/modify: any `team-pulse` test that asserts the old `.agentChipAv` letter

`TeamPulse` already receives `agents: TeamPulseAgent[]` where each has `{ key, name, status, setUp }` and `status` is `"working" | "idle"` (both are valid `AgentActivity` values). Replace only the avatar; keep the existing `.agentChipStatus` dot and the "Not set up" text.

- [ ] **Step 1: Add the import**

At the top of `team-pulse.tsx`, add:

```tsx
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
```

- [ ] **Step 2: Replace the flat letter disc**

Replace this block:

```tsx
<span className={styles.agentChipAv} aria-hidden="true">
  {name[0]}
</span>
```

with:

```tsx
<PrintedPortraitAvatar
  agentKey={key}
  size={30}
  status={setUp ? status : "idle"}
  allowMotion={key === firstWorkingKey}
  showPip={false}
/>
```

And add the focal-agent computation **immediately before the `return (` statement in `TeamPulse`** (after the `{ agents, onOpenAgent }` props are in scope; `TeamPulse` has no early returns or hooks, so this is a plain top-of-body `const`, not inside the `.map`), so at most one avatar breathes (the one-breathing-avatar-per-viewport budget, spec Principle VI):

```tsx
const firstWorkingKey = agents.find((a) => a.setUp && a.status === "working")?.key;
```

Why these three props:
- `status={setUp ? status : "idle"}`: a not-set-up agent (Mira on day one) must never read as working or animate.
- `allowMotion={key === firstWorkingKey}`: even if two agents are working, only the first one's sprite breathes; the rest hold a static frame.
- `showPip={false}`: the chip already renders its own `.agentChipStatus` dot just below. **Documented asymmetry for this slice:** Home shows status via that existing dot plus the focal sprite's working animation; Inbox and the agent panel are identity-only (no pip, no live status yet). Unifying status onto the avatar pip across surfaces is a follow-on plan, not this keystone.

- [ ] **Step 3: Verify tests; update only if red**

Run: `pnpm --filter @switchboard/dashboard test team-pulse`
- If a test asserts the literal initial (e.g., `getByText("A")` for the avatar), it will now also still pass because `PrintedPortraitAvatar` renders the letter only for Mira; for Alex/Riley it renders a sprite. If such an assertion exists and goes red, change it to assert the chip name (`getByText("Alex")` via `.agentChipName`) or the `data-testid={`agent-chip-${key}`}` instead. Keep the `agent-status-dot` assertions as-is (the dot is unchanged).
- Expected after any needed edit: PASS.

- [ ] **Step 4: Remove the now-dead `.agentChipAv` rule (only if unused)**

Run: `git grep -n "agentChipAv" apps/dashboard/src`. If the only remaining hit is the CSS rule in `home.module.css` (no `.tsx` consumer), delete the `.agentChipAv` rule block from `home.module.css`. If any consumer remains, leave it.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/home/team-pulse.tsx apps/dashboard/src/components/home/home.module.css
git commit -m "feat(dashboard): Home team pulse uses the printed-portrait avatar with live status"
```

---

## Task A5: Live verification + full gate

**Files:** none (verification only)

**Gating policy:** Step 1 (tests + format) plus the typecheck and build from earlier tasks are HARD gates that must pass. Steps 2 to 4 (dev server, live screenshots, the in-browser reduced-motion check) are REQUIRED ONLY IF the local dev environment boots. If it does not (Postgres down, or the `feedback_worktree_env_sync_corruption` env breakage), report the blocker with logs and proceed: correctness is already covered by the unit tests, typecheck, and build. Do not burn time fighting env setup after the gates pass.

- [ ] **Step 1: Full test + format gate**

Run: `pnpm --filter @switchboard/dashboard test` then `pnpm format:check`.
Expected: tests green; prettier clean. If `format:check` flags the new files, run `pnpm format` and re-add. (CI `format:check` is `*.ts` only and the dashboard ESLint is stubbed, so do not rely on CI for the CSS or `.tsx` complexity; this step is the gate.)

- [ ] **Step 2: Boot the app for live screenshots**

Start Postgres if needed, then boot detached (tracked/nohup processes get reaped, per `feedback_local_dev_server_launch` / `reference_dashboard_visual_verification`):
- API: `node --env-file=.env --import tsx apps/api/src/server.ts` on :3000
- Dashboard: `pnpm --filter @switchboard/dashboard dev` on :3002
Launch via a Node `child_process.spawn(cmd, args, { detached: true, stdio: [ignore, log, log] }).unref()` script so they survive harness cleanup.

- [ ] **Step 3: Screenshot the three surfaces and confirm the unification**

Capture with playwright-core + system Chrome (`waitUntil: "domcontentloaded"` + a fixed wait, never `networkidle`):
- Home (`/`): the team ribbon now shows printed-portrait avatars (Alex/Riley sprites in a coral/teal ground with the ink-offset halo; Mira a violet in-frame "M"), and a working agent's sprite animates. Save `/tmp/sbshot/avatar-home.png`.
- Inbox (`/inbox`): decision-card bylines, the filter row, and the approval sheet show the same printed-portrait frame. Save `/tmp/sbshot/avatar-inbox.png`.
- Mira agent panel (open Mira from Home/Inbox): the size-44 header avatar is now the violet printed portrait, not a bare square. Save `/tmp/sbshot/avatar-mira.png`.

Confirm by eye: one consistent frame and one hue per agent across all three surfaces; pixels stay crisp (not blurred); Mira reads as a peer of Alex/Riley. Tune `inner` (sprite inset, currently `size * 0.82`) or the pip size in the CSS module if the mat looks too thin/thick, then re-run A2 tests.

- [ ] **Step 4: Reduced-motion check**

In Chrome devtools emulate `prefers-reduced-motion: reduce` and reload Home; confirm no sprite animates and the pip does not pulse. (The component reads the media query and holds `playing=false`.)

- [ ] **Step 5: Final commit (screenshots are not committed)**

If A4 Step 3/4 produced any test or CSS edits not yet committed, commit them now:

```bash
git add -A apps/dashboard/src
git commit -m "test(dashboard): adjust avatar tests + drop dead chip-avatar CSS"
```

---

## Self-review (run after the tasks, before handoff)

- **Spec coverage:** the spec's "one printed-portrait frame everywhere (small + hero), replacing the fragmented avatar systems, fed by real status" is implemented by A2 (component), A3 (inbox/panel adapter), A4 (Home + status). The spec's "Mira's real sprite is an open deliverable" is honored (in-frame letter fallback). Hero-scale usage (96-120px "meet your team") is a later surface plan, not this keystone; the component already supports it via `size`.
- **Placeholder scan:** none. Every step has the real code or the exact command + expected output.
- **Type consistency:** `AgentActivity` is defined once (A1) and imported by A2; `agentVisualState` returns the same `{ spriteState, pip, playing }` shape asserted in both test files; `PrintedPortraitAvatarProps` matches the props passed in A3 and A4; `InboxAgentAvatarProps` is unchanged so its 6 callers still typecheck.
- **Token correctness:** each color uses the correct wrapping for its token form: raw-triple tokens as `hsl(var(--agent-*))` / `hsl(var(--surface))` / `hsl(var(--agent-active))`, and the full-color hairline as bare `var(--hair)` (never `hsl(var(--ink) / a)`, since `--ink` is already a full color). All exist in globals.css post-#832; no new tokens, no raw hex (keeps the drift guard green).

---

## Follow-on plans (out of scope here, noted so they are not lost)

1. Wire live status into Inbox/agent-panel avatars (show the pip there, halt -> sleep on the panel header).
2. Hero-scale "meet your team" band on Home (printed portraits at 96-120px) + the cumulative value strip.
3. Mira's real 24x24 sprite (author it like `alex-variants.ts`/`riley-variants.ts`, then drop the letter fallback).
4. Canvas paper-grain + no-italics sweep (separate plan).
5. The remaining wave-1 Phase-B foundation from `docs/superpowers/plans/2026-06-02-wave-1-token-unification-foundation.md`: EL1 shadow ladder, SP1 spacing scale, TY2 tracking tokens (TY2 is blocked on the font-display sans-vs-serif decision). QS1/QS2 QueryStates is already implemented (PRs #834/#836 open), so it is no longer "remaining."
