# Meet Your Team Hero Poster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Home team band into the locked direction's "meet your team" poster: the crew at fluid hero scale on tri-radial identity-tint grounds, under the lighter poster grain, with serif identity names, role lines, and the existing honest live status.

**Architecture:** Three layers, bottom-up. (1) The sprite renderer gains a `"fill"` size so the vector SVG can scale fluidly. (2) `PrintedPortraitAvatar` gains `size="fill"` plus a `hero` frame variant (2px halo, 1.5px edge, capped pip). (3) `TeamBand` swaps its three cream tiles for one poster surface in a new co-located CSS module (identity-tint radials + a lighter grain layer blended into the poster's own background, mirroring the shipped canvas mechanism). Governance and voice gates extend to cover the new surface. Data flow, module composition, and the tap-to-panel contract do not change.

**Tech Stack:** Next.js 14 dashboard, CSS Modules, Vitest + Testing Library (jsdom, css:false, so tests assert data-\*/structural contracts, never computed styles), the token drift-guard, playwright-core + system Chrome for live verification.

**Spec:** `docs/superpowers/specs/2026-06-04-meet-your-team-hero-design.md`

**Worktree note:** Implementation happens on the `worktree-team-hero` branch (worktree under `.claude/worktrees/team-hero`, based on origin/main). Commit messages end with the Co-Authored-By line shown in each commit step. lint-staged reformats staged `.ts/.tsx` on commit; if it modifies files, re-stage and the commit proceeds.

---

### Task 1: Sprite `"fill"` size mode

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/sprite/pixel-sprite.tsx`
- Modify: `apps/dashboard/src/components/cockpit/sprite/animated-sprite.tsx`
- Test: `apps/dashboard/src/components/cockpit/sprite/__tests__/pixel-sprite.test.tsx`

- [ ] **Step 1.1: Add the failing test**

Append inside the existing `describe("<PixelSprite>")` block in `pixel-sprite.test.tsx`:

```tsx
it('renders percentage dimensions in "fill" mode (fluid hero scale)', () => {
  const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size="fill" />);
  const svg = container.querySelector("svg");
  expect(svg?.getAttribute("width")).toBe("100%");
  expect(svg?.getAttribute("height")).toBe("100%");
  // The viewBox still pins the 24x24 grid so pixels scale crisply.
  expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
});
```

- [ ] **Step 1.2: Run it, confirm it fails on the type and/or attribute**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/cockpit/sprite/__tests__/pixel-sprite.test.tsx`
Expected: FAIL (TS type error for `size="fill"` surfaces as a test-file type error or the width assertion fails).

- [ ] **Step 1.3: Implement**

In `pixel-sprite.tsx`, change the props interface and the svg dimensions:

```tsx
export interface PixelSpriteProps {
  rows: Frame;
  palette: Palette;
  /** Box size in px, or "fill" to scale to the parent box (fluid hero scale). */
  size: number | "fill";
  style?: CSSProperties;
}
```

and in the component body replace `width={size} height={size}` with:

```tsx
      width={size === "fill" ? "100%" : size}
      height={size === "fill" ? "100%" : size}
```

In `animated-sprite.tsx`, widen the pass-through type the same way:

```tsx
export interface AnimatedSpriteProps {
  frames: readonly AnimFrame[];
  palette: Palette;
  /** Box size in px, or "fill" to scale to the parent box (fluid hero scale). */
  size: number | "fill";
  playing?: boolean;
  style?: CSSProperties;
}
```

(No body change in `AnimatedSprite`; it forwards `size` to `PixelSprite`.)

- [ ] **Step 1.4: Run the sprite tests, confirm green**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/cockpit/sprite/__tests__/`
Expected: PASS (all files).

- [ ] **Step 1.5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/sprite/pixel-sprite.tsx apps/dashboard/src/components/cockpit/sprite/animated-sprite.tsx apps/dashboard/src/components/cockpit/sprite/__tests__/pixel-sprite.test.tsx
git commit -m "feat(dashboard): sprite fill size mode for fluid hero scale

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PrintedPortraitAvatar` fill mode and hero frame

**Files:**

