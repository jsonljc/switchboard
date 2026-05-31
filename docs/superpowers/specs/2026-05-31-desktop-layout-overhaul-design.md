# Desktop Layout Overhaul — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design forks chosen by user; full-overhaul arc)
**Surface:** `apps/dashboard` (Next.js 14 App Router), authed product screens
**Audit:** `docs/audits/2026-05-31-desktop-layout/` (synthesis `00-synthesis.md` + 5 domain files)

---

## 1. Problem

The dashboard is mobile-first and its responsive treatment **stops at the 768px (`md`) breakpoint**. There is no genuine desktop tier (`lg:` used 12× total across the app; one `1024px` media query; `2xl:` zero). Consequently, on a wide screen:

- Every product page renders as a **640–720px column centered in empty gutters** — on a 1440px viewport ~55% of the width is whitespace (Home `home.module.css:21` = 640px; Results `results.module.css:1260` = 640px; Inbox `inbox-design-base.css:169` = 720px).
- The body column (640px) **doesn't even align** under the header inner row (capped 1280px).
- **Navigation is a phone tab-bar**: `.primary-nav` is `position:fixed` bottom bar <768px that merely un-fixes into 3 inline text links ≥768px; all other destinations (Pipeline, Automations, Reports, Mira, Settings) hide behind a "Tools ▾" dropdown even on huge screens.
- Detail views are **phone overlays on desktop**: Inbox detail is a `position:fixed` ~480px overlay over a scrim (list never reflows); shared `Sheet` caps at `sm:max-w-sm` (384px) with no `lg` override; the agent-panel drill-in is a near-fullscreen bottom sheet.

## 2. Goals / Non-Goals

**Goals**

- A first-class desktop experience at ≥1024px across Home, Inbox, Results, and the app shell/nav.
- One canonical desktop breakpoint and one content-width scale.
- Reuse proven in-house patterns (Settings sidebar, Reports grid, the dead `.dashboard-*` grid) rather than inventing new systems.

**Non-Goals**

