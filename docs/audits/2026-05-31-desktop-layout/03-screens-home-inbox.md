# Desktop Layout Audit — Home & Inbox Screens

**Date:** 2026-05-31
**Scope:** The Home screen (`/`) and Inbox screen (`/inbox`) of `apps/dashboard`. Focus strictly on these two screens' internal layout. The global shell/nav-chrome, max-content-width, Results/Reports, and design tokens are owned by other auditors and only referenced here for context.
**Method:** Read-only static read of the route entries, screen components, and their CSS.

---

## Executive summary (the single highest-impact reflow per screen)

- **Home** renders as ONE centered vertical column capped at `max-width: 640px` (`home.module.css:20-24`). Every one of the 6 modules is full-width and stacked top-to-bottom via `flex-direction: column` (`home.module.css:12-18`). **There is no `grid` anywhere at the page level and no breakpoint above 768px** — so on a 1440px desktop the content sits in a 640px ribbon with ~800px (≈56%) of empty cream gutters. Highest-impact fix: introduce a desktop (`≥1024px`) **bento/two-column grid beneath a full-width verdict hero** — pair the small quiet modules (Team Pulse, While You Slept, Work in Progress, Permissions) into a secondary column while This Week + Needs You take the primary column.
- **Inbox** is a single centered list column capped at `max-width: 720px` (`inbox-design-base.css:168-170`). Selecting a row does NOT open an inline pane — it slides in a `position: fixed` 480px right-rail OVERLAY (`.sheet`, `inbox-design-base.css:97-113`) on top of a dimming `.scrim` (`inbox-design-base.css:147-164`). The list underneath does not reflow. Highest-impact fix: on desktop, convert the fixed-overlay sheet into a **true master-detail two-pane layout** — list pinned left, the already-built detail sheet content docked as a persistent right pane (not an overlay) — using the horizontal space the page already wastes.

Both screens share the same root cause: **the ONLY responsive breakpoint either screen uses is `@media (min-width: 768px)`** (confirmed by enumerating every `@media` rule in all four CSS files — see Facts §0). Above 768px nothing changes; the "tablet" layout is stretched/centered through every desktop width.

---

# Home — Current Layout & Desktop Opportunities

## FACTS — route & component wiring

- Route entry: `apps/dashboard/src/app/(auth)/page.tsx:7-15` renders `<HomePage initialAgent={…} />`. Home is the index of the `(auth)` route group.
- Shared auth shell: `apps/dashboard/src/app/(auth)/layout.tsx:20` wraps children in `<AppShell>`, which (for non-onboarding/operator routes) mounts `EditorialAuthShellInner`. That shell renders a bare **`<main>{children}</main>`** with NO width class — `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:46`. There is no `main { max-width }` rule in `globals.css` (the only `max-width: 1280px` is on `.app-header-row`, `globals.css:489-490`, i.e. the header, not the content). **So `<main>` is full viewport width; the only thing constraining Home's width is the screen's own `.column`.**
- Screen component: `apps/dashboard/src/components/home/home-page.tsx`. It builds an array `modules` and renders them inside one container: **`<div className={styles.column}>{modules}</div>`** — `home-page.tsx:287`.

## FACTS — the column container (the cap)

`home.module.css:11-26`:

```css
.column {
  width: 100%;
  padding: 4px 18px 28px;
  display: flex;
  flex-direction: column; /* ← single vertical stack */
  gap: 22px;
}
@media (min-width: 768px) {
  .column {
    max-width: 640px; /* ← hard cap; never grows past 640 on desktop */
    margin: 0 auto; /* ← centered → symmetric empty gutters */
    padding: 28px 32px 40px;
    gap: 28px;
  }
}
```

- This is the **only** layout container for Home. It is `display: flex; flex-direction: column` — a literal single-column stack. There is no `grid`, no `grid-template-columns`, no `flex-wrap`, and no `lg:`/`xl:` Tailwind variant anywhere in the Home component tree (verified by grep — see §0).
- The `640px` cap applies from 768px upward with no further breakpoint, so at 1024 / 1280 / 1440 / 1920px the content is identical: a 640px ribbon centered in a sea of `--ambient-cream`.

## FACTS — the modules in the stack

`home-page.tsx:224-283` wraps each module in a `HomeModuleBoundary` and pushes it onto `modules`. Two orderings (`home-page.tsx:266-283`):

- **ACTIVE** (decisions present): Verdict → NeedsYou → TeamPulse → ThisWeek → WhileYouSlept → WorkInProgress → Permissions
- **CALM** (`isCalm`, feed live & zero decisions, `home-page.tsx:222`): Verdict → ThisWeek (promoted) → TeamPulse → WhileYouSlept → WorkInProgress → Permissions (NeedsYou omitted when empty)