- Modify: `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`
- Modify: `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.module.css`
- Test: `apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx`

- [ ] **Step 2.1: Add the failing tests**

Append inside the existing `describe("<PrintedPortraitAvatar>")`:

```tsx
it('size="fill" makes the box fluid (data contract; sizing lives in CSS)', () => {
  const { container } = render(<PrintedPortraitAvatar agentKey="alex" size="fill" />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.dataset.size).toBe("fill");
  // No fixed inline px box in fill mode.
  expect(root.style.width).toBe("");
  expect(root.style.height).toBe("");
  // Sprite still renders, scaled to the box.
  expect(container.querySelector("svg")?.getAttribute("width")).toBe("100%");
});

it("number mode is unchanged (no data-size, fixed px box)", () => {
  const { container } = render(<PrintedPortraitAvatar agentKey="alex" size={44} />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.dataset.size).toBeUndefined();
  expect(root.style.width).toBe("44px");
});

it("hero prop applies the hero frame variant (data contract)", () => {
  const { container } = render(<PrintedPortraitAvatar agentKey="riley" size="fill" hero />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.dataset.hero).toBe("true");
  const chip = render(<PrintedPortraitAvatar agentKey="riley" size={28} />);
  expect((chip.container.firstElementChild as HTMLElement).dataset.hero).toBeUndefined();
});
```

