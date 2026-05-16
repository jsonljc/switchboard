# `/activity` rebuild — Design Spec

_2026-05-13 · wave-1 editorial rebuild of the shipped Mercury Tools surface · sibling to wave-1 rebuilds of `/approvals`, `/reports`, `/mission`, and Pipeline · pairs with `docs/design-prompts/shared-conventions.md` (wave 1.5, in flight)_

> **Reading posture:** surface-only. The `/activity` backend (route, schemas, projection, redaction, hash chain, keyset pagination, operational allowlist) is **frozen**. This spec describes a UI rewrite that exposes more of what the backend already returns, in the editorial paper-and-ink register the Tools tier has converged on. No new endpoints, no new schema fields, no new env flags.

---

## 1. Problem & scope

### 1.0 One-line scope

Rewrite the `/activity` page (`apps/dashboard/src/app/(auth)/(mercury)/activity/`) against the locked Claude Design mockup at `docs/design-prompts/locked/switchboard/project/activity-v2/`, surfacing the full filter, hash-chain, and evidence vocabulary that `AuditEntryBrowseRow` already carries.

### 1.1 What this slice ships

A surface rewrite of the `/activity` page only:

- Replacement for `activity-page.tsx`, `activity.module.css`, and the `components/` tree (file inventory in §3).
- A sticky filter strip with five affordances (scope segment, event-type combobox, actor pills, date range, entity selector) — all of which map 1:1 onto `AuditEntriesListQuery` fields the backend already accepts.
- A denser table treatment: 96px time column, mono event-type badge with band-dot, actor glyph, entity stack, summary, inline `+N redacted` pill, left-edge risk hairline, right-edge amber risk tint.
- An inline accordion drawer (not a modal, not a side panel) carrying full ISO timestamp, classification line, snapshot key chips, evidence rows with `hashPrefix · rest-of-hash` + copy-hash, an explicit "storageRef intentionally absent" absence note, a hash-chain block with **view previous ↓** that scrolls to the predecessor row when present on the page, and Envelope / Trace rows with copy + `open ↗` links to `/approvals/[envelopeId]` and `/traces/[traceId]`.
- A non-unmounting error banner above the table on fetch failure.
- A fixed bottom-right stale-fetch pill with manual refresh (no polling — see §1.2).
- An editorial topbar + page-head with a plain display title (`Audit log`) and a single right-aligned status tile (`last ledger entry`), hidden under narrowing.
- Extended fixtures matching the locked design's 30-row distribution (22 distinct event types across all 4 bands, all 4 actor types, mix of risk, 4 with envelope lineage, 2 with notable `redactedKeyCount`, one out-of-allowlist row to validate "All" scope).
- Co-located tests at the component level (§9).

### 1.2 What this slice does **not** ship

- **No backend changes.** `AuditEntriesListQuery`, `AuditEntryBrowseRow`, `AuditEntriesListResponse`, `OPERATIONAL_AUDIT_EVENT_TYPES`, `listAuditEntriesForBrowse`, `GET /api/dashboard/activity`, the snapshot allowlist constant in `packages/core/src/audit/list-entries.ts` (`SNAPSHOT_KEY_ALLOWLIST`), and the 16-byte `hashPrefix` are all unchanged. Edits to any of these are rejected at review.
- **No `storageRef` exposure.** The browse row doesn't carry it; the absence is surfaced as a labeled dashed note, not silently omitted.
- **No raw snapshot values.** Allowlisted key *names* only, plus `+N redacted` for the count of redacted keys. Mirrors the `project` step in `list-entries.ts` (snapshot keys partitioned against `SNAPSHOT_KEY_ALLOWLIST`; values dropped).
- **No traffic-light hues.** Risk is hairline weight (left edge) plus amber depth (right edge). No `red`/`green`/`yellow` semantic colors.
- **No polling, no real-time tail, no auto-refresh.** Paginated lists with polling break cursor stability. Manual refresh only via the stale pill. (The fixture mentions an opt-in tail toggle as future work — not built.)
- **No infinite scroll.** Keyset cursor pagination is canonical; `← Newer` / `Older →` only.
- **No new event types, no edits to the operational allowlist.** Pinned by `operational-allowlist.test.ts`.
- **No actor-name resolution to canonical agents (Alex/Riley/Mira).** Raw `actorType + actorId` only. Same deferral as the D3 spec (`docs/superpowers/specs/2026-05-10-activity-d3-design.md` §1.2). The agent registry remains decoupled from this Tools-tier surface.
- **No hash-chain verification button.** `GET /api/audit/verify` exists for forensic use; wiring a Verify button is its own slice.
- **No CSV export, no saved filters, no column chooser, no multi-select.** Read-side niceties — post-launch backlog.
- **No `actorId` filter.** The backend `AuditEntriesListQuerySchema` accepts `actorType`, `entityType`, and `entityId`, but not `actorId`. Filtering to a *specific* user or agent (e.g. "just `agent_alex_001`") is therefore not possible from this surface. Filtering by `actorType=agent` returns all three canonical agents commingled. The narrow escape hatch is `?entityType=agent&entityId=<id>`, which only catches rows where the agent is the *entity*, not the actor. Tracked as a wave-1 follow-up; resolution requires adding `actorId` to `AuditEntriesListQuerySchema` + the `AuditLedgerBrowseFilter`, which is additive but out of this spec's scope.
- **No cross-page chain navigation.** The drawer's `view previous ↓` button only navigates when the predecessor row is on the *current* page (see §2.11). When the predecessor is off-page we render an inert "off-page" indicator; following a chain across pages is wave-1 follow-up.
- **No new design tokens in `globals.css`.** All values come from existing `--sw-*` / `--mercury-*` / editorial tokens already in `apps/dashboard/src/app/globals.css`. Where the locked CSS introduces local aliases (`--paper`, `--ink`, `--hair`, `--amber`, `--amber-paper`, `--amber-deep`), they are declared **inside `activity.module.css` only** so wave 1.5 can decide whether to lift them globally (see §10 item 15). Decisions worth codifying across surfaces feed `shared-conventions.md` (§10), not this CSS module.

### 1.3 Why this surface, why now