Module-by-module shape & natural desktop footprint:

| Module                   | File                                          | Shape                                                                                                                                                                            | Natural width need                                                                                                            |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Verdict** (hero)       | `verdict.tsx` + `home.module.css:31-131`      | Eyebrow + big serif line (`font-size: 48px` at ≥768, `.line` `home.module.css:73-79`) + proof line. `max-width: 26ch` on the line.                                               | Wants to be **wide / full-bleed** — it's the one sentence that earns the screen.                                              |
| **NeedsYou**             | `needs-you.tsx`                               | Section header + up to **2** decision cards (`needs-you.tsx:35` `slice(0,2)`) + "See all in Inbox" link.                                                                         | Cards are content-rich; primary-column width. The 2 cards could even sit **side-by-side**.                                    |
| **ThisWeek** (week-note) | `this-week.tsx` + `this-week.module.css`      | A warm "employee email" card — drop-cap prose, signoff, "Read full report" link.                                                                                                 | Reads best as a **single readable measure** (~600px); good primary-column anchor.                                             |
| **TeamPulse**            | `team-pulse.tsx` + `home.module.css:204-297`  | A horizontal **chip ribbon** (3 agent chips), `overflow-x: auto` on mobile, un-scrolled at ≥768 (`home.module.css:215-220`).                                                     | Tiny height; 3 chips ≈ <500px. **Huge wasted width** as a full row — ideal secondary-column or could move into the hero band. |
| **WhileYouSlept**        | `while-you-slept.tsx`                         | Quiet list, ≤3 rows (`MAX_ROWS = 3`), or "All quiet overnight."                                                                                                                  | Short; secondary-column candidate.                                                                                            |
| **WorkInProgress**       | `work-in-progress.tsx`                        | Quiet list; currently **always empty** — `workInProgressItems: WorkInProgressItem[] = []` is hardcoded (`home-page.tsx:198`), so it renders only "No active handoffs right now." | Near-zero content today; pairs trivially beside another quiet module.                                                         |
| **Permissions**          | `permissions.tsx` + `home.module.css:383-415` | A single quiet line + "Adjust" link (`.permsline`).                                                                                                                              | One line; **maximally wasteful** as a full-width row — natural footer or secondary-column tail.                               |

Note the internal `display: grid` at `home.module.css:319-320` (`grid-template-columns: 14px 1fr auto`) is the **micro-layout of a single quiet-list ROW** (stripe / text / time), NOT a page-level grid. It does not reflow the modules.

## OPPORTUNITIES — Home desktop reflow

1. **Add a `≥1024px` breakpoint to `.column` and switch it to a grid (the core fix).** Today `.column` stops responding at 768px. A desktop tier could turn it into a **bento / two-column grid** (e.g. `display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); max-width: ~1120px`) so the 640px ribbon expands to use the space `<main>` already provides.
2. **Full-width verdict hero, modules in columns beneath.** The Verdict (`home.module.css:31-131`, 48px serif line) is the natural full-bleed banner. Span it across the grid (`grid-column: 1 / -1`), then flow the rest into two columns under it.
3. **Pairing that works side-by-side (concrete):**
   - **Primary column (reading):** ThisWeek (week-note) + NeedsYou decision cards — the content-heavy, decision-driving modules.
   - **Secondary column (status rail):** TeamPulse chips + WhileYouSlept + WorkInProgress + Permissions — all short, low-content modules that currently each eat a full 640px-wide row for a few chips / one line. Stacking them in a narrower right rail removes the worst of the wasted width.
4. **NeedsYou cards 2-up.** `needs-you.tsx` caps at 2 cards in `.needsSection` (`home.module.css:302-306`, currently `flex-direction: column`). On desktop these two could sit side-by-side, making the "needs you" band scannable in one row.
5. **TeamPulse is the clearest single waste.** A 3-chip ribbon (~450px of content) currently occupies a full module row. Moving it into the hero band (right of the verdict) or the top of the secondary column reclaims an entire row of vertical space and most of its horizontal space.
6. **Keep mobile intact.** All of the above belongs behind a new `@media (min-width: 1024px)` (or `lg:` if porting to Tailwind utilities) block; the existing `<768` flex-column stack and the `768px` tablet rules stay exactly as-is so mobile does not regress.

---

# Inbox — Current Layout & Master-Detail Opportunity

## FACTS — route & component wiring

