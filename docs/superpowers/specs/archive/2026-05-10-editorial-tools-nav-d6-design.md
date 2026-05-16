# Editorial Tools nav (Slice D6) — Design Spec

_2026-05-10 · part of the agent-first redesign track · Phase D, surface 6 (cross-cutting) · wraps up Phase D after D1 (`/contacts`), D1.5 (`/contacts/[id]`), D2 (`/automations`), D3 (`/activity`), D4+D5 (legacy retirement)_

> **Reading posture:** opinionated, narrow scope. This is the smallest possible change that makes the four shipped Mercury Tools surfaces (and Settings) reachable from the editorial shell. No new affordances, no new components beyond the dropdown itself.

---

## 1. Problem & scope

### 1.0 One-line scope

Add a `Tools ▾` overflow item to the editorial header so operators can reach `/contacts`, `/automations`, `/activity`, `/reports`, and `/settings` without typing the URL.

### 1.1 What this slice ships

- A new client component at `apps/dashboard/src/components/layout/tools-overflow.tsx` rendered inside the existing `header-actions` cluster of `editorial-auth-shell.tsx`, after the `me-chip`.
- A centralized route-availability **getter function** (`getToolsRouteAvailability()`) that mirrors `NEXT_PUBLIC_*_LIVE` flags via explicit references. The function is called inside the component (not at module top-level) so vitest can stub envs before render.
- An active state on the `Tools ▾` trigger when the current pathname matches a Tools route (boundary-aware — see §3.3). **Not** active on `/settings`.
- An active state (with `aria-current="page"`) on the matching menu item when the pathname matches that item (this *does* include `/settings`).
- A scoped CSS module `tools-overflow.module.css` for trigger + menu styling. No inline or global styles.
- One co-located test file (`tools-overflow.test.tsx`).
- **The trigger is hidden entirely when zero Tools routes are live** (see decision §2 row 11). Settings-alone does not justify a Tools menu.

### 1.2 What this slice does **not** ship

- **No mobile-specific layout.** The dropdown is already compact; small viewports use the same component. No hamburger.
- **No keyboard launcher.** ⌘K omnibar is a separate surface, deliberately deferred.
- **No prefetching strategy beyond what Next.js `<Link>` already does.**
- **No icons in the menu items.** Editorial register is text-only; the dropdown follows.
- **No analytics events.** Add later if we need adoption signal.
- **No new env flags.** This slice consumes the four existing `NEXT_PUBLIC_*_LIVE` flags (`CONTACTS`, `AUTOMATIONS`, `ACTIVITY`, `REPORTS`). `/settings` has no flag — always shown when the Tools trigger is rendered.
- **No environment-conditional behavior.** The Tools nav obeys `NEXT_PUBLIC_*_LIVE` in **every** environment. Dev/staging must set the flags to `"true"` for surfaces under review. This avoids surprising "works in dev, hidden in prod" drift.
- **No changes to `ROUTE_AVAILABILITY` in `lib/agent-home/resolve-link.ts`.** That object is for the agent-home cross-link resolver (different concern: where does a recommendation card link to?). The Tools-nav availability map is a separate, header-local concept.
- **No `aria-current` on the trigger.** Only on individual menu item links. The trigger's data-attribute styling is sufficient for visual cue; ARIA on a dropdown trigger that *contains* an active route is semantically muddy.

### 1.3 Why this is the right register

Per CLAUDE.md and the Phase B doctrine: the editorial shell is identity-first (Switchboard brand, Home, agent links). Mercury Tools surfaces are utilities — operationally important but not part of the editorial register. The chosen register split:

- **Editorial nav (left of header):** `Switchboard | Home  Alex  Riley  Mira  +`
- **Header actions (right of header):** `live-signal · inbox · halt · me-chip · Tools ▾`

Tools sits in the actions cluster, not in the brand-nav, because:
1. The brand-nav is editorial register; flat-listing Tools there pollutes it ("Switchboard | Home Alex Riley Mira + Contacts Automations Activity Reports Settings" is a wall of links).
2. The actions cluster already groups operational utilities (live signal popover, inbox, halt). Tools is the same tier.
3. A dropdown anchored at the right keeps the editorial register quiet and one click discoverable.

