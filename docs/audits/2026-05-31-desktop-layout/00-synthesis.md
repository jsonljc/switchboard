# Desktop Layout Audit — Synthesis

**Date:** 2026-05-31
**Branch:** `worktree-desktop-layout-overhaul`
**Scope:** `apps/dashboard` (Next.js 14 App Router) authed product surfaces
**Method:** 5 parallel read-only audits (see `01`–`05` in this folder); load-bearing claims re-verified by hand.

---

## The diagnosis in one sentence

The dashboard is **mobile-first and stops at the 768px (`md`) breakpoint** — there is essentially **no ≥1024px desktop tier** — so on a wide screen every product screen renders as a **single 640–720px column centered in a sea of empty gutters** (~55% of a 1440px viewport is whitespace), and navigation is a phone tab-bar that merely un-fixes into a row of text links.

## Verified evidence (hand-checked, not just agent-reported)

| Fact                                                                                                                                                                                           | Evidence                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| One shared authed shell; its `<main>` is **bare** (no width/padding/grid) — every screen self-imposes width                                                                                    | `components/layout/editorial-auth-shell.tsx:46` |
| Home content column capped at **640px** centered                                                                                                                                               | `components/home/home.module.css:21`            |
| Results content column capped at **640px** centered                                                                                                                                            | `components/results/results.module.css:1260`    |
| Inbox page capped at **720px** centered                                                                                                                                                        | `components/inbox/inbox-design-base.css:169`    |
| Inbox detail = `position:fixed` ~480px **overlay** over a scrim; list never reflows                                                                                                            | `inbox-design-base.css` `.sheet`/`.scrim`       |
| Header inner row capped at **1280px** — so the 640px body doesn't even align under the header                                                                                                  | `globals.css` `.app-header-row`                 |
| **No desktop tier**: `lg:` used **12×** total across `apps/dashboard/src`; `1024px` media query appears **once**; `2xl:` **0×**                                                                | census via ripgrep                              |
| Hand-rolled CSS "desktop" steps live at **768 / 1280 / 1440** while Tailwind `lg`=1024 — the two systems never switch at the same width                                                        | `tailwind.config.ts` has no `screens` override  |
| A complete desktop **main+rail grid exists as DEAD CODE** (zero consumers): `.dashboard-frame` / `.dashboard-content-grid` / `.dashboard-rail`, 76→88rem, `1fr / 320px` sticky rail at ≥1440px | `globals.css:332-393`                           |
| All sheets/drawers are mobile-width on desktop: shared `Sheet` caps at `w-3/4 sm:max-w-sm` (384px), no lg/xl                                                                                   | `components/ui/sheet.tsx:39-40`                 |

## Proven in-house patterns to REUSE (do not invent new)

1. **Persistent left sidebar** — already shipped & shippable: `components/layout/settings-layout.tsx:34-58` (`hidden md:block w-[200px] shrink-0` aside + `flex-1 min-w-0` content + active-link `cn()` idiom + mobile fallback). This is the template for desktop primary nav.
2. **Real desktop content layout ("gold standard")** — `app/(auth)/(mercury)/reports/reports.module.css`: a `--max-w` content frame with **collapsing grids** (`1fr 1fr`, `1fr 1fr 1.35fr`) and a table that falls back to mobile cards. This is the pattern to port to Results/Home.
3. **The dead `.dashboard-*` grid** (`globals.css:332-393`) — a ready-made main+rail desktop grid; revive instead of authoring new CSS.
4. **Nav data already exists** — `primary-nav.tsx` ITEMS + `isActive()`; `tools-overflow.tsx` TOOLS_NAV_ITEMS (Pipeline/Automations/Reports/Mira/Full-reports/Settings, with `useMiraEnabled`/`isMercuryToolLive` gates); `account-menu.tsx` (already viewport-agnostic). A desktop sidebar re-renders these, not rebuilds them.

## The single highest-leverage insertion point

`components/layout/editorial-auth-shell.tsx:46` — the lone `<main>` every authed, chrome-bearing route passes through, mounted exactly once. A shell-owned desktop layout (content frame + optional sidebar grid) fixes width app-wide in one place; per-screen work then handles internal reflow.

## Per-screen opportunities (from the domain audits)

- **Shell/Nav:** introduce a real `≥1024px` desktop tier — a persistent **left sidebar** surfacing the full destination set (today hidden behind "Tools ▾"); demote the top bar to a utility strip (brand · live-signal · halt · account). Reuse `settings-layout` pattern.
- **Home:** turn the 6-module single stack into a **bento/multi-column grid** — full-width verdict hero, then a primary column (week-note + Needs-You) beside a secondary **status rail** (Team Pulse + While-You-Slept + Work-In-Progress + Permissions). Lever: `home.module.css:20` + revive `.dashboard-content-grid`.
- **Inbox:** convert the fixed 480px overlay into a true **master-detail two-pane** (list left, detail docked right) at ≥1024px. The `open`/selected state already models this; only presentation changes. Lever: `inbox-design-base.css` `.sheet`/`.scrim` + `.inbox-page`.
- **Results:** lift the 640px cap at ≥1024px, add a **KPI grid** and side-by-side funnel/breakdown; port the Reports `--max-w` + collapsing-grid pattern. Lever: `results.module.css:1258`.
- **Sheets / agent panel:** add desktop widths to `Sheet` (`lg:max-w-md xl:max-w-lg`); on desktop render the agent-panel drill-in as a **right side-panel** (it takes plain `open/onOpenChange`, host owns state) rather than a bottom near-fullscreen sheet.

## Missing primitives the overhaul must establish first

1. **One canonical desktop breakpoint** (recommend `lg` = 1024) so Tailwind and CSS modules switch at the same width — set `theme.screens` in `tailwind.config.ts:7`.
2. **One canonical content-width scale** to replace the **8 competing ceilings** (640 / 720 / 74rem / 76–88rem / `max-w-[80rem]`×16 / …).
3. **A reusable responsive grid/bento primitive** (revive the orphaned `.dashboard-content-grid`).
4. **A desktop sidebar layout primitive** (generalize `settings-layout`).
5. **A responsive type scale** (replace per-component literal-px bumps; `clamp()` already proven in reports).

## Design decisions to resolve in brainstorming

1. **Scope / ambition:** transformative (sidebar nav + master-detail inbox + bento home + widened data screens) vs. incremental (widen columns + add grids only)? Which screens are in/out for v1?
2. **Desktop nav paradigm:** persistent left sidebar (recommended) vs. keep top bar and widen.
3. **Canonical desktop breakpoint & content width:** lg=1024? content max ~1184–1408px?
4. **Per-screen layout targets** (bento home, two-pane inbox, dashboard Results, side-panel sheets) — confirm or trim.
5. **Implementation strategy:** shell-level primitives + per-screen `@media(min-width:1024px)` in existing CSS modules; additive-only at ≥lg to guarantee zero mobile regression.
6. **Verification:** visual checks at 390 / 768 / 1024 / 1440 / 1920 viewports.