- [ ] **Step 2.2: Run, confirm fail**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx`
Expected: FAIL (type error on `size="fill"` / `hero`).

- [ ] **Step 2.3: Implement the component**

In `printed-portrait-avatar.tsx`:

1. Widen the props:

```tsx
export interface PrintedPortraitAvatarProps {
  agentKey: AgentKey;
  /** Box size in px (chip ~22-44) or "fill" (fluid, parent-controlled; hero poster). Default 28. */
  size?: number | "fill";
  /** Hero frame variant: heavier 2px halo offset + 1.5px edge + capped pip (spec section 4). */
  hero?: boolean;
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
```

2. In the component, derive fill mode and adjust the inner sizing block (replace the current `inner` / `letterSize` lines and the root `style`):

```tsx
const fill = size === "fill";
const inner = fill ? 0 : Math.round(size * 0.82); // ~9% identity ground showing around the inset plate
// Fallback letter (unreached today; every agent ships a sprite). In fill mode
// there is no px box to derive from; 40px reads correctly at hero scale.
const letterSize = fill ? 40 : Math.round(size * 0.4);
```

3. Update the root span (add `hero` class, fill class, data attributes; keep px style only in number mode):

```tsx
    <span
      className={`${styles.portrait} ${AGENT_CLASS[agentKey]}${fill ? ` ${styles.fill}` : ""}${
        hero ? ` ${styles.hero}` : ""
      }${className ? ` ${className}` : ""}`}
      style={fill ? undefined : { width: size, height: size }}
      data-agent={agentKey}
      data-sprite-state={visual.spriteState}
      data-pip={visual.pip}
      data-playing={playing ? "true" : "false"}
      {...(fill ? { "data-size": "fill" } : {})}
      {...(hero ? { "data-hero": "true" } : {})}
      aria-hidden="true"
    >
```

(`hero` comes from the destructured props with default `false`: add `hero = false,` to the destructuring.)

4. Update the sprite branch inside `.plate` so fill mode wraps the sprite in a fluid 82% box (number mode unchanged):

```tsx
{
  sprite ? (
    fill ? (
      <span className={styles.fillInner}>
        <AnimatedSprite
          frames={sprite.frames}
          palette={sprite.palette}
          size="fill"
          playing={playing}
        />
      </span>
    ) : (
      <AnimatedSprite
        frames={sprite.frames}
        palette={sprite.palette}
        size={inner}
        playing={playing}
      />
    )
  ) : (
    <span className={styles.letter} style={{ fontSize: letterSize }}>
      {AGENT_LETTER[agentKey]}
    </span>
  );
}
```

- [ ] **Step 2.4: Add the CSS variant rules**

Append to `printed-portrait-avatar.module.css` (after the `.pip` block, before the keyframes):

```css
/* ---- fill mode: fluid, parent-controlled box (the hero poster) ---- */
.fill {
  width: 100%;
  aspect-ratio: 1 / 1;
}
.fillInner {
  display: block;
  width: 82%; /* same ground reveal as the number path (inner = 0.82 * size) */
  aspect-ratio: 1 / 1;
}

/* ---- hero frame: the spec's poster weights (2px halo offset, 1.5px edge) ---- */
.hero.alex {
  box-shadow:
    2px 2px 0 0 hsl(var(--agent-alex-deep)),
    inset 0 0 0 1.5px var(--hair);
}
.hero.riley {
  box-shadow:
    2px 2px 0 0 hsl(var(--agent-riley-deep)),
    inset 0 0 0 1.5px var(--hair);
}
.hero.mira {
  box-shadow:
    2px 2px 0 0 hsl(var(--agent-mira-deep)),
    inset 0 0 0 1.5px var(--hair);
}
/* The 28% pip is tuned for 22-44px chips; at 80-112px it would dominate.
   17% reads as the same calm dot at hero scale (13-19px across the fluid range). */
.hero .pip {
  width: 17%;
  height: 17%;
}
```

- [ ] **Step 2.5: Run avatar tests, confirm green**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/agent-avatar/__tests__/`
Expected: PASS (new and pre-existing assertions, including the number-mode `44px` test).

- [ ] **Step 2.6: Commit**

```bash
git add apps/dashboard/src/components/agent-avatar/
git commit -m "feat(dashboard): printed-portrait fill mode + hero frame variant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The team-band poster

**Files:**

- Modify: `apps/dashboard/src/components/home/team-band.tsx`
- Create: `apps/dashboard/src/components/home/team-band.module.css`
- Modify: `apps/dashboard/src/components/home/home.module.css` (delete the `.teamBand*` block)
- Test: `apps/dashboard/src/components/home/__tests__/team-band.test.tsx`

- [ ] **Step 3.1: Add the failing tests**

Append inside `describe("<TeamBand>")` in `team-band.test.tsx`:

```tsx
it("renders the poster surface with one cell per agent", () => {
  render(<TeamBand agents={AGENTS} />);
  expect(screen.getByTestId("team-poster")).toBeInTheDocument();
});

it("celebrates each agent with an honest role line", () => {
  render(<TeamBand agents={AGENTS} />);
  expect(screen.getByText("Front desk")).toBeInTheDocument();
  expect(screen.getByText("Ad analyst")).toBeInTheDocument();
  expect(screen.getByText("The maker")).toBeInTheDocument();
});

it("features exactly the focal working agent (the same one that breathes)", () => {
  const two: TeamBandAgent[] = [
    { key: "alex", name: "Alex", setUp: true, status: "working", halted: false },
    { key: "riley", name: "Riley", setUp: true, status: "working", halted: false },
    { key: "mira", name: "Mira", setUp: true, status: "idle", halted: false },
  ];
  render(<TeamBand agents={two} />);
  expect(screen.getByTestId("team-mate-alex").dataset.featured).toBe("true");
  expect(screen.getByTestId("team-mate-riley").dataset.featured).toBe("false");
  expect(screen.getByTestId("team-mate-mira").dataset.featured).toBe("false");
});

it("features nobody when nobody is genuinely working (positive evidence only)", () => {
  render(<TeamBand agents={AGENTS.map((a) => ({ ...a, status: "idle" as const }))} />);
  expect(document.querySelectorAll('[data-featured="true"]')).toHaveLength(0);
});

it("renders the portraits in fluid hero mode", () => {
  const { container } = render(<TeamBand agents={AGENTS} />);
  const heroAvatars = container.querySelectorAll('[data-hero="true"][data-size="fill"]');
  expect(heroAvatars).toHaveLength(3);
});
```

- [ ] **Step 3.2: Run, confirm the new assertions fail**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/home/__tests__/team-band.test.tsx`
Expected: FAIL on `team-poster`, role copy, `data-featured`, and hero-avatar assertions. The pre-existing assertions still pass.

- [ ] **Step 3.3: Rewrite `team-band.tsx`**

Replace the file content with:

```tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import type { TeamBandAgent } from "./types";
import styles from "./team-band.module.css";

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
    case "error":
      return "Needs you";
    default:
      return "Ready";
  }
}

/**
 * Honest role lines (job descriptions, not status claims), from the locked
 * aesthetic-direction mockup. Presentation copy: the registry's `role` field
 * is a machine slug, not display copy.
 */
const ROLE_FOR_AGENT: Record<AgentKey, string> = {
  alex: "Front desk",
  riley: "Ad analyst",
  mira: "The maker",
};

/**
 * TeamBand - the "meet your team" poster, the emotional peak of the locked
 * direction. The crew at fluid hero scale (about 81px at a 320px viewport up to
 * 112px capped) as printed portraits on one tri-radial identity-tint ground
 * under the lighter poster grain, with serif identity names, role lines, and
 * honest live status. One breathing focal avatar (the first genuinely-working
 * agent) which also steps forward (the featured lift); reduced motion strips
 * both, plus the grain. Each cell opens the agent panel. Agent hues are
 * identity-only (grounds, name and role inks, status accents), never on an
 * action surface; the focus ring stays amber.
 */
export function TeamBand({ agents, onOpenAgent }: TeamBandProps) {
  const focalKey = agents.find(
    (a) => a.setUp && !a.halted && (a.status === "working" || a.status === "analyzing"),
  )?.key;

  return (
    <section className={styles.band} aria-label="Your team">
      <h2 className={styles.heading}>Your team</h2>
      <div className={styles.poster} data-testid="team-poster">
        <div className={styles.grid} role="list">
          {agents.map((agent) => {
            const { key, name, setUp, halted } = agent;
            const statusLabel = teamStatusLabel(agent);
            const featured = key === focalKey;
            return (
              <div key={key} role="listitem">
                <button
                  type="button"
                  className={styles.mate}
                  data-agent={key}
                  data-disabled={String(!setUp)}
                  data-featured={String(featured)}
                  data-testid={`team-mate-${key}`}
                  aria-label={`Open ${name}, ${statusLabel}`}
                  onClick={() => onOpenAgent?.(key)}
                >
                  <span className={styles.portraitBox}>
                    <PrintedPortraitAvatar
                      agentKey={key}
                      size="fill"
                      hero
                      status={setUp ? agent.status : "idle"}
                      halted={halted}
                      allowMotion={featured}
                      showPip
                    />
                  </span>
                  <span className={styles.mateName}>{name}</span>
                  <span className={styles.mateRole}>{ROLE_FOR_AGENT[key]}</span>
                  <span className={styles.mateStatus}>{statusLabel}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3.4: Create `team-band.module.css`**

```css
/* apps/dashboard/src/components/home/team-band.module.css
   =========================================================
   TEAM BAND POSTER: the "meet your team" emotional peak.
   One printed poster surface (spec 2026-06-04-meet-your-team-hero-design):
   a linear surface-to-canvas wash, three radial identity tints (one per
   agent column), and the lighter poster grain blended into the poster's
   OWN background (background-blend-mode; never a stacked layer, so child
   portraits and labels are untouched and AA-safe by construction; the
   canvas grain on body:has(.app-header) is a separate, untouched rule).
   Identity hues live on the ground, the portrait frame, and the name and
   role inks only: the cell chrome (focus ring) stays amber, never an
   agent color. Heading is NOT italic, and the names are explicitly
   upright (no italics, locked direction).
   ========================================================= */
.band {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.heading {
  font-style: normal; /* never italic */
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin: 0;
}

.poster {
  /* The grain layer rides in a file-local property so the dark and
     reduced-motion off rules can drop it without restating the gradient
     stack. Intensity is the baked feColorMatrix alpha (0.19): the spec's
     poster .34 vs canvas .42 ratio applied to the shipped canvas 0.24,
     locked from live screenshots. No raw hex (ink lives in decimal
     channels; the #filter ref is encoded %23). */
  --_grain: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22200%22%20height%3D%22200%22%3E%3Cfilter%20id%3D%22g%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.88%22%20numOctaves%3D%222%22%20stitchTiles%3D%22stitch%22%20seed%3D%227%22%2F%3E%3CfeColorMatrix%20type%3D%22matrix%22%20values%3D%220%200%200%200%200.16%200%200%200%200%200.13%200%200%200%200%200.09%200%200%200%200.19%200%22%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20filter%3D%22url(%23g)%22%2F%3E%3C%2Fsvg%3E");
  background-color: hsl(var(--canvas));
  background-image:
    var(--_grain),
    radial-gradient(120% 70% at 16% -6%, hsl(var(--agent-alex-tint)) 0%, transparent 45%),
    radial-gradient(120% 70% at 50% -6%, hsl(var(--agent-riley-tint)) 0%, transparent 45%),
    radial-gradient(120% 70% at 84% -6%, hsl(var(--agent-mira-tint)) 0%, transparent 45%),
    linear-gradient(180deg, hsl(var(--surface)), hsl(var(--canvas)));
  background-repeat: repeat, no-repeat, no-repeat, no-repeat, no-repeat;
  background-size:
    200px 200px,
    auto,
    auto,
    auto,
    auto;
  background-blend-mode: multiply, normal, normal, normal, normal;
  border: 1px solid var(--hair-soft);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  /* Top padding reserves the featured lift (6px) so it never clips. */
  padding: 24px 14px 16px;
}
/* Dark and reduced motion strip the grain; the ground stays. Mirrors the
   canvas rule (.dark body / reduced-motion -> background-image: none). */
:global(.dark) .poster {
  --_grain: none;
}
@media (prefers-reduced-motion: reduce) {
  .poster {
    --_grain: none;
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 116px));
  justify-content: center;
  gap: clamp(8px, 3vw, 22px);
}

.mate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-height: 168px; /* reserve geometry so status-text wrap never shifts the row */
  padding: 6px 2px 8px;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: center;
}
.mate:focus-visible {
  outline: 2px solid hsl(var(--action));
  outline-offset: 2px;
  border-radius: 12px;
}
.mate[data-disabled="true"] {
  opacity: 0.72;
}

