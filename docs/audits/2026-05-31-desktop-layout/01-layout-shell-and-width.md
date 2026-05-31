# Desktop Layout Audit — 01: Global Layout Shell & Content-Width Strategy

**Scope:** Global layout shell + content-width strategy ONLY (nav internals, individual screen bodies, and design tokens are out of scope / other auditors).
**Date:** 2026-05-31
**App:** `apps/dashboard` (Next.js 14 App Router, Tailwind, raw-HSL-triplet tokens)
**Method:** READ-ONLY static read of layouts, shell components, `globals.css`, CSS modules, and `tailwind.config.ts`. No source edited.

---

## TL;DR

- The authed app renders inside ONE shared shell (`EditorialAuthShellInner`) whose `<main>` element is **completely unstyled** — full-bleed, no `max-width`, no padding (`editorial-auth-shell.tsx:46`). Every screen self-imposes its own width.
- There is **no shared "page container"** for authed screens. Width is fragmented across CSS modules and global classes: **Home 640px, Results 640px, Inbox 720px, Settings edge-to-edge.**
- On a **1440px desktop**, the Home and Results content is a **single 640px column centered with ~720px of empty side gutters** (~50% of the viewport is whitespace). This is the "stretched mobile" complaint, quantified.
- The ONLY desktop-aware multi-column layout in the codebase (`.dashboard-frame` / `.dashboard-content-grid` / `.dashboard-rail`, 1408px + 1fr/320px grid at ≥1440px) is **dead code — zero consumers** in any `.tsx`.
- **There are ZERO `@media (min-width: 1024px)` rules in the entire dashboard CSS.** The real desktop breakpoint (`lg`) is unused; the app tops out at the 768px (`md`, "tablet") breakpoint.
- **Single best insertion point:** `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:46` — wrap `<main>` (or introduce a shell-owned content frame here) so a desktop paradigm can be introduced in ONE place for all authed routes.

---

## 1. Shell Hierarchy (root → content, with `file:line`)

### 1.1 Route-group / layout tree

```
RootLayout                          app/layout.tsx:82
 └─ <html class="<7 font vars>">     app/layout.tsx:84-88   (no width/layout classes)
     └─ <body class={inter}>          app/layout.tsx:89      (no width/layout classes)
         └─ QueryProvider             app/layout.tsx:90
             └─ {children}  ── route-group layouts below ──

  ┌─ (auth) group ──────────────────────────────────────────────
  AuthLayout (server)                 app/(auth)/layout.tsx:11
   └─ AuthProvider                    app/(auth)/layout.tsx:17
       └─ DataModeProvider            app/(auth)/layout.tsx:18
           └─ ErrorBoundary           app/(auth)/layout.tsx:19
               └─ AppShell  ◀── client router/gate, NOT the width owner
                                       components/layout/app-shell.tsx:53
                  ├─ (chromeFree: /onboarding,/operator)  app-shell.tsx:35,83-91
                  │     → renders {children} full-bleed, no header/main
                  └─ (default authed)                     app-shell.tsx:97-105
                        └─ EditorialShellBoundary          editorial-shell-boundary.tsx:9
                            └─ EditorialAuthShellInner  ◀━━ THE SHARED SHELL
                                       editorial-auth-shell.tsx:22
                                ├─ <header class="app-header">    :28
                                │    └─ <div class="app-header-row"> :29  (max-width 1280px)
                                │         ├─ .brand-cluster (brand + PrimaryNav) :30
                                │         └─ .header-actions (signals/inbox/halt/account) :37
                                └─ <main>{children}</main>  ◀━━ UNSTYLED, FULL-BLEED  :46
                                     └─ (per-screen wrappers, see §2/§3)

      ┌─ (auth)/settings sub-layout ─────────────────────────
      SettingsRouteLayout              app/(auth)/settings/layout.tsx:3
       └─ SettingsLayout               components/layout/settings-layout.tsx:27
           └─ <div class="flex gap-10 min-h-[calc(100vh-120px)]">  :34
               ├─ <aside class="hidden md:block w-[200px] shrink-0">  :35  (200px nav)
               └─ <div class="flex-1 min-w-0">{children}</div>        :60  (fills rest)
           (NO max-width cap → fills the full-bleed <main> edge to edge)

  ┌─ (public) group (marketing/legal — NOT the app) ───────────
  PublicLayout                         app/(public)/layout.tsx:23
   └─ <div class="light min-h-screen flex flex-col">  :25
       └─ <main class="flex-1">{children}</main>        :26
       (marketing pages use the .page-width 1184px class internally)
```

