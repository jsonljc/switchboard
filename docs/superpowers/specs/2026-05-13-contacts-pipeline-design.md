# `/contacts` → Opportunity Pipeline — Design Spec

_2026-05-13 · part of the wave-1 dashboard redesign track · Mercury Tools tier · sibling to `/activity`, `/approvals`, `/mission`, `/reports` rebuilds being authored in parallel_

> **Reading posture:** This spec rebuilds the existing `/contacts` list page as an **Opportunity-stage kanban board** ("Opportunity pipeline"), per the locked Claude Design mockup at `docs/design-prompts/locked/switchboard/project/agent-home-v3/Pipeline.html`. The mockup shares its package with Alex Home v2 and Riley Home v2 (wave 2); this spec deliberately does not pre-design those surfaces but flags shell-component decisions wave 2 will inherit. The decisions ledger in §2 is binding; subsequent sections describe what to build.

---

## 1. Problem & scope

### 1.0 One-line scope

Rebuild `/contacts` from a `Contact.stage` browse list into an `Opportunity.stage` kanban board with eight columns, drag-to-move with optimistic save, an in-page opportunity detail drawer, and a deep-link to the existing `/contacts/[id]` for contact context. Mercury register. Org-wide single board.

### 1.1 What this slice ships

- Full rebuild of `apps/dashboard/src/app/(auth)/(mercury)/contacts/page.tsx` and its component tree (board, column, card, filter strip, detail drawer, toast, page header). The detail route at `apps/dashboard/src/app/(auth)/(mercury)/contacts/[id]/` is **untouched** — Pipeline cards deep-link to it via the drawer's "Open contact →" button.
- New view-model schemas in `packages/schemas/src/pipeline-board.ts`: `PipelineBoardOpportunity` (a board-ready row joining `Opportunity` + minimal `Contact` projection) and `PipelineBoardResponse` (flat `{ rows }` envelope; no pagination — see §2 OPEN-11).
- New page-tier query hook `useOpportunitiesBoard()` (TanStack Query) replacing `useContactsList()`. New mutation hook `useOpportunityStageTransition()` with optimistic update + rollback.
- Fixture mode wired through the existing `NEXT_PUBLIC_CONTACTS_LIVE` gate. Off → the 20-card SGD-medspa fixture set from `pipeline-data.jsx` is rendered; drag-and-drop mutates local state only. On → the live endpoints are hit.
- Tests at three layers (schema parse, hook behavior including optimistic rollback, page composition + DnD).

### 1.2 What this slice does **not** ship

- **Backend endpoints.** This spec describes the **shape** the page needs (`GET /api/dashboard/opportunities` returning a `PipelineBoardResponse`; `PATCH /api/dashboard/opportunities/:id/stage` returning the updated opportunity) but does not design the route, projection, or Fastify wiring. The implementation plan (or a separate backend spec) must pick up that prerequisite. **The store layer partly exists** — `PrismaOpportunityStore` in `packages/db/src/stores/prisma-opportunity-store.ts` provides `getCountsByStage`, `findByContact`, `findActiveByContact`, and `updateStage`. What's missing: (a) an org-wide flat-list method that joins minimal `Contact` data, (b) the route + core projection that consumes it, and (c) audit emission on stage transition — `updateStage` mutates the row but does **not** write a `WorkTrace`, so the PATCH route must thread the mutation through `PlatformIngress.submit()` per `CLAUDE.md` doctrine, or emit the audit event explicitly. This is a backend concern called out so the implementation plan inherits the obligation.
- **The detail route `/contacts/[id]`.** Stays exactly as it shipped in D1.5. Its `ContactDetail` projection already surfaces an Opportunities section, so an operator landing there from a Pipeline card sees consistent data.
- **Topbar additions.** The mockup's `Alex · Riley · Mira · | · Pipeline · Contacts · Reports` topbar is rendered by `Topbar()` in `pipeline.jsx` as a self-contained header. **This spec does not adopt it.** The page renders inside the existing `EditorialAuthShell` (per `apps/dashboard/src/app/(auth)/(mercury)/layout.tsx`). Brand-nav promotion of "Pipeline" is wave-2 territory; see §3.
- **Tweaks panel.** `tweaks-panel.jsx` is a Claude Design authoring affordance, not production UI.
- **Stage filter by agent or channel.** The mockup's earlier drafts had them; chat 11 explicitly removed them.
- **Search.** Not in the mockup. If operators need search, it lives on `/contacts/[id]` or a future per-channel surface.
- **Saved filter views, multi-select bulk actions, CSV export.** Read-side niceties; revisit post-launch.
- **Keyboard drag-and-drop.** Pointer-only in v1 (see §6). Cards stay click-to-open-drawer for keyboard users; a "Change stage" select inside the drawer is the keyboard-accessible mutation path and is the **only** mutation surface required for accessibility parity. The spec ships that select.
- **Conflict resolution for concurrent edits.** Last-write-wins. The backend's existing `transitionStage` is idempotent in practice (writes the new stage and a `WorkTrace`); concurrent operators occasionally seeing each other's stale state is acceptable for v1.
- **Mobile/responsive collapse to accordion.** Mercury surfaces are desktop-first by design (`memory/project_two_register_design.md`). The board is a horizontal-scroll region; below ~720px the page works but is not optimized.
- **Currency switching.** SGD only.