.portraitBox {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  transition: transform 250ms var(--ease-home);
}
.mate:hover .portraitBox {
  transform: translateY(-3px);
}
.mate[data-featured="true"] .portraitBox {
  /* The working agent steps forward (transform only: no reflow). */
  transform: translateY(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .portraitBox {
    transition: none;
  }
}

.mateName {
  font-family: var(--font-home-serif);
  font-style: normal; /* never italic */
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.012em;
  line-height: 1.2;
  color: var(--ink);
}
.mateRole {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-top: 1px;
  color: var(--ink-2);
}
/* Identity inks on name and role (full opacity: faded identity ink would
   dip below AA). The deeps are AA on both the surface wash and the tints
   (gate-asserted in token-governance). */
.mate[data-agent="alex"] .mateName,
.mate[data-agent="alex"] .mateRole {
  color: hsl(var(--agent-alex-deep));
}
.mate[data-agent="riley"] .mateName,
.mate[data-agent="riley"] .mateRole {
  color: hsl(var(--agent-riley-deep));
}
.mate[data-agent="mira"] .mateName,
.mate[data-agent="mira"] .mateRole {
  color: hsl(var(--agent-mira-deep));
}
.mateStatus {
  font-size: 12px;
  margin-top: 3px;
  color: var(--ink-2); /* AA on the poster wash (ink-3 is below AA) */
}

@media (max-width: 360px) {
  .poster {
    padding-left: 8px;
    padding-right: 8px;
  }
  .grid {
    gap: 6px;
  }
}
```

- [ ] **Step 3.5: Delete the old block from `home.module.css`**

Remove the entire `TEAM BAND` section (the comment banner starting `/* =========================================================
   TEAM BAND: the crew onstage at hero scale (replaces the ribbon)` through the closing brace of the `@media (max-width: 360px)` block that tightens `.teamBandGrid` / `.teamMate`, currently lines 406-477). Nothing else in `home.module.css` references `.teamBand*` or `.teamMate*` (verify with `grep -n "teamBand\|teamMate" apps/dashboard/src/components/home/home.module.css`: zero matches after the deletion).

- [ ] **Step 3.6: Run the home component tests and the full home suite**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/home/`
Expected: PASS (team-band tests incl. the five new ones; `home-page.test.tsx` untouched and green because the `team-mate-{key}` ids, names, and panel-open contract are preserved).

- [ ] **Step 3.7: Commit**

```bash
git add apps/dashboard/src/components/home/
git commit -m "feat(dashboard): team band becomes the meet-your-team poster

One printed poster ground (identity-tint radials + lighter grain via
own-background blend), fluid hero portraits, serif identity names,
role lines, featured lift on the focal working agent. Data flow and
the tap-to-panel contract unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Governance gates (poster grain + contrast)

**Files:**

- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts`

- [ ] **Step 4.1: Append the poster-grain governance block (GR2)**

Add after the existing `describe("token governance — paper grain (GR1)")` block:

```ts
describe("token governance — team poster grain (GR2)", () => {
  const bandCss = readFileSync(
    path.resolve(process.cwd(), "src/components/home/team-band.module.css"),
    "utf8",
  );
  /** The .poster rule body (first match; the off rules come later in source). */
  const posterRule = (): string => {
    const m = bandCss.match(/\.poster\s*\{([^}]*)\}/);
    expect(m, ".poster rule must exist in team-band.module.css").not.toBeNull();
    return m![1];
  };

  it("carries the grain as a layer of the poster's own background, blended multiply", () => {
    const decl = posterRule();
    expect(decl).toMatch(/--_grain:\s*url\("data:image\/svg\+xml,/);
    expect(decl).toMatch(/background-image:\s*var\(--_grain\),/);
    expect(decl).toMatch(/background-blend-mode:\s*multiply,/);
    expect(decl).toContain("feTurbulence");
    expect(decl).toContain("baseFrequency%3D%220.88%22");
  });

  it("bakes the poster grain LIGHTER than the canvas grain (spec .34 vs .42)", () => {
    const alphaOf = (decl: string): number => {
      const m = decl.match(/feColorMatrix[^>]*?values%3D%22(.+?)%22%2F%3E/);
      expect(m, "feColorMatrix values must be present").not.toBeNull();
      const nums = decodeURIComponent(m![1]).trim().split(/\s+/).map(Number);
      expect(nums).toHaveLength(20);
      return nums[18];
    };
    const canvasRule = css.match(/body:has\(\.app-header\)\s*\{([^}]*)\}/);
    expect(canvasRule).not.toBeNull();
    const posterAlpha = alphaOf(posterRule());
    const canvasAlpha = alphaOf(canvasRule![1]);
    expect(posterAlpha).toBeLessThan(canvasAlpha);
    expect(posterAlpha).toBeGreaterThanOrEqual(0.12);
  });

  it("strips the poster grain in dark and under reduced motion (ground stays)", () => {
    expect(bandCss).toMatch(/:global\(\.dark\)\s+\.poster\s*\{\s*--_grain:\s*none/);
    expect(bandCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.poster\s*\{\s*--_grain:\s*none/,
    );
  });

  it("the poster ground is built only from tokens (no raw color literals)", () => {
    // The data URI carries decimal channels only; outside it, every color is
    // hsl(var(--token)) / var(--token). The generalized hex sweep also covers
    // this file; this is the targeted assertion.
    const outsideUri = posterRule().replace(/url\("data:image\/svg\+xml,[^"]*"\)/g, "");
    expect(outsideUri).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(outsideUri).not.toMatch(/rgb\(/);
  });
});

describe("token governance — hero poster label contrast (AA)", () => {
  // Names and roles render in the agent deep inks on the poster ground, whose
  // text zone ranges from --surface (white wash) to the agent tints (worst
  // case: a label directly over its column's tint). The grain multiplies
  // (darkens) the ground, which only raises dark-text contrast, so the
  // ungrained ground is the conservative bound. Status renders in the ink-2
  // ramp value on the same ground.
  const SURFACE = tokenValue("surface");
  const cases: Array<[string, string]> = [
    ["palette-coral-deep", "palette-coral-tint"],
    ["palette-teal-deep", "palette-teal-tint"],
    ["palette-violet-deep", "palette-violet-tint"],
  ];

  it("every agent deep ink is AA on the surface wash and on its own tint", () => {
    for (const [deep, tint] of cases) {
      expect(contrastRatio(tokenValue(deep), SURFACE), `${deep} on surface`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrastRatio(tokenValue(deep), tokenValue(tint)),
        `${deep} on ${tint}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the status ink (ink-2 ramp) is AA on the surface wash", () => {
    expect(contrastRatio(tokenValue("palette-ink-700"), SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
});
```

Note: `tokenValue("palette-ink-700")` is the primitive behind `--ink-2`. Before running, confirm the name with `grep -n "palette-ink" apps/dashboard/src/app/globals.css`; if the ramp tier behind `--ink-2` differs (e.g. `--palette-ink-600`), use the tier that `--ink-2` references.

- [ ] **Step 4.2: Run the governance suite, confirm green**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/app/__tests__/token-governance.test.ts`
Expected: PASS.

- [ ] **Step 4.3: Prove the gates bite (mutation check, no commit)**

Temporarily change the poster data URI alpha `0.19` to `0.30` in `team-band.module.css`, re-run the governance file, expect the LIGHTER-than-canvas assertion to FAIL; revert. Temporarily delete the `:global(.dark) .poster` rule, re-run, expect FAIL; revert. Confirm file is back to green and `git diff` shows only the intended state.

- [ ] **Step 4.4: Commit**

```bash
git add apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "test(dashboard): governance gates for poster grain + hero label contrast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Voice corpus

**Files:**

- Modify: `apps/dashboard/src/__tests__/in-app-voice.test.ts`

- [ ] **Step 5.1: Add the band to the corpus**

In the `CORPUS` array, after `"components/home/this-week.tsx",` add:

```ts
  "components/home/team-band.tsx",
```

- [ ] **Step 5.2: Run the voice guard, confirm green**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/__tests__/in-app-voice.test.ts`
Expected: PASS (the band's copy carries no em-dash and no "generated").

- [ ] **Step 5.3: Commit**

```bash
git add apps/dashboard/src/__tests__/in-app-voice.test.ts
git commit -m "test(dashboard): team band copy joins the in-app voice corpus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full gates

- [ ] **Step 6.1: Full dashboard test suite**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS, coverage thresholds (40/35/40/40) hold.

- [ ] **Step 6.2: Clean typecheck**

Run: `rm -rf apps/dashboard/.next && pnpm typecheck`
Expected: PASS (the `rm` clears the stale dev-types false-failure).

- [ ] **Step 6.3: Production build (catches missing `.js`/@ imports and dead files)**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: build succeeds.

- [ ] **Step 6.4: Formatting and architecture**

Run: `pnpm format:check && pnpm arch:check`
Expected: both PASS (`format:check` is `*.ts` only; do NOT prettier-format the CSS module by hand. `arch:check` counts raw `.ts` lines; `team-band.tsx` stays far under 600).

- [ ] **Step 6.5: Fix anything found, then commit any fixes**

If all green and no changes, skip the commit.

---

### Task 7: Live visual pass (the slice lives or dies here)

**Setup** (the worktree env is already fixed: single `DATABASE_URL`, `DEV_BYPASS_AUTH=true`):

- [ ] **Step 7.1: Launch the stack detached**

Create `/tmp/sbshot/launch.mjs` (recipe from memory: detached spawn survives task reaping):

```js
import { spawn } from "node:child_process";
const ROOT = "/Users/jasonli/switchboard/.claude/worktrees/team-hero";
function det(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: "ignore", ...opts });
  p.unref();
  return p.pid;
}
// API on :3000 (root .env loaded via --env-file; api has no dotenv)
det("node", ["--env-file=.env", "--import", "tsx", "apps/api/src/server.ts"]);
// Dashboard on :3002
det("pnpm", ["--filter", "@switchboard/dashboard", "dev"]);
console.log("launched");
```

Run: `mkdir -p /tmp/sbshot && cd /tmp/sbshot && npm init -y >/dev/null 2>&1 && npm i playwright-core >/dev/null 2>&1 && node launch.mjs`, then poll `curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/` until 200/307 (Bash `until` loop, background).

- [ ] **Step 7.2: Screenshot matrix**

Driver script (`/tmp/sbshot/shots.mjs`) using playwright-core + system Chrome (`executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`, `--no-sandbox`, `waitUntil: "domcontentloaded"` then `waitForSelector('[data-testid="team-poster"]')`, never `networkidle`):

- Home at widths 320, 360, 375, 390, 430 (mobile) and 1024, 1280 (desktop bento).
- Dark: add init script `document.documentElement.classList.add("dark")` for one 390 shot (toggle is hidden; class-based).
- Reduced motion: context option `reducedMotion: "reduce"` for one 390 shot (expect: no grain on poster or canvas, no breathing).
- A canvas-grain regression shot: `/inbox` with the detail sheet open if reachable, else `/inbox` plus Home, confirming the body grain is unchanged and content stacking is intact.

For each Home shot also `page.evaluate`:

```js
const poster = document.querySelector('[data-testid="team-poster"]');
const grid = poster.querySelector('[role="list"]');
const avatar = poster.querySelector('[data-size="fill"]');
return {
  posterW: poster.clientWidth,
  overflow: grid.scrollWidth > grid.clientWidth + 1,
  avatarW: Math.round(avatar.getBoundingClientRect().width),
  docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
};
```

Expected: `overflow: false` and `docOverflow: false` at every width; `avatarW` roughly 81 at 320 rising to 112 capped at desktop.

- [ ] **Step 7.3: Read every PNG and judge like a designer**

Read each screenshot. Specifically judge: the poster reads as one printed surface (not three tiles); the tints are felt, not loud; the grain is visible at 2x zoom but the surface still reads cream; names read instantly; the featured working agent (seed data usually has one working) steps forward; the pip is a calm dot, not a balloon. Iterate the CSS calibration values (grain alpha within 0.14 to 0.22, tint stop 40 to 50 percent, pip 15 to 19 percent, lift 4 to 8px) until it looks loved. Re-run the governance test after any alpha change.

- [ ] **Step 7.4: Pixel-sampled contrast on the real ground**

Extend the driver: for each label (3 names, 3 roles, 3 statuses) compute the real contrast: text color from `getComputedStyle(el).color`; ground from a clipped screenshot of the label's bounding box area with the text hidden (`el.style.visibility="hidden"` momentarily), decoded with pngjs and averaged. Compute WCAG contrast (same formula as `src/lib/tokens/contrast.ts`). Expected: every label at or above 4.5. If any fails, darken that ink usage (e.g. role moves from deep to `--ink-2`) and re-shoot.

- [ ] **Step 7.5: Commit calibration deltas**

```bash
git add apps/dashboard/src/components/home/team-band.module.css apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.module.css
git commit -m "style(dashboard): calibrate poster grain, tints, pip and lift from live shots

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Skip if zero deltas. Save the final keeper screenshots to `/tmp/sbshot/keep/` for the PR body.)

---

### Task 8: Reviews, PRs, merge, hygiene

- [ ] **Step 8.1:** Re-run the full gate set (Task 6 commands) one final time.
- [ ] **Step 8.2:** `/code-review` at high effort on the branch diff; address findings (superpowers:receiving-code-review: verify before implementing).
- [ ] **Step 8.3:** `/codex:adversarial-review` on the diff; address findings.
- [ ] **Step 8.4:** Docs PR: branch `docs/meet-your-team-hero` off origin/main carrying ONLY the spec and this plan; push; `gh pr create` to main; merge when CI is green.
- [ ] **Step 8.5:** Impl PR: after the docs PR merges, `git fetch origin && git rebase origin/main` (the doc commits dedupe away), push the implementation branch as `feat/meet-your-team-hero`, `gh pr create` with before/after screenshots, merge when CI is green.
- [ ] **Step 8.6:** Hygiene: delete merged branches local and remote (mine only), `git worktree` cleanup per doctrine, fast-forward local main in the primary checkout.