### 1.2 What each shell layer contributes to WIDTH

| Layer                                | File:line                        | Width contribution                                                                                       |
| ------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `<html>` / `<body>`                  | `app/layout.tsx:84,89`           | none (fonts + bg only)                                                                                   |
| `AppShell`                           | `app-shell.tsx:53`               | none — pure routing/onboarding gate                                                                      |
| `EditorialShellBoundary`             | `editorial-shell-boundary.tsx:9` | none — error boundary only                                                                               |
| `EditorialAuthShellInner` `<header>` | `editorial-auth-shell.tsx:28`    | `.app-header` full-bleed bar; inner `.app-header-row` capped **1280px** centered (`globals.css:489-491`) |
| `EditorialAuthShellInner` `<main>`   | `editorial-auth-shell.tsx:46`    | **NONE — no class, no `main {}` rule exists in globals.css.** Children control their own width.          |
| Per-screen wrapper                   | see §2                           | the ACTUAL content cap (640 / 720 / none)                                                                |

**Key architectural fact:** the shell delegates 100% of content-width responsibility to each screen. The header is the only shell element with a `max-width` (1280px), and the body content is NOT aligned to it.

---

## 2. Width Strategy (FACTS — exact values)

### 2.1 Width tokens (`globals.css` `:root`)

| Token             | Value    | px         | Where defined     | Consumers                 |
| ----------------- | -------- | ---------- | ----------------- | ------------------------- |
| `--content-width` | `42rem`  | **672px**  | `globals.css:130` | `.content-width` (3 uses) |
| `--col`           | `640px`  | **640px**  | `globals.css:200` | `.measure-prose` (1 use)  |
| `--col-wide`      | `1080px` | **1080px** | `globals.css:201` | `.page` / `.page-wide`    |

> `tailwind.config.ts` has **no `screens`, no `maxWidth`, no `container` override** (whole file read). Default Tailwind applies: `lg=1024px`, `xl=1280px`, `2xl=1536px`; `max-w-md=448px`, `lg=512px`, `xl=576px`, `2xl=672px`.

### 2.2 Global width-utility classes (`@layer components` in `globals.css`)

| Class                                 | max-width                          | Centered        | Used by authed app?                      | `file:line`           |
| ------------------------------------- | ---------------------------------- | --------------- | ---------------------------------------- | --------------------- |
| `.content-width`                      | 672px (`--content-width`)          | yes (`mx auto`) | rare (3)                                 | `globals.css:316-322` |
| `.page` / `.page-wide`                | **1080px** (`--col-wide`)          | yes             | **NO authed-screen consumers** (grep: 0) | `globals.css:619-637` |
| `.page-width`                         | 1184px (74rem)                     | yes             | marketing/landing only                   | `globals.css:324-330` |
| `.dashboard-frame`                    | 1216px (76rem); **1408px ≥1440px** | yes             | **DEAD — 0 consumers**                   | `globals.css:333-352` |
| `.dashboard-content-grid`             | grid `1fr / 320px` ≥1440px         | —               | **DEAD — 0 consumers**                   | `globals.css:354-367` |
| `.dashboard-rail` / `.dashboard-main` | sticky right rail                  | —               | **DEAD — 0 consumers**                   | `globals.css:369-393` |
| `.measure-prose`                      | 640px (`--col`)                    | yes             | 1                                        | `globals.css:638-643` |
| `.app-header-row`                     | 1280px                             | yes             | shell header only                        | `globals.css:489-491` |

### 2.3 Per-screen actual content caps (what users see)

| Screen                   | Outer wrapper                                | Source                                                       | Desktop max-width                             | Centered                   |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- | -------------------------- |
| **Home** (`/`)           | `styles.column`                              | `home-page.tsx:287` → `home.module.css:12,19-26`             | **640px** (only ≥768px)                       | yes (`margin:0 auto`)      |
| **Results** (`/results`) | `styles.column`                              | `results-page.tsx:116` → `results.module.css:1250,1258-1265` | **640px** (only ≥768px)                       | yes                        |
| **Inbox** (`/inbox`)     | `.inbox-page`                                | `inbox-screen.tsx:188` → `inbox-design-base.css:168-173`     | **720px**                                     | yes (`margin-inline:auto`) |
| **Mira** (`/mira`)       | inline-style flex `100dvh`, `#000` bg        | `mira-feed-page.tsx:31-39`                                   | full-bleed custom (ignores shell)             | n/a                        |
| **Settings/\***          | `flex gap-10` + `w-[200px]` aside + `flex-1` | `settings-layout.tsx:34-35,60`                               | **no cap → fills bare `<main>` edge-to-edge** | no                         |