The trigger reads `Tools ▾` (text) rather than `⋯` (kebab) because kebab in this product reads as "more actions for this page," not "global Tools navigation." Tools surfaces are real destinations, not secondary actions.

---

## 2. Decisions ledger

| # | Decision | Rationale | Flip cost |
|---|---|---|---|
| 1 | Trigger label is `Tools ▾`, not `⋯` | Kebab reads as page-level overflow; these are destinations | Trivial — one string change |
| 2 | Mounts in `header-actions`, after `me-chip` | Matches existing operational-utilities cluster; doesn't pollute brand-nav | Trivial — move JSX |
| 3 | Hidden, not disabled, when route flag is `false` | Disabled items add noise + roadmap promise; YAGNI | Trivial — flip `if (!available) return null` |
| 4 | Separator before Settings | Tools = data/operations; Settings = system config | Trivial — remove the separator |
| 5 | Trigger active state excludes `/settings` | Settings is in overflow for convenience, not a "Tool" — semantic clarity | Trivial — add `\|\| pathname.startsWith("/settings")` |
| 6 | Menu-item active state includes `/settings` | Marking "you are here" inside the menu is correct regardless of register | Trivial |
| 7 | Availability is read via `getToolsRouteAvailability()` function (not a top-level const) with explicit `NEXT_PUBLIC_*_LIVE` references | Function call lets vitest `stubEnv` work without `vi.resetModules()` | Trivial — inline the body |
| 8 | Use the project's existing shadcn wrapper at `@/components/ui/dropdown-menu` (re-exports Radix) | Matches codebase convention; same wrapper styles other dropdowns | Could fall back to direct Radix import; not anticipated |
| 9 | No icons in menu items | Editorial register is text-only; consistency | Trivial — add icon prop later |
| 10 | `/settings` has no `NEXT_PUBLIC_*_LIVE` flag — always shown when the trigger is rendered | Settings is system-level; not a feature to gate | Doesn't apply |
| 11 | **Hide the entire `Tools ▾` trigger when zero Tools routes are live.** Settings-alone does not justify the menu | A single-item "Tools ▾ → Settings" menu is semantically dishonest; users misread it | Trivial — the existing `if (visibleItems.length === 0) return null` check |
| 12 | Boundary-aware path matching: `pathname === href \|\| pathname.startsWith(`${href}/`)` | Avoids `/contacts-old` activating Contacts and similar false positives | Trivial — single helper |
| 13 | Active menu item carries `aria-current="page"`. Trigger does **not** | Item-level current-page is well-understood; trigger semantics are muddy | Easy to revisit |
| 14 | `white-space: nowrap` on trigger | `Tools ▾` is wider than `⋯`; the `header-actions` cluster shouldn't wrap | Trivial — one CSS rule |

---

## 3. Architecture

### 3.1 File map

**Modify:**
- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — mount `<ToolsOverflow />` in `header-actions` after `<span className="me-chip">M</span>`.

**Create:**
- `apps/dashboard/src/components/layout/tools-overflow.tsx` — new client component.
- `apps/dashboard/src/components/layout/tools-overflow.module.css` — scoped styles for trigger + menu (active state via `[data-on-tools="true"]` and `[data-active="true"]`; `white-space: nowrap` on trigger).
- `apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx` — co-located test.

**No changes to:**
- `lib/agent-home/resolve-link.ts` (different `ROUTE_AVAILABILITY` concern).
- Any individual Mercury Tools surface.
- Global stylesheets — all D6 styling is scoped to the new module file.

### 3.2 The route-availability getter

Inside `tools-overflow.tsx`:

```ts
export function getToolsRouteAvailability() {
  return {
    contacts: process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true",
    automations: process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true",
    activity: process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true",
    reports: process.env.NEXT_PUBLIC_REPORTS_LIVE === "true",
  } as const;
}

const TOOLS_NAV_ITEMS = [
  { id: "contacts" as const, label: "Contacts", href: "/contacts" },
  { id: "automations" as const, label: "Automations", href: "/automations" },
  { id: "activity" as const, label: "Activity", href: "/activity" },
  { id: "reports" as const, label: "Reports", href: "/reports" },
] as const;
```