### 1.3 Why this surface, why now

Three forces converge:

1. **The existing `/contacts` list is the wrong shape.** D1 (2026-05-08) shipped a contact-stage browse list. D1.5 (2026-05-09) gave it a detail route. The operator workflow that actually drives revenue — "what deals are in flight, where are they parked, what needs attention" — is opportunity-shaped, not contact-shaped. Founders look at this surface to triage deals, not to inspect contact records.
2. **The Opportunity data layer already exists, unused by the dashboard.** `PrismaOpportunityStore` handles stage transitions and audit; `OpportunitySchema` is 8-stage and matches the mockup exactly. The contact detail page already projects opportunities. Only the dashboard list surface is missing.
3. **The wave-1 redesign needs Mercury Tools to demonstrate range.** The other four wave-1 surfaces (`/activity`, `/approvals`, `/mission`, `/reports`) are tables or single-column long-scroll. Pipeline is the first Mercury surface that is **interactive and mutating** — drag, save, drawer. Settling its conventions here unlocks the same patterns elsewhere (e.g., approvals batch-act, activity inline-expand-and-mutate).

### 1.4 Out-of-scope decisions inherited from prior specs

- Two-register split — Mercury for Tools tier (`memory/project_two_register_design.md`; `2026-05-03-agent-first-redesign-roadmap.md` §3).
- Canonical agent names Alex / Riley / Mira (`memory/project_canonical_agent_names.md`).
- Surface-agnostic backend rule (`memory/feedback_surface_agnostic_backend.md`).
- Mercury design tokens in `apps/dashboard/src/app/globals.css` (`--mercury-cream`, `--mercury-ink`, `--mercury-accent`, `--mercury-hairline`, `--mercury-row-hover`, `--mercury-pos`, `--mercury-neg`). This spec consumes those tokens; it does **not** introduce the mockup's inline `P.amber` HSL literals as new tokens.
- Production gate pattern (`NEXT_PUBLIC_<SURFACE>_LIVE`). Reused as-is — `NEXT_PUBLIC_CONTACTS_LIVE` keeps its name; flipping it now flips the new board live.
- Test layout for Mercury surfaces — three layers (schema, hook, page), mirroring D1 / D1.5 / activity / reports.

---

## 2. Decisions

### 2.0 Decisions ledger (locked 2026-05-13)

