# Editorial Tools nav (Slice D6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Tools ▾` overflow menu in the editorial header so operators can reach `/contacts`, `/automations`, `/activity`, `/reports`, and `/settings` from `/` and `/[agentKey]` editorial pages.

**Architecture:** A single client component (`tools-overflow.tsx`) mounted in the existing `header-actions` cluster of `editorial-auth-shell.tsx`. It uses the project's shadcn `@/components/ui/dropdown-menu` wrapper, reads availability via a `getToolsRouteAvailability()` function (so vitest's `stubEnv` works without `resetModules`), and is hidden entirely when zero Tools routes are live. Active state is boundary-aware (`pathname === href || pathname.startsWith(href + "/")`).

**Tech Stack:** TypeScript, Next.js 14 App Router, React 19, Tailwind + CSS modules, Radix `DropdownMenu` (via shadcn wrapper), vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-10-editorial-tools-nav-d6-design.md` (decisions ledger §2; component shape §3.4).

**PR shape:** Two PRs targeting `main` per CLAUDE.md doctrine.

- **PR-D6-spec** = this plan + the spec doc (single docs-only PR).
- **PR-D6-impl** = Tasks 1–6 (component + CSS + test + shell mount).

After every task: `pnpm --filter @switchboard/dashboard test -- tools-overflow` must be green before commit. Run `pnpm typecheck` only in Task 1 (helper exports cross from this file to the test) and Task 6 (final sweep). Run `pnpm --filter @switchboard/dashboard build` once at the end of Task 6 to confirm Next.js can resolve the new route imports — D3 shipped a `.js`-extension regression that CI didn't catch (#414); the build sweep here prevents a repeat.

---

## Backend wiring — none

D6 is purely a presentational addition to the editorial shell. No backend changes, no schema changes, no migrations, no new env vars. The four `NEXT_PUBLIC_CONTACTS_LIVE`, `NEXT_PUBLIC_AUTOMATIONS_LIVE`, `NEXT_PUBLIC_ACTIVITY_LIVE`, `NEXT_PUBLIC_REPORTS_LIVE` flags are already consumed by their respective hooks; this slice reads them at the header level only.

---

## File map

**Modify:**
- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — mount `<ToolsOverflow />` in the `header-actions` cluster after `<span className="me-chip">M</span>`.

**Create:**
- `apps/dashboard/src/components/layout/tools-overflow.tsx` — client component (`"use client"`).
- `apps/dashboard/src/components/layout/tools-overflow.module.css` — scoped styles for trigger + menu (active state, `white-space: nowrap`).
- `apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx` — 11-case test file.

**No changes to:**
- `apps/dashboard/src/lib/agent-home/resolve-link.ts` (different `ROUTE_AVAILABILITY` concern; spec §1.2).
- Any individual Mercury Tools surface.
- Global stylesheets (all D6 styling is scoped to `tools-overflow.module.css`).

---

## Task 1: Scaffold helpers and types in `tools-overflow.tsx`

**Files:**
- Create: `apps/dashboard/src/components/layout/tools-overflow.tsx`

This task creates the helper exports the test file imports in Task 2. JSX comes in Task 3.

- [ ] **Step 1: Create the file with helpers and a stub component**

```tsx
"use client";

import { usePathname } from "next/navigation";

export const TOOLS_NAV_ITEMS = [
  { id: "contacts", label: "Contacts", href: "/contacts" },
  { id: "automations", label: "Automations", href: "/automations" },
  { id: "activity", label: "Activity", href: "/activity" },
  { id: "reports", label: "Reports", href: "/reports" },
] as const;

export const TOOLS_PREFIXES = TOOLS_NAV_ITEMS.map((it) => it.href);

export type ToolsNavId = (typeof TOOLS_NAV_ITEMS)[number]["id"];

export function getToolsRouteAvailability(): Record<ToolsNavId, boolean> {
  return {
    contacts: process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true",
    automations: process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true",
    activity: process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true",
    reports: process.env.NEXT_PUBLIC_REPORTS_LIVE === "true",
  };
}