- No change to mobile/tablet (<1024px) rendering — every rule is additive at ≥`lg`.
- No content/data/logic changes; this is layout/presentation only. (Exception: nav assembles existing destination data into a new sidebar component.)
- No redesign of Reports (already a proper desktop layout — it's the _reference_, not a target) or Settings (already has a sidebar).
- No new design language/tokens beyond layout primitives; color/type/motion tokens are already mature.

## 3. Design Principles

1. **Additive at ≥1024px.** All new CSS is inside `@media (min-width:1024px)` or `lg:`/`xl:` Tailwind prefixes. Below `lg`, output is unchanged. This is the core no-regression guarantee.
2. **One breakpoint.** `lg` = 1024px is _the_ desktop switch. Migrate stray 1280/1440 module steps onto it (keep a `xl`=1280 / optional `2xl` only for genuine "extra room" refinements).
3. **Shell owns width; screens own internal reflow.** A single content frame at the shell sets the desktop max-width once; each screen drops its own narrow cap and arranges its interior.
4. **Reuse, don't reinvent.** Sidebar ⟵ `settings-layout.tsx`; main+rail grid ⟵ revived `.dashboard-content-grid`; wide data layout ⟵ Reports `--max-w` + collapsing grids.

## 4. Foundation Primitives (PR1)

These ship first, mostly invisible, and unblock the screen PRs.

### 4.1 Canonical breakpoint

- Make `lg`=1024 explicit in `tailwind.config.ts` (`theme.screens`) so intent is documented; default value is already 1024, so this is a no-op for existing `lg:` classes but pins the convention.
- New CSS-module desktop rules use `@media (min-width: 1024px)`. Existing 768px rules are left intact (they govern mobile→tablet, which we are not touching).

### 4.2 Content frame on the shell

- Target: the bare `<main>` in `components/layout/editorial-auth-shell.tsx:46`.
- Introduce an `.app-content` wrapper (or apply to `<main>`): at ≥1024px, `max-width: var(--content-max)` (~1280px, header-aligned) + `margin-inline:auto` + responsive padding. Below 1024px it is full-width passthrough (no change).
- **Safety:** screens that still self-cap narrower (Home/Results/Inbox) are unaffected (their cap < frame). The only screen this _changes_ is Settings (currently uncapped/over-wide) — constraining it to the frame is the desired fix.
- **Opt-out:** layouts that want the full frame width (the two-pane Inbox, wide Results) simply set their own width to the frame; layouts that need true full-bleed can use an `.app-content--bleed` modifier. Document this.

### 4.3 Width-token scale

- Define a small canonical scale (CSS custom properties in `globals.css`), e.g. `--content-max` (frame), and reconcile the existing ad-hoc ceilings (`--content-width` 42rem, `--col`/`--col-wide`, `.page-width` 74rem, `.dashboard-frame` 76–88rem) toward it. PR1 introduces the token + frame; later PRs migrate screens onto it. Do **not** mass-rewrite all 16 `max-w-[80rem]` sites in PR1 — migrate opportunistically per screen.

### 4.4 Reusable layout primitives

- **Main+rail grid:** promote the orphaned `.dashboard-content-grid` / `.dashboard-rail` (`globals.css:354-393`) into a documented primitive that engages at `lg` (currently 1440) → retune to 1024. Used by Home (and available to Results).
- **Desktop sidebar:** generalize the `settings-layout.tsx:34-58` pattern (`hidden lg:block w-[var] shrink-0` aside + `flex-1 min-w-0` content + active-link `cn()` idiom) into a shell-level app sidebar primitive consumed by PR2.

## 5. Desktop Navigation — Persistent Left Sidebar (PR2)

- **≥1024px:** a persistent left sidebar rendered in the shell. It lists the full destination set assembled from existing sources — `primary-nav.tsx` ITEMS (Home/Inbox/Results) + `tools-overflow.tsx` TOOLS_NAV_ITEMS (Pipeline/Automations/Reports/Mira/Settings) — preserving the existing feature gates (`useMiraEnabled`, `isMercuryToolLive`) and `isActive()` logic. Visual idiom mirrors `settings-layout` (lucide icons, active-link styling, section divider between primary and secondary groups).
- The top header at ≥1024px demotes to a **slim utility strip**: brand · `LiveSignalPopover` · `HaltButtonClient` · `AccountMenu`. `PrimaryNav` and `ToolsOverflow` are hidden at `lg` (their destinations now live in the sidebar) and remain as-is below `lg`.
- **<1024px:** unchanged — current top bar (`PrimaryNav` un-fixing bottom bar) + `ToolsOverflow`.
- Layout: sidebar + content become a 2-column grid inside the content frame at `lg`. The `InboxDrawer` quick-peek trigger and other header actions stay in the top utility strip at `lg` (the sidebar's "Inbox" link is full navigation; the drawer is a from-anywhere peek — both kept, no functionality removed).

## 6. Home — Bento Grid (PR3)

- **≥1024px:** transform the single `styles.column` stack (`home/home-page.tsx:287`, `home.module.css`) into a bento:
  - Verdict hero spans full content width (row 1).
  - Row 2 is the main+rail grid. To keep mobile byte-identical (the bento containers are `display:contents` below lg), the split follows **contiguous slices of the existing module order**: **main column** = the next 2–3 active modules after the hero (active: Needs You, Team Pulse, This Week; calm: This Week, Team Pulse); **status rail** (~320px) = the quiet remainder (While You Slept, Work In Progress, Permissions).
- Implemented with the revived grid primitive. Drop the 640px cap at `lg` (`home.module.css:21`). Module components are reused unchanged; only their container reflows.
- **<1024px:** unchanged single column (Needs-You-first ordering preserved).

## 7. Inbox — Master-Detail Two-Pane (PR4)

- **≥1024px:** convert the fixed overlay into co-resident panes. `.inbox-page` becomes a 2-column grid (list left, detail right); `.sheet` is un-`fixed` and docked into the right column; `.scrim` is suppressed. List stays visible and the selected row is highlighted.
- Selection already drives `open` state (`inbox-screen.tsx`), so **no state-model change** — detail/approval/handoff components render in the docked pane unchanged. Empty state (nothing selected) shows a placeholder in the right pane.
- **<1024px:** unchanged overlay + scrim behavior.

## 8. Results — Widen + Dashboard Grid (PR5)

- **≥1024px:** lift the 640px cap (`results.module.css:1258`); arrange KPIs as a responsive grid (not a vertical flex stack), funnel beside its breakdown, porting the Reports `--max-w` + collapsing-grid idiom. The campaigns table (already has a `matchMedia(1024px)` branch in `results-page.tsx:63-73`) now renders inside freed width instead of a 640px scroll box.
- **Cross-cutting, folded into this PR:**
  - `components/ui/sheet.tsx:39-40`: add desktop widths (`lg:max-w-md xl:max-w-lg`) so right/left drawers aren't 384px on desktop.
  - Agent-panel drill-in (`agent-panel.tsx`): at ≥1024px render as a right side-panel rather than a bottom near-fullscreen sheet (it already takes plain `open/onOpenChange`; host owns state).
- **<1024px:** unchanged.

## 9. PR Sequence

| PR  | Title                                                                                             | Depends on | Mobile-safe    |
| --- | ------------------------------------------------------------------------------------------------- | ---------- | -------------- |
| 1   | Foundation: `lg` breakpoint, shell content frame, width tokens, revived grid + sidebar primitives | —          | yes (additive) |
| 2   | Desktop nav: persistent left sidebar + utility strip                                              | PR1        | yes            |
| 3   | Home: bento grid + status rail                                                                    | PR1        | yes            |
| 4   | Inbox: master-detail two-pane                                                                     | PR1        | yes            |
| 5   | Results: widen + dashboard grid + Sheet/agent-panel desktop widths                                | PR1        | yes            |

PRs 2–5 are independent of each other (all depend only on PR1), so they can be built/reviewed in parallel after PR1 lands.

## 10. Testing & Verification

- **No mobile regression (primary guarantee):** because all rules are gated ≥1024px, existing rendering <1024px is unchanged. Spot-verify at 390px and 768px that nothing moved.
- **Visual verification** at 1024 / 1440 / 1920 using the project's headless approach (playwright-core + system Chrome from a scratch dir; Read the PNG — per `reference_dashboard_visual_verification`). Capture before/after per screen.
- **Component tests** where logic (not just CSS) changes:
  - Desktop sidebar renders the correct destination set and honors `useMiraEnabled`/`isMercuryToolLive` gates and `isActive()`.
  - Inbox: selecting a row shows detail in the docked pane; empty state shows placeholder.
- **Existing suite stays green**; `pnpm --filter @switchboard/dashboard build` (Next build — not in CI) run locally per the known gotcha; `pnpm lint` / `format:check` before each PR.

## 11. Risks & Mitigations

| Risk                                                               | Mitigation                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Shell content frame unintentionally constrains a full-bleed screen | Frame is generous (~1280px) + `--bleed` opt-out modifier; verify each route visually at PR1.            |
| Sidebar duplicates nav source-of-truth (drift vs top bar)          | Sidebar consumes the _same_ ITEMS/TOOLS_NAV_ITEMS arrays + gates; no copies.                            |
| Two-pane Inbox breaks the existing overlay on a hidden edge case   | Gate strictly at `lg`; mobile overlay path untouched; keep selection state model identical.             |
| CSS-module 768px rules interact badly with new 1024px rules        | New rules only add; never edit the 768px blocks. Cascade verified per screen.                           |
| `next build` / dashboard coverage thresholds (40/35/40/40)         | Run local Next build + targeted tests before each PR; CSS-heavy PRs add tests only where logic changes. |

## 12. Out-of-scope follow-ups (noted, not built)

- Migrating all 16 `max-w-[80rem]` sites onto the width token.
- Responsive `clamp()` type scale (only partially present).
- Container queries (none today).
- Operator/Mercury legacy screens beyond Results.