| # | Question | Locked answer |
|---|---|---|
| 1 | Route name | **`/contacts` stays.** Page title and h1 are "Opportunity pipeline." Renaming to `/pipeline` is downstream — it would couple to brand-nav decisions that are wave-2. |
| 2 | Data domain | **Opportunity-centric.** Cards are `Opportunity` rows joined to a minimal `Contact` projection (`{ name, primaryChannel }`). Eight stages map 1:1 to the existing `OpportunityStageSchema`. |
| 3 | Existing `useContactsList` hook | **Deleted.** Replaced by `useOpportunitiesBoard()`. The hook served only the old list; `useContactDetail` (used by `/contacts/[id]`) is independent and is untouched. |
| 4 | Backend prerequisite | New `GET /api/dashboard/opportunities` (org-scoped flat array) + `PATCH /api/dashboard/opportunities/:id/stage` (returns the updated opportunity). **Flagged as prerequisite; not designed here.** Fixture mode covers the gap until they ship. |
| 5 | Drag-to-move persistence | **Optimistic local update + quiet PATCH.** On success: header indicator returns to `synced` and a brief toast confirms. On error: revert local state, surface an error toast with retry. Each successful transition writes a `WorkTrace` via the existing store. |
| 6 | Card click target | **In-page right-aligned drawer (420px).** Drawer shows opportunity fields. Drawer footer has primary `Open contact →` that navigates to `/contacts/[id]`. |
| 7 | Filter primitive | **Two only**, per mockup: `updated` segmented control (`any time` / `24h` / `7d` / `30d`) and `Qualified only` checkbox (filters on `qualificationComplete === true`). No stage filter (the board is the stage view). No search. No agent filter. No channel filter. |
| 8 | Stage columns | All 8 stages always visible (`interested` / `qualified` / `quoted` / `booked` / `showed` / `won` / `lost` / `nurturing`). Won/lost render at 78% opacity (terminal). Nurturing renders on slightly muted paper with a dashed left border (parking lot). |
| 9 | Card value display | `estimatedValue` for non-terminal stages, `revenueTotal` for `won`/`lost`. Em-dash when `null`. Format: `S$1,234` on cards, compact `S$1.2k` on header tiles. SGD only. |
| 10 | Empty board state | If `rows.length === 0` for the org (not just for the current filters), render a Mercury empty surface above the board: **"No deals in your pipeline yet. New ones appear here as soon as someone replies to one of your channels."** Plain-language; avoids "agent" jargon on day 1. Per-column empty copy still renders for individual empty columns (mockup behavior). |
| 11 | Pagination | **None.** Single flat array. Rationale: 8-column kanban with a sane operator workload is ~50–200 cards. If a real org breaches 1000 opportunities, the surface will degrade gracefully (vertical scroll inside columns is already implemented) and we revisit. Cursor-paging an 8-bucket board is not free; defer until empirically needed. |
| 12 | Default sort within a column | **`updatedAt DESC`.** Mockup's fixtures naturally order this way. Backend should return rows sorted this way to keep the client cheap. |
| 13 | Mobile / narrow viewport | **Horizontal scroll inside the board.** Columns use `clamp(220px, 12.5vw, 288px)` (see OPEN-25). Below ~720px the page works but is not optimized. No accordion fallback in v1. |
| 14 | Production gate | **Reuse `NEXT_PUBLIC_CONTACTS_LIVE`.** Flipping it flips the new board live; off → fixtures. The flag's `ToolsNavId = "contacts"` mapping in `route-availability.ts` stays. |
| 15 | Topbar / nav | **Render inside existing `EditorialAuthShell`.** Do not adopt the mockup's `Topbar()` or `Tab()` components. Do not add a "Pipeline" tab to the brand-nav. Wave 2 (Alex/Riley home rebuilds) will land the new topbar; this spec stays inside whatever shell wave-1.5's route split settles on. |
| 16 | Page header chrome | Replace the existing `ContactsHeader` content but keep it as the same file (`apps/dashboard/src/app/(auth)/(mercury)/contacts/components/header.tsx`), now rendering: eyebrow `Mercury Tools · Pipeline`, h1 `Opportunity pipeline` (Cormorant Garamond 38px), descriptive paragraph, three right-aligned stat tiles. |
| 17 | Header stat tiles | Three slots: `open pipeline` (sum of `estimatedValue` across non-terminal + non-`nurturing` stages, formatted compact), `won this period` (sum of `revenueTotal` across `won`, formatted compact, with amber-deep tone), and a saving-state indicator (`synced` green dot when idle, `saving…` ellipsis when a PATCH is in flight). |
| 18 | DnD library | **Native HTML5 drag-and-drop.** No `dnd-kit`, no `react-beautiful-dnd`. Matches the mockup's `data-dragging` / `data-over` attribute model; smaller bundle; one source of truth (the mockup) to port. |
| 19 | Render model | **Client component + TanStack Query.** Matches every other Mercury surface. `useOpportunitiesBoard()` keyed by `keys.opportunities.board()`. Mutation uses `useMutation` with `onMutate` (snapshot + optimistic flip), `onError` (rollback), `onSettled` (toast + invalidate). |
| 20 | Audit | The existing `OpportunityStore.updateStage` does **not** write a `WorkTrace`. The backend PATCH must thread the mutation through `PlatformIngress.submit()` (per `CLAUDE.md` doctrine) or emit an audit event explicitly. **Out-of-scope to design here**, but called out so the implementation plan knows the audit obligation is real, not a follow-up. |
| 21 | Tweaks panel | **Not shipped.** Authoring tool only. |
| 22 | Show/hide nurturing | Always show in v1. The mockup's `showParking` tweak is a design-tool affordance. Nurturing being a "parking lot" is communicated visually (dashed border, muted paper), not by hiding it. |
| 23 | Card affordances we drop | Channel glyph (chat 11 removed), agent name (chat 11 removed). Kept: serviceName, contact name, value, optional staff pill, objection count chip, relative-updated time. |
| 24 | Mercury accent vs. mockup amber | **Consume existing `--mercury-*` tokens.** Current values (`--mercury-accent: hsl(20 90% 55%)`, `--mercury-cream: hsl(40 25% 94%)`) are visibly hotter/darker than the mockup's `hsl(30 55% 46%)` / `hsl(45 25% 98%)`. Spec does **not** retune tokens — that's a cross-surface change owned by wave-1.5's `shared-conventions.md`. The page will look slightly different from the mockup as a result; this is a known acceptable divergence for v1. |
| 25 | Column width | **Flexible `clamp(220px, 12.5vw, 288px)`** instead of fixed 288px. At 1440px viewport this fits ~5 columns plus partials; below ~1100px the operator scrolls horizontally either way. The mockup's pixel-fixed 288px is preserved at wide breakpoints. |
| 26 | Drag-over feedback scope | Treatment (inset amber box-shadow + 6% amber tint) applies to **the whole column (header + body)**, not just the body. Empty columns get the same visual response. |
| 27 | Drawer mutual exclusion | The page's opportunity-detail drawer and the shell's `InboxDrawer` are both right-side. **Opening one closes the other.** Implemented via the same `Sheet` primitive the InboxDrawer already uses (`@/components/ui/sheet`), so width + animation + scrim are consistent. State is held in a single `useDrawer()` helper or a simple "open the other → close me first" `onOpenChange` handler. |
| 28 | Revenue on drag-to-won | Dragging to `won` sets `stage` + `closedAt` only. **It does NOT record revenue.** `revenueTotal` is sourced from `LifecycleRevenueEvent` rows and only updates when revenue is actually captured (existing flow, out of scope). Until revenue lands, Won cards show em-dash; the drawer surfaces a calm hint: "Recorded as won. Revenue is captured separately." |
| 29 | ⌘-click / middle-click on a card | Opens `/contacts/[id]` in a new tab (matches operator muscle memory). Plain click still opens the in-page drawer. Implemented by wrapping the card body in a `<Link>` with `prefetch={false}` and `onClick` that calls `preventDefault()` only on unmodified left-click. |
| 30 | Filter-state hint on header tiles | When `range !== "all"` or `qualifiedOnly === true`, each tile's sublabel appends a faint mono `(filtered)` suffix. Tiles remain filter-coupled per the mockup; the hint just makes the coupling visible. |

### 2.1 Decisions deliberately NOT made here