export function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ToolsOverflow() {
  // Stub — JSX implementation lands in Task 3.
  // Wire usePathname() now so the import is resolved by typecheck.
  const _pathname = usePathname() ?? "";
  return null;
}
```

**Why these specific shapes:**

- `TOOLS_NAV_ITEMS` is `as const` so `TOOLS_NAV_ITEMS[number]["id"]` narrows to the literal union `"contacts" | "automations" | "activity" | "reports"`. The `Record<ToolsNavId, boolean>` return type then keys exactly to those four ids — no `keyof` widening.
- `getToolsRouteAvailability` is a function (not a top-level `const`) so vitest's `vi.stubEnv` takes effect on the *next* call without `vi.resetModules()`. Spec §3.2.
- `isPathActive` performs boundary matching — required by the spec to avoid `/contacts-old` activating Contacts. Spec §3.3.
- The `ToolsOverflow` export is a stub returning `null` so Task 5's mount can compile before Task 3 lands the real JSX.

- [ ] **Step 2: Run typecheck to verify the file compiles cleanly**

```bash
pnpm typecheck
```

Expected: clean across all 18 workspaces.

If `pnpm typecheck` reports missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core` after worktree creation, run `pnpm reset` first (per CLAUDE.md).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/tools-overflow.tsx
git commit -m "feat(dashboard): tools-overflow scaffolding (helpers + stub) (D6)"
```

---

## Task 2: Write the 11 failing tests

**Files:**
- Create: `apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx`

Vitest-only test; no Playwright. Uses `vi.stubEnv` for the four `NEXT_PUBLIC_*_LIVE` flags and a manual mock for `next/navigation`'s `usePathname`. Pattern mirrors `apps/dashboard/src/app/(auth)/activity/hooks/__tests__/use-activity-list.test.tsx`'s env handling.

Reference for rendering Radix dropdowns under vitest + @testing-library: the existing inbox-drawer tests at `apps/dashboard/src/components/layout/__tests__/` already exercise Radix portals — follow their pattern (`pointerdown` simulation if `userEvent.click` doesn't open the menu in jsdom).

- [ ] **Step 1: Write the file with all 11 cases**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsOverflow } from "../tools-overflow";

// Mock next/navigation. Each test sets the return value via mockReturnValue.
const mockUsePathname = vi.fn<[], string>(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

function setAllToolsLive(value: boolean) {
  vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", value ? "true" : "");
  vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", value ? "true" : "");
  vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", value ? "true" : "");
  vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", value ? "true" : "");
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /tools/i });
  await userEvent.click(trigger);
  return trigger;
}

beforeEach(() => {
  mockUsePathname.mockReturnValue("/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ToolsOverflow", () => {
  // Case 1
  it("renders a trigger labelled 'Tools'", () => {
    setAllToolsLive(true);
    render(<ToolsOverflow />);
    expect(screen.getByRole("button", { name: /tools/i })).toBeInTheDocument();
  });

  // Case 2
  it("opens the menu and lists all four Tools items + Settings with separator", async () => {
    setAllToolsLive(true);
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual([
      "Contacts",
      "Automations",
      "Activity",
      "Reports",
      "Settings",
    ]);
    // Separator between Reports and Settings.
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  // Case 3
  it("hides one route when its flag is false", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "true");
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Automations")).not.toBeInTheDocument();
    expect(within(menu).getByText("Contacts")).toBeInTheDocument();
    expect(within(menu).getByText("Activity")).toBeInTheDocument();
    expect(within(menu).getByText("Reports")).toBeInTheDocument();
  });

  // Case 4
  it("hides the entire trigger when all four flags are off", () => {
    setAllToolsLive(false);
    const { container } = render(<ToolsOverflow />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /tools/i })).not.toBeInTheDocument();
  });

  // Case 5
  it.each([
    ["/contacts"],
    ["/contacts/abc"],
    ["/automations"],
    ["/automations/xyz"],
    ["/activity"],
    ["/reports"],
  ])("trigger has data-on-tools when pathname is %s", (pathname) => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue(pathname);
    render(<ToolsOverflow />);
    const trigger = screen.getByRole("button", { name: /tools/i });
    expect(trigger).toHaveAttribute("data-on-tools", "true");
  });

  // Case 6
  it("trigger does NOT have data-on-tools when pathname is /settings", () => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue("/settings");
    render(<ToolsOverflow />);
    const trigger = screen.getByRole("button", { name: /tools/i });
    expect(trigger).not.toHaveAttribute("data-on-tools");
  });

  // Case 7
  it.each([["/"], ["/alex"], ["/missing"]])(
    "trigger does NOT have data-on-tools when pathname is %s",
    (pathname) => {
      setAllToolsLive(true);
      mockUsePathname.mockReturnValue(pathname);
      render(<ToolsOverflow />);
      const trigger = screen.getByRole("button", { name: /tools/i });
      expect(trigger).not.toHaveAttribute("data-on-tools");
    },
  );

  // Case 8
  it.each([
    ["/contacts-old", "Contacts"],
    ["/reports-archive", "Reports"],
    ["/settingsness", "Settings"],
  ])(
    "boundary matching: pathname %s does not activate %s",
    async (pathname, label) => {
      setAllToolsLive(true);
      mockUsePathname.mockReturnValue(pathname);
      render(<ToolsOverflow />);
      const trigger = screen.getByRole("button", { name: /tools/i });
      // Trigger must not be marked active for the spurious match
      // (only valid for the four Tools prefixes; /settingsness is irrelevant here).
      if (label !== "Settings") {
        expect(trigger).not.toHaveAttribute("data-on-tools");
      }
      await userEvent.click(trigger);
      const menu = await screen.findByRole("menu");
      const item = within(menu).getByText(label).closest('[role="menuitem"]');
      expect(item).not.toHaveAttribute("data-active");
    },
  );

  // Case 9
  it.each([["/settings"], ["/settings/account"]])(
    "Settings menu item is active+aria-current when pathname is %s",
    async (pathname) => {
      setAllToolsLive(true);
      mockUsePathname.mockReturnValue(pathname);
      render(<ToolsOverflow />);
      await openMenu();
      const menu = await screen.findByRole("menu");
      const settings = within(menu).getByText("Settings");
      const item = settings.closest('[role="menuitem"]');
      expect(item).toHaveAttribute("data-active", "true");
      // aria-current="page" lives on the inner <Link>.
      expect(settings.closest("a")).toHaveAttribute("aria-current", "page");
    },
  );

  // Case 10
  it.each([
    ["/contacts", "Contacts"],
    ["/automations", "Automations"],
    ["/activity", "Activity"],
    ["/reports", "Reports"],
  ])("%s item is active+aria-current when pathname matches", async (pathname, label) => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue(pathname);
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    const text = within(menu).getByText(label);
    const item = text.closest('[role="menuitem"]');
    expect(item).toHaveAttribute("data-active", "true");
    expect(text.closest("a")).toHaveAttribute("aria-current", "page");
  });

  // Case 11
  it("no menu item has aria-current when pathname is on no Tools/Settings route", async () => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue("/alex");
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    const links = within(menu).getAllByRole("menuitem").map((el) => el.querySelector("a"));
    for (const link of links) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
pnpm --filter @switchboard/dashboard test -- tools-overflow
```

