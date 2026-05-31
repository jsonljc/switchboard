# Desktop Layout Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/dashboard` a first-class desktop layout at ≥1024px (persistent sidebar nav, bento Home, master-detail Inbox, widened Results) without changing anything below 1024px.

**Architecture:** Every change is **additive at `@media (min-width: 1024px)`** (or `lg:`/`xl:` Tailwind prefixes). The existing 768px CSS-module rules are never edited — they govern mobile→tablet, which we are not touching. A single shell-owned content frame on the bare `<main>` (`editorial-auth-shell.tsx:46`) establishes desktop width once; each screen then reflows its interior. Proven in-house patterns are reused: the Settings sidebar (`settings-layout.tsx`), the Reports grid, and the dead `.dashboard-*` grid in `globals.css`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript (ESM, no `.js` on dashboard imports), Tailwind + CSS Modules + a global `globals.css`, design tokens as raw HSL triplets (`hsl(var(--token))`), Vitest + Testing Library, lucide-react icons.

---

## Conventions (read once, apply to every task)

- **The additive rule:** new desktop CSS lives in `@media (min-width: 1024px)` blocks (CSS modules / globals.css) or `lg:`/`xl:` prefixes (Tailwind/JSX). Do **not** modify existing `@media (min-width: 768px)` or base rules. This is the no-mobile-regression guarantee.
- **Dashboard import gotcha:** relative AND `@/` imports omit `.js` extensions in this app. Only `next build` catches a wrong import — run it.
- **Verification commands** (run from worktree root `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul`):
  - Typecheck: `pnpm --filter @switchboard/dashboard typecheck`
  - Tests: `pnpm --filter @switchboard/dashboard test`
  - Lint: `pnpm --filter @switchboard/dashboard lint`
  - Format (CI runs prettier; local lint does not): `pnpm format:check` (fix with `pnpm format`)
  - Next build (NOT in CI — must run locally): `pnpm --filter @switchboard/dashboard build`
