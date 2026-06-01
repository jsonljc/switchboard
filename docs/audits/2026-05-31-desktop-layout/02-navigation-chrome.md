# Desktop Layout Audit — 02: Navigation Chrome Across Viewports

Domain: navigation chrome only (top header/app bar, bottom tab bar, sidebar/drawer nav,
account menu, Mira entry, advanced reports). Layout-shell width, screen bodies, and design
tokens are owned by other auditors.

Scope basis: the AUTHED app (`(auth)` route group). The public marketing nav
(`landing-nav.tsx`, `v6/topbar.tsx`, `v6/dock.tsx`) is mounted ONLY by `(public)/welcome/page.tsx`
and is out of scope.

Repo state: HEAD is `73a24f91` = **#770 "feat(dashboard): header nav — account menu, Mira
entry, advanced reports."** So the #770 work referenced in the problem statement IS the current
checkout; all header-nav findings below are post-#770.

---

## FACT — Breakpoint system (this frames everything)

- `tailwind.config.ts` defines **NO custom `screens`** (verified: only `borderRadius` md/lg/xl).
  So Tailwind defaults apply: `sm`=640, `md`=768, `lg`=1024, `xl`=1280.
- **The authed nav chrome is NOT styled with Tailwind utilities — it is hand-written CSS in
  `src/app/globals.css` using raw `@media (min-width: …)` queries.** The header, brand cluster,
  header-actions, and primary-nav all live in the `@layer components` block (globals.css:474+).
- **Every nav breakpoint in that block is `768px` or `1280px`. There is NO `1024px` (`lg`) rule
  anywhere in the nav chrome, and NO Tailwind `lg:`/`xl:` class in any `src/components/layout/*`
  file** (verified: `rg 'lg:|xl:|1024px' src/components/layout/` → zero matches).
- Net effect: the app has exactly two nav layouts — **"narrow" (<768px)** and **"wide" (≥768px)**.
  A 768px-wide tablet and a 2560px-wide monitor render the _identical_ nav. There is no
  "desktop" tier distinct from "large tablet."

Relevant width caps (set by the nav chrome itself; body column width is another auditor's domain
but listed for context):

- `.app-header-row { max-width: 1280px; margin: 0 auto; }` — globals.css:489-490.
  Header content is capped at 1280px and centered; on a 1920px viewport the header rule has
  ~320px of dead gutter on each side.
- `--col-wide: 1080px` (globals.css:201); `.page-wide { max-width: var(--col-wide) }`
  (globals.css:620-621) — body content even narrower than the header.

---

## Nav Inventory (authed app)

Mounted once in `editorial-auth-shell.tsx` (`EditorialAuthShellInner`), which `app-shell.tsx`
renders for every authed route except chrome-free paths (`/onboarding`, `/operator` —
app-shell.tsx:35). Wiring: `(auth)/layout.tsx:20` → `AppShell` → `EditorialShellBoundary` →
`EditorialAuthShellInner`.

Header markup, `editorial-auth-shell.tsx:28-45`:

```
<header class="app-header">
  <div class="app-header-row">
    <div class="brand-cluster"> brand-mark + <PrimaryNav/> </div>
    <div class="header-actions"> LiveSignalPopover + InboxDrawer + HaltButton + AccountMenu + ToolsOverflow </div>
```