The function returns a fresh object on each call so vitest's `vi.stubEnv` takes effect inside the next render without needing `vi.resetModules()`. Next.js still inlines the four `NEXT_PUBLIC_*_LIVE` references statically because they appear as literal property accesses (`process.env.NEXT_PUBLIC_CONTACTS_LIVE`), satisfying the bundler's static analysis.

The id-`as const` pattern keeps `routeAvailability[item.id]` typed without a `keyof` widening.

`/settings` is rendered separately (below the separator, not in `TOOLS_NAV_ITEMS`) because it has no flag and is in a different group.

### 3.3 Active-state logic — boundary-aware

```ts
const pathname = usePathname() ?? "";

const TOOLS_PREFIXES = ["/contacts", "/automations", "/activity", "/reports"] as const;

function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const isToolsRoute = TOOLS_PREFIXES.some((p) => isPathActive(pathname, p));
```

Boundary matching prevents `/contacts-old` from activating Contacts, `/reports-archive` from activating Reports, `/settingsness` from activating Settings, etc.

The trigger reads `data-on-tools={isToolsRoute || undefined}` and styles via that attribute. Each menu item link reads `data-active={isPathActive(pathname, item.href) || undefined}` AND `aria-current={isPathActive(pathname, item.href) ? "page" : undefined}`. The Settings item participates in this regardless of whether the trigger is active.

### 3.4 Component shape

Use the project's existing shadcn dropdown wrapper at `@/components/ui/dropdown-menu` (which re-exports Radix primitives) so the import style matches the rest of the codebase.

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

// ...getToolsRouteAvailability + TOOLS_NAV_ITEMS + isPathActive from §3.2/3.3