**Breakpoint reality check (CSS-wide grep):**

- `@media (min-width: 768px)` → **39 rules** (the de-facto "desktop" breakpoint everything stops at)
- `@media (min-width: 1280px)` → **18 rules** (typography / header padding bumps, NOT content widening)
- `@media (min-width: 1440px)` → **4 rules** (ALL belong to the dead `.dashboard-*` classes)
- `@media (min-width: 1024px)` → **0 rules** — the true `lg` desktop breakpoint is entirely unused in CSS.

> Note: a handful of TSX files use Tailwind `lg:grid-cols-3` (e.g. `settings/team/page.tsx:155,193`, `settings/connections-list.tsx:157,169`) — those are the only places `lg` desktop layout exists, and only inside already-narrow Settings bodies.

---

## 3. The Desktop Problem (QUANTIFIED)

**Yes — on a 1440px desktop the primary content is a single narrow column with huge empty gutters.**

Worked example at **1440px viewport** (the `--col`/`.column` = 640px case, i.e. Home & Results):

```
|<------------------------ 1440px viewport ------------------------>|
|                                                                    |
|<--- gutter ~400px --->|<-- content 640px (max) -->|<-- gutter ~400px -->|
|        EMPTY          |  Home / Results column    |       EMPTY         |
```

- Content column: **640px** (`home.module.css:21`, `results.module.css:1260`) minus 64px internal padding ⇒ ~**576px of usable content**.
- Total side gutters: `1440 − 640 = 800px` ⇒ **~55% of the viewport is empty whitespace** (~400px per side).
- Inbox is slightly better but the same shape: 720px column ⇒ `1440 − 720 = 720px` gutter ⇒ **50% empty**.
- The header content bar is capped at 1280px (`globals.css:490`) but the BODY caps at 640/720px, so the header and content **don't even share an alignment** — body content sits ~320px narrower than the header on each side.

At **1024px** (`lg` entry) the effect is already present: Home/Results = 640px content + `(1024−640)/2 ≈ 192px` gutters per side (37% empty); nothing in CSS responds to 1024px at all.

**Settings is the inverse failure:** with no `max-width` on the `flex` row (`settings-layout.tsx:34`), at 1440px it stretches the content `flex-1` region to ~1200px **edge-to-edge with no page padding and no gutters** — long unreadable line lengths. So the app is simultaneously too-narrow (Home/Results/Inbox) and too-wide (Settings) on desktop.

**Root cause:** the shell `<main>` (`editorial-auth-shell.tsx:46`) imposes no width contract, so each screen reuses its mobile-first single-column module unchanged; the editorial 640px "measure" that is correct on mobile/tablet is never re-laid-out for desktop, and the one desktop grid that was authored (`.dashboard-*`) was never wired up.

---

## 4. Best Insertion Point (single, highest-leverage)

### Primary: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:46`

```tsx
<main>{children}</main> // ← editorial-auth-shell.tsx:46  (currently zero styling)
```

This is the **one node every authed, chrome-bearing route passes through** (Home, Inbox, Results, Settings, Mira, all Mercury routes). It is mounted exactly once (`app-shell.tsx:101`). Introducing the desktop paradigm here — a shell-owned content frame / sidebar-vs-content grid / desktop `max-width` — changes desktop layout for the whole app in a single place, with no per-screen edits required for the baseline.

Supporting reasons:

- The width responsibility is _already_ the shell's to give — it just currently gives nothing.
- A class on `<main>` (e.g. an app-shell "content frame") can set a generous desktop `max-width` + responsive horizontal padding and align it to the existing 1280px header (`globals.css:490`) so header and body finally share a measure.
- It is the natural home for a **persistent left sidebar** on desktop: today nav lives in the top header (`PrimaryNav`, only 3 items). Converting the header `<header>`+`<main>` pair into a `[sidebar | main]` grid at `lg` would be a shell-local change here.

### Secondary (companion, not alternative):