- Route entry: `apps/dashboard/src/app/(auth)/inbox/page.tsx:1-6` → `<InboxScreen />`.
- Screen component: `apps/dashboard/src/components/inbox/inbox-screen.tsx`. It imports two stylesheets at the top: `./inbox-design-base.css` and `./inbox.css` (`inbox-screen.tsx:24-25`).
- Render tree (`inbox-screen.tsx:187-245`):
  - `<div className="inbox-page">` (root)
  - `<header className="inbox-pagehead">` — `<h1>inbox</h1>` + count line
  - `<InboxFilterRow …>` — agent filter chips
  - `<div className="inbox-queue">` — the list; `.map()` of `<InboxDecisionItem>` rows (`inbox-screen.tsx:205-214`)
  - **Detail layer (overlay):** a `.scrim` div + conditionally a `<ApprovalDetailSheet>` or `<HandoffDetailSheet>` (`inbox-screen.tsx:217-226`)
  - Plus the `<AgentPanel>` (a separate Radix sheet, opened from a card avatar).

## FACTS — selection behavior (this is the crux)

- Selection state: `const [open, setOpen] = useState<{ decision; kind } | null>(null)` (`inbox-screen.tsx:149`).
- A row opens detail via `onOpenDetail={(dec) => setOpen({ decision: dec, kind: dec.kind })}` (`inbox-screen.tsx:210`). "Take over" on a handoff also routes to the same `onOpenDetail` (`inbox-decision-item.tsx:69`).
- When `open` is set, the screen renders **a fixed-position OVERLAY sheet, not an inline pane**:
  - `inbox-screen.tsx:218-220`: `<div className="scrim" data-open="true" … onClick={() => setOpen(null)} />`
  - `inbox-screen.tsx:221-226`: `<ApprovalDetailItem …>` / `<HandoffDetailItem …>` (each renders a `<… DetailSheet>` carrying the `.sheet.ds` class).
- The list (`.inbox-queue`) is **not** restructured or narrowed when a detail opens — the sheet floats above it and the scrim dims it. Esc closes (`inbox-screen.tsx:153-160`).

So the current pattern is: **single list column → tap row → slide-in overlay sheet over a dimmed page.** Classic mobile bottom-sheet, reused as a right-rail on desktop, but still an **overlay**, never a co-resident second pane.

## FACTS — the width cap and the sheet docking

`inbox-design-base.css:166-172` (page column):

```css
/* Center the inbox as a readable column (the design's phone-frame shell that
   constrained width isn't present in the real app). */
.inbox-page {
  max-width: 720px;      /* ← hard cap */
  margin-inline: auto;   /* ← centered → empty gutters on desktop */
  padding-left: 20px;
  padding-right: 20px;
  …
}
```

`.inbox-page` itself is `display: flex; flex-direction: column` (`inbox.css:14-19`). `.inbox-queue` is `display: flex; flex-direction: column; gap: 10px` (`inbox.css:156-160`) — a single stacked list.

The base sheet (`inbox-design-base.css:77-113`) — **note it is `position: fixed`**:

```css
.sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;     /* mobile: full-width bottom sheet */
  z-index: 60;
  transform: translateY(100%);       /* slides up */
  …
}
.sheet[data-open="true"] { transform: translateY(0); }

@media (min-width: 768px) {
  .sheet {
    left: auto; right: 0; top: 0; bottom: 0;
    width: 480px;                    /* desktop: 480px right rail */
    border-left: 1px solid var(--hair);
    transform: translateX(100%);     /* slides in from the right */
    box-shadow: -20px 0 40px rgba(40, 30, 20, 0.1);
  }
  .sheet[data-open="true"] { transform: translateX(0); }
}
```

The authoring comment is explicit (`inbox.css:487-491`): _"DETAIL SHEET (.ds) … Full-screen slide-up on phone (rides existing .sheet), docked right-rail on desktop (also from .sheet)."_ And `inbox-design-base.css:74-76`: _"The app has no `.app[data-layout]` shell, so we dock via position:fixed + a media query."_

The scrim that backs it (`inbox-design-base.css:147-164`) is also `position: fixed; inset: 0; z-index: 55` and on desktop merely lightens (`rgba(20,18,14,0.18)`) — i.e. the page behind is dimmed, not laid out beside the sheet.

## FACTS — what's wasted on desktop

- `.inbox-page` is 720px centered, so at 1440px the list ribbon leaves ~720px (≈50%) of empty cream.
- When a detail opens, the **fixed** 480px sheet floats over the right edge of the viewport, overlapping/ignoring the centered 720px list rather than sitting next to it. There is no layout in which list + detail coexist as two columns; the sheet is always an overlay (z-60) above the list with a scrim (z-55) between.
- Internal `display: grid` usages in `inbox.css` (`:743-744` `1fr auto 1fr`, `:783-784` `1fr 1fr`) and the many `flex-wrap: wrap` (`:322,:457,:587,:611,:811,…`) are all **inside the detail sheet body** (stat rows, chip rows) — they do not create a page-level master-detail layout.

## OPPORTUNITIES — Inbox desktop master-detail