export function ToolsOverflow() {
  const pathname = usePathname() ?? "";
  const availability = getToolsRouteAvailability();
  const visibleItems = TOOLS_NAV_ITEMS.filter((it) => availability[it.id]);

  // Hide the entire trigger when zero Tools routes are live.
  // Settings alone does not justify a "Tools ▾" menu (decision §2 row 11).
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

The separator always renders (because we early-return when `visibleItems.length === 0`, the menu is guaranteed to have at least one Tools item before the separator). No conditional separator needed.

### 3.5 Styling

Required: `apps/dashboard/src/components/layout/tools-overflow.module.css`. No inline `<style>`, no additions to global stylesheets.

Selectors:

- `.trigger` — base; includes `white-space: nowrap` so `Tools ▾` doesn't wrap when `header-actions` is crowded.
- `.trigger[data-on-tools="true"]` — active state. Amber underline matching the editorial brand-nav's existing underline-active pattern. Pair with a non-color signal (e.g., `font-weight: 500`) so the cue passes WCAG 1.4.1.
- `.menu` — dropdown content frame.
- `.menu [data-active="true"]` — active menu item. Same amber accent pattern; consistent with `aria-current="page"`.

Reuse `--mercury-*` / editorial-shell token names already in the codebase. Do not introduce new color tokens.

---

## 4. Accessibility

- The shadcn dropdown wrapper (Radix under the hood) provides:
  - `aria-haspopup="menu"` on the trigger.
  - `aria-expanded` toggling automatically.
  - Roving focus inside the menu, escape-to-close, click-outside-to-close.
  - Menu items rendered as `role="menuitem"`.
- Each menu item is a real `<Link>` (anchor) — right-click / cmd-click work.
- The visible trigger label `Tools ▾` is sufficient for screen readers; no `aria-label` needed (the `▾` glyph is decorative chevron, announced as a punctuation character at most). No `aria-current` on the trigger — semantics are muddy for a control that *contains* an active route.
- Each active menu item link carries `aria-current="page"`. Screen readers announce "current page" on the matching item.
- The active-state visual cue (amber underline) is paired with a non-color signal (`font-weight: 500`), satisfying WCAG 1.4.1.

---

## 5. Tests

Single test file: `tools-overflow.test.tsx`.

Use `vi.stubEnv("NEXT_PUBLIC_*", "true"|"")` and `vi.unstubAllEnvs()` between cases. Mock `usePathname` from `next/navigation` to control the route.

Cases:

1. **Renders trigger labelled "Tools".** Smoke test; all four flags `"true"`, pathname `/`.
2. **Opens menu on click; lists all four Tools items + Settings (with separator).** All flags `"true"`. Assert order, presence of separator.
3. **Hides one route when its flag is `false`.** Set `NEXT_PUBLIC_AUTOMATIONS_LIVE=""`, others `"true"`; "Automations" is absent, the other three Tools items present.
4. **Hides the entire trigger when all four flags are off.** No `Tools ▾` in DOM; Settings is not reachable via this surface in this state. (Decision §2 row 11.)
5. **Trigger has `data-on-tools="true"` when pathname is `/contacts`, `/contacts/abc`, `/automations`, `/activity`, `/reports`.** Parameterized over the four prefixes plus a deep path.
6. **Trigger does NOT have `data-on-tools` when pathname is `/settings`.** Distinct semantic; menu still opens.
7. **Trigger does NOT have `data-on-tools` when pathname is `/`, `/alex`, or `/missing`.** Editorial / unknown routes.
8. **Boundary matching: `/contacts-old` does NOT activate Contacts.** Confirms the `pathname === href || pathname.startsWith(\`${href}/\`)` rule. Same for `/reports-archive` and `/settingsness`.
9. **Settings menu item has `data-active="true"` and `aria-current="page"` when pathname is `/settings` or `/settings/account`.** Even though the trigger is not active.
10. **Each Tools item has `data-active="true"` and `aria-current="page"` when pathname matches that item's href.** Parameterized over the four items.
11. **No menu item has `aria-current` when pathname is on no Tools/Settings route.** Confirms current-page is gated on the match.

Total: 11 test cases. Co-located at `apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx`.

---

## 6. Implementation order (informal — full plan to follow)

1. Scaffold `tools-overflow.tsx` with `getToolsRouteAvailability()`, `TOOLS_NAV_ITEMS`, `TOOLS_PREFIXES`, `isPathActive` helpers (no JSX yet).
2. Write 11 failing tests.
3. Implement JSX using the shadcn `@/components/ui/dropdown-menu` wrapper until tests pass.
4. Add `tools-overflow.module.css` with `[data-on-tools]` / `[data-active]` styling and `white-space: nowrap` on the trigger.
5. Mount `<ToolsOverflow />` in `editorial-auth-shell.tsx` after `<span className="me-chip">M</span>`.
6. Manual smoke (run `pnpm dev` with all four `NEXT_PUBLIC_*_LIVE=true` in `.env.local`): load `/`, `/alex`, `/contacts`, `/contacts/some-id`, `/contacts-old`, `/settings`, `/missing` — verify trigger renders and active state matches each. Then unset all four flags and verify the trigger disappears.
7. **Two PRs to `main` per CLAUDE.md doctrine:** D6-spec PR first (this document + the implementation plan), then D6-impl PR (the component + test + CSS module + shell mount). Same pattern as D2 (#408 spec, #406 impl) and D3 (#412 spec, #413 impl).

---

## 7. Out of plan / not in scope

- `/settings` sub-routes (`/settings/account`, `/settings/team`, etc.) — they all share the `/settings` prefix so the active state Just Works. No per-sub-page menu items.
- A "What's new" or release-notes affordance attached to the menu — out of scope; if it ships later, it sits in `header-actions` separately.
- Right-rail-style command palette (⌘K) — separate slice, separate spec.
- Preserving menu-open state across route navigation — Radix closes on item click by default; that's correct UX here.
- Telemetry on Tools menu usage — add later if we need adoption signal; no surface-agnostic event-name decisions to make right now.
- Reflecting "new content" badges on items (e.g., "Contacts (3)") — needs a separate signal source; defer.

---

## 8. Open questions

None at spec time. All previously-open decisions are captured in the ledger §2.