- **Dashboard coverage thresholds are 40/35/40/40** (not CLAUDE.md's global 55/50/52/55).
- **Visual verification:** see the live app headlessly via playwright-core + system Chrome (per `docs/.../reference_dashboard_visual_verification`), capturing each touched screen at **390 / 768 / 1024 / 1440 / 1920**. The 390/768 shots must match `main` (no mobile/tablet regression); 1024/1440/1920 show the new desktop layout. If the live app cannot be brought up locally, fall back to: `next build` clean + all tests green + a careful diff confirming every new rule is `lg`-gated.
- **Commit subjects are lowercase** (commitlint `subject-case`). Conventional Commits enforced. lint-staged reformats staged files — re-`git add` if it does.
- **Branch:** all work on `worktree-desktop-layout-overhaul` in this worktree. Verify with `git branch --show-current` before each commit.

## File Structure

**New files**

- `apps/dashboard/src/components/layout/app-sidebar.tsx` — desktop left-rail nav (client component).
- `apps/dashboard/src/components/layout/app-sidebar.ts` — pure `buildSidebarSections()` helper (no JSX, unit-tested).
- `apps/dashboard/src/components/layout/__tests__/app-sidebar.test.tsx` — sidebar assembly + render tests.

**Modified files**

- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — content frame (PR1), sidebar + body grid + utility-strip (PR2).
- `apps/dashboard/src/app/globals.css` — frame/body/sidebar/header desktop rules; retune the dead `.dashboard-*` grid to `lg`.
- `apps/dashboard/tailwind.config.ts` — pin `screens` (PR1).
- `apps/dashboard/src/components/home/home-page.tsx` + `home.module.css` — bento (PR3).
- `apps/dashboard/src/components/inbox/inbox-screen.tsx` + `inbox-design-base.css` — two-pane (PR4).
- `apps/dashboard/src/components/results/results-page.tsx` + `results.module.css` — widen + grid (PR5).
- `apps/dashboard/src/components/ui/sheet.tsx` + `components/agent-panel/agent-panel.*` — desktop sheet widths / side-panel (PR5).

---

# PR1 — Foundation (breakpoint, content frame, width tokens, revived grid primitive)

Ships mostly-invisible primitives. After PR1, screens still self-cap (so they look unchanged) except Settings, which gains a sane max-width.

### Task 1.1: Pin the canonical breakpoint

**Files:** Modify `apps/dashboard/tailwind.config.ts`

- [ ] **Step 1: Read the current config** to find `theme` / `theme.extend`.

Run: `sed -n '1,40p' apps/dashboard/tailwind.config.ts`

- [ ] **Step 2: Add an explicit `screens` key** documenting `lg=1024` as the desktop switch. Inside `theme` (NOT `theme.extend`, so it pins the full set), add:

```ts
screens: {
  sm: "640px",
  md: "768px",
  lg: "1024px", // canonical desktop switch — matches the @media(min-width:1024px) CSS-module rules
  xl: "1280px",
  "2xl": "1536px",
},
```

These are Tailwind's defaults, so existing `sm:`/`md:`/`lg:` classes are unaffected; this only documents and locks the convention so future drift is visible in one place.

- [ ] **Step 3: Verify build + typecheck.**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: PASS (no class output changes).

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/tailwind.config.ts
git commit -m "feat(dashboard): pin lg=1024 as canonical desktop breakpoint"
```

### Task 1.2: Add the shell content frame

**Files:** Modify `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:46`; Modify `apps/dashboard/src/app/globals.css`

- [ ] **Step 1: Wrap `<main>`'s children in a content frame.** Change line 46 from:

```tsx
<main>{children}</main>
```

to:

```tsx
<main className="app-main">
  <div className="app-content">{children}</div>
</main>
```

- [ ] **Step 2: Add the frame CSS.** In `globals.css`, near the existing `.app-header` block (search `===== Editorial auth shell header =====`), add a sibling block. First define the width tokens in the existing `:root`/`@layer base` token area (search for an existing `:root {` with `--hair`), adding:

```css
--app-frame: 1280px; /* desktop content frame — aligns with .app-header-row */
--app-sidebar-w: 216px; /* desktop nav rail (consumed in PR2) */
--header-h: 68px; /* approx sticky-header height at lg (tune in visual pass) */
```

Then add the frame rule (inside the same `@layer`/scope as `.app-header`, so it shares the cascade):

```css
/* ===== Desktop content frame (additive at lg; below lg it is a passthrough) ===== */
@media (min-width: 1024px) {
  .app-content {
    max-width: var(--app-frame, 1280px);
    margin-inline: auto;
  }
}
```

No padding here — screens keep their own horizontal padding, so this only centers + caps width.

- [ ] **Step 3: Verify no regression + build.** Below 1024px `.app-content` has no rules, so it is a transparent wrapper.

Run: `pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

- [ ] **Step 4: Visual check.** Bring up the app (see Conventions). At 1440/1920 confirm the previously-uncapped **Settings** page is now centered at ≤1280 (the intended fix); Home/Inbox/Results still show their own narrow column (unchanged — they self-cap narrower). At 390/768 confirm pixel-identical to `main`.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx apps/dashboard/src/app/globals.css
git commit -m "feat(dashboard): add desktop content frame on the app shell"
```

### Task 1.3: Retune the dead `.dashboard-*` grid primitive to `lg`

**Files:** Modify `apps/dashboard/src/app/globals.css:332-393`

The orphaned `.dashboard-frame` / `.dashboard-content-grid` / `.dashboard-rail` grid currently engages at `1440px`. Retune it to `1024px` so Home (PR3) and Results (PR5) can consume it as the canonical main+rail primitive. It has **zero current consumers**, so this is safe.

- [ ] **Step 1: Re-read the block** to confirm it is still unused.

Run: `grep -rn "dashboard-content-grid\|dashboard-rail\|dashboard-frame" apps/dashboard/src`
Expected: matches ONLY in `globals.css` (no `.tsx` consumers).

- [ ] **Step 2: Change the three `@media (min-width: 1440px)` guards in that block to `@media (min-width: 1024px)`** (lines ~360, ~377, ~389). Leave `.dashboard-frame`'s `max-width` step at 1440 (that is a width refinement, fine to keep) but switch the grid/rail _engagement_ to 1024:

```css
@media (min-width: 1024px) {
  .dashboard-content-grid {
    display: grid;
    grid-template-columns: 1fr var(--app-rail, 320px);
    gap: 32px;
    align-items: start;
  }
}
/* ... */
@media (min-width: 1024px) {
  .dashboard-rail {
    display: block;
    position: sticky;
    top: calc(var(--header-h, 68px) + 16px);
  }
}
/* ... */
@media (min-width: 1024px) {
  .dashboard-activity-inline {
    display: none;
  }
}
```

- [ ] **Step 3: Verify.** Still no consumers, so output is unchanged.

Run: `pnpm --filter @switchboard/dashboard build`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/app/globals.css
git commit -m "refactor(dashboard): retune dormant dashboard grid primitive to lg=1024"
```

---

# PR2 — Desktop navigation (persistent left sidebar)

Depends on PR1. Introduces the sidebar, the body grid, and demotes the header to a utility strip — all at ≥1024px.

### Task 2.1: Build and test the sidebar section assembly (pure logic, TDD)

**Files:** Create `apps/dashboard/src/components/layout/app-sidebar.ts`; Create `apps/dashboard/src/components/layout/__tests__/app-sidebar.test.tsx`

The sidebar shows: **Primary** (Home, Inbox, Results from `PrimaryNav` ITEMS) + **Tools** (live `TOOLS_NAV_ITEMS`, deduped against primary hrefs, + Mira when enabled + Full reports when advanced) + **Settings**. It must honor the same gates ToolsOverflow uses (`isMercuryToolLive`, `miraEnabled`) and dedupe `Reports`→`/results` against primary `Results`→`/results`.

- [ ] **Step 1: Write the failing test.**

```tsx
// app-sidebar.test.tsx
import { describe, it, expect } from "vitest";
import { buildSidebarSections } from "../app-sidebar";

describe("buildSidebarSections", () => {
  it("always shows the three primary destinations + Settings", () => {
    const s = buildSidebarSections({ miraEnabled: false, liveToolIds: [] });
    expect(s.primary.map((i) => i.href)).toEqual(["/", "/inbox", "/results"]);
    expect(s.settings.href).toBe("/settings");
  });

  it("dedupes a tools item whose href duplicates a primary destination", () => {
    // 'reports' tools item points at /results (same as primary Results) → must not appear in tools
    const s = buildSidebarSections({
      miraEnabled: false,
      liveToolIds: ["contacts", "automations", "reports"],
    });
    expect(s.tools.map((i) => i.href)).toEqual(["/contacts", "/automations"]);
  });

  it("includes Mira only when enabled", () => {
    expect(
      buildSidebarSections({ miraEnabled: false, liveToolIds: [] }).tools.find(
        (i) => i.href === "/mira",
      ),
    ).toBeUndefined();
    expect(
      buildSidebarSections({ miraEnabled: true, liveToolIds: [] }).tools.find(
        (i) => i.href === "/mira",
      ),
    ).toBeDefined();
  });

  it("includes Full reports (/reports) only when the reports tool is live", () => {
    expect(
      buildSidebarSections({ miraEnabled: false, liveToolIds: [] }).tools.find(
        (i) => i.href === "/reports",
      ),
    ).toBeUndefined();
    expect(
      buildSidebarSections({ miraEnabled: false, liveToolIds: ["reports"] }).tools.find(
        (i) => i.href === "/reports",
      ),
    ).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it; verify it fails.**

Run: `pnpm --filter @switchboard/dashboard test app-sidebar`
Expected: FAIL ("buildSidebarSections is not a function").

- [ ] **Step 3: Implement the helper.** Create `app-sidebar.ts`. It reuses the canonical item arrays/labels but takes resolved gate booleans as input (so it stays pure + testable; the component resolves `miraEnabled`/live-ids from hooks).

```ts
import {
  Home,
  Inbox,
  BarChart3,
  Users,
  Workflow,
  FileText,
  Sparkles,
  Settings,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ToolsNavId } from "@/lib/route-availability";

export interface SidebarItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}
export interface SidebarSections {
  primary: SidebarItem[];
  tools: SidebarItem[];
  settings: SidebarItem;
}

const PRIMARY: SidebarItem[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Results", href: "/results", icon: BarChart3 },
];

// Mirrors TOOLS_NAV_ITEMS + its icon assignment. id drives the live gate.
const TOOLS: Array<SidebarItem & { id: ToolsNavId }> = [
  { id: "contacts", label: "Pipeline", href: "/contacts", icon: Users },
  { id: "automations", label: "Automations", href: "/automations", icon: Workflow },
  { id: "reports", label: "Reports", href: "/results", icon: BarChart3 },
];

export function buildSidebarSections(opts: {
  miraEnabled: boolean;
  liveToolIds: ReadonlyArray<ToolsNavId>;
}): SidebarSections {
  const primaryHrefs = new Set(PRIMARY.map((i) => i.href));
  const tools: SidebarItem[] = TOOLS.filter((t) => opts.liveToolIds.includes(t.id))
    .filter((t) => !primaryHrefs.has(t.href)) // dedupe Reports→/results vs primary Results
    .map(({ id: _id, ...item }) => item);
  if (opts.miraEnabled) tools.push({ label: "Mira", href: "/mira", icon: Sparkles });
  if (opts.liveToolIds.includes("reports"))
    tools.push({ label: "Full reports", href: "/reports", icon: FileText });
  return {
    primary: PRIMARY,
    tools,
    settings: { label: "Settings", href: "/settings", icon: Settings },
  };
}
```

- [ ] **Step 4: Run tests; verify pass.**

Run: `pnpm --filter @switchboard/dashboard test app-sidebar`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/layout/app-sidebar.ts apps/dashboard/src/components/layout/__tests__/app-sidebar.test.tsx
git commit -m "feat(dashboard): sidebar section assembly with gate + dedupe logic"
```

### Task 2.2: Build the AppSidebar component

**Files:** Create `apps/dashboard/src/components/layout/app-sidebar.tsx`; append a render test to `__tests__/app-sidebar.test.tsx`

- [ ] **Step 1: Write the failing render test** (append to the test file):

```tsx
import { render, screen } from "@testing-library/react";
import { AppSidebar } from "../app-sidebar";

// usePathname + useMiraEnabled are module deps — mock them
vi.mock("next/navigation", () => ({ usePathname: () => "/inbox" }));
vi.mock("@/hooks/use-mira-enabled", () => ({ useMiraEnabled: () => ({ enabled: false }) }));
vi.mock("@/lib/route-availability", async (orig) => ({
  ...(await orig<typeof import("@/lib/route-availability")>()),
  isMercuryToolLive: () => true,
}));

describe("AppSidebar", () => {
  it("renders primary destinations and marks the active route", () => {
    render(<AppSidebar />);
    const inbox = screen.getByRole("link", { name: /inbox/i });
    expect(inbox).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /results/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; verify it fails** (no `AppSidebar` export). Run: `pnpm --filter @switchboard/dashboard test app-sidebar` → FAIL.

- [ ] **Step 3: Implement `app-sidebar.tsx`.** Reuse the `settings-layout` active-link idiom (`cn()`), lucide icons, `aria-current`.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import { isMercuryToolLive, type ToolsNavId } from "@/lib/route-availability";
import { buildSidebarSections, type SidebarItem } from "./app-sidebar";

const ALL_TOOL_IDS: ToolsNavId[] = ["contacts", "automations", "reports"];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, pathname }: { item: SidebarItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors duration-fast",
        active
          ? "text-foreground font-medium bg-surface"
          : "text-muted-foreground hover:text-foreground hover:bg-surface/50",
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname() ?? "/";
  const { enabled: miraEnabled } = useMiraEnabled({ poll: false });
  const liveToolIds = ALL_TOOL_IDS.filter((id) => isMercuryToolLive(id));
  const { primary, tools, settings } = buildSidebarSections({ miraEnabled, liveToolIds });

  return (
    <aside className="app-sidebar" aria-label="Primary">
      <nav className="space-y-0.5">
        {primary.map((i) => (
          <NavLink key={i.href} item={i} pathname={pathname} />
        ))}
      </nav>
      {tools.length > 0 && (
        <nav className="space-y-0.5 mt-4 pt-4 border-t border-hair-soft">
          {tools.map((i) => (
            <NavLink key={i.href} item={i} pathname={pathname} />
          ))}
        </nav>
      )}
      <nav className="space-y-0.5 mt-4 pt-4 border-t border-hair-soft">
        <NavLink item={settings} pathname={pathname} />
      </nav>
    </aside>
  );
}
```

If `border-hair-soft` is not a Tailwind color, use an inline style or an existing hairline class — confirm against `tailwind.config.ts` colors; fall back to `style={{ borderColor: "var(--hair-soft)" }}`.

- [ ] **Step 4: Run tests; verify pass.** Run: `pnpm --filter @switchboard/dashboard test app-sidebar` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/layout/app-sidebar.tsx apps/dashboard/src/components/layout/__tests__/app-sidebar.test.tsx
git commit -m "feat(dashboard): add desktop AppSidebar nav component"
```

### Task 2.3: Wire the sidebar into the shell + body grid + utility strip

**Files:** Modify `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`; Modify `apps/dashboard/src/app/globals.css`

- [ ] **Step 1: Restructure the shell.** Import `AppSidebar` and wrap the body. Replace the `<main className="app-main">…</main>` (from Task 1.2) and its surroundings so the structure becomes:

```tsx
import { AppSidebar } from "./app-sidebar";
// ...
<div className="app-body">
  <AppSidebar />
  <main className="app-main">
    <div className="app-content">{children}</div>
  </main>
</div>;
```

Also wrap the header's nav bits so they hide at `lg` (their destinations now live in the sidebar). In the header `.brand-cluster`, wrap `<PrimaryNav />` as `<span className="hide-at-lg"><PrimaryNav /></span>`; in `.header-actions`, wrap `<ToolsOverflow />` as `<span className="hide-at-lg"><ToolsOverflow /></span>`.

- [ ] **Step 2: Add the body-grid, sidebar, utility-strip CSS** to `globals.css` (additive, lg-gated):

```css
/* ===== Desktop app body: sidebar + content, centered in the frame ===== */
@media (min-width: 1024px) {
  .app-body {
    max-width: var(--app-frame, 1280px);
    margin-inline: auto;
    display: grid;
    grid-template-columns: var(--app-sidebar-w, 216px) minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  .app-content {
    max-width: none;
    margin-inline: 0;
  } /* frame now owned by .app-body */
  .app-main {
    min-width: 0;
  }
  .app-sidebar {
    position: sticky;
    top: calc(var(--header-h, 68px) + 16px);
    align-self: start;
    max-height: calc(100dvh - var(--header-h, 68px) - 32px);
    overflow-y: auto;
    padding-top: 8px;
  }
  /* nav bits that moved into the sidebar are hidden in the header */
  .hide-at-lg {
    display: none;
  }
}
/* sidebar is desktop-only */
.app-sidebar {
  display: none;
}
@media (min-width: 1024px) {
  .app-sidebar {
    display: block;
  }
}
```

(The `.app-body` block overrides Task 1.2's `.app-content` frame so the frame moves to `.app-body`.)

- [ ] **Step 3: Typecheck + build + test.**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

- [ ] **Step 4: Visual verification (critical).** Bring up the app. At **1024/1440/1920**: a left sidebar shows Home/Inbox/Results + live tools + Settings, active route highlighted; header shows only brand + live-signal + inbox-drawer + halt + account (no inline Home/Inbox/Results, no "Tools ▾"); content sits to the right of the sidebar, the whole block centered at 1280. At **390/768**: identical to `main` — bottom tab bar + "Tools ▾" present, NO sidebar. Capture all five.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx apps/dashboard/src/app/globals.css
git commit -m "feat(dashboard): persistent desktop sidebar + utility-strip header at lg"
```

---

# PR3 — Home bento grid

Depends on PR1. Turns the single 640px module stack into hero + main column + status rail at ≥1024px. Mobile stays byte-identical via `display:contents`.

### Task 3.1: Slice modules into hero / main / rail (JSX)

**Files:** Modify `apps/dashboard/src/components/home/home-page.tsx:285-303`

The `modules` array is already ordered (active vs calm). Split it into contiguous slices so that, with `display:contents` below lg, the flat mobile order is preserved exactly.

- [ ] **Step 1: Replace the render** (lines ~285-303). Keep everything above (the `modules` array build) unchanged. Replace the return body's `<div className={styles.column}>{modules}</div>` with:

```tsx
// Bento split (desktop only — display:contents below lg keeps the flat mobile order):
// hero = verdict (always modules[0]); main = next N "active" modules; rail = the quiet remainder.
const [heroNode, ...restNodes] = modules;
const mainCount = isCalm ? 2 : 3; // active: NeedsYou, TeamPulse, ThisWeek · calm: ThisWeek, TeamPulse
const mainNodes = restNodes.slice(0, mainCount);
const railNodes = restNodes.slice(mainCount);

return (
  <>
    <div className={styles.column}>
      {heroNode}
      <div className={styles.bento}>
        <div className={styles.bentoMain}>{mainNodes}</div>
        <div className={styles.bentoRail}>{railNodes}</div>
      </div>
    </div>
    {panelAgent && (
      <AgentPanel
        key={panelAgent}
        agentKey={panelAgent}
        open
        onOpenChange={(o) => {
          if (!o) setPanelAgent(null);
        }}
        onSeeAll={() => router.push("/results")}
        onOpenDecision={() => router.push("/inbox")}
        onActivate={() => router.push("/settings/channels")}
      />
    )}
  </>
);
```

- [ ] **Step 2: Typecheck.** Run: `pnpm --filter @switchboard/dashboard typecheck` → PASS.

### Task 3.2: Bento CSS (mobile = display:contents; lg = grid)

**Files:** Modify `apps/dashboard/src/components/home/home.module.css`

- [ ] **Step 1: Add the bento rules** after the `.column` block (after line ~26). Below lg, `.bento`/`.bentoMain`/`.bentoRail` are `display:contents`, so the module nodes render as direct flex children of `.column` in source order = the current mobile order (UNCHANGED).

```css
/* ─── Bento (desktop only) ─── */
.bento {
  display: contents;
}
.bentoMain,
.bentoRail {
  display: contents;
}
@media (min-width: 1024px) {
  .column {
    max-width: none; /* fill the shell content frame instead of the 640px column */
    padding: 32px 0 56px;
  }
  .bento {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--home-rail, 320px);
    gap: 28px;
    align-items: start;
  }
  .bentoMain,
  .bentoRail {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
  }
}
```

- [ ] **Step 2: Build + test.** Run: `pnpm --filter @switchboard/dashboard build && pnpm --filter @switchboard/dashboard test` → PASS.

- [ ] **Step 3: Visual verification.** At **1024/1440**: verdict spans full content width; below it a two-column bento — main column (Needs You / Team Pulse / This Week per ordering) beside a ~320px rail (While You Slept / Work In Progress / Permissions). At **390/768**: identical single-column stack to `main` (verify the module order is unchanged). Capture.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/components/home/home-page.tsx apps/dashboard/src/components/home/home.module.css
git commit -m "feat(dashboard): bento home layout on desktop"
```

---

# PR4 — Inbox master-detail two-pane

Depends on PR1. Docks the detail beside the list at ≥1024px; mobile keeps the overlay + scrim.

### Task 4.1: Wrap the list + add a desktop empty-pane placeholder (JSX)

**Files:** Modify `apps/dashboard/src/components/inbox/inbox-screen.tsx:187-245`

- [ ] **Step 1: Wrap the list region and add a placeholder.** In the returned JSX, wrap the header + filter row + queue/empty in `<div className="inbox-list">`, and add a desktop-only empty-pane placeholder shown when nothing is open. Replace lines ~188-226 so the structure is:

```tsx
    <div className="inbox-page">
      <div className="inbox-list">
        <header className="inbox-pagehead">
          <h1>inbox</h1>
          <span className="inbox-pagehead-count">
            {counts.total === 0
              ? "That's everything"
              : `${counts.total} ${counts.total === 1 ? "thing needs" : "things need"} you`}
          </span>
        </header>
        <InboxFilterRow counts={counts} selected={agentFilter} onSelect={setAgentFilter} />
        {decisions.length === 0 ? (
          <InboxEmptyState
            filtered={agentFilter !== null}
            agentName={agentFilter ? AGENT_REGISTRY[agentFilter]?.displayName : undefined}
          />
        ) : (
          <div className="inbox-queue">
            {decisions.map((d) => (
              <InboxDecisionItem
                key={d.id}
                decision={d}
                onOpenDetail={(dec) => setOpen({ decision: dec, kind: dec.kind })}
                onOpenAgent={setPanelAgent}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop docked-detail placeholder — display:none below lg, so mobile is unaffected */}
      {!open && (
        <div className="inbox-detail-empty" aria-hidden="true">
          Select an item to see details
        </div>
      )}

      {/* Detail layer (scrim hidden at lg; sheets dock into the right pane at lg) */}
      {open && (
        <div className="scrim" data-open="true" aria-hidden="true" onClick={() => setOpen(null)} />
      )}
      {open?.kind === "approval" && (
        <ApprovalDetailItem decision={open.decision} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "handoff" && (
        <HandoffDetailItem decision={open.decision} onClose={() => setOpen(null)} />
      )}
      {/* Agent panel unchanged */}
```

(Keep the existing AgentPanel block and closing tags as-is.)

- [ ] **Step 2: Typecheck.** Run: `pnpm --filter @switchboard/dashboard typecheck` → PASS.

### Task 4.2: Two-pane CSS (dock `.sheet`, hide `.scrim`, grid `.inbox-page` at lg)

**Files:** Modify `apps/dashboard/src/components/inbox/inbox-design-base.css`

- [ ] **Step 1: Confirm `.sheet` is the detail root.** The detail components render `.sheet` (audit-confirmed). Quickly verify:

Run: `grep -rn "className=\"sheet\"\|\"sheet\"\|sheet " apps/dashboard/src/components/inbox/approval-detail-sheet.tsx apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx | head`

- [ ] **Step 2: Add the lg two-pane rules** at the end of `inbox-design-base.css`. These come after the existing `@media(min-width:768px)` `.sheet` rules, so at ≥1024 they win (equal specificity, later wins):

```css
/* ─── Desktop master-detail two-pane (additive at lg) ─── */
@media (min-width: 1024px) {
  .inbox-page {
    max-width: none; /* fill the shell content frame */
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--inbox-detail-w, 460px);
    gap: 32px;
    align-items: start;
    padding-bottom: 32px;
  }
  .inbox-list {
    min-width: 0;
  }
  /* dock the detail sheet into the right column instead of a fixed overlay */
  .sheet {
    position: sticky;
    top: calc(var(--header-h, 68px) + 16px);
    right: auto;
    left: auto;
    width: auto;
    max-height: calc(100dvh - var(--header-h, 68px) - 48px);
    transform: none;
    border-left: none;
    border: 1px solid var(--hair);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sheet);
  }
  .sheet[data-open="true"] {
    transform: none;
  }
  /* no dimming in two-pane mode */
  .scrim {
    display: none;
  }
  .inbox-detail-empty {
    position: sticky;
    top: calc(var(--header-h, 68px) + 16px);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    color: var(--ink-3);
    font-family: var(--serif);
    font-style: italic;
    border: 1px dashed var(--hair);
    border-radius: var(--r-lg);
  }
}
/* placeholder is desktop-only */
.inbox-detail-empty {
  display: none;
}
```

Note: the docked `.sheet` and `.inbox-detail-empty` both occupy grid column 2 implicitly (they are the 2nd in-flow child after `.inbox-list`); only one exists at a time. If grid auto-placement misorders them, add `.sheet, .inbox-detail-empty { grid-column: 2; }` and `.inbox-list { grid-column: 1; }` inside the lg block.

- [ ] **Step 3: Build + test.** Run: `pnpm --filter @switchboard/dashboard build && pnpm --filter @switchboard/dashboard test` → PASS (existing inbox tests must stay green — they assert error-before-empty and detail open behavior).

- [ ] **Step 4: Visual verification (critical).** At **1024/1440**: list on the left, detail docked on the right with NO dimming scrim; selecting different items swaps the right pane; with nothing selected the right pane shows the dashed placeholder; the list stays visible/interactive. Esc still closes. At **390/768**: identical overlay + scrim behavior to `main`. Capture.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/inbox/inbox-screen.tsx apps/dashboard/src/components/inbox/inbox-design-base.css
git commit -m "feat(dashboard): master-detail two-pane inbox on desktop"
```

---

# PR5 — Results widen + dashboard grid + desktop sheet widths

Depends on PR1. The most data-dense screen; also fixes shared Sheet widths and the agent-panel drill-in for desktop.

### Task 5.1: Lift the Results column cap + grid the KPIs/funnel

**Files:** Modify `apps/dashboard/src/components/results/results.module.css`

- [ ] **Step 1: Read the relevant blocks** to get exact selectors/structure (the audit cited `.column:1258`, `.heroOutcomes:41`, `.funnelRow:403`):

Run: `sed -n '38,60p;395,430p;1248,1270p' apps/dashboard/src/components/results/results.module.css`

- [ ] **Step 2: Add lg rules** at the end of the file. Lift the 640px cap so the screen fills the content frame, and turn the vertical KPI stack + stacked funnel into desktop grids (port the Reports `1fr 1fr` collapsing-grid idiom). Use the actual class names found in Step 1; the template:

```css
/* ─── Results desktop layout (additive at lg) ─── */
@media (min-width: 1024px) {
  .column {
    max-width: none; /* was 640px — fill the shell content frame */
    padding-block: 32px 56px;
  }
  /* KPI hero outcomes: vertical stack → responsive grid */
  .heroOutcomes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 20px;
  }
  /* Funnel: full-width stacked rows → two-up so it uses the width */
  .funnel {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px 32px;
    align-items: start;
  }
}
```

Adjust selector names to match Step 1's findings (e.g., if the funnel container is `.funnelList` not `.funnel`). The campaigns table already branches at `matchMedia(1024px)` (`results-page.tsx:63-73`) and now renders in freed width — verify it no longer horizontally scrolls.

- [ ] **Step 3: Build + test + visual.** Run: `pnpm --filter @switchboard/dashboard build && pnpm --filter @switchboard/dashboard test`. Visual at 1024/1440/1920: KPIs in a row, funnel two-up, table uses full width; 390/768 unchanged. Capture.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/components/results/results.module.css
git commit -m "feat(dashboard): widen results into a desktop dashboard grid"
```

### Task 5.2: Desktop widths for the shared Sheet + agent-panel side-panel

**Files:** Modify `apps/dashboard/src/components/ui/sheet.tsx:39-40`; Modify `apps/dashboard/src/components/agent-panel/agent-panel.tsx` + `agent-panel.module.css`

- [ ] **Step 1: Widen side sheets on desktop.** In `sheet.tsx`, the right/left variants cap at `sm:max-w-sm` (384px). Add desktop steps. Read the `sheetVariants` cva (around lines 30-45) and append to the right/left side classes: `lg:max-w-md xl:max-w-lg`. Example (match exact existing strings):

```tsx
// right: "inset-y-0 right-0 h-full w-3/4 border-l ... sm:max-w-sm lg:max-w-md xl:max-w-lg",
// left:  "inset-y-0 left-0  h-full w-3/4 border-r ... sm:max-w-sm lg:max-w-md xl:max-w-lg",
```

- [ ] **Step 2: Agent panel as a desktop right side-panel.** The agent panel is a `side="bottom"` near-fullscreen sheet (`agent-panel.tsx:88`). At lg, render it as `side="right"` so it's a side-panel (it already takes plain `open/onOpenChange`; host owns state). Minimal approach: read `agent-panel.tsx` around line 88; change the `side` prop to be responsive. Since `side` is a render-time string, gate on a media query via a small `useIsDesktop()` hook (matchMedia 1024px, mirroring `results-page.tsx:63-73`):

```tsx
const isDesktop = useIsDesktop(); // matchMedia("(min-width: 1024px)")
// ...
<SheetContent side={isDesktop ? "right" : "bottom"} className={styles.panel}>
```

If a `useIsDesktop`/`matchMedia` helper already exists (check `results-page.tsx` and `@/hooks`), reuse it; otherwise add a tiny hook in `@/hooks/use-is-desktop.ts` with a co-located test. In `agent-panel.module.css`, add an `@media (min-width:1024px)` rule so `.panel` width/height suit a right panel (e.g., `width: min(520px, 92vw); height: 100%;`).

- [ ] **Step 3: Build + test + visual.** Run: `pnpm --filter @switchboard/dashboard build && pnpm --filter @switchboard/dashboard test`. Visual: open an agent drill-in from Home/Results at 1440 → right side-panel (not bottom sheet); inbox/contacts drawers wider than 384px; mobile unchanged. Capture.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/components/ui/sheet.tsx apps/dashboard/src/components/agent-panel/
git commit -m "feat(dashboard): desktop widths for sheets and agent side-panel"
```

---

## Final verification (after all PRs)

- [ ] `pnpm --filter @switchboard/dashboard typecheck` → PASS
- [ ] `pnpm --filter @switchboard/dashboard test` → PASS (coverage ≥ 40/35/40/40)
- [ ] `pnpm --filter @switchboard/dashboard lint && pnpm format:check` → PASS
- [ ] `pnpm --filter @switchboard/dashboard build` → PASS
- [ ] Visual matrix captured for Home, Inbox, Results, Settings at 390 / 768 / 1024 / 1440 / 1920; 390 & 768 match `main`.
- [ ] Request code review (superpowers:requesting-code-review), then finish the branch (superpowers:finishing-a-development-branch).

## Self-Review (run before handing off to execution)

- **Spec coverage:** PR1 ↔ spec §4 (breakpoint/frame/tokens/grid); PR2 ↔ §5 (sidebar/utility strip); PR3 ↔ §6 (bento); PR4 ↔ §7 (two-pane); PR5 ↔ §8 (Results + sheets). All spec sections mapped.
- **Mobile-safe:** every CSS block is `@media (min-width:1024px)` or the element is `display:none` below lg. No base/768 rule edited.
- **Type consistency:** `buildSidebarSections(opts)` signature + `SidebarSections`/`SidebarItem` shapes are used identically in `app-sidebar.ts`, the component, and tests.