- `globals.css` — the dead `.dashboard-frame` / `.dashboard-content-grid` / `.dashboard-rail` (`globals.css:333-393`) is a **ready-made desktop multi-column primitive** (1408px frame + `1fr/320px` grid + sticky rail at ≥1440px). It can be revived/renamed as the shell content frame instead of authoring a new one.
- Per-screen module caps (`home.module.css:21`, `results.module.css:1260`, `inbox-design-base.css:169`) are the **secondary** edit sites — needed only where a screen should opt into multi-column rather than just a wider single column. The 640px "reading measure" may be intentionally preserved for prose; desktop gains should come from adding columns/rails beside it, not just stretching it.

---

## 5. Opportunities (overhaul targets — NOT current behavior)

> Separated from facts above. These are options for the overhaul, with concrete anchors.

1. **Give the shell `<main>` a real content frame.** Add a shell-owned wrapper class at `editorial-auth-shell.tsx:46` with a desktop `max-width` (~1200–1408px) + responsive horizontal padding, aligned to the header's 1280px (`globals.css:490`). One change fixes the global "narrow column + giant gutters" for every screen and unifies header/body alignment. (FACT motivating it: `<main>` has zero styling today.)

2. **Revive the already-authored desktop grid instead of inventing one.** `.dashboard-frame` + `.dashboard-content-grid` + `.dashboard-rail` (`globals.css:333-393`) already implement a 1408px frame with a `1fr / 320px` two-column layout and sticky rail at ≥1440px, but have **zero consumers**. Wiring Home/Results into this (main column + contextual rail) directly reclaims the ~55% wasted gutter as a useful second column.

3. **Promote primary nav to a persistent desktop sidebar.** Today nav is 3 links in the top header (`primary-nav.tsx:5-9`, rendered at `editorial-auth-shell.tsx:36`). At `lg`+ a left rail (mirroring the proven `SettingsLayout` `w-[200px]` + `flex-1` pattern, `settings-layout.tsx:34-60`) converts wasted horizontal space into navigation and lets content use a wider centered measure. Insertion: restructure the `<header>`/`<main>` pair in `editorial-auth-shell.tsx:28-46`.

4. **Add real desktop breakpoints.** There are **zero `@media (min-width:1024px)`** rules and no `lg` content behavior; everything stops at 768px. Either add `screens`/`maxWidth` scales in `tailwind.config.ts` (currently bare) or `@media (min-width:1024px/1280px)` blocks to the per-screen module caps (`home.module.css:19`, `results.module.css:1258`, `inbox-design-base.css:168`) so the column widens / goes multi-column beyond tablet.

5. **Cap Settings line length.** `SettingsLayout` outer `flex` has no `max-width` (`settings-layout.tsx:34`), so content stretches edge-to-edge on wide screens. Add a `max-width` to the content region (or fold it into the new shell frame) to fix the opposite-extreme readability problem.

6. **Decide Mira's relationship to the desktop shell.** Mira (`mira-feed-page.tsx:31-39`) renders a bespoke `100dvh`, black-bg, full-bleed feed that ignores the shell width entirely — a desktop layout overhaul should explicitly choose whether Mira stays full-bleed (intentional vertical-feed UX) or adopts the shared frame, so it isn't an accidental exception.

---

## Appendix — Evidence index (verified `file:line`)

- Root: `app/layout.tsx:82-90` (no width classes)
- Auth layout → AppShell: `app/(auth)/layout.tsx:11-26`; `components/layout/app-shell.tsx:53,97-105`
- Shared shell `<main>` (UNSTYLED): `components/layout/editorial-auth-shell.tsx:22-51` (main at `:46`)
- Header cap 1280px: `globals.css:489-491`
- Width tokens: `--content-width` `globals.css:130`; `--col`/`--col-wide` `globals.css:200-201`
- `.page`/`.page-wide` (1080px, unused by app): `globals.css:619-637`
- Dead desktop grid (`.dashboard-frame`/`-content-grid`/`-rail`): `globals.css:333-393` (0 TSX consumers)
- Home column 640px: `home-page.tsx:287` → `home.module.css:12-26`
- Results column 640px: `results-page.tsx:116` → `results.module.css:1250-1265`
- Inbox 720px: `inbox-screen.tsx:188` → `inbox-design-base.css:168-173`
- Settings (no cap, 200px + flex-1): `settings-layout.tsx:34-35,60`
- Mira full-bleed custom: `mira-feed-page.tsx:31-39`
- Tailwind config (no screens/maxWidth/container override): `tailwind.config.ts` (whole file)
- Breakpoint counts (CSS-wide): `min-width:768px` ×39, `1280px` ×18, `1440px` ×4 (all dead `.dashboard-*`), `1024px` ×0