- Whether the org-wide opportunities endpoint should be paged, scoped to non-terminal stages, or include closed-out terminals after a TTL. **Backend spec's call.**
- The exact wire format of `PATCH /api/dashboard/opportunities/:id/stage` (envelope shape, error codes, idempotency key). **Backend spec's call.** This spec assumes a JSON `{ stage }` body and a `200 { opportunity: PipelineBoardOpportunity }` or `409 { code, message }` response.
- Whether the eventual brand-nav makes Pipeline a top-level item (sibling to Alex / Riley / Mira) or a Tools subitem (sibling to Reports / Activity / Approvals). **Wave-2 / wave-1.5 nav spec's call.**

---

## 3. Wave-2 carryover flags (shell-component decisions inherited from the mockup)

These appear in the locked mockup but belong to wave 2 (Alex Home v2 / Riley Home v2 rebuilds). **This spec does not pre-design them**; it flags them so wave 1.5's route-split and wave 2's home pages can decide.

1. **Topbar `Alex · Riley · Mira · | · Pipeline · Contacts · Reports` with the active-tab + sub-tab grammar.** The mockup's `Topbar()` and `Tab()` paint Pipeline as a sub-tab of the active agent. This conflates Tools-tier surfaces (Pipeline) with agent homes. Wave-1.5's route split must decide: does Pipeline belong to the agent's home (per-agent pipeline) or to Tools (org-wide pipeline)? This spec assumes **Tools, org-wide**, because that's the only shape the existing data layer supports without a major projection rewrite.
2. **`<Mark />` SVG logo** (rounded-square + two dots + amber smile arc). Will be the brand mark across Alex Home / Riley Home / Pipeline / etc. Wave 1.5 owns when/whether to replace the existing brand mark with it.
3. **Topbar right side: `SGD · Singapore` locale chip + circle avatar.** Pure decoration. Wave 2 owns.
4. **The `Eyebrow` component (11px, 700, 0.14em tracking, uppercase, ink3 default with optional color override).** Re-implemented in every Claude Design mockup. Strong candidate for `shared-conventions.md`; flagging.
5. **The color palette literal `P`** (paper, ink ramp, amber ramp, semantic green/red/blue). The mockup redeclares this in `pipeline.jsx` and `cockpit.jsx`. `globals.css` already has `--mercury-*` tokens, but the **values diverge meaningfully**: codebase `--mercury-accent` is `hsl(20 90% 55%)` (a hot orange), mockup is `hsl(30 55% 46%)` (warmer/duller amber); codebase `--mercury-cream` is `hsl(40 25% 94%)`, mockup is `hsl(45 25% 98%)`. This spec consumes the existing tokens (per OPEN-24); the rebuild will look slightly different from the mockup until wave-1.5 retunes the palette. Wave-1.5 owns the retune.
6. **`SavingIndicator` micro-pattern (animated ellipsis with `pl-savedots` keyframes).** Reusable across any mutating Mercury surface (Approvals, Automations). Candidate for shared.

---

## 4. Shared-conventions input

Things this surface needs that wave-1.5's `docs/design-prompts/shared-conventions.md` (in-flight) should consider:

- **Eyebrow micro-component** — see §3.4.
- **StatTile pattern** — Cormorant page title + 3-tile right cluster. Recurring on Reports, here, and the mockup's Approvals.
- **SavingIndicator** — see §3.6.
- **Card hover affordance** — 1px border darken + tiny `↗` arrow on hover. Recurring.
- **Detail drawer** — 420px right slide-in, scrim at `rgba(14,12,10,0.28)`, `pl-fadein .18s ease` animation. Reusable across any per-row-detail surface.
- **DnD attribute model** — `data-dragging="true"` on the source, `data-over="true"` on drop targets. CSS handles the visual treatment so React state stays minimal.
- **Mercury tokens vs. inline HSL** — every locked mockup re-declares its color palette inline. The convention should be: **mockups declare for self-containment; production consumes `--mercury-*` tokens from `globals.css`.** Both should drift together; flagging the need for a token audit.

---

## 5. Visual contract

The page layout, in document order:

### 5.1 Page header (`components/header.tsx`)

- Container: `padding: 24px 28px 18px` inside the `74rem` content width.
- Two-column flex row, baseline-aligned, wraps on narrow.
- Left column:
  - Eyebrow text `Mercury Tools · Pipeline` (consume `.section-label` if it matches; otherwise inline the 11px / 700 / 0.14em rule).
  - h1: Cormorant Garamond 38px / 500 weight / `-0.01em` letter-spacing / 1.05 line-height, color `--mercury-ink` (`#0E0C0A`).
  - Paragraph: 13.5px, color `--mercury-ink-3` (`#6B6052`), `max-width: 540px`, copy mirrors mockup: "Every active deal across all eight stages. Drag a card to move it — the change saves quietly. Won and lost columns are dimmed; nurturing parks the long tail."
- Right column: `grid-template-columns: repeat(3, auto)`, `gap: 0 28px`, baseline-aligned.
  - Tile 1 `open pipeline` — value compact-SGD, sublabel `{count} opportunities` (singular when n=1 via `pluralize` helper — see §6.6). When filters are active, sublabel appends mono `(filtered)` per OPEN-30.
  - Tile 2 `won this period` — value compact-SGD, sublabel `{count} captured`, value tone `--mercury-accent-deep` (`hsl(30 60% 32%)`). When filters are active, sublabel appends mono `(filtered)` per OPEN-30. "This period" = the current `updated` filter window; sublabel reads `{count} captured · last 24h` (etc.) so the period is named, not silent.
  - Tile 3 `state` — saving indicator. `synced` (green dot + label) when idle; `saving…` (animated ellipsis) when a mutation is in flight.