Expected: every assertion fails because the stub component returns `null` (no trigger button, no menu, no data attributes). Concretely Case 1 fails on `getByRole("button")`, Cases 2/3/9/10/11 fail on `findByRole("menu")`, Case 4 *passes* (the stub returns null, so `container` is empty), Cases 5–8 fail on `getByRole("button")`. **Case 4 is a false positive at this stage** — it will continue to pass through Task 3 because the same hide-branch is preserved. That's correct behavior; do not chase it.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx
git commit -m "test(dashboard): tools-overflow 11-case red-bar (D6)"
```

---

## Task 3: Implement the JSX (red → green)

**Files:**
- Modify: `apps/dashboard/src/components/layout/tools-overflow.tsx`

The shadcn wrapper at `apps/dashboard/src/components/ui/dropdown-menu.tsx` re-exports Radix primitives with project styling. We use `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, and `DropdownMenuPortal` from there.

Shadcn's `DropdownMenuItem` already wraps Radix's `Item`; passing `asChild` lets us swap in a Next.js `<Link>` while preserving menu behavior.

- [ ] **Step 1: Replace the stub with the real component**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import styles from "./tools-overflow.module.css";

export const TOOLS_NAV_ITEMS = [
  { id: "contacts", label: "Contacts", href: "/contacts" },
  { id: "automations", label: "Automations", href: "/automations" },
  { id: "activity", label: "Activity", href: "/activity" },
  { id: "reports", label: "Reports", href: "/reports" },
] as const;