- **`/activity` underuses what the backend already gives it.** The shipped D3 surface has two chips, no event-type/actor/range/entity filters, and a drawer that lists IDs without copy affordances or hash-chain navigation. The backend has shipped a 45-event vocabulary, an operational allowlist, full hash chain, and `appliedFilters` semantics — none of which the current UI exposes.
- **Wave-1 is collapsing register variance.** Tools surfaces (`/approvals`, `/reports`, `/mission`, Pipeline, `/activity`) are being rebuilt against the same editorial paper-and-ink language in parallel (chat14, chat15, chat13 in the locked design package). `/activity` is the densest of the five and the one that exercises the most backend surface, so it carries weight in the conventions doc that wave 1.5 will codify.
- **The visual rebuild is cheap relative to its forensic value.** No new schemas, no new endpoints, no new tests below the page. The forensic UX (hash-chain anchor, evidence pointers, "view previous" navigation, redaction absence note) is what operators ask the audit ledger to answer.

### 1.4 Out-of-scope decisions inherited from prior specs

These are locked elsewhere and not relitigated here:

- Backend redaction contract (`packages/core/src/audit/list-entries.ts` — `SNAPSHOT_KEY_ALLOWLIST` constant and `project()` function).
- Operational allowlist constants (`OPERATIONAL_AUDIT_EVENT_TYPES` in `packages/schemas/src/audit.ts`).
- Keyset cursor semantics — `appliedFilters` non-empty ⇒ `scope === "custom"`; `nextCursor === null` ⇒ end of list (`isCustomScope` and the trim-and-encode block at the bottom of `listAuditEntriesForBrowse`).
- `NEXT_PUBLIC_ACTIVITY_LIVE` gating + `useActivityList` hook + fixture-mode in-memory filtering (`apps/dashboard/src/app/(auth)/(mercury)/activity/hooks/use-activity-list.ts`).
- Editorial-shell mount on Mercury surfaces (`#419`, D7-1).

### 1.5 Register note (the Tools-tier convergence)

The 9-day-old `memory/project_two_register_design.md` describes Tools tier (`/reports`, `/contacts`, `/automations`, `/activity`, `/settings`) as **Mercury / Work**, separate from editorial. That description is partially stale for wave-1: the locked design package treats `/approvals`, `/reports`, Pipeline, and `/activity` as a single paper-and-ink register — editorial display face, JetBrains Mono numerals, Inter prose, paper background, amber accent, hairline borders — applied to **dense forensic surfaces** rather than magazine spreads. This is not a relapse into mixing registers; it is the Tools-tier convergence, and the entry that needs updating is the memory file, not this surface.

The page-head display title on Tools-tier surfaces names what the surface is (`Audit log`, `Reports`, `Contacts`) — no italic accent, no editorial flourish. Editorial-flourish moves (Cormorant italic accent on a key noun) are reserved for editorial-tier surfaces (agent homes, decision cards, marketing pages) and for *interior* editorial pauses on Tools-tier surfaces (empty-state headlines, error-banner messages, drawer prose notes), where prose is doing the work.

**How to apply:** if a future Tools surface introduces a chart, a non-mono numeric, or a non-hairline border, treat it as register drift and surface the question. A display-face headline over a dense table is the Tools-tier shell; an italic-accented display-face headline is the editorial shell.

---

## 2. Architectural decisions (with flip notes)