### 5.2 Filter strip (`components/filter-strip.tsx`)

- Sticky-ish but not actually sticky in v1 (mockup isn't either). Border-top and border-bottom hairlines. Padding `12px 28px`.
- Left side: `FilterGroup` "updated" + 4-segment control (`any time`, `24h`, `7d`, `30d`). Single hairline divider, then a checkbox `Qualified only` with accent-color `--mercury-accent`.
- Right side: a `flex: 1` spacer, then mono counter `showing N of M`. "Clear filters" underline-link appears when filters are active.

### 5.3 Board (`components/board.tsx`)

- Container: `overflow-x: auto`, padding `20px 28px 40px`. Inside it, a flex row of columns wrapped in a 1px hairline + 6px radius container.
- Footnote below the board: `won & lost are terminal · nurturing parks the long tail · drag cards to move`.

### 5.4 Column (`components/column.tsx`)

- Width: `flex: 0 0 clamp(220px, 12.5vw, 288px)` per OPEN-25 — fluid between 220px and 288px so a 1440px viewport fits 5+ columns; pixel-fixed at wide breakpoints to match the mockup.
- Header (sticky inside column): stage label eyebrow with leading accent dot (filled amber for `accent` tone, hollow ink4 square for `parking` tone) + count (mono); sum (mono, 13px, 600) + subtitle (10.5px, lowercase, mono).
- Body: vertical scroll, `padding: 10px 10px 28px`, gap 8px between cards. `min-height: 320px`, `max-height: calc(100vh - 340px)`.
- Tone treatment:
  - `accent` (quoted, booked, showed): accent dot in header.
  - `closed` (won, lost): full column at 78% opacity.
  - `parking` (nurturing): background `rgba(14,12,10,0.025)`, dashed left border.
- Drag-over treatment (per OPEN-26): when `data-over="true"`, the **whole column** (header + body) gets the inset 1px amber `box-shadow` and 6% amber tint. Empty columns get the same response, so an operator dragging onto a zero-card column has unambiguous feedback.

### 5.5 Card (`components/opportunity-card.tsx`)

- Surface: `#FFFFFF`, 1px hairline (`rgba(14,12,10,0.08)`), 6px radius, `padding: 11px 12px 12px`.
- Three rows:
  - Row 1: `serviceName` (Inter 13.5px / 600) on the left, value badge on the right. Value badge is mono 11.5px / 600, with tone variants:
    - `won` → green pill (`rgba(63,122,54,0.10)` bg, `#3F7A36` text).
    - Accent-toned stage → amber pill (`amberSoft` bg, `amberDeep` text, hairline border).
    - Otherwise → grey pill (`rgba(14,12,10,0.04)` bg, `ink2` text).
  - Row 2: `contact.name` (12.5px, ink3, single-line ellipsis) + optional `assignedStaff` pill (mono 10px, hairline border).
  - Row 3: optional `{N} obj` chip on the left (mono 10.5px, amberSoft hairline, amberDeep text, leading 4px amber dot) — count = unresolved objections only — and a relative-updated time on the right (mono 10.5px, ink4).
- Hover: border to `ink5`, subtle 1px shadow, `↗` arrow top-right.
- Drag: `cursor: grab`; on drag start, `data-dragging="true"` flips card opacity to `0.35`.
- Click model (per OPEN-29):
  - **Plain left-click** → opens the in-page drawer (default).
  - **⌘-click / Ctrl-click / middle-click** → opens `/contacts/[id]` in a new tab. The card body wraps in a `next/link` with `prefetch={false}`; the `onClick` calls `event.preventDefault()` only when the click is unmodified left-button, otherwise the browser handles new-tab semantics natively.
- Card value display, terminal vs. non-terminal (per OPEN-28):
  - Non-terminal stages (interested … showed, nurturing): show `formatSGD(estimatedValue)`; em-dash when `estimatedValue` is null.
  - `won` / `lost`: show `formatSGD(revenueTotal)` when `revenueTotal > 0`; em-dash when zero. **Dragging a card to `won` does NOT itself capture revenue**, so a freshly-dropped Won card displays em-dash until revenue is recorded through the existing revenue flow. This is intentional, not a bug.

### 5.6 Detail drawer (`components/detail-drawer.tsx`)

- **Primitive (per OPEN-27).** Built on the same `@/components/ui/sheet` (Radix-based) primitive `InboxDrawer` uses, with `<SheetContent side="right">`. Width `sm:max-w-[26rem]` (≈420px). Scrim, focus trap, and `Escape`-to-close are inherited from Radix Sheet — the spec does not re-implement them.
- **Mutual exclusion with `InboxDrawer`.** Both are right-side. Opening the opportunity drawer must close `InboxDrawer` first, and vice versa. Implementation: a single shared `useRightDrawer()` hook in `apps/dashboard/src/components/layout/right-drawer-context.tsx` that holds `"inbox" | "opportunity" | null`. Each drawer reads + writes via `onOpenChange`. **This is the smallest cross-cutting change in scope for this spec** — it touches `InboxDrawer` to consume the shared hook.
- Header (padding `18px 22px`, bottom hairline):
  - Eyebrow with stage label, color `--mercury-accent-deep`.
  - h2 `serviceName` (19px / 600).
  - `contact.name` muted.
  - Close `✕`.
- Body (padding `18px 22px`, vertical scroll). Fields rendered as `Eyebrow` + value, in this order:
  - `value` — `estimatedValue` (mono 14px / 600); if `revenueTotal > 0`, suffix `· {revenue} captured` in green.
  - `timeline` — `{timeline} · price · {priceReadiness}`. Em-dash when unknown.
  - `staff` — `assignedStaff` if present (else omitted).
  - `objections` — list with green dot if `resolvedAt`, amber dot if open. Category text + relative raised time.
  - `notes` — free text if present.
  - `lost reason` — red text if `lostReason` present (lost stage only).
  - `qualification` — green `complete` or grey `incomplete`.
  - `dates` — mono grid: opened / updated / closed (if terminal).
  - **`stage` (keyboard-accessible mutation surface)** — a `<select>` listing all 8 stages. On change, fires `useOpportunityStageTransition` mutation. **This is the only mutation surface required for keyboard accessibility parity in v1.**
  - **Revenue hint (per OPEN-28).** When `stage === "won"` AND `revenueTotal === 0`, render a calm mono note below the `value` field: `Recorded as won. Revenue is captured separately.` Hidden when `revenueTotal > 0`.
- Footer (padding `14px 22px`, top hairline): primary dark button `Open contact →` (navigates to `/contacts/[id]`); secondary `Close` (closes drawer).

### 5.7 Toast (`components/toast.tsx`)

- Fixed bottom-center, `bottom: 24px`, dark ink fill `#0E0C0A`, white text, mono 13px / 500, `padding: 10px 16px`, 6px radius, drop shadow.
- Auto-dismiss after 3s on success; persist until dismissed on error (operator needs to read it).
- Two variants:
  - Move success: `Moved {firstName} to {stage}.`
  - Move error: `Couldn't save that move — {firstName} is back in {oldStage}. Try again in a moment.` Calmer than "refresh"; tells the operator (a) it didn't save, (b) the card already reverted, (c) what to do. The board reverts **before** the toast appears so the visual state is honest by the time they read the message.

### 5.8 Per-column empty state

- Rendered inside a column when `opportunities.length === 0` *after filtering*.
- Dashed 1px border, ink4 text, mono 12.5px, calm copy keyed off `stage.key` (mirror mockup's `EmptyColumn` strings).

### 5.9 Whole-board empty state

- Rendered above the board (replacing it) when the org has **zero** opportunities. Mercury voice: **"No deals in your pipeline yet. New ones appear here as soon as someone replies to one of your channels."** Plain-language; avoids "agent" jargon on day 1. Distinct from filtered-empty (which is per-column, not whole-board).

---

## 6. Data contract

### 6.1 New shared schemas (`packages/schemas/src/pipeline-board.ts`)

```ts
// PipelineBoardOpportunity is the join of Opportunity + a minimal Contact projection.
// Field names mirror OpportunitySchema verbatim, except `contact` is the joined
// minimal projection (NOT the full ContactSchema, to keep payloads small).
export const PipelineBoardContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // fallback to phone or "Unknown" upstream if missing
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
});

export const PipelineBoardOpportunitySchema = OpportunitySchema.pick({
  id: true,
  contactId: true,
  serviceId: true,
  serviceName: true,
  stage: true,
  timeline: true,
  priceReadiness: true,
  objections: true,
  qualificationComplete: true,
  estimatedValue: true,
  revenueTotal: true,
  assignedAgent: true,
  assignedStaff: true,
  lostReason: true,
  notes: true,
  openedAt: true,
  closedAt: true,
  updatedAt: true,
}).extend({
  contact: PipelineBoardContactSchema,
});

export const PipelineBoardResponseSchema = z.object({
  rows: z.array(PipelineBoardOpportunitySchema),
});
```

### 6.2 Hook contract (`hooks/use-opportunities-board.ts`)

```ts
export function useOpportunitiesBoard(): UseQueryResult<PipelineBoardResponse, Error>;
```

- `queryKey`: `keys.opportunities.board()` (new namespace). **Add the factory in `apps/dashboard/src/lib/query-keys.ts`** — that's where `scopedKeys(orgId)` lives. `apps/dashboard/src/hooks/use-query-keys.ts` is the thin React wrapper; it does not own the namespace shape.
- `queryFn`: fetches `/api/dashboard/opportunities`, parses with `PipelineBoardResponseSchema`.
- `enabled`: `live || !!keys` (mirrors `useContactsList` pattern).
- Fixture mode: returns the `pipeline-data.jsx` fixture mapped into the schema shape; resolves immediately.

### 6.3 Mutation contract (`hooks/use-opportunity-stage-transition.ts`)

```ts
type Variables = { id: string; stage: OpportunityStage };
export function useOpportunityStageTransition(): UseMutationResult<PipelineBoardOpportunity, Error, Variables, Context>;
```

- `mutationFn` (live): `PATCH /api/dashboard/opportunities/:id/stage` with `{ stage }`, parses response.
- `mutationFn` (fixture): resolves with the locally-updated row after a 700ms timeout (matches mockup's saveTimer).
- `onMutate`:
  - Cancel in-flight queries on `keys.opportunities.board()`.
  - Snapshot previous board state for rollback.
  - Optimistically update the cache: flip the target row's `stage` and `updatedAt`; set `closedAt` if transitioning into a terminal stage; clear if leaving terminal.
  - Return `{ previous }` as context.
- `onError(_, _, ctx)`: restore `previous` to the cache.
- `onSuccess`: fire toast.
- `onSettled`: `invalidateQueries({ queryKey: keys.opportunities.board() })`.

### 6.4 Fixture mode

- `fixtures.ts` re-exports a `PIPELINE_FIXTURE_ROWS: PipelineBoardOpportunity[]` derived from `pipeline-data.jsx`'s 20 cards. Dates are converted from the JSX `D(offset, hour, min)` helper to ISO at fixture-build time, anchored to `2026-05-13 12:00:00 SGT` (matches mockup's pinned "now").
- Stage transitions in fixture mode mutate the in-memory `useState`; refresh resets.

### 6.5 Filter / aggregation logic (client-side)

- The `updated` filter applies `Date.now() - row.updatedAt < range` (24h / 7d / 30d).
- The `Qualified only` filter applies `row.qualificationComplete === true`.
- Header stat aggregates use **filtered** rows (matches mockup: filters change the headline numbers, by design). To keep this honest, the header tiles' sublabels append `(filtered)` whenever a filter is active (per OPEN-30) and "won this period" names the period in its sublabel (e.g., `… · last 24h`).
- Column count + sum aggregates use **filtered** rows.

### 6.6 String formatting helpers (`components/format.ts`)

- `formatSGD(cents: number | null): string` → `S$1,234` or em-dash.
- `formatSGDCompact(cents: number | null): string` → `S$1.2k` for ≥ S$10k, else full digits.
- `relTime(iso: string, now: Date): string` → mockup helper verbatim, but `now` is a parameter (no hidden globals; tests can pin it).
- `pluralize(n: number, singular: string, plural: string): string` → for `1 opportunity` vs. `2 opportunities`.

---

## 7. Risks & accessibility

- **Keyboard DnD deferred.** Cards are click-to-open-drawer for keyboard users; the drawer contains a `<select>` for stage transitions (§5.6). This is the v1 accessibility commitment.
- **Native HTML5 DnD on touch.** Mobile drag-and-drop in browsers is patchy. The board is desktop-first by design; touch users get drawer + select, same as keyboard.
- **Concurrent edits.** Last-write-wins. The optimistic update model means a stale read in one tab won't see another tab's move; refreshing reconciles. Calling this out as a known limitation.
- **Drawer focus management.** When the drawer opens, focus moves to the close button. `Escape` closes. Scrim click closes (mockup behavior preserved).
- **Reduced motion.** The `pl-fadein` and `pl-savedots` keyframes should be conditioned on `@media (prefers-reduced-motion: no-preference)`. The mockup doesn't do this; the production rebuild should.
- **Server-render boundary.** The page must be a client component (TanStack Query). The Next.js route stays as `page.tsx` → `<PipelinePage />`.

---

## 8. File-by-file plan

```
apps/dashboard/src/app/(auth)/(mercury)/contacts/
  page.tsx                                # unchanged shell; renders <PipelinePage />
  pipeline-page.tsx                       # RENAMED from contacts-page.tsx
  pipeline.module.css                     # REPLACES contacts.module.css
  fixtures.ts                             # REWRITTEN to PipelineBoardOpportunity[] shape
  hooks/
    use-opportunities-board.ts            # NEW (replaces use-contacts-list.ts)
    use-opportunity-stage-transition.ts   # NEW
  components/
    header.tsx                            # KEPT (file path); content swapped to page-header (eyebrow + h1 + tiles)
    filter-strip.tsx                      # NEW (replaces filter-chips.tsx, search-input.tsx)
    board.tsx                             # NEW
    column.tsx                            # NEW
    opportunity-card.tsx                  # NEW (replaces contact-row.tsx, contacts-table.tsx)
    detail-drawer.tsx                     # NEW
    saving-indicator.tsx                  # NEW
    toast.tsx                             # NEW
    empty-states.tsx                      # NEW (replaces empty-state.tsx; both whole-board and per-column variants)
    format.ts                             # EXTENDED with formatSGD / formatSGDCompact / relTime / pluralize
  __tests__/
    pipeline-page.test.tsx                # RENAMED from contacts-page.test.tsx (gut-rebuilt)
    drag-and-drop.test.tsx                # NEW
    detail-drawer.test.tsx                # NEW
packages/schemas/src/
  pipeline-board.ts                       # NEW (PipelineBoardContact, PipelineBoardOpportunity, PipelineBoardResponse)
  index.ts                                # add the new exports
apps/dashboard/src/lib/
  query-keys.ts                           # add `opportunities.board()` factory inside scopedKeys(orgId)
apps/dashboard/src/components/layout/
  tools-overflow.tsx                      # rename "Contacts" label to "Pipeline" in TOOLS_NAV_ITEMS; href stays "/contacts"
  right-drawer-context.tsx                # NEW; shared {kind: "inbox"|"opportunity"|null} state per OPEN-27
  inbox-drawer.tsx                        # consume useRightDrawer (mutual-exclusion wiring); no visual change
```

**Deleted files:**

```
apps/dashboard/src/app/(auth)/(mercury)/contacts/
  contacts-page.tsx                       # → pipeline-page.tsx
  contacts.module.css                     # → pipeline.module.css
  hooks/use-contacts-list.ts
  components/contact-row.tsx
  components/contacts-table.tsx
  components/filter-chips.tsx
  components/pagination-footer.tsx
  components/search-input.tsx
  components/empty-state.tsx              # → empty-states.tsx
  __tests__/contacts-page.test.tsx        # → pipeline-page.test.tsx
  hooks/__tests__/use-contacts-list.test.ts
  components/__tests__/                   # rebuild test-by-test in lockstep with new components
```

**Untouched:**

```
apps/dashboard/src/app/(auth)/(mercury)/contacts/[id]/   # entire detail route — D1.5 stays
```

---

## 9. Test plan

Three layers, mirroring D1 / D1.5 / activity / reports.

### 9.1 Schema layer (`packages/schemas/src/pipeline-board.test.ts`)

- `PipelineBoardOpportunitySchema.parse` accepts mockup fixture rows verbatim.
- Rejects rows missing `contact.name` or with invalid `stage`.
- `PipelineBoardResponseSchema.parse` accepts `{ rows: [] }`.

### 9.2 Hook layer

- `use-opportunities-board.test.tsx`: fixture mode returns 20 rows; live mode hits the proxy and parses; live mode error surfaces as `isError`.
- `use-opportunity-stage-transition.test.tsx`:
  - `onMutate` optimistically updates the cache.
  - `onError` rolls back to previous state.
  - `onSettled` invalidates `opportunities.board`.
  - Fixture mode resolves locally after 700ms.

### 9.3 Page composition layer

- `pipeline-page.test.tsx`:
  - Renders 8 columns with correct labels + counts + sums for the fixture.
  - `Qualified only` checkbox filters out non-qualified rows from columns + tiles.
  - `updated` segmented control reduces row count appropriately.
  - "Clear filters" appears only when filtered; resets state.
  - Whole-board empty state renders when zero rows; per-column empty renders when a column is empty after filtering.
  - Card click opens drawer; drawer close + scrim click + Escape all dismiss.
  - "Open contact →" button navigates to `/contacts/[id]`.
- `drag-and-drop.test.tsx`:
  - Card dragged to a different column moves locally + fires mutation.
  - Card dropped on its own column is a no-op (no mutation).
  - Saving indicator flips during mutation, returns to synced on success.
  - On mutation error, card reverts to its previous column **before** the error toast appears; toast copy matches OPEN-10's calmer phrasing.
  - Drag-over feedback (`data-over="true"`) applies to the whole column (header + body), including empty columns.
  - **Manual smoke note (not automated):** verify the browser's HTML5 drag image renders cleanly on Chrome + Safari at 100% zoom; the `data-dragging` 0.35 opacity stacks with the OS default and can produce near-invisible drag previews on some macOS setups. Document in PR description if a fix is needed (probably setting `dragImage` explicitly).
- `detail-drawer.test.tsx`:
  - All schema-driven fields render.
  - Stage `<select>` change fires mutation.
  - Drawer's "Open contact →" links to `/contacts/{contactId}`.
  - Missing fields (no notes, no objections, no staff) render gracefully.
  - **Revenue hint:** appears when `stage === "won"` AND `revenueTotal === 0`; hidden otherwise.
  - **Mutual exclusion:** opening the opportunity drawer while `InboxDrawer` is open closes the inbox first; opening `InboxDrawer` while the opportunity drawer is open does the reverse. Asserted via the `useRightDrawer()` state machine.
  - **⌘-click on a card** opens `/contacts/[id]` in a new tab; plain click opens the drawer. Verified by inspecting the `<Link>` behavior (mocking `window.open` is fragile; assert `preventDefault` was/was-not called on the synthetic event instead).

---

## 10. Open questions for the implementation plan

These are intentionally not pre-decided; the writing-plans pass should pick them up:

1. **Where does the backend wait go?** Two valid options:
   - **(a) Block on backend first** — implementation plan ships `GET /api/dashboard/opportunities` + `PATCH .../stage` + core projection in a prerequisite PR, then the visual rebuild lands behind `NEXT_PUBLIC_CONTACTS_LIVE`.
   - **(b) Ship the visual rebuild on fixtures first**, then layer the backend in. The gate stays off until the backend lands.
   The recommendation in the plan should be (b) — it lets design review and screenshot tests happen in parallel with backend work, mirrors the wave-1 rebuilds' pattern (`/activity`, `/approvals` etc. are gated on the same flag).
2. **Do we keep `NEXT_PUBLIC_CONTACTS_LIVE` or rename it to `NEXT_PUBLIC_PIPELINE_LIVE`?** Recommendation: **keep**. The flag gates a single route (`/contacts`); renaming requires touching `route-availability.ts`'s `ToolsNavId` union, every test that sets the env var, and the agent-home link gate. Not worth the churn when the route name itself isn't changing.
3. **Do the agent-home pipeline tiles (`useAgentPipeline`) need a contract change?** They consume a `PipelineViewModel` keyed per-agent. **No** — they're independent of this rebuild. The org-wide board and per-agent tiles can coexist.