1. **Convert overlay → true two-pane master-detail on `≥1024px` (the core fix).** The bones are already here: a list (`.inbox-queue`) and a fully-built detail panel (`.sheet.ds` content — `ApprovalDetailSheet` / `HandoffDetailSheet`). On desktop, lay them out as **list left, detail right, side-by-side** instead of detail-as-overlay. Concretely: give `.inbox-page` a desktop grid (e.g. `display: grid; grid-template-columns: minmax(360px, 480px) 1fr` and raise/remove the `max-width: 720px` cap at that breakpoint) and **un-fix the sheet** at `≥1024px` (`position: static`/`sticky` inside the second grid column, drop `transform`, drop the scrim) so it becomes a persistent right pane.
2. **Keep selection state; it already supports this.** `open` (`inbox-screen.tsx:149`) is exactly the "selected item" a master-detail needs. No state-model change is required — only the presentation of `open` changes from "fixed overlay + scrim" to "right pane." When `open` is null on desktop, show a quiet empty/placeholder pane ("Select a decision") instead of nothing.
3. **Selected-row affordance.** In two-pane mode the tapped `.decision` row should get a `data-selected`/active style (highlight, retain agent stripe) so the list reflects which item the right pane shows — today there is no selected-row styling because the row is always dimmed behind a scrim.
4. **Drop the scrim and Esc-to-close-only semantics on desktop.** The `.scrim` (`inbox-design-base.css:147-164`) and click-scrim-to-close (`inbox-screen.tsx:218-220`) are overlay semantics; in a persistent two-pane they should be suppressed at `≥1024px` (Esc / explicit close button still fine).
5. **Reuse, don't rebuild.** The detail content components (`approval-detail-sheet.tsx`, `handoff-detail-sheet.tsx`) and their `.ds-*` styles are presentational and can render unchanged inside a docked pane — only the OUTER `.sheet` positioning rules (`inbox-design-base.css:97-113`) need a `≥1024px` override.
6. **Preserve mobile + tablet.** Mobile (<768) keeps the bottom-sheet; 768–1023 can keep today's slide-in right rail overlay. The two-pane is purely additive at the desktop tier, so mobile does not regress.
7. **Optional, lower priority:** the agent-filter chip row (`InboxFilterRow`) and `.inbox-pagehead` masthead can stay above the list column, or move to span the full grid width as a header band.

---

## §0 — Cross-cutting facts (verification of the negatives)

- **Single breakpoint only.** Enumerating every `@media (min-width: …)` across `home.module.css`, `this-week.module.css`, `inbox.css`, `inbox-design-base.css`, `inbox-decision-card.css` yields **only `768px`** (multiple occurrences) — there is no `1024px`/`1280px`/`1440px` rule for either screen. Above 768px both screens are frozen at their tablet layout.
- **No page-level grid / no responsive grid utilities.** No `display: grid` at the module/screen container level (the only grids are intra-row/intra-card micro-layouts: `home.module.css:319`, `inbox.css:743`/`:783`). No `grid-cols-*`, `lg:`, `xl:`, `2xl:`, or `columns-*` Tailwind classes appear in any Home or Inbox component (verified by grep). All `flex-wrap: wrap` hits are inside the Inbox detail-sheet body.
- **Width caps live in the screens, not the shell.** `<main>` (`editorial-auth-shell.tsx:46`) has no width rule; `globals.css`'s `max-width: 1280px` is on `.app-header-row` (header) only. The effective content caps are **Home `.column` 640px** (`home.module.css:20`) and **Inbox `.inbox-page` 720px** (`inbox-design-base.css:169`). These are the levers to raise/replace for the desktop overhaul.

## Key files (absolute paths)

Home:

- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/app/(auth)/page.tsx`
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/home/home-page.tsx`
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/home/home.module.css`
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/home/this-week.module.css`
- Module components: `verdict.tsx`, `needs-you.tsx`, `this-week.tsx`, `team-pulse.tsx`, `while-you-slept.tsx`, `work-in-progress.tsx`, `permissions.tsx` (same `home/` dir)

Inbox:

- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/app/(auth)/inbox/page.tsx`
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/inbox/inbox-screen.tsx`
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/inbox/inbox-design-base.css` (`.sheet`, `.scrim`, `.inbox-page` cap)
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/inbox/inbox.css` (`.inbox-queue`, `.sheet.ds`)
- Detail components: `approval-detail-sheet.tsx`, `handoff-detail-sheet.tsx`, `inbox-decision-item.tsx`, `inbox-decision-card.tsx`

Shell context (owned by other auditors, referenced only):

- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/components/layout/editorial-auth-shell.tsx:46` (`<main>` has no width cap)
- `/Users/jasonli/switchboard/.claude/worktrees/desktop-layout-overhaul/apps/dashboard/src/app/globals.css:489-490` (`.app-header-row` 1280px — header only)