| # | Decision | Reason | Flip cost |
|---|---|---|---|
| 2.1 | Replace `<table>` with CSS Grid (`div`s + `role` attrs) | The locked design uses div-grid for col alignment; the existing v1 uses `<table>` and has to inject `<tbody>` between drawer rows. Div-grid keeps drawer markup linear. | Medium — undo with a `<table>` swap and `<tr>` re-wrapping of drawer. |
| 2.2 | Chevron is the only interactive target in a row; row body stays text-selectable | The locked design clicks the row, but the existing v1 carries an explicit `CRITICAL UX INVARIANT: The row body is NON-INTERACTIVE` comment so operators can copy identifiers (Stripe ids, envelope ids, hashes) out of the `summary` cell without collapsing it. Forensic UX wins over scan speed; we preserve the v1 invariant. | Low — promote the row to `role="button"` with row-level `onClick`, drop the chevron's button semantics. The locked design's behaviour is the flipped state. |
| 2.3 | Custom scope is a status badge, not a button | `custom` is server-derived from `appliedFilters` non-emptiness; clicking has no defined semantic. Rendering it as a third button invites operators to click and feel stuck. Instead the segmented control is two buttons (Operational / All) and `· Custom` appears as an inline status badge with amber dot only when narrowing is active. | Low — promote the badge back to a third button with `aria-disabled`. |
| 2.4 | Page-local counts on combobox and actor pills | Keyset pagination cannot compute totals cheaply; counts are derived from the loaded page. Counts are labeled with a `on this page` suffix so they cannot be misread as totals. The surrounding "limit 50 · cursor head" chrome line reinforces this. | Low — drop counts entirely if the suffix is still felt to mislead. |
| 2.5 | Hide "last ledger entry" stat tile when narrowing is active | The backend doesn't return a ledger-head timestamp. Deriving from `rows[0].timestamp` lies when filtered. Hiding the tile when narrowing is active is honest; not hiding it during Operational / All is also honest because rows[0] is the head under those scopes. | Medium — show with a tooltip "last on page" when narrowed; or, as a follow-up, add `ledgerHead` to `AuditEntriesListResponse` (out of scope here). |
| 2.6 | Non-unmounting error banner | The existing v1 swaps the table for `EmptyState variant="filtered"` on error (see the `isError` branch of `activity-page.tsx`'s render), losing the previously-loaded page. The locked design keeps the table mounted and shows an inline banner with retry. Better forensic UX. | Low — replace banner with EmptyState swap. |
| 2.7 | Bottom-right fixed stale pill (no polling) | Polling fights cursor stability (see the `// NO refetchInterval` comment in `useActivityList`). The pill anchors `Date.now()` from page-load wall clock (not the API anchor) so "fetched Nm ago" is honest. Mirrors the chat15 fix. | Low — pill is its own component, replace with always-visible refresh button or remove. |
| 2.8 | Inline accordion drawer, not modal or side panel | Side panels hide context; modals freeze scrolling. Forensic work needs the chain to stay visible while inspecting a row. | Low — swap drawer host. |
| 2.9 | Cursor stack on the **client** | Existing v1 already does this (`prevCursorStack` state in `activity-page.tsx`). Keyset has no inherent "previous cursor"; storing the prior cursors lets `← Newer` work. Filter changes clear the stack. | None — preserved verbatim. |
| 2.10 | Filter state is client-local; URL params are deep-link input | Existing v1 mirrors filters into the URL on every change. The rebuild reads the URL on mount and on back/forward, but does not write filter changes back. Simpler, fewer re-renders, but loses deep-link copy-paste fidelity. | Medium — re-add `router.replace` on each filter change (same shape as existing). |
| 2.11 | `view previous ↓` is page-bounded; off-page is inert | Cross-page navigation through the hash chain would require either page-stepping or a server-side row-by-hash lookup, neither of which v1 buys us. When the predecessor is on the current page we scroll + flash; when it's off-page we render a muted "off-page" tag. Predecessor timestamp is *not* surfaced as a hint here to keep the drawer scannable. | Medium — wave-1 follow-up: introduce a `?anchorHash=<entryHash>` URL param that the backend resolves to a cursor anchored at that row. Out of this spec. |

---

## 3. File inventory

```
apps/dashboard/src/app/(auth)/(mercury)/activity/
├── page.tsx                              [unchanged — server entry]
├── activity-page.tsx                     [rewritten — local filter state shape]
├── activity.module.css                   [rewritten — editorial paper tokens]
├── fixtures.ts                           [extended — 30-row v2 distribution]
├── hooks/use-activity-list.ts            [unchanged]
└── components/
    ├── header.tsx                        [rewritten — editorial topbar + page-head]
    ├── filter-strip.tsx                  [NEW — sticky filter rail]
    ├── scope-segment.tsx                 [NEW — Operational / All / Custom]
    ├── event-type-combobox.tsx           [NEW — banded autocomplete over 45 types]
    ├── actor-pills.tsx                   [NEW — 4 mutually-exclusive toggles]
    ├── date-range.tsx                    [NEW — after / before date inputs]
    ├── entity-selector.tsx               [NEW — type select + id input]
    ├── activity-table.tsx                [rewritten — div-grid]
    ├── activity-row.tsx                  [rewritten — glyph, badge, risk hairline]
    ├── activity-row-drawer.tsx           [rewritten — hash chain, evidence, references]
    ├── error-banner.tsx                  [NEW — non-unmounting]
    ├── stale-pill.tsx                    [NEW — bottom-right fetched-Nm-ago pill]
    ├── pagination-footer.tsx             [retained, restyled]
    ├── empty-state.tsx                   [rewritten — zero vs filtered]
    └── format.ts                         [extended — fmtClock, fmtRel, fmtFullISO, eventBand]
```

`filter-chips.tsx` is removed. `MercuryFilterChips` (the shared primitive at `apps/dashboard/src/components/mercury/filter-chips/`) is not deleted — it stays in use by `/contacts` and `/automations`. If it falls out of use after the wave-1 rebuild, retirement is handled as a separate cleanup PR.

Each file in the table above is targeted to stay under 400 lines (the CLAUDE.md warn threshold). The locked design is one giant `ActivityApp` component; this decomposition is the cost of fitting it into the codebase budget.

---

## 4. Data flow

```
URL                       ──┐
   /activity?scope=all&     │ readScope, readNarrowingParams (mount + back/forward only)
   eventType=action.failed  │
                            ▼
              ┌─────────────────────────┐
              │  ActivityPage state     │
              │  scope, eventType,      │      ┌──────────────────────────┐
              │  actorType, dateRange,  │      │   useActivityList(query) │
              │  entitySel, cursor,     ├─────▶│   ─▶ GET /api/dashboard  │
              │  prevCursorStack,       │      │      /activity?…          │
              │  expandedId             │      └──────────────────────────┘
              └─────────────────────────┘                  │
                       │                                   ▼
                       │            { rows, nextCursor, scope, appliedFilters }
                       ▼                                   │
              ┌─────────────────────────┐                  │
              │  filter-strip           │                  │
              │  scope-segment ◀────────┼──────────────────┘ (effectiveScope)
              │  combobox / pills / …   │
              └─────────────────────────┘
                       │
                       ▼
              ┌─────────────────────────┐
              │  activity-table         │
              │  activity-row × N       │
              │  └─ activity-row-drawer │  (inline; toggles via expandedId)
              └─────────────────────────┘
```

**Filter-change invariant** (preserved verbatim from the `filterSignature` `useEffect` in `activity-page.tsx`): any change to `scope` OR any narrowing field clears `cursor`, `prevCursorStack`, and `expandedId`. The filter signature is the same `[scope, eventType, actorType, entityType, entityId, after, before].join("|")` pattern.

**Effective scope for display:** `data.scope` from the API response (which can be `"custom"`). Local `scope` state is `"operational" | "all"` only; the segmented control reads `effectiveScope` for the active-button highlight, and writes `scope` (clamped to operational/all) on click. The inline `· Custom` status badge appears when `effectiveScope === "custom"` (see §5.2).

**Fixture mode:** when `!isMercuryToolLive("activity")`, the page filters in-memory exactly as it does today (`filterFixturesByScope` in `activity-page.tsx`), plus applies the new narrowing fields with the same logic the locked `app.jsx` uses in its `filteredRows` memo.

---

## 5. Components

### 5.1 Editorial header + page-head (`header.tsx`)

Two stacked regions inside `EditorialAuthShell`'s content slot:

- **Topbar row** — Switchboard mark + org slug + page slug (amber underline) on the left; "audit ledger" live-pip (steady green dot, no animation), SGT clock (mm-precision), me-chip (initials + display name) on the right. Sticky to viewport top under the editorial shell.
- **Page-head grid** — `minmax(0,1fr) auto` two-column.
  - Left: `eyebrow "Mercury Tools · /activity"`, display title **`Audit log`** (editorial display face via `--font-display` / `.font-display` — whatever the editorial shell currently ships; no italic accent, no editorial flourish). Prose subhead in Inter ~14.5px max-width 44em: "Every mutation by every actor — user, agent, service account, system — lands here, hash-chained. By default this shows the operator-visible actions; switch to All to inspect the full audit vocabulary."
  - Right: a single `last ledger entry` stat tile (relative time + "chain head · verified" sub-line). The "entries shown" and "scope" tiles are dropped — both duplicate information already present in the filter strip's `· Custom` badge and the pagination footer's `Showing N of …` line. The remaining `last ledger entry` tile is hidden when `appliedFilters` is non-empty (§2.5), so an empty page-head right-column is a normal state under narrowing.

Tile numerals are mono with `font-variant-numeric: tabular-nums`. Eyebrows are 11px mono uppercase, tracked 0.14em, `--ink-3`. No icons. No display-serif headline at any size larger than this.

### 5.2 Filter strip (`filter-strip.tsx` + children)

Sticky region directly under the topbar (z-index between topbar and table). Two-row flex layout:

**Row 1** — `scope · event · actor`
- **`scope-segment.tsx`** — hairline segmented control with **two** buttons (Operational / All). Active = solid ink background, paper text. When `effectiveScope === "custom"` (server-derived from any narrowing param), an inline `· Custom` status badge with a 5px amber dot appears immediately to the right of the segmented control. The badge is *not* a button — it has no click handler, no `role="button"`, and is `aria-hidden` for screen readers (the narrowing affordances below already announce the active filter to AT). The operator's underlying Operational/All choice stays visible (whichever button is highlighted), so the chip group reads as "Operational, plus narrowing" rather than "Custom alone."
- **`event-type-combobox.tsx`** *(simplified v1)* — input that opens a popover list. Options are grouped under non-sticky band headers (`Action lifecycle` / `Identity & governance` / `Events & reactions` / `Agent & WorkTrace`) — the headers scroll with the list. Each option shows its name and a page-local count labeled `· N on this page` (matches §2.4). Typing in the input live-filters the list by substring match (no `<em>` highlight in v1). Selected option gets an amber-paper background. Keyboard support: ↑/↓ move highlight, Enter selects, Esc closes, `×` clears. **Deferred to the conventions doc / wave 1.5:** sticky band headers, match-substring highlighting, and one-line band descriptions. The locked design ships all three; v1 ships none. The forensic value is in the table and drawer, not the combobox flourish — if any of the deferred items is wanted across surfaces, it should land as a primitive in `mercury/` rather than per-surface bespoke chrome.
- **`actor-pills.tsx`** — four rounded-pill toggles (User / Agent / System / Service). Mutually exclusive: clicking the active one deselects. Counts on each pill carry the same `· N on this page` suffix as the combobox. **A muted helper line sits directly under the pills:** `Specific actor filtering (e.g. just Alex) is not yet available — see §1.2.` This sets expectation explicitly so an operator selecting `Agent` does not assume the page is broken when all three canonical agents are commingled.

**Row 2** — `range · entity · meta · clear`
- **`date-range.tsx`** — two-segment hairline shell; each segment has an `after` / `before` eyebrow label and an `<input type="date">`. Local-TZ display, ISO out. `×` button clears both when either is set.
- **`entity-selector.tsx`** — type `<select>` (populated from `distinct entityTypes` over the loaded page, sorted) + freeform id `<input>`. Server accepts each independently.
- **filter-meta** — small mono "limit 50 · cursor head" indicator. Chrome only.
- **`Clear filters`** — outlined pill, right-aligned, shown only when any narrowing is active.

### 5.3 Activity table (`activity-table.tsx` + `activity-row.tsx`)

`div`-grid table at `max-width: 74rem`. Grid template: `96px | minmax(180px,220px) | minmax(150px,180px) | minmax(150px,180px) | 1fr | 24px`.

**ARIA grid structure** — because we're using `div`-grid instead of a semantic `<table>`, the markup must carry explicit grid roles: the table-wrap is `role="table"`, the header bar is a `role="row"` inside a `role="rowgroup"`, each header cell is `role="columnheader"`, the body block is its own `role="rowgroup"`, each data row is `role="row"`, each cell is `role="cell"`, and the inline drawer is `role="region"` (already specified in §5.4) — *not* a row, so it sits outside the rowgroup. If this becomes awkward (e.g. focus management between row and drawer fights the rowgroup boundary), the fallback in §2.1 is to revert to semantic `<table>` / `<tbody>` markup; do not ship the div-grid without the role attributes.

**Header row** — 1px solid ink bottom border. Six 10px mono uppercase eyebrows: `Time · Event · Actor · Entity · Summary · ·`.

**Body rows** — 44px nominal height (12px padding × 2 + 20px content), 1px hair-soft bottom border.
- `col-time` — column flex: mono `HH:MM:SS` over muted `Nm ago`.
- `col-event` — hairline mono pill containing a 5px band-dot + event type text. Band → dot color: `action.*` → amber, `identity.* / overlay.* / policy.* / connection.* / competence.* / delegation.* / entity.*` → ink-3, `event.*` → ink-5, `agent.* / work_trace.*` → ink.
- `col-actor` — 28×18 glyph (`USR` / `AGT` / `SYS` / `SVC`) + mono actorId truncated. Glyph border style by type: `user` solid ink-3, `agent` solid amber on amber-paper, `system` dashed, `service_account` dotted.
- `col-entity` — column flex: 10px uppercase entityType over mono entityId.
- `col-summary` — Inter 13.5px, single-line `text-overflow: ellipsis`. Inline `+N redacted` dashed pill when `redactedKeyCount > 0`.
- `col-chevron` — a real `<button type="button">` containing `›` that rotates 90° when row is open. This is the **only** interactive element in the row; the rest of the cells are non-interactive selectable text.

**Risk indication** — pseudo-elements:
- `::before` (left edge, 1–3px wide, `--hair → --ink` weighted by `data-risk`).
- `::after` (right edge, 3px wide, `transparent → rgba(160,120,80, 0.18)` amber tint weighted by `data-risk`).

Row hover: 2.5% ink background. Row open: amber-paper background. Row target (post-scroll): 1.6s amber-paper flash via CSS keyframe.

Interactivity per §2.2: **the row body itself has no `onClick` and no `role="button"`** — operators can select transaction ids, hashes, and envelope ids from the summary cell without collapsing the row. The chevron button carries `aria-expanded`, `aria-controls={drawerId}`, and `aria-label="Toggle details for entry <id>"`. The locked design's "click anywhere on the row" behaviour is the §2.2 flipped state if reviewers want it.

### 5.4 Inline drawer (`activity-row-drawer.tsx`)

Two-column CSS grid, `minmax(0,1fr) minmax(0,1fr)`, collapses to one column under 980px. Background paper-warm, top + bottom hairline. Enter animation: 280ms `cubic-bezier(0.4,0,0.2,1)`, slide-down 4px + opacity 0→1.

Sections (each has a 10px mono uppercase label):

1. **Timestamp** — `YYYY-MM-DD · HH:MM:SS.mmm ±HH:MM` mono, with prose note "stored as ISO-8601 UTC on the entry; rendered in your browser's local timezone."
2. **Visibility · classification** — `visibility: <level> · risk: <category> · event: <eventType>` inline mono, with prose note about server-side visibility filtering.
3. **Snapshot keys** *(full-width row)* — Inline chips of allowlisted key names (paper-raised, hairline, 11px mono) + `+N redacted` dashed pill when applicable. Prose note enumerates the 13 allowlist keys verbatim: `id, kind, source, actionType, decisionId, recommendationId, approvalId, envelopeId, agentKey, targetEntityType, targetEntityId, correlationId, traceId`.
4. **Evidence pointers** *(full-width row)* — one row per pointer: `type` eyebrow (left, 56px), `hashPrefix` highlighted ink over `hash.slice(16)` muted ink-4 (truncated with title attr for full hash), `[copy hash]` button on the right. Empty: italic "no evidence pointers attached." **Absence note** in a dashed box: "`storageRef` intentionally absent — evidence reference is held server-side. Clients fetch evidence via authenticated `/api/evidence/:hash`."
5. **Hash chain · integrity anchor** *(full-width row)* — two `chain-row`s inside a section with top + bottom 1px ink borders.
   - `Entry hash` row: full mono hash + `[copy]` button.
   - `Previous` row: full mono hash + `[copy]` button + **`view previous ↓`** button (ink-bordered) when a row on the current page has `entryHash === thisRow.previousEntryHash`. If predecessor is off-page: muted "off-page". If `previousEntryHash === null`: italic "— genesis (no predecessor) —" and label color shifts to ink.
6. **References** *(full-width row)* — two rows in hairline boxes:
   - `Envelope` — when set: id mono + `[copy]` + `open ↗` link (`/approvals/[envelopeId]`). When null: dashed box, italic "no approval envelope".
   - `Trace` — same shape, link `/traces/[traceId]`, fallback "no correlation trace".

**Copy semantics** — `navigator.clipboard.writeText` wrapped in try/catch (existing v1's `copyToClipboard` helper at the top of `activity-row-drawer.tsx`). On success, button gets a 1.1s `copied` state (amber background, white text). Multiple copy buttons on one drawer track their own state by key (e.g., `"ev0"`, `"eh"`, `"ph"`, `"env"`, `"tr"`).

**View-previous scroll** — `scrollIntoView({ behavior: "smooth", block: "center" })` on the target row's ref. The drawer host (`activity-table.tsx`) holds a ref map keyed by row id and exposes a `scrollToRow(id)` function plus a 1700ms `targetId` flash applied to the target row.

### 5.5 Error banner, stale pill, empty state, pagination

- **`error-banner.tsx`** — full-width strip above the table when `isError`. Eyebrow "request failed", italic display-serif message with the failing path + status (e.g., "GET /api/dashboard/activity returned 503 after 8s. The previous page of entries is still shown below; nothing was dropped."), `[Retry]` button. Does **not** unmount the table.
- **`stale-pill.tsx`** — `position: fixed; right: 22px; bottom: 22px`. Shows `fetched <Nm ago | just now>` + ink-bordered `[refresh]` button. `fetchedAt` is wall-clock `Date.now()` set on `useActivityList` success; ticker recomputes Nm every 15s.
- **`empty-state.tsx`** — two variants:
  - `zero` — eyebrow "ledger health", display headline "No activity *recorded yet*.", prose context, mono "last recorded" + chain-head verified line. Shown when `rows.length === 0 && !narrowing && scope === "operational"`.
  - `filtered` — eyebrow "no matches", display headline "No entries match *these filters*.", prose with the count of rows scanned in the current scope, `[Clear filters]` CTA.
- **`pagination-footer.tsx`** — info line on the left (`Showing N of … · keyset cursor — total unknown by design · limit 50`), navigation buttons on the right (`← Newer` disabled when `prevCursorStack.length === 0`; `Older →` disabled when `nextCursor === null`). 1px top hair border. Hidden in fixture mode (preserved from v1).

---

## 6. Fixtures

Extend `fixtures.ts` to mirror the 30-row distribution in `docs/design-prompts/locked/switchboard/project/activity-v2/data.js`:

- 30 rows, DESC by timestamp, fully hash-chained (each row's `previousEntryHash` equals the next row's `entryHash`).
- 22 distinct event types across all 4 bands.
- All 4 actor types (`user`, `agent`, `system`, `service_account`).
- Mix of risk: `none` / `low` / `medium` / `high` / `critical` represented at least once each.
- 4 rows with `envelopeId` set (approval lineage).
- 2 rows with `redactedKeyCount > 0` (notable values: 5 and 7).
- 1 row outside the operational allowlist (`event.published`) so toggling to "All" reveals at least one extra row that "Operational" hid.

Fixtures must still parse against `AuditEntryBrowseRowSchema` — `hashPrefix` is the first 16 chars of `hash`, `timestamp` is ISO string, `visibilityLevel` is `"public" | "org"`. The existing fixture file (`fixtures.ts`) parses against the schema via the hook's response validator; extend, don't replace.

---

## 7. State coverage matrix

| State | Trigger | Treatment |
|---|---|---|
| Idle (operational) | First mount, default scope, no narrowing | Filter strip shows Operational active, 30 fixture rows visible, last-ledger tile shows `Nm ago`. |
| Loading | `useQuery.isLoading` true | Skeleton table: 10 rows of shimmer bars, preserve row height. |
| Empty (zero) | `rows.length === 0 && !narrowing && scope === "operational"` (live mode) | `empty-state variant="zero"` shown. Table region replaced. Pagination hidden. |
| Empty (filtered) | `rows.length === 0 && (narrowing || scope === "all")` | `empty-state variant="filtered"` with `[Clear filters]` CTA. Table region replaced. |
| Error | `useQuery.isError` | `error-banner` above the table; **table stays mounted** with last successful page. Retry button refetches. |
| Stale | Page has been open for ≥1 minute since last `useQuery` success | Stale pill shows `fetched Nm ago`; refresh button forces refetch. No auto-refresh. |
| Custom scope | Any narrowing param present | Operational or All remains visually selected as the base scope; an adjacent `· Custom` status badge with amber dot appears next to the segmented control. Clearing filters returns to the base scope, not always Operational. |

---

## 8. Accessibility

- The page is a single landmark region (`<main>` provided by editorial shell).
- Filter strip is a `<form role="search">` with a labeled fieldset per affordance group. Eyebrow labels are `<label>` elements bound by `htmlFor`.
- Segmented scope control: `role="group"` + `aria-label="Activity scope"`. Each of the two real buttons (Operational, All) has `aria-pressed`. The `· Custom` status badge is `aria-hidden="true"` — narrowing affordances themselves carry the screen-reader announcement.
- Combobox follows the WAI-ARIA combobox-with-listbox pattern: input has `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; listbox has `role="listbox"`; options have `role="option"` + `aria-selected`. Band-header band-description lines are inside `<div role="presentation">` so the listbox tree remains options-only.
- Date inputs are native `<input type="date">` with `<label>` wrappers — keyboard + screen-reader support is browser-provided.
- The row body is non-interactive (per §2.2 + §5.3); the chevron is the only `<button>` in the row, with `aria-expanded` reflecting drawer state, `aria-controls={drawerId}`, and an explicit `aria-label="Toggle details for entry <id>"`. Enter/Space activate the chevron when focused. This mirrors the existing v1 invariant and keeps summary text selectable.
- Drawer is `role="region"` with `aria-label="Audit entry detail"`. Copy buttons announce success via the visual `copied` state; no `aria-live` injected (a 1.1s flash is local feedback, not an announcement).
- "View previous ↓" is a `<button>` (not a link) because the action is a scroll, not navigation. After scroll, focus moves to the target row.
- Error banner has `role="alert"` so screen readers announce the failure.
- Stale pill is `role="status"` with `aria-live="polite"` on the age value.
- Risk indication is decorative (pseudo-elements on the row). `riskCategory` is also surfaced as text inside the drawer's Visibility section, so screen reader users get it there.

---

## 9. Tests

Co-located unit tests using the existing vitest setup. New files:

- `components/__tests__/scope-segment.test.tsx` — `· Custom` status badge appears when `effectiveScope === "custom"` and is absent otherwise; the badge has no click handler and no `role="button"`; clicking Operational/All updates scope and clears narrowing only via the page-level reset (not the segment).
- `components/__tests__/event-type-combobox.test.tsx` — grouped band rendering when input empty; flat filtered rendering with `<em>` highlight when typing; keyboard navigation; clearing.
- `components/__tests__/actor-pills.test.tsx` — mutual exclusion; click-to-deselect.
- `components/__tests__/date-range.test.tsx` — ISO output for `after` and `before`; `×` clears both; `before < after` is allowed (server validates).
- `components/__tests__/entity-selector.test.tsx` — type and id independence; selector populated from page rows.
- `components/__tests__/activity-row.test.tsx` — band-dot per event-type band; actor glyph per type; risk hairline width per category; `+N redacted` pill only when `redactedKeyCount > 0`; **the row body has no `onClick` and no `role="button"`**; chevron button toggles via click and via Enter/Space; clicking inside the summary cell does NOT toggle the drawer (regression guard for §2.2).
- `components/__tests__/activity-row-drawer.test.tsx` — full ISO + TZ rendering; snapshot key chips for allowlist members only; "no snapshot keys recorded" when empty; **never renders `storageRef`** (defense-in-depth even though browse row doesn't carry it); copy buttons no-throw when clipboard unavailable; "view previous ↓" calls scroll handler when predecessor is on-page; "off-page" message when not; genesis-row treatment for `previousEntryHash === null`; envelope/trace empty + present states.
- `components/__tests__/error-banner.test.tsx` — banner mounts above table; **table is NOT unmounted** when banner is shown; retry triggers refetch.
- `components/__tests__/stale-pill.test.tsx` — "just now" when fresh, "Nm ago" after 60s+; refresh calls refetch.
- `components/__tests__/empty-state.test.tsx` — zero variant when scope=operational + no narrowing + 0 rows; filtered variant otherwise; CTA wires to clear handler.
- `__tests__/activity-page.test.tsx` — filter-signature reset clears cursor stack + expanded row; URL-param read on mount; `effectiveScope` from API response overrides local scope for display only.

The operational allowlist test (`packages/schemas/operational-allowlist.test.ts`) is unchanged and remains authoritative.

---

## 10. Shared-conventions input (flags for `docs/design-prompts/shared-conventions.md`)

The following decisions are made in this surface but feel like they want to be codified across all five wave-1 surfaces. They are flagged here for wave 1.5 to pick up; this spec does not extract primitives.

1. **Sticky filter strip** — paper background, hairline top + bottom borders, max-width matches the page's `--max-w`, sticky offset matches the topbar's resolved height.
2. **Segmented scope control** — two-button hairline group (active = solid ink) plus an inline status badge for server-auto-derived state (e.g., `· Custom` with amber dot). Server-derived state is never a button; if narrowing must be cleared, that's the surrounding `Clear filters` pill's job.
3. **Banded combobox** — popover list with band-grouped options + page-local counts + amber-paper selection background + ×-to-clear. The fancier moves (sticky band headers, `<em>` match highlight, one-line band descriptions) ship in v1 only if they become a shared primitive — surfaces should not implement them bespoke.
4. **Date range shell** — two date inputs in a single hairline group, `after` / `before` eyebrows, shared clear-both ×.
5. **Risk indication** — left-edge hairline weight (1→3px ink depth) + right-edge amber tint (0→0.18α). No RGB hues.
6. **Actor glyph (3-letter mono)** — 28×18 box, border-style encodes actor-type semantic (solid / amber / dashed / dotted). Codified labels: USR / AGT / SYS / SVC.
7. **Event-band dot** — 5px circle keyed off the noun prefix (`action.` / `identity.` family / `event.` / `agent.`+`work_trace.`). The 4-bucket bucketing is the canonical reduction over 45 event types.
8. **Inline accordion drawer** — never a modal for read-only forensic detail; the drawer expands inline below its row and preserves scroll context. Two-column grid that collapses to one column under 980px. 280ms entry.
9. **Copy-pill micro-component** — `[copy]` / `[copy full]` / `[copy hash]` buttons with a 1.1s amber confirmed state; `navigator.clipboard.writeText` wrapped in try/catch; no toast.
10. **Stale-fetch pill** — fixed bottom-right; the canonical replacement for polling on Tools-tier list surfaces. Anchors to page-load wall clock, not API response time.
11. **Non-unmounting error banner** — paginated lists never erase prior data on error; banner sits above the still-mounted table with a retry.
12. **Empty-state cadence** — section eyebrow + display-serif italic-emphasized headline + Inter prose + (optional) CTA. Two variants (`zero`, `filtered`) on every Tools list.
13. **Page-head pattern** — eyebrow + display title (editorial display face via `--font-display`, no editorial-flourish italic on Tools-tier surfaces — Mercury-tier surfaces name what they are) + prose lead + at most one right-aligned status tile (mono numerals, `font-variant-numeric: tabular-nums`). Counts that duplicate filter-strip / pagination-footer info do not earn a tile.
14. **Hash-chain anchor visual** — top + bottom 1px ink borders to mark integrity-bearing data inside a drawer that otherwise uses hairlines.
15. **CSS-module-local design tokens** — the locked design CSS files introduce local aliases (`--paper`, `--ink`, `--hair`, `--amber`, `--amber-paper`, `--amber-deep`) that are not in `globals.css`. Each wave-1 surface declares these inside its own CSS module rather than `globals.css`. Wave 1.5 decides whether to (a) lift them into `globals.css` as the canonical editorial palette, (b) alias them onto existing `--sw-*` tokens, or (c) leave them per-module. Until that decision, **`globals.css` is not edited from any wave-1 surface PR**.

The conventions doc decides whether each of these is a primitive (lifted into `apps/dashboard/src/components/mercury/` or `…/editorial/`), a Tailwind utility, or just a documented pattern.

---

## 11. Risks and unknowns

- **Stale memory drift (`project_two_register_design.md`).** The 9-day-old memory describes the Tools tier as Mercury banking-style. Wave-1 has converged on editorial paper-and-ink for Tools surfaces (`/approvals`, `/reports`, `/mission`, `/activity` rebuilds). Either the memory needs updating or the rebuild needs justification on every PR. **Mitigation:** update the memory as a small follow-up after wave 1 lands.
- **Filter strip sticky offset and the editorial shell.** The editorial shell already has a sticky top region. The filter strip's `top: 57px` (locked CSS) assumes a 57px topbar; ours is likely different. **Mitigation:** use a CSS custom property `--editorial-topbar-height` exposed by the shell (or measure with a ResizeObserver if the shell doesn't expose one).
- **Combobox count semantics.** Page-local counts can read as totals to operators who don't notice the "keyset cursor — total unknown" chrome. **Mitigation:** flip 2.4 if reviewers find them misleading.
- **Row interactivity inversion (§2.2).** The locked design clicks the row; we keep the existing v1's chevron-only invariant. Reviewers familiar with the locked HTML may push back. **Mitigation:** §2.2 flip cost is low and the change is gated on a single component file; the row click can be re-enabled in a follow-up if the call goes that way.
- **`<table>` → `div`-grid (§2.1).** Screen-reader users lose table semantics. **Mitigation:** if accessibility review pushes back, fall back to a real `<table>` with `<tbody>` chunking around drawers.
- **Display-face drift between memory, `globals.css`, and the locked design.** The dashboard `globals.css` declares `--font-display: "Instrument Sans"` near the top of the file and separately wires an editorial Source Serif 4 + JetBrains Mono stack from `next/font` via `app/layout.tsx` (loaded into `--font-serif` / `--font-mono-editorial`). The locked CSS (`activity-v2/styles.css`) names Cormorant Garamond as `--font-display`. The project memory's "Key Design System" block also says Cormorant Garamond, dated before the Source Serif 4 wiring landed. The rebuild consumes whatever face the editorial shell exposes via `--font-display` / `.font-display` — **the spec deliberately does not name a font directly in §5.1**, and **does not introduce new `next/font` declarations** in this surface. **Mitigation:** if the rendered display face looks wrong during implementation, fix it in the shell + `globals.css`, not in `/activity` CSS modules. Surface the drift in the wave 1 wrap-up.
- **`actorId` filter gap (see §1.2).** The most common forensic question — "what did Alex do?" — has no native answer on this surface, only the `entityType=agent&entityId=<id>` proxy that misses rows where the agent is the *actor*. Operators investigating a specific actor will hit this within five minutes of use. **Mitigation:** call it out in onboarding / docs; queue the additive backend change for wave-1.5 or post-launch.
- **Day-granular date range.** `<input type="date">` only narrows to a day; operators investigating "around 14:23" must scroll a full day's worth of rows. The backend accepts ISO datetime. **Mitigation:** if this bites repeatedly, swap to a date-and-time picker. Not a v1 blocker.

---

## 12. Acceptance criteria

A reviewer can validate this spec by walking the rebuilt page and confirming:

### Hard invariants (any violation is a regression, not a stylistic call)

- **H1.** Row body must remain selectable text. The row carries no `onClick`, no `role="button"`, and no `tabIndex`. The chevron is the only interactive element in a row. Any row-level click handler is a regression.
- **H2.** `storageRef` is never rendered anywhere on the page — including when an upstream fixture or test seed accidentally contains it. The drawer reads only the allowlisted fields from `AuditEntryBrowseRow`.
- **H3.** Snapshot *values* are never rendered. Only allowlisted key *names* appear; everything else is collapsed into `redactedKeyCount`.
- **H4.** Copy buttons never throw, even when `navigator.clipboard` is missing or permission is denied. They no-op visually instead.
- **H5.** Fetch errors never unmount the table. The previous page of rows stays on screen with an inline banner above.
- **H6.** "Last ledger entry" tile is hidden whenever `appliedFilters` is non-empty.

### Walk-the-page acceptance

1. The filter strip exposes scope segment (two buttons), event-type combobox, actor pills, date range, and entity selector. Setting any narrowing param shows the `· Custom` status badge next to the segmented control and the `Clear filters` pill at the right edge of the strip.
2. Each row shows mono clock + relative time, hairline event-type badge with band-dot, actor glyph, entityType/entityId stack, summary with `+N redacted` pill when applicable, left-edge risk hairline, right-edge amber risk tint. Selecting text inside the summary cell does not toggle the drawer (per H1).
3. Expanding a row (chevron click, or Enter/Space when chevron is focused) reveals an inline drawer with full ISO timestamp, snapshot key chips (no values per H3), evidence rows with `hashPrefix · rest-of-hash` + copy-hash, the "storageRef intentionally absent" dashed note (per H2), hash-chain anchor with copyable full hashes, "view previous ↓" that scrolls when predecessor is on-page (inert "off-page" tag otherwise), envelope and trace rows with copy + open links.
4. Triggering a fetch error shows the inline banner with retry; the previous page of rows is still visible (per H5).
5. Page-load wall-clock anchors the stale pill; 60s after load it reads `1m ago`; refresh button refetches. **The stale pill does not appear before the first successful fetch** — it's hidden during initial loading and during the error state when no successful page has been rendered yet.
6. Empty zero state reads "No activity recorded yet" with ledger-health context. Empty filtered state reads "No entries match these filters" with a Clear CTA.
7. Pagination shows `Showing N of …`; `← Newer` is disabled at the head; `Older →` is disabled when `nextCursor === null`.
8. Counts on the combobox and actor pills are visibly suffixed with `on this page` so they cannot be misread as totals.
9. The page-head displays `Audit log` plain (no italic accent, no editorial flourish) and contains at most one stat tile (`last ledger entry`, hidden under narrowing per H6).
10. **Changing any filter clears expanded drawer state** (`expandedId` is reset alongside `cursor` and `prevCursorStack` whenever the filter signature changes).
11. **Clearing filters returns to the operator's underlying scope choice (Operational *or* All), not always Operational.** The clear handler resets only narrowing fields; it does not overwrite the segmented-control selection.
12. The actor pills carry the muted helper line `Specific actor filtering (e.g. just Alex) is not yet available` so an operator selecting `Agent` understands they are seeing all canonical agents commingled.
13. Every assertion in §1.2 holds — including the `actorId` filter gap and the page-bounded `view previous ↓`.
14. All tests in §9 pass.
15. `pnpm typecheck` and `pnpm --filter @switchboard/dashboard build` succeed locally (per `memory/feedback_dashboard_build_not_in_ci.md` — `next build` is not in CI).

---

## 13. Implementation phasing (three PRs)

The surface looks small ("a UI rewrite") but the implementation surface is closer to a mini app rebuild: new filter strip, custom popover list, four filter affordances, div-grid table with ARIA roles, drawer with hash-chain navigation, stale pill, non-unmounting error banner, extended fixtures, and the test surface for all of the above. Shipping it as one PR makes review impractical. The spec is staged into three PRs against the same `docs/activity-rebuild-design-spec`-derived implementation branch, each independently mergeable behind the existing `NEXT_PUBLIC_ACTIVITY_LIVE` flag (which already gates the surface).

### PR-A — Table + drawer rebuild (forensic core)

The forensic UX lands first. Filter strip is **not** in this PR — the page continues to ship the existing two-chip `filter-chips.tsx` until PR-B replaces it.

Ships:
- `header.tsx` rewrite (editorial topbar + plain `Audit log` page-head + single status tile).
- `activity-table.tsx` + `activity-row.tsx` rewrite (div-grid, ARIA roles, band-dot badge, actor glyph, risk hairline + tint, chevron-only interactivity).
- `activity-row-drawer.tsx` rewrite (snapshot key chips, evidence rows with copy, "storageRef intentionally absent" note, hash-chain anchor with `view previous ↓`, envelope / trace rows with copy + open).
- `format.ts` extension (`fmtClock`, `fmtRel`, `fmtFullISO`, `eventBand`).
- `fixtures.ts` extension to the 30-row v2 distribution.
- Editorial paper-and-ink tokens declared in `activity.module.css` only (per §10 #15).
- Tests for the above components.

Does **not** ship: new filter strip, error banner, stale pill, new empty states, accessibility regression tests for the filter chrome.

### PR-B — Filter strip

Ships:
- `filter-strip.tsx` + `scope-segment.tsx` + `event-type-combobox.tsx` (simplified v1) + `actor-pills.tsx` + `date-range.tsx` + `entity-selector.tsx`.
- The actor-pills helper line ("specific actor filtering not yet available").
- Filter-signature reset behaviour (clears `cursor`, `prevCursorStack`, `expandedId`).
- `Clear filters` pill behaviour (resets narrowing only, preserves base scope per acceptance #11).
- URL-param read on mount + back/forward (no URL writes).
- Tests for each filter component.
- Removal of `filter-chips.tsx`.

Does **not** ship: error banner, stale pill, empty-state rewrites, accessibility regression tests for the table.

### PR-C — Resilience + polish

Ships:
- `error-banner.tsx` (non-unmounting on fetch failure).
- `stale-pill.tsx` (bottom-right, hides until first successful fetch).
- `empty-state.tsx` rewrite (zero + filtered variants with editorial copy).
- `pagination-footer.tsx` restyle.
- Accessibility regression tests across the whole page (grid roles, combobox WAI-ARIA pattern, chevron focus management, drawer focus behaviour, `aria-live` announcements).
- Shared-conventions cleanup: feed §10 items 1–15 into `docs/design-prompts/shared-conventions.md` so wave 1.5 can codify or reject each.

### Cross-PR invariants

- All three PRs land against `main`; the implementation branch consumes this spec from `main` per CLAUDE.md doctrine.
- Hard invariants H1–H6 from §12 must hold after every PR, not just the final one. PR-A introduces H1–H4 (all row + drawer invariants). PR-B introduces H6 (the narrowing-aware tile-hide rule first becomes meaningful when narrowing exists). PR-C introduces H5 (error banner). Each PR's tests must cover the invariants it introduces.
- No backend changes in any of the three PRs.
- Each PR keeps the page rendering on Operational scope under fixture mode (`NEXT_PUBLIC_ACTIVITY_LIVE !== "true"`) so reviewers can validate visually without staging data.

If during PR-A it becomes clear that the table rebuild needs the filter strip to land first (e.g. the new fixtures don't exercise enough of the row variants without scope/event filtering), swap the order to PR-B → PR-A → PR-C. The staging is a heuristic, not a contract.

---

## 14. References

- Locked design: `docs/design-prompts/locked/switchboard/project/activity-v2/{Activity.html,app.jsx,table.jsx,data.js,styles.css}` + chats `chat13.md` (primary intent), `chat14.md` and `chat15.md` (sibling surfaces).
- Backend contracts: `packages/schemas/src/audit.ts` (browse projection block — `AuditEntryBrowseRowSchema`, `AuditEntriesListQuerySchema`, `AuditEntriesListResponseSchema`, `OPERATIONAL_AUDIT_EVENT_TYPES`), `packages/core/src/audit/list-entries.ts`, `apps/api/src/routes/dashboard-activity.ts`.
- Existing surface (D3): `apps/dashboard/src/app/(auth)/(mercury)/activity/`, design spec `docs/superpowers/specs/2026-05-10-activity-d3-design.md`.
- D7 plumbing: `#419` (editorial shell mount), `#422` (route-availability getter), `#423` (Mercury FilterChips primitive — left alone here).
- CLAUDE.md doctrine: branch-per-worktree, specs land on main, file-size budgets (400/600), no `console.log`, no `any`.
- Memory: `project_two_register_design.md` (needs update), `feedback_surface_agnostic_backend.md` (preserved — this spec touches no backend), `feedback_dashboard_build_not_in_ci.md` (acceptance test 10).