| #   | Surface                                                     | Component (file:line)                                                                                                     | Trigger / shape                                                                                                          | Styling source                                                                             |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | **Top app header (the #770 bar)**                           | `editorial-auth-shell.tsx:28` (`<header class="app-header">`)                                                             | sticky top bar, full width, inner row capped 1280px                                                                      | `globals.css:481` `.app-header`, `:489` `.app-header-row`                                  |
| 2   | **Brand mark**                                              | `editorial-auth-shell.tsx:31` (`<a class="brand-mark" href="/">`)                                                         | "● Switchboard" home link                                                                                                | `globals.css:513` `.brand-mark`                                                            |
| 3   | **Primary nav (Home · Inbox · Results)**                    | `primary-nav.tsx:15` (`<nav class="primary-nav">`); items array `:5-9`                                                    | **Mobile: fixed bottom tab bar. ≥768px: inline horizontal strip inside `.brand-cluster`.**                               | `globals.css:1175` `.primary-nav` (+ `:1189` md, `:1200`/`:1233` item)                     |
| 4   | **Live signal popover**                                     | `live-signal-popover.tsx` (trigger `.live-pip`/`.folio-link`)                                                             | header chip → Radix Popover of recent audit events                                                                       | `live-signal-popover.css`; trigger CSS `globals.css:544` `.live-pip`, `:575` `.folio-link` |
| 5   | **Inbox drawer**                                            | `inbox-drawer.tsx:43`; trigger `:103-119` (`button.folio-link`)                                                           | header "Inbox · N" chip → right-side `Sheet` (`SheetContent side="right" class="inbox-drawer sm:max-w-[28rem]"`, `:121`) | `inbox-drawer.css`; trigger `.folio-link` (globals.css:575)                                |
| 6   | **Halt button**                                             | mounted `editorial-auth-shell.tsx:40` (`HaltButtonClient`)                                                                | header kill-switch chip                                                                                                  | `globals.css:600` `.folio-link.is-halt`                                                    |
| 7   | **Account menu (NEW in #770)**                              | `account-menu.tsx:39`; trigger `:50` (`.me-chip`); links builder `:26-33`                                                 | circular avatar chip (org initial) → Radix dropdown: org/email header, Account, Billing (if Stripe), Sign out            | `globals.css:603` `.me-chip`                                                               |
| 8   | **Tools overflow menu (Mira + advanced reports live here)** | `tools-overflow.tsx:43`; items `:18-26`; **Mira item `:83-89`**; **Advanced/Full-reports `:90-100`**; Settings `:101-106` | "Tools ▾" text trigger → Radix dropdown                                                                                  | `tools-overflow.module.css` (`.trigger`, `.menu`)                                          |
| 9   | **Settings sidebar (route-scoped)**                         | `settings-layout.tsx:35` (`<aside class="hidden md:block w-[200px] shrink-0">`); items `:10-18`; mobile fallback `:61-92` | **Persistent left sidebar — ONLY on `/settings/*`.** Tailwind-styled.                                                    | inline Tailwind                                                                            |

Notes on the #770 additions specifically:

- The account menu (#7) replaced a previously-dead "me" chip with a real dropdown; sign-out was
  formerly 3 clicks deep (commit body).
- The **Mira entry** is a single dropdown item inside ToolsOverflow (`tools-overflow.tsx:83-89`),
  gated by `useMiraEnabled({ poll:false })` (`:47`). There is NO top-level Mira nav link.
- **"Advanced" reports** = a labeled group + "Full reports" → `/reports` item inside the same
  ToolsOverflow dropdown (`tools-overflow.tsx:90-100`), gated on `isMercuryToolLive("reports")`.

What is NOT present (verified):

- No bottom tab bar that persists on desktop (the only bottom bar, `.primary-nav`, becomes inline
  at ≥768px — globals.css:1189-1198).
- No left/right sidebar nav for the main app shell. The single `<aside>` is `/settings`-only.
- No `lg`/`xl`/desktop-specific nav component, container, or breakpoint anywhere in
  `src/components/layout/`.

---

## Per-Surface Responsive Behavior (FACT)

### Top header `.app-header` / `.app-header-row` (globals.css:481-507)

- `position: sticky; top: 0; z-index: 50` — full-bleed bar at all widths.
- Inner row: `max-width: 1280px; margin: 0 auto; display:flex; justify-content: space-between;`
  Padding scales: `14px 24px` base → `16px 40px` @768 (`:498-502`) → `18px 56px` @1280 (`:503-507`).
- **There is no reflow of the row contents across breakpoints — only padding grows.** Same two
  flex clusters (`.brand-cluster`, `.header-actions`) at every width. So the desktop header is the
  mobile header with bigger side padding and the bottom-bar links hoisted up into it.

### `.brand-cluster` (globals.css:508-512) and `.header-actions` (globals.css:529-543)

- `.brand-cluster`: `display:flex; gap:28px` — **NO media query.** Fixed at all widths.
- `.header-actions`: `display:flex; gap:18px` base → `gap:24px` @768 (`:539-543`). That's its only
  responsive change. Mono/uppercase 10.5px chip styling identical mobile→desktop.
- Both clusters are always visible; nothing collapses into a hamburger at any width. On a small
  phone the header chips can crowd, but that's the narrow-end concern, not desktop.

### Primary nav `.primary-nav` (globals.css:1175-1246) — the load-bearing one

- **<768px:** `position: fixed; bottom:0; left:0; right:0; z-index:50; justify-content: space-around;
border-top; padding includes env(safe-area-inset-bottom)` → a **mobile bottom tab bar.** Items
  are stacked column (icon-over-label idiom), `font-size:12px`, with an animated underline
  `::after` for the active item (`:1215-1232`).
- **≥768px (`@media min-width:768px`, `:1189`):** `position: static; background:transparent;
border-top:none; padding:0` → the nav **un-fixes and renders inline inside `.brand-cluster`,
  right of the brand mark.** Items switch to `flex-direction: row`, `font-size:15px`,
  `padding:6px 14px`; the underline `::after` is `display:none` and active state becomes a pill
  `background: hsl(20 10% 12% / 0.05)` (`:1233-1246`).
- So at ≥768px the _entire_ primary navigation is **three inline text links (Home / Inbox /
  Results)** living in the top-left of the header. There is no expansion, grouping, icons, or
  section structure added for wider screens.

### Account menu (account-menu.tsx) / Tools overflow (tools-overflow.tsx)

- **Fully viewport-agnostic.** Both are Radix dropdowns with a single small trigger
  (`.me-chip` 30×30 circle; `.trigger` "Tools ▾" text). No responsive prefixes; identical mobile
  → desktop. On desktop these collapse the bulk of app destinations (Pipeline, Automations,
  Reports, Mira, Full reports, Settings) behind a _click_, even though there's abundant horizontal
  room to surface them.

### Inbox drawer / Live signal popover / Halt

- Inbox: trigger is a header chip at all widths; panel is a right `Sheet`, width
  `sm:max-w-[28rem]` (inbox-drawer.tsx:121) — the only responsive token, a max-width clamp on the
  overlay. Behavior identical across desktop sizes.
- Live signal + Halt: header chips, no responsive variation.

### Settings sidebar (settings-layout.tsx) — the lone real "desktop nav" pattern

- `<aside class="hidden md:block w-[200px] shrink-0">` (`:35`): **hidden below md, persistent
  200px left rail at ≥768px**, with icon+label `Link`s and an active-state (`bg-surface`,
  font-medium) `:45-50`.
- Below md it degrades to a full-width list at `/settings` and a "← Settings" back-link on child
  routes (`:61-92`).
- This is the ONLY surface in the authed app that uses a persistent left-sidebar paradigm — and
  it's scoped to `/settings/*`. It is a ready-made visual/interaction template for an app-wide
  desktop sidebar.

---

## Desktop Navigation Problem (FACT + quantified)

**On desktop (≥1024px) a user navigates exactly the same way as on a ≥768px tablet:** via three
inline text links (Home/Inbox/Results) crammed into the top-left of a sticky header, plus a
"Tools ▾" dropdown and a "me" avatar dropdown at top-right. There is **no persistent, always-visible
navigation that exposes the app's full destination set.** Key destinations — Pipeline, Automations,
Reports, Mira, Full reports, Settings — are all **one click hidden behind the ToolsOverflow
dropdown** (`tools-overflow.tsx:18-106`), discoverable only by opening it.

Why it "looks like a stretched mobile layout" — navigation specifics:

1. **No `lg` desktop tier exists.** The single ≥768px layout is a tablet layout reused unchanged up
   to any monitor width (verified: zero `lg:`/`1024px` nav rules). The bottom tab bar simply
   teleports into the header; nothing is _designed_ for wide screens.
2. **Wasted horizontal space.** The primary nav is 3 short links pinned top-left; the header row
   is capped at 1280px and centered, so on a 1920px screen the nav chrome itself wastes ~640px of
   total gutter (≈33%), and on ultrawide far more. The left third of a wide header is mostly empty
   beside "● Switchboard Home Inbox Results."
3. **Mobile affordances persist on desktop.** Primary destinations behind a tap-to-open dropdown
   ("Tools ▾"), a right-side `Sheet` drawer for Inbox, and a popover for signals are
   phone-ergonomic patterns. On desktop, where a persistent rail is conventional and there is room
   for it, the app still funnels the user through mobile-style overlays.
4. **Two competing nav idioms.** Top-bar inline nav (app-wide) vs. left sidebar (`/settings` only)
   means the one place the app _does_ use a desktop-native sidebar is an island, inconsistent with
   the rest of the shell.
5. **Active-state cues are minimal on desktop** — primary nav loses its underline at ≥768px
   (`:1240-1241`) for a faint 5%-opacity pill; ToolsOverflow's active route is only visible after
   you open the dropdown. Low wayfinding for a wide canvas.

---

## Opportunities / Reusable Pieces (OPPORTUNITY — separated from facts above)

Recommended direction: **introduce a genuine `lg` (≥1024px) desktop tier with a persistent left
sidebar** that surfaces the full destination set (Home, Inbox, Results, and the currently-buried
Pipeline / Automations / Reports / Mira / Full reports / Settings), demoting the top bar to a thin
utility strip (brand + live signal + halt + account). Keep the current ≤md behavior (top bar +
bottom tab bar) byte-for-byte to protect mobile — add `lg:` rules rather than editing the existing
`<768`/`768` rules.

Why a left sidebar over wider inline top-nav:

- The destination set (≈8–9 routes incl. Tools items) is too large for a comfortable single inline
  row but ideal for a vertical rail with sections (Primary: Home/Inbox/Results; Tools:
  Pipeline/Automations/Reports/Mira; Advanced: Full reports; bottom: Settings).
- A rail reclaims the wasted left gutter and gives persistent wayfinding instead of dropdown
  spelunking.

Reusable pieces (do NOT rebuild these):

- **`settings-layout.tsx:35-58`** — an already-shipped persistent left sidebar pattern
  (`hidden md:block w-[200px] shrink-0`, icon+label `Link`s, active-state via `cn(... active ?
"bg-surface font-medium" : "hover:bg-surface/50")`, lucide icons). This is the template for an
  app-wide desktop sidebar; lift its structure/active-link idiom up to the shell.
- **`primary-nav.tsx` ITEMS + `isActive()` (`:5-13`)** — canonical primary destinations and the
  active-route predicate. Reuse verbatim as the sidebar's primary section; the existing
  `.primary-nav` CSS already cleanly forks mobile-bottom vs ≥768 via media queries — add an `lg`
  branch (or a sidebar variant) rather than a new component.
- **`tools-overflow.tsx` TOOLS_NAV_ITEMS + Mira/Advanced gating (`:18-26`, `:47`, `:52`,
  `:83-100`)** — the destinations currently hidden in the dropdown, already with their
  `isMercuryToolLive` / `useMiraEnabled` visibility gates. On desktop, promote these into the
  sidebar's "Tools"/"Advanced" sections (same gates) instead of a dropdown; keep the dropdown for
  ≤md.
- **`account-menu.tsx` (`accountMenuLinks` `:26`, `.me-chip` `:50`)** — already
  viewport-agnostic; keep it in the top utility strip on desktop unchanged (and/or anchor it at
  the sidebar foot). No rework needed.
- **`editorial-auth-shell.tsx:22-51`** — the single shared shell mount point. A desktop sidebar
  should be introduced HERE (one place, wraps `<main>`), preserving the chrome-free bypass logic
  in `app-shell.tsx:35`. The shell already cleanly separates `.brand-cluster` (nav) from
  `.header-actions` (utilities), so demoting nav out of the header is a localized change.
- **`globals.css` `@layer components` nav block (481-616, 1173-1246)** — existing tokens
  (`--ambient-cream`, `--hair`, `--ink*`, `hsl(var(--operator))`) and the established mobile/≥768
  media-query fork are the place to add `@media (min-width:1024px)` sidebar rules. The codebase
  already mixes raw-CSS chrome with Tailwind screens, so either approach is consistent — but the
  nav chrome's convention is **raw `@media` in globals.css**, so match that for the header/sidebar.

Risk notes for whoever implements:

- Tailwind has no custom `screens`; `lg` = 1024px is available for Tailwind-class work
  (settings-layout uses `md:`). But the _header/primary-nav_ are raw-CSS — keep additions in
  globals.css `@media (min-width:1024px)` to avoid a split convention within one surface.
- Preserve the `position: fixed; bottom:0` mobile primary-nav and its safe-area padding
  (globals.css:1176-1187) untouched; only layer a new ≥1024px sidebar treatment on top.
- The header row's `max-width:1280px` cap (globals.css:490) and body `--col-wide:1080px`
  (globals.css:201) are owned by the layout-shell-width auditor; a sidebar redesign must be
  reconciled with their max-width decision (sidebar typically sits outside the centered content
  column).