export const TOOLS_PREFIXES = TOOLS_NAV_ITEMS.map((it) => it.href);

export type ToolsNavId = (typeof TOOLS_NAV_ITEMS)[number]["id"];

export function getToolsRouteAvailability(): Record<ToolsNavId, boolean> {
  return {
    contacts: process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true",
    automations: process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true",
    activity: process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true",
    reports: process.env.NEXT_PUBLIC_REPORTS_LIVE === "true",
  };
}

export function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ToolsOverflow() {
  const pathname = usePathname() ?? "";
  const availability = getToolsRouteAvailability();
  const visibleItems = TOOLS_NAV_ITEMS.filter((it) => availability[it.id]);

  // Hide the entire trigger when zero Tools routes are live (decision §2 row 11).
  if (visibleItems.length === 0) return null;

  const isToolsRoute = TOOLS_PREFIXES.some((p) => isPathActive(pathname, p));
  const settingsActive = isPathActive(pathname, "/settings");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={styles.trigger}
        data-on-tools={isToolsRoute || undefined}
      >
        Tools ▾
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent className={styles.menu} sideOffset={6} align="end">
          {visibleItems.map((it) => {
            const active = isPathActive(pathname, it.href);
            return (
              <DropdownMenuItem key={it.id} asChild data-active={active || undefined}>
                <Link href={it.href} aria-current={active ? "page" : undefined}>
                  {it.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild data-active={settingsActive || undefined}>
            <Link href="/settings" aria-current={settingsActive ? "page" : undefined}>
              Settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
```

**Notes for the implementer:**

- The early `return null` for `visibleItems.length === 0` runs *before* `isToolsRoute` is computed; that's intentional — when the trigger isn't rendered, there's no `data-on-tools` attribute to set.
- `data-on-tools={isToolsRoute || undefined}` — passing `undefined` strips the attribute entirely, so absence-of-attribute is the inactive state. Same pattern for `data-active` on items.
- `aria-current={active ? "page" : undefined}` — same idea, applied to the inner `<Link>` because that's the actual anchor tag. Radix's `asChild` forwards props to the child; combining `data-active` on the wrapper and `aria-current` on the link gives styling and a11y semantics independent paths.
- The CSS module import `tools-overflow.module.css` doesn't exist yet — Task 4 creates it. TypeScript will narrow `styles` to `Record<string, string>` so this compiles even with the file missing; Next.js will error at *build* time (handled in Task 6).

- [ ] **Step 2: Create a placeholder CSS module so the import resolves**

```bash
touch apps/dashboard/src/components/layout/tools-overflow.module.css
```

Empty is fine — Task 4 fills it. With the file present (even empty), CSS Modules' loader will resolve it and return `{}`. Tests pass without selectors because they assert on `data-*` attributes, not class names.

- [ ] **Step 3: Run the tests, verify they pass**

```bash
pnpm --filter @switchboard/dashboard test -- tools-overflow
```

Expected: 11/11 pass.

If Case 2 fails because the menu doesn't open under jsdom, check whether Radix needs `pointerdown` instead of `click`. The fix is to swap `userEvent.click(trigger)` for:

```ts
trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
```

Look at one of the existing dropdown tests in `apps/dashboard/src/components/layout/__tests__/` for the exact pattern that works in this repo's vitest config. Do not introduce a new pattern.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/tools-overflow.tsx apps/dashboard/src/components/layout/tools-overflow.module.css
git commit -m "feat(dashboard): tools-overflow component (Tools ▾ menu) (D6)"
```

---

## Task 4: CSS module — trigger and menu styling

**Files:**
- Modify: `apps/dashboard/src/components/layout/tools-overflow.module.css`

The shadcn wrapper already styles `DropdownMenuContent`, `DropdownMenuItem`, and `DropdownMenuSeparator` (cream surface, ink text, hairlines). Our module adds: trigger styling (matches the editorial brand-nav register, no-wrap), `data-on-tools` accent on the trigger, and `data-active` accent on items.

Token references: the editorial shell already exposes `--mercury-ink`, `--mercury-cream`, and the operator amber accent via existing CSS custom properties (defined in `apps/dashboard/src/app/globals.css` and the layout shell). Reuse those — do not introduce new color tokens.

- [ ] **Step 1: Write the CSS**

```css
.trigger {
  /* Editorial nav register: text-only, sized like other header-actions chips. */
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
  color: var(--mercury-ink, hsl(0 0% 14%));
  background: transparent;
  border: 0;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  cursor: pointer;
  white-space: nowrap;
}

.trigger:hover {
  background: hsl(30 30% 92% / 0.6);
}

.trigger:focus-visible {
  outline: 2px solid hsl(30 55% 46%);
  outline-offset: 2px;
}

.trigger[data-on-tools="true"] {
  /* Active accent — pair color with weight so WCAG 1.4.1 holds. */
  font-weight: 500;
  box-shadow: inset 0 -2px 0 hsl(30 55% 46%);
}

.menu {
  /* shadcn wrapper already covers surface + border + shadow.
     This rule is intentionally empty — kept so future styling
     (e.g., a min-width on the menu) has a hook. */
}

.menu :global([data-active="true"]) {
  /* shadcn DropdownMenuItem already supports data attributes.
     Mirror the trigger's active accent inside the menu. */
  font-weight: 500;
  color: hsl(30 55% 46%);
}
```

**Notes for the implementer:**

- The `:global([data-active="true"])` selector is needed because the shadcn `DropdownMenuItem` adds the `data-active` attribute to the wrapper element, but that element is not directly classed by our CSS module. Without `:global`, CSS Modules would mangle the attribute selector's scope. The cascade still applies only inside `.menu` because of the parent selector — so this scopes cleanly to our menu.
- The `box-shadow` underline mirrors the editorial brand-nav active pattern. If the editorial nav uses `border-bottom` instead, switch — but check the existing rule first by grepping for `.brand-nav a[aria-current]` or similar in `globals.css`.
- The `--mercury-ink` and `hsl(30 55% 46%)` operator-amber values are already in the codebase. Confirm with: `grep -rn "30 55% 46%" apps/dashboard/src/` — at least the contacts/automations modules already reference this hue.

- [ ] **Step 2: Re-run tests to confirm CSS doesn't break behavior**

```bash
pnpm --filter @switchboard/dashboard test -- tools-overflow
```

Expected: 11/11 still pass. Tests don't assert on class names, so adding rules can't break them.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/tools-overflow.module.css
git commit -m "feat(dashboard): tools-overflow scoped styles + active accent (D6)"
```

---

## Task 5: Mount in `editorial-auth-shell.tsx`

**Files:**
- Modify: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`

The mount point is the existing `header-actions` div. Insert `<ToolsOverflow />` after `<span className="me-chip">M</span>` so the cluster reads `live-signal · inbox · halt · me-chip · Tools ▾`.

- [ ] **Step 1: Add the import**

In `editorial-auth-shell.tsx`, add to the import block:

```tsx
import { ToolsOverflow } from "./tools-overflow";
```

Place it alphabetically after `import { TweaksPanelMount } from "./tweaks-panel-mount";` — actually no, `ToolsOverflow` sorts before `TweaksPanelMount` lexically. Insert it just before the `TweaksPanelMount` import to keep the block sorted:

```tsx
import { HaltProvider } from "./halt/halt-context";
import { ToolsOverflow } from "./tools-overflow";
import { TweaksPanelMount } from "./tweaks-panel-mount";
```

- [ ] **Step 2: Mount the component in `header-actions`**

Find the `header-actions` div in `EditorialAuthShellInner`:

```tsx
<div className="header-actions">
  <LiveSignalPopover />
  <InboxDrawer />
  <HaltButtonClient />
  <span className="me-chip">M</span>
</div>
```

Add `<ToolsOverflow />` after the `me-chip`:

```tsx
<div className="header-actions">
  <LiveSignalPopover />
  <InboxDrawer />
  <HaltButtonClient />
  <span className="me-chip">M</span>
  <ToolsOverflow />
</div>
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Run dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: full suite green. The mount doesn't break any existing test because no other component renders `<EditorialAuthShellInner />` in isolation that asserts on specific child counts.

If the existing `app-shell.test.tsx` or any layout snapshot test breaks, update its expected count — the mount adds one new child to `header-actions`. Snapshots are inappropriate for layout tests anyway; if you find one, replace it with a behavior assertion before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx
git commit -m "feat(dashboard): mount ToolsOverflow in editorial header (D6)"
```

---

## Task 6: Final verification sweep

**Files:** none (verification only).

This task confirms the four boxes the spec promises:
1. Typecheck across the workspace.
2. Full dashboard test suite green.
3. Lint clean.
4. **Dashboard build green** — D3 shipped a `.js`-extension regression that CI didn't catch (#414); D6 should not repeat that. The build sweep is the safety net.

- [ ] **Step 1: Typecheck**

```bash
pnpm typecheck
```

Expected: 18/18 workspaces successful, 0 errors.

If `@switchboard/*` packages report missing exports, run `pnpm reset` per CLAUDE.md and retry.

- [ ] **Step 2: Dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: all green. The new `tools-overflow` tests add 11 passing cases.

- [ ] **Step 3: Lint**

```bash
pnpm --filter @switchboard/dashboard lint
```

Expected: clean (or unchanged-from-main warnings only — the dashboard's lint is a stub per Next 16 migration as of 2026-05-10, but if it returns errors specific to `tools-overflow.*` files, fix before commit).

- [ ] **Step 4: Dashboard build (regression guard)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: `Compiled successfully in <N>s`. The `/contacts`, `/automations`, `/activity`, `/reports`, `/settings` routes already build on main; this command verifies that adding `<ToolsOverflow />` (with its `next/link` references) doesn't introduce a new module-resolution error.

If you see "Module not found" errors, **stop**. The most likely cause is an import using `.js` extensions in Next.js relative imports — check `tools-overflow.tsx` for any `from "./...js"` (there should be none).

- [ ] **Step 5: Manual smoke (optional but recommended)**

In a terminal with all four `NEXT_PUBLIC_CONTACTS_LIVE=true` etc. set in `.env.local`, run:

```bash
pnpm dev
```

Visit each pathname and verify:

| Pathname | Trigger visible? | `data-on-tools`? | Active item inside menu? |
|---|---|---|---|
| `/` | yes | no | none |
| `/alex` | yes | no | none |
| `/contacts` | yes | yes | Contacts |
| `/contacts/abc` | yes | yes | Contacts |
| `/contacts-old` | yes | **no** (boundary) | none |
| `/automations` | yes | yes | Automations |
| `/activity` | yes | yes | Activity |
| `/reports` | yes | yes | Reports |
| `/settings` | yes | **no** (semantic) | Settings |
| `/settings/account` | yes | no | Settings |
| `/missing` | yes | no | none |

Then unset all four flags (or set them to `""`) and reload `/`. Verify the trigger disappears entirely (decision §2 row 11).

- [ ] **Step 6: No commit needed**

This task only verifies. If any sub-step fails, fix in the relevant earlier task and re-run from there.

---

## Out of plan / not in scope

Per spec §7:
- `/settings` sub-routes are not separate menu items.
- "What's new" / release-notes affordance.
- Right-rail-style command palette (⌘K).
- Telemetry on Tools menu usage.
- "New content" badges on items.

Per spec §1.2:
- No mobile-specific layout (small viewports use the same component).
- No keyboard launcher.
- No prefetching beyond Next.js `<Link>` defaults.
- No icons.
- No analytics events.
- No new env flags.
- No environment-conditional behavior — flags obeyed in every environment.
- No changes to `lib/agent-home/resolve-link.ts`'s `ROUTE_AVAILABILITY` (different concern).
- No `aria-current` on the trigger.
