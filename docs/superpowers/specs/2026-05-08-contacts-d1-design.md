# `/contacts` (Slice D1) — Design Spec

_2026-05-08 · amended 2026-05-09 (decisions locked) · part of the agent-first redesign track · Phase D, surface 1 (Tools tier, Mercury register)_

> **Reading posture:** First draft was a single-shot proposal with 20 tentative decisions marked `OPEN:`. They were reviewed on 2026-05-09 and **all 20 are now locked** (see §2.0 Decisions ledger). The OPEN narrative below is preserved for context; the ledger is the binding contract for the implementation plan.

---

## 1. Problem & scope

### 1.0 One-line scope

`/contacts` is a read-only operational register of people already captured by Switchboard. It is **not** a CRM replacement, **not** a pipeline board, and **not** a mutation surface in D1.

### 1.1 What this slice ships

The Tools-tier list view at `/contacts` — a Mercury-register page that lists every `Contact` for the current org with server-side filter, search, and sort, paged at 50 rows per page. It is the first surface in Phase D and the founder's read-side "where's my CRM" answer.

Concretely:

- New route `apps/dashboard/src/app/(auth)/contacts/page.tsx` rendering a Mercury surface that mirrors `/reports`' visual vocabulary (cream + ink + hairline tables + tabular numerals + JetBrains Mono labels).
- New backend endpoint `GET /api/dashboard/contacts` (Next.js proxy) → `GET /api/contacts` (Fastify) → `ContactStore.listForBrowse(...)` (new core method) → `PrismaContactStore` (existing, extended).
- New shared schema `ContactsListQuery` + `ContactsListResponse` types in `packages/schemas` so query params and the page-ready view model are typed end-to-end.
- A small set of opinionated filter chips backed **purely by `Contact.stage`** (`All / New / Active / Customer / Retained / Dormant`) + a single text search input + sortable `Last activity` and `First contact` columns. No `Opportunity`-derived chips in D1 — see §2.0 ledger note on OPEN-9.
- Per-row "open" affordance that **navigates to `/contacts/[id]`** (which D1 does **not** ship — see §6.2 OPEN) — we set the destination but render rows as `<Link>` only when `ROUTE_AVAILABILITY.contact` flips true. Until then, row click is a no-op and the tile renders `aria-disabled="true"` — same pattern as the agent-home pipeline tiles use today.
- Production gate identical to `/reports`: `NEXT_PUBLIC_CONTACTS_LIVE === "true"` flips fixtures off and live data on. Off, the page renders a small fixture so design review and Storybook-style screenshots stay decoupled from a live db.
- Tests at three layers (projection, hook+route, page composition) mirroring the reports + agent-home test patterns already on `main`.

### 1.2 What this slice does **not** ship

- `/contacts/[id]` detail page. Ships in **D1.5** (separate brainstorm + spec). The list links to it, but `ROUTE_AVAILABILITY.contact` stays `false` in this slice, so the link is rendered as `aria-disabled` — same pattern the agent-home pipeline tiles use today (`apps/dashboard/src/lib/agent-home/resolve-link.ts:8-14`).
- **Mutating** actions on contacts. No create/edit/archive/merge/tag/assign in v1. Read-only browse only.
- Absorption of `/me`, `/my-agent`, or `/conversations` into the Tools tier. Legacy routes keep working unchanged. **D4** (route disposition) decides their fate; this slice deliberately does not pre-judge.
- Shared Mercury header chrome / nav. `/contacts` ships its own `ContactsHeader` (a sibling of `ReportsHeader`) with inert nav placeholders, matching the existing `/reports` precedent. Header consolidation is its own future slice.
- The `Tools ▾` / `Contacts` link inside the editorial agent-home header (`EditorialAuthShell`). Operators reach `/contacts` by direct URL or (later) via decision-card / pipeline-tile navigation when the detail route lands. Editorial-header expansion is a Phase D wrap-up.
- Saved filter views, multi-select bulk actions, CSV export, column chooser. All read-side niceties; revisit post-launch.
- An `Opportunity`-scoped variant ("Pipeline" view at `/contacts?view=pipeline` or a sibling `/opportunities` page). The pipeline view lives on the **agent home** today (B5); a Mercury opportunity browse is a future slice.

### 1.3 Why this surface, why now

Three forces converge:

1. **Existing code already links to `/contacts/[id]`.** `apps/dashboard/src/lib/agent-home/resolve-link.ts:22` and the handoff/recommendation decision-card adapters (`packages/core/src/decisions/adapters/handoff-adapter.ts:22`, `recommendation-adapter.ts:48`) already compose `/contacts/:id` and `/contacts/:id/conversations/:thread` URLs. The destinations are dead ends. Shipping the list closes part of that gap and gives the operator a place to land when they click a contact name in any decision card.
2. **Mercury register has only one occupant (`/reports`).** The two-register design is load-bearing for the agent-first redesign (`memory/project_two_register_design.md`). With only one Mercury surface, there's no test of whether the register generalises beyond a static report. `/contacts` is the second occupant and validates that the visual contract scales to dynamic, paginated, filterable data.
3. **Phase D depends on it.** D2 (`/automations`) and D3 (`/activity`) are easier once D1 has settled the Mercury list-page conventions: header, filter chips, table, pagination, empty states. D1 is the pattern; D2/D3 follow it.

### 1.4 Out-of-scope decisions inherited from prior specs

These are **already locked** elsewhere and not re-debated here:

- Two-register split — Mercury for Tools tier (`memory/project_two_register_design.md`; `2026-05-03-agent-first-redesign-roadmap.md` §3).
- Canonical agent names Alex / Riley / Mira (`memory/project_canonical_agent_names.md`).
- Surface-agnostic backend rule (`memory/feedback_surface_agnostic_backend.md`).
- Mercury design tokens already shipped to `apps/dashboard/src/app/globals.css` lines 99–110 (`--mercury-cream`, `--mercury-ink`, `--mercury-accent`, `--mercury-hairline`, `--mercury-row-hover`, `--mercury-pos`, `--mercury-neg`, etc.) — D1 consumes these via the same CSS-module aliasing pattern `/reports` uses (`apps/dashboard/src/app/(auth)/reports/reports.module.css:13-50`).
- Production gate pattern (`NEXT_PUBLIC_<SURFACE>_LIVE`) from `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts:15`.

---

## 2. Decisions

### 2.0 Decisions ledger (locked 2026-05-09)

All 20 OPENs from the first draft have been resolved. Where the locked answer differs from the original `chose <X>`, the **Locked** column reflects the post-review decision. The implementation plan binds to this table; the original OPEN narrative in §2.1–§2.8 is kept for context only.

| #   | Question                                                  | Locked answer                                                                                                                                                               |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | List vs. List+Detail in D1                                | **List-only.** `/contacts/[id]` ships in D1.5.                                                                                                                              |
| 2   | Read-only vs. mutating in v1                              | **Read-only.** No create/edit/archive/merge/tag/assign in D1.                                                                                                               |
| 3   | Detail-route gating                                       | `ROUTE_AVAILABILITY.contact = false` for D1; flips when D1.5 ships.                                                                                                         |
| 4   | Header strategy                                           | **Own `ContactsHeader`** (near-clone of `ReportsHeader`). Shared `MercuryAuthShell` extraction deferred to a later slice once a third Mercury surface lands.                |
| 5   | Editorial-shell nav target                                | Do **not** add Contacts/Tools to `EditorialAuthShell` in D1.                                                                                                                |
| 6   | Stage column source                                       | **`Contact.stage` (lifecycle).** No `Opportunity.stage`. No dual column.                                                                                                    |
| 7   | Per-contact revenue total                                 | Omit. Belongs on the detail page, not the list.                                                                                                                             |
| 8   | Channel column                                            | Show `Contact.primaryChannel`.                                                                                                                                              |
| 9   | Filter primitive                                          | **Lifecycle-only chips:** `All / New / Active / Customer / Retained / Dormant`. No `Opportunity`-derived chips ("Booked", "Has active opportunity") in D1 — defer to D1.5+. |
| 10  | Search shape                                              | Single text input, server-side `OR` substring across `name`, `phone`, `email`. `ILIKE` case-insensitive.                                                                    |
| 11  | Pagination strategy                                       | **Cursor-based** via `(lastActivityAt, id)`, base64-encoded. Page size 50.                                                                                                  |
| 12  | Default sort                                              | `lastActivityAt DESC`. Sortable columns in v1: `Last activity`, `First contact`.                                                                                            |
| 13  | Where the read lives in core                              | New `packages/core/src/contacts/list.ts`. Sibling to `agent-home/`, not under `lifecycle/`.                                                                                 |
| 14  | View-model shape                                          | Page-ready projection (`ContactBrowseRow`), not raw Prisma `Contact`.                                                                                                       |
| 15  | `opportunityCount` denormalisation                        | Include, capped at 99.                                                                                                                                                      |
| 16  | Empty-state copy register                                 | Mercury voice. No agent prose.                                                                                                                                              |
| 17  | Filtered-empty distinct copy                              | Yes — distinct from zero-state, with a [Clear] affordance.                                                                                                                  |
| 18  | Legacy disposition (`/me`, `/my-agent`, `/conversations`) | Defer entirely to D4. D1 does not absorb.                                                                                                                                   |
| 19  | Gate variable name                                        | `NEXT_PUBLIC_CONTACTS_LIVE`.                                                                                                                                                |
| 20  | Gate default at launch                                    | `false` until staging review; flip after.                                                                                                                                   |

**Two amendments resolved alongside the ledger** (driven by reviewer feedback that surfaced inconsistency in the first draft):

- **A.** Chip examples in the original §1.1 and §3.3 referenced "Booked" — that's an `Opportunity.stage` value, contradicting the locked OPEN-6 (`Contact.stage` only). Both locations have been corrected to the lifecycle-only set above.
- **B.** Disabled-row affordance is upgraded from a `title` tooltip to a small **persistent notice above the table** while `ROUTE_AVAILABILITY.contact === false`: `Browse-only for now. Contact detail is coming next.` The hover tooltip on individual rows stays as a redundancy, but the notice is the primary signal.

### 2.1 Scope shape

- **OPEN-1 (List vs. List+Detail):** Ship list-only in D1; `/contacts/[id]` detail in D1.5 — chose **list-only** because (a) the detail route is a brainstorm in its own right (which fields, which sub-tabs, which mutating actions, threading vs. flat); (b) the existing decision-card → contact links are inert today, so deferring detail by one slice does not regress anything; (c) D1's job is to validate the Mercury list pattern, which is the load-bearing question for D2/D3. **Flip to list+detail bundled** if the reviewer reads the existing inert links as a launch-blocker that warrants closing the loop in one PR.

- **OPEN-2 (Read-only vs. mutating in v1):** Read-only. Chose read-only because (a) the launch path doesn't need contact-edit-from-Mercury — agents create contacts via channel ingest, not the dashboard; (b) `memory/feedback_ship_clean_not_followup.md` and the modes-not-knobs guidance both push toward smaller scopes that ship clean; (c) mutating actions on contacts (merge, archive, opt-out toggle) interact with `MessagingOptIn`, GDPR, and conversation routing — each is its own correctness question that doesn't belong in a list view. **Flip to read+archive** if the reviewer believes founders need a "remove this lead" affordance for the launch demo. (Note: the Meta Data Deletion path already exists in core via `ContactStore.delete` — the question is only whether to expose it from this UI.)

- **OPEN-3 (Detail route gating):** Keep `ROUTE_AVAILABILITY.contact = false` for D1; flip to `true` only when D1.5 ships. Chose this because the row-click destination doesn't yet exist, and rendering live `<Link>`s into a 404 is worse than rendering disabled rows. **Flip** if reviewer wants D1 to ship a stub `/contacts/[id]` page (e.g., "Detail coming next week — view the contact's conversations on `/conversations`") so rows are clickable from day one.

### 2.2 Header chrome

- **OPEN-4 (Header strategy):** D1 renders its own `ContactsHeader` (a near-clone of `ReportsHeader`) with inert nav placeholders. Chose this because it matches the existing `/reports` precedent verbatim and avoids a header-consolidation refactor in this PR. **Flip to a shared `MercuryAuthShell`** (extracted from `ReportsHeader` and reused by `ContactsHeader`) if reviewer wants to take the shared-chrome refactor now while there are still only two Mercury surfaces.

- **OPEN-5 (Nav target inside the agent-home `EditorialAuthShell`):** Do **not** add a "Contacts" or "Tools" link to `EditorialAuthShell` in this slice. Chose this because the editorial header is intentionally minimalist (`Home · Alex · Riley · +`) per Slice B Q2, and adding a Tools link is a register-bridging decision that wants its own brainstorm (probably alongside D2/D3 launch). **Flip** if reviewer wants discoverability now and is okay with the editorial-vs-Mercury visual handshake at the click point.

### 2.3 Data model

- **OPEN-6 (Stage column source):** Show `Contact.stage` (lifecycle: `new` / `active` / `customer` / `retained` / `dormant`) as the primary stage column. Chose lifecycle stage because it's universal across every contact (every row has a value), the values are operator-meaningful, and it doesn't require a join. The `Opportunity.stage` (sales: `interested` / `qualified` / `quoted` / `booked` / `showed` / `won` / `lost` / `nurturing`) is opportunity-scoped — many contacts have zero or many opportunities, so it doesn't fit a one-row-per-contact list cleanly. **Flip to two columns** (Lifecycle + "Top opportunity stage") if the reviewer reads "stage" as a sales question, not a lifecycle question. The dual-column path requires a left-join projection in the store — non-trivial but not blocking.

- **OPEN-7 (Joining `LifecycleRevenueEvent` / `Opportunity` revenue total):** Do **not** project a per-contact revenue column in v1. Chose this because (a) the agg requires a sum over `LifecycleRevenueEvent` per contact, which adds a second query; (b) it's not on the launch path; (c) it's a `/reports`-style number and may belong on the detail page instead of the list. **Flip** if reviewer wants ROAS-style "show me my $-weighted contacts" sort on the list itself.

- **OPEN-8 (Channel column):** Show `Contact.primaryChannel` as a small icon / label (whatsapp · telegram · dashboard) rather than `firstTouchChannel`. Chose primary because it's where the operator can reach the contact today; first-touch is more attribution-flavored and belongs on the detail page. **Flip** if reviewer reads "where did this lead come from" as more interesting than "where do I reach them now" for a list.

### 2.4 Filter, search, sort, paging

- **OPEN-9 (Filter primitive — chips vs. multi-facet):** Use **opinionated chips** (`All`, `Active leads`, `Booked`, `Dormant`) where each chip is a server-side stage filter, not a freeform multi-select. Chose chips because `memory/feedback_modes_not_knobs.md` and `feedback_modes_not_knobs.md` both push toward presets at v1, and a Mercury surface with a 4-chip toolbar reads cleanly without UI bloat. **Flip to a chip + facet panel** (stage + source + channel + opt-in) if reviewer wants the same surface to satisfy ad-ops and sales triage in one pass — but that escalates the complexity meaningfully.

- **OPEN-10 (Search shape):** Single text input, server-side `OR` substring across `name`, `phone`, `email`. Case-insensitive, prefix-friendly via `ILIKE`. Trimmed to non-empty before sending. Chose this because it's the smallest useful search and matches operator mental model ("I remember a name OR a phone"). **Flip to per-field search** if reviewer wants exact-match phone lookup as a first-class affordance (then it's a separate `?phone=` param + a typed input).

- **OPEN-11 (Pagination strategy):** **Cursor-based** via `(lastActivityAt DESC, id DESC)` tiebreak, encoded as an opaque base64 cursor. Page size 50. Chose cursor because (a) the index `Contact[organizationId, lastActivityAt]` already exists (`schema.prisma:1507`), (b) deep `OFFSET` is a known foot-gun on this table over time, (c) the `/reports` precedent doesn't help here (it returns whole-period rollups). **Flip to offset+limit** if reviewer wants page-number jumping ("page 5 of 12") and is okay with the perf trade. Cursor cannot show total page count without a second query — this means the UI shows `Showing 1–50 · more →` rather than `Page 1 of N`.

- **OPEN-12 (Default sort):** `lastActivityAt DESC`. Chose recency because operators want "what changed" first, and the existing index already covers it. Sortable columns in v1: `Last activity`, `First contact`. Name / stage are not sortable in v1 (unlocks no clear operator value, adds index questions). **Flip** if reviewer wants stage-grouped browsing as default ("show me Booked first").

### 2.5 Backend boundary

- **OPEN-13 (Where does the read live in core?):** New file `packages/core/src/contacts/list.ts` exporting `listContactsForBrowse(input, deps)`. The store interface gets a new method `ContactStore.listForBrowse({ orgId, stage, search, channel, sort, cursor, limit })`. Chose a sibling module to `agent-home/` rather than living inside `lifecycle/` because the read is dashboard-driven and orthogonal to lifecycle state transitions. **Flip to `lifecycle/contact-browse.ts`** if reviewer wants to keep all `Contact` reads under the `lifecycle/` namespace. (Either way, the public symbol stays `listContactsForBrowse`.)

- **OPEN-14 (View-model shape):** The endpoint returns a page-ready row shape (the `ContactBrowseRow` schema below in §4.2), not the raw Prisma `Contact`. This is the standard surface-agnostic projection: the dashboard never sees DB enums or join tables. Chose this because it matches the recommendations + agent-home wins / pipeline / metrics pattern that's already shipped. **No flip planned** — projection is project doctrine. Listed here so reviewers know the API contract is the projection, not the model.

- **OPEN-15 (`opportunityCount` denormalisation):** Include a small `opportunityCount: number` per row (count of non-terminal opportunities, capped at 99 in the projection). Chose to include it because it answers "is this a real prospect or just a name in the book?" without a click-through, and a `COUNT(*)` per row is an index hit. Capped at 99 to avoid leaking pipeline density into the list and to keep the column width predictable. **Flip to omit** if reviewer thinks even a small join is too much for a list view; in that case the count moves to the detail page.

### 2.6 Empty state, loading, error

- **OPEN-16 (Empty-state copy register):** Mercury register stays Mercury — no agent-voice prose in the empty state. Use a short statement: `No contacts yet. They'll appear here as conversations come in.` Chose Mercury voice because the two-register doctrine forbids editorial copy on a Mercury surface. **Flip** if reviewer wants Alex's voice to leak in here as a brand consistency move, but that's an exception to the doctrine.

- **OPEN-17 (Filtered-empty distinct copy):** Yes, distinct copy when search/filter returns zero rows: `No matches. Try a different search or clear your filter.` (vs. zero-state above). Chose distinct because the affordance is different (zero-state has no recovery; filtered-empty has a clear-filter recovery). **No flip planned** — universal best practice.

### 2.7 Legacy routes

- **OPEN-18 (Legacy disposition):** D1 does not touch `/me`, `/my-agent`, or `/conversations`. Chose to defer because (a) the redesign roadmap §4 puts route disposition explicitly in D4; (b) `/conversations` is the closest cousin to `/contacts` but its UX (status pills, take-over, transcript expansion) is a meaningfully different surface from a Mercury contact list; (c) folding `/conversations` into `/contacts/[id]` is part of D1.5's brainstorm, not D1's. **Flip to absorb `/conversations`** if reviewer believes shipping `/contacts` while a separate `/conversations` page exists creates a discoverability mess at launch — but that PR escalates to ~2x the size.

### 2.8 Production gate

- **OPEN-19 (Gate variable name):** `NEXT_PUBLIC_CONTACTS_LIVE` (`"true"` flips to live). Mirrors `NEXT_PUBLIC_REPORTS_LIVE`. **No flip planned** — naming alignment with the existing precedent.

- **OPEN-20 (Default value at launch):** `false` until the live data has been operator-reviewed once on staging. Chose conservative because contacts contain PII (`Contact.phone`, `Contact.email`, attribution data) — flipping it on without a deliberate review is the kind of thing the post-launch review should reject. **Flip** to `true` after first staging walkthrough; the flip is a one-line `.env.production` change, not a code change.

---

## 3. Visual contract (Mercury, inherited)

### 3.1 Tokens — already shipped

D1 imports nothing new at the token layer. Everything in `apps/dashboard/src/app/globals.css:99-110` is already on `main`:

```
--mercury-cream      hsl(40 25% 94%)
--mercury-ink        hsl(20 10% 12%)
--mercury-ink-2      hsl(20 8% 28%)
--mercury-ink-3      hsl(20 6% 46%)
--mercury-ink-4      hsl(20 6% 62%)
--mercury-accent     hsl(20 90% 55%)        // marketing orange
--mercury-accent-soft hsl(20 60% 50%)
--mercury-hairline   hsl(40 15% 86%)
--mercury-hairline-soft hsl(40 15% 90%)
--mercury-row-hover  hsl(40 18% 90%)
--mercury-pos        hsl(140 35% 35%)
--mercury-neg        hsl(0 60% 45%)
```

Plus the existing font tokens: `--font-serif-mercury` (Source Serif 4 for headlines), `--font-mono-mercury` (JetBrains Mono for folios + small caps), Inter for the sans body.

### 3.2 CSS organisation

`apps/dashboard/src/app/(auth)/contacts/contacts.module.css`. Same module-aliasing pattern as `reports.module.css:13-50`:

```css
.contactsPage {
  --cream: var(--mercury-cream);
  --ink: var(--mercury-ink);
  --ink-3: var(--mercury-ink-3);
  --accent: var(--mercury-accent);
  --hair: var(--mercury-hairline);
  --row-hover: var(--mercury-row-hover);
  --serif: var(--font-serif-mercury);
  --sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --mono: var(--font-mono-mercury);
  --col-wide: 1080px;
  background: var(--cream);
  color: var(--ink);
  font-family: var(--sans);
  font-variant-numeric: tabular-nums;
  /* ... */
}
```

Visual vocabulary inherited from `/reports`:

- **Folios** (`folio` / `folioL` / `folioR` in `reports.module.css:440-460`) — caps + mono, hairline-bottom, used as section labels.
- **Hairline tables** with mono-caps thead, sans-medium tbody, tnum, row hover at `--mercury-row-hover` (`reports.module.css:663-732`).
- **Page shell** — single column, `max-width: 1080px`, generous section gaps (`var(--gap-section)` 96/72/56 px responsive).
- **Sticky header** — `position: sticky` + cream background + hairline bottom (`reports.module.css:57-65`).

If a rule grows broadly applicable across two Mercury surfaces, it earns promotion to globals — but **not in this PR**. Introducing a shared Mercury CSS file is the consolidation refactor mentioned in OPEN-4. D1 stays self-contained.

### 3.3 Page layout

Mirrors `/reports` rhythm without copy-pasting structure:

```
┌ Header (sticky, cream, hairline-bottom) ─────────────────┐
│ Switchboard ●   Alex · Riley · +     Live · Inbox · Halt · M │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Contacts                                          MAY 8  │
│ ──────────────────────────────────────────────────────── │
│ Browse-only for now. Contact detail is coming next.      │
│                                                          │
│ [All] [New] [Active] [Customer] [Retained] [Dormant]     │
│                                            [search input]│
│                                                          │
│ NAME             STAGE     CHANNEL  LAST ACTIVITY    →   │
│ ──────────────────────────────────────────────────────── │
│ Lisa K.          Active    WA       3h ago           ›   │
│ Marcus T.        Booked    WA       Yesterday        ›   │
│ ...                                                      │
│                                                          │
│                              Showing 1–50 · more →       │
└──────────────────────────────────────────────────────────┘
```

`›` = the inert `aria-disabled` chevron until D1.5 ships the detail route. Hovering a row with the detail route disabled still highlights the row (using `--row-hover`) and shows a tooltip "Detail coming next" via `title` attr — minimal affordance, matches existing pipeline-tile behaviour.

---

## 4. Data model

### 4.1 Existing Prisma — what we read from, unchanged

```
Contact (schema.prisma:1471)
  id, organizationId, name, phone, email,
  primaryChannel, firstTouchChannel,
  stage (lifecycle: new/active/customer/retained/dormant),
  source, sourceType, attribution (json),
  messagingOptIn, messagingOptInAt, messagingOptInSource,
  firstContactAt, lastActivityAt, createdAt, updatedAt
  Indexes used by D1:
    (organizationId)
    (organizationId, stage)
    (organizationId, lastActivityAt)        ← drives default sort + cursor
    (organizationId, sourceType, createdAt)

Opportunity (schema.prisma:1512)
  ... only used for opportunityCount(non-terminal) per row
  Indexes used: (organizationId, stage), (contactId)
```

D1 reads these tables. **Zero schema changes.** No new migrations.

### 4.2 New schemas in `packages/schemas/src/contacts.ts`

```ts
import { z } from "zod";
import { ContactStageSchema } from "./lifecycle.js"; // existing

// One row in the browse list — page-ready, surface-agnostic.
export const ContactBrowseRowSchema = z.object({
  id: z.string(),
  displayName: z.string(), // = name ?? phone ?? email ?? "—"
  stage: ContactStageSchema, // lifecycle stage
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
  source: z.string().nullable(), // raw `Contact.source`
  lastActivityAt: z.string(), // ISO
  firstContactAt: z.string(), // ISO
  opportunityCount: z.number().int().min(0).max(99),
  // Reserved for D1.5 — list does not currently render this, but the API
  // emits it so the detail link can pre-warm the route.
  detailHref: z.string(), // `/contacts/${id}`
});
export type ContactBrowseRow = z.infer<typeof ContactBrowseRowSchema>;

export const ContactsListQuerySchema = z.object({
  stage: ContactStageSchema.optional(), // null → all stages
  search: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().optional(), // opaque base64 (lastActivityAt|id)
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["lastActivityAt", "firstContactAt"]).default("lastActivityAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type ContactsListQuery = z.infer<typeof ContactsListQuerySchema>;

export const ContactsListResponseSchema = z.object({
  rows: z.array(ContactBrowseRowSchema),
  nextCursor: z.string().nullable(), // null = final page
  // Truthful "more exists" badge for the UI — no totalCount because it
  // requires a second COUNT(*) query and isn't worth the cost in v1.
  hasMore: z.boolean(),
});
export type ContactsListResponse = z.infer<typeof ContactsListResponseSchema>;
```

`displayName` resolution order — `name` → `phone` → `email` → `"—"`. PII visibility is the same as `/conversations` today; no extra masking introduced here. (A separate slice will revisit dashboard PII display rules; not D1's call.)

### 4.3 Cursor encoding

`base64(JSON.stringify({ ts: lastActivityAt.toISOString(), id }))`. Decoded server-side; opaque to the client. The store uses keyset pagination:

```sql
WHERE organizationId = $1
  AND (lastActivityAt, id) < ($cursor.ts, $cursor.id)
ORDER BY lastActivityAt DESC, id DESC
LIMIT 51                              -- fetch one extra to detect hasMore
```

For `direction: "asc"` flip both comparators and ORDER BY clauses.

---

## 5. Backend (surface-agnostic boundary)

The rule from `memory/feedback_surface_agnostic_backend.md`: nothing in `core` / `schemas` / `db` may name a UI surface or path. `/contacts` exists only in `apps/dashboard`. The backend talks about contacts, not pages.

### 5.1 Layered structure

```
apps/dashboard/src/app/(auth)/contacts/
  ├ page.tsx                       (Server component, metadata + ContactsPage)
  ├ contacts-page.tsx              ("use client", composition of components)
  ├ contacts.module.css            (Mercury aliases)
  ├ components/
  │   ├ header.tsx                 (ContactsHeader — clone of ReportsHeader for now; OPEN-4)
  │   ├ filter-chips.tsx           (4 stage chips)
  │   ├ search-input.tsx           (debounced text input)
  │   ├ contacts-table.tsx         (hairline table with sortable headers)
  │   ├ contact-row.tsx            (one row; renders inert when route disabled)
  │   ├ pagination-footer.tsx      ("Showing N–M · more →")
  │   ├ empty-state.tsx            (zero / filtered-empty / error)
  │   └ format.ts                  (tiny — relativeAge, channelIcon, stageLabel)
  ├ hooks/
  │   └ use-contacts-list.ts       (React Query, keyed by (org, query))
  └ __tests__/
      ├ contacts-page.test.tsx
      ├ contacts-table.test.tsx
      ├ filter-chips.test.tsx
      └ use-contacts-list.test.ts

apps/dashboard/src/app/api/dashboard/contacts/
  └ route.ts                       (Next proxy → /api/contacts on Fastify)

apps/api/src/routes/
  └ contacts.ts                    (Fastify route, validates ContactsListQuerySchema, calls core)

packages/core/src/contacts/
  ├ index.ts                       (barrel — re-exports listContactsForBrowse)
  ├ list.ts                        (listContactsForBrowse(input, deps))
  └ __tests__/
      └ list.test.ts               (in-memory store, exercises sort + cursor + filter)

packages/core/src/lifecycle/contact-store.ts
  + listForBrowse(args): Promise<{ rows: Contact[]; opportunityCounts: Map<string, number>; hasMore: boolean; nextCursor: string | null }>
  // Implementation extends prisma-contact-store.ts; in-memory implementation
  // also extends in-memory-contact-store.ts (already exists in db package).

packages/schemas/src/contacts.ts   (new file; barrel-exported)
```

### 5.2 Core function shape

```ts
// packages/core/src/contacts/list.ts
import type { ContactStore } from "../lifecycle/contact-store.js";
import type { ContactsListQuery, ContactsListResponse } from "@switchboard/schemas";

export interface ListContactsDeps {
  contactStore: ContactStore;
  // Wallclock injection so cursor-relative tests are deterministic.
  // Not actually needed today (cursor is positional, not relative); kept here
  // as the standard-shape stub so the dep object grows cleanly later.
  now?: () => Date;
}

export async function listContactsForBrowse(
  input: { orgId: string; query: ContactsListQuery },
  deps: ListContactsDeps,
): Promise<ContactsListResponse> {
  // Decode cursor → keyset args
  // Call contactStore.listForBrowse({ orgId, stage, search, sort, direction, cursor, limit })
  // Project rows → ContactBrowseRow (compute displayName, derive opportunityCount cap)
  // Encode nextCursor from the last row when hasMore
  // Return ContactsListResponse
}
```

The function does **not** know about `/contacts`, `/api/dashboard/contacts`, React Query, or Next.js. It's a pure projection over a `ContactStore`-shaped dependency, exactly like `agent-home/wins.ts` and `agent-home/pipeline.ts`.

### 5.3 Why `ContactStore.listForBrowse` is a new method (not an overload of `list`)

`ContactStore.list(orgId, filters)` already exists and returns `Contact[]`. It's used by skill-runtime tooling (`packages/core/src/skill-runtime/tools/crm-query.ts`) and lifecycle service paths. Adding cursor + search + opportunity-count semantics to that method would change a contract that has consumers outside the dashboard.

The new browse method is sibling-shaped (`listForBrowse` next to `listForPipeline` — the agent-home pipeline already added one). Same store interface, additional method, no breaking change.

### 5.4 Fastify route + Next proxy

Mirrors the existing `/api/agents/[agentId]/pipeline` ↔ `/api/dashboard/agents/[agentId]/pipeline` pattern from PR-S4:

- `apps/api/src/routes/contacts.ts` — `GET /api/contacts?stage=&search=&cursor=&limit=&sort=&direction=`. Auth: same org-scoping middleware as everything else; `req.organizationId` derives from the session. Validates query against `ContactsListQuerySchema`, calls `listContactsForBrowse`, returns the projection.
- `apps/dashboard/src/app/api/dashboard/contacts/route.ts` — thin Next proxy that forwards the query and the auth header. Same `notFound()`-on-prod gating as `/decisions-preview` is **not** needed here — the API is the gate for the data; the page itself is gated by the env flag, not by a `notFound()`.

### 5.5 ESLint / layer enforcement

`packages/core/src/contacts/list.ts` imports only `@switchboard/schemas` and the `ContactStore` interface from `lifecycle/`. No imports from `apps/`, no string literals matching `/contacts` or `/api/`. ESLint already flags layer violations across the monorepo — D1 does not change those rules.

---

## 6. Frontend — composition

### 6.1 Hook: `useContactsList(query)`

```ts
// apps/dashboard/src/app/(auth)/contacts/hooks/use-contacts-list.ts
"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { FIXTURE } from "../fixtures";
import type { ContactsListQuery, ContactsListResponse } from "@switchboard/schemas";

const isLive = process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true";

export function useContactsList(query: Omit<ContactsListQuery, "cursor">) {
  const keys = useScopedQueryKeys();

  // useInfiniteQuery wired only when live; fixtures in dev render in one page.
  return useInfiniteQuery<ContactsListResponse>({
    queryKey: keys?.contacts.list(query) ?? ["__disabled_contacts__"],
    enabled: isLive && !!keys,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        ...query,
        ...(pageParam ? { cursor: pageParam } : {}),
      } as Record<string, string>);
      const res = await fetch(`/api/dashboard/contacts?${params}`);
      if (!res.ok) throw new Error(`Failed to load contacts: ${res.status}`);
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
```

When `!isLive`, the hook returns a synthesised fixture page. Tests use the same in-memory store as core's tests — see §8.

`useScopedQueryKeys` already exists; we add a `contacts` namespace:

```ts
// apps/dashboard/src/hooks/use-query-keys.ts (existing — append):
contacts: {
  list: (q: object) => [...base, "contacts", "list", q] as const,
}
```

### 6.2 Row click behaviour and disabled-route notice

Two states, decided at render time:

| `ROUTE_AVAILABILITY.contact` | Page-level notice                                                                                                                | Row element                                                        | UX                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| `false` (today / D1)         | `<p>Browse-only for now. Contact detail is coming next.</p>` (visible above the table, hairline-bottom, mono-caps Mercury voice) | `<div role="row" aria-disabled="true" title="Detail coming next">` | hover highlight + `cursor: not-allowed` |
| `true` (D1.5+)               | (no notice)                                                                                                                      | `<Link href={row.detailHref}>`                                     | full row click → detail page            |

The page imports `ROUTE_AVAILABILITY` from the same module the agent-home pipeline tile does (`apps/dashboard/src/lib/agent-home/resolve-link.ts:8-14`). Single source of truth for "is the contact detail route real yet."

The page-level notice is the **primary** signal that detail is unavailable; the per-row tooltip is a redundant fallback. Tooltips alone are too quiet for a deliberately-disabled primary affordance — operators should not have to hover-and-wait to learn the row click does nothing.

### 6.3 Filter / search debounce

Search input uses a 200ms debounce locally, then commits to URL state via `useSearchParams` + `router.replace`. Same pattern `/reports` uses for window selection. Filter chips and sort headers commit instantly (no debounce).

URL shape: `/contacts?stage=active&q=lisa&sort=firstContactAt&direction=asc`. The cursor stays out of the URL — pagination is in-page only, not deep-linkable. (Cursor in URL would let operators bookmark page 5, but bookmarks across data churn return inconsistent results; a future "saved view" feature solves this differently.)

### 6.4 Fixtures

`apps/dashboard/src/app/(auth)/contacts/fixtures.ts` — three rows hand-written, covering `active`, `customer`, `dormant` stages with realistic names + relative timestamps. Used in the `!isLive` branch and in component tests. The fixture stays small (≤ 5 rows) because the table renders identically with N=3 and N=50 — pagination is an integration concern, not a render concern.

---

## 7. Empty / loading / error states

| State          | Trigger                                                | Copy (Mercury voice — short, no agent prose)                                  |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Loading        | First fetch in flight                                  | Single hairline-row skeleton repeated 8× under header (no spinner)            |
| Zero-state     | `!query.search && !query.stage && rows.length === 0`   | `No contacts yet. They'll appear here as conversations come in.`              |
| Filtered-empty | `(query.search \|\| query.stage) && rows.length === 0` | `No matches. Try a different search or clear your filter.` + `[Clear]` button |
| Error          | API non-2xx / network error                            | `Couldn't load contacts. <button>Try again</button>` (retries the query)      |

All four states share the same Mercury container. No editorial copy. (See OPEN-16.)

---

## 8. Test strategy

Three layers, mirroring the agent-home + reports patterns already on `main`.

### 8.1 Core (projection)

`packages/core/src/contacts/__tests__/list.test.ts` — uses `InMemoryContactStore` (already in `packages/db/src/stores/in-memory-contact-store.ts`).

Coverage:

- Default sort = lastActivityAt DESC.
- Stage filter applies before search.
- Search matches name OR phone OR email (`ILIKE`-equivalent for in-memory).
- Cursor round-trip — `nextCursor` from page 1 → page 2 → final page with `nextCursor === null`.
- `hasMore` is true iff `rows.length === limit + 1` (verifies the +1 fetch trick).
- `displayName` resolution: name → phone → email → "—".
- `opportunityCount` cap at 99.
- Empty result returns `{ rows: [], nextCursor: null, hasMore: false }`.
- Org-scoping: contacts in another org never appear.

Targets the core 65/65/70/65 coverage thresholds (see CLAUDE.md).

### 8.2 API (Fastify) + Next proxy

`apps/api/src/__tests__/api-contacts.test.ts` — uses `buildTestServer` + mocked Prisma per `memory/feedback_api_test_mocked_prisma.md`.

Coverage:

- `GET /api/contacts` returns 200 with the projected shape on a happy path.
- Missing auth → 401 (existing middleware behaviour).
- Invalid query (`stage=banana`) → 400 with Zod error path.
- `limit > 100` → 400 (schema clamp).
- Cursor decode failure → 400.
- Cross-org isolation — another org's contacts never returned.

`apps/dashboard/src/app/api/dashboard/contacts/__tests__/route.test.ts` — proxy correctness only (forwards query + auth header, doesn't transform body). Two tests; the projection logic is already covered upstream.

### 8.3 Component / hook

- `contacts-page.test.tsx` — renders all four state transitions (loading, populated, empty, error) using a mocked `useContactsList`.
- `contacts-table.test.tsx` — sort header click toggles direction; sortable headers render mono-caps; row hover applies `--row-hover`; `aria-disabled="true"` on rows when `ROUTE_AVAILABILITY.contact = false`.
- `filter-chips.test.tsx` — chip click updates URL via mocked `useRouter.replace`; only one chip active at a time.
- `use-contacts-list.test.ts` — fixtures branch when `NEXT_PUBLIC_CONTACTS_LIVE !== "true"`; live branch wires `useInfiniteQuery` correctly (verified by spying the fetch wrapper).

### 8.4 What we explicitly do **not** test

- E2E (Playwright) for `/contacts` — no E2E suite for `/reports` either; following precedent.
- Visual regression — Mercury tokens are validated implicitly via the existing `security-headers.test.ts`-style snapshot pattern only if reviewer wants it.
- PostgreSQL-specific cursor behaviour — covered in store tests; integration test is not required for D1 (would be valuable in a future Mercury-list-scaling slice).

---

## 9. PR sequencing

D1 ships in **two PRs**, both targeting `main`. The second consumes a flag flip from the first, but otherwise they're independent.

### PR-D1a — Backend (schemas + core + API + Next proxy)

- New `packages/schemas/src/contacts.ts` (3 schemas, 1 barrel re-export).
- `ContactStore.listForBrowse` interface + Prisma + in-memory impls.
- `packages/core/src/contacts/list.ts` + tests.
- `apps/api/src/routes/contacts.ts` + tests.
- `apps/dashboard/src/app/api/dashboard/contacts/route.ts` + minimal proxy test.

No UI. No CSS. No new public route.

### PR-D1b — Frontend page

- `apps/dashboard/src/app/(auth)/contacts/{page,contacts-page}.tsx` + `contacts.module.css`.
- All `components/` and `hooks/`.
- `apps/dashboard/src/hooks/use-query-keys.ts` — append `contacts.list(query)` key.
- Fixtures + tests.
- No `EditorialAuthShell` change. No `ROUTE_AVAILABILITY` change. (`OPEN-3`.)

PR-D1b is gated to staging-only by `NEXT_PUBLIC_CONTACTS_LIVE`. Production flip is a `.env.production` change after a deliberate staging review (`OPEN-20`).

### Out of D1 scope, ordered

- **D1.5** — `/contacts/[id]` detail. Brainstorm + spec next, after D1b lands. Will flip `ROUTE_AVAILABILITY.contact = true` when it ships.
- **D2** — `/automations`. Reuses everything Mercury D1 settled.
- **D3** — `/activity`. Same.
- **D4** — Legacy route disposition (`/me`, `/my-agent`, `/conversations`). Decides whether `/conversations` folds into `/contacts/[id]` or stays.

---

## 10. Risks + mitigations

| Risk                                                                        | Mitigation                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mercury surface count grows past two and shared-chrome refactor gets harder | Keep `ContactsHeader` a near-copy of `ReportsHeader`. The instant a third Mercury surface lands, extract `MercuryAuthShell` as that PR's tax (see OPEN-4).          |
| PII shows in dashboard list without thought to redaction                    | Same display posture as `/conversations` today. A separate slice will revisit; D1 does not regress the existing baseline.                                           |
| Cursor pagination + filter changes create stale-page UX                     | React Query keys include the full query; changing filter resets pagination automatically (queryKey changes → fresh first-page fetch).                               |
| Backend grows surface-coupled by accident                                   | ESLint already enforces. Reviewer should watch for path strings + page names in `core/contacts/list.ts` during PR-D1a review.                                       |
| `opportunityCount` denormalisation slows the list query                     | Cap at 99 — already a small per-row count. Index `(organizationId, contactId)` on `Opportunity` exists. Re-evaluate if EXPLAIN shows >50ms p95 on 10k-contact orgs. |
| `listForBrowse` interface gets reused as a generic CRM list and over-grows  | Method docstring says "browse only — UI list view"; mutating callers should use existing CRUD methods. Skill-runtime tools keep using `list(orgId, filters)`.       |
| Inert row click confuses operators ("nothing happens")                      | Title attr ("Detail coming next") + `cursor: not-allowed` + the existing pipeline-tile precedent. If operator tests show confusion, ship D1.5 sooner.               |

---

## 11. References

### Specs already on `main`

- `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` §3 (two registers), §4 (Phase D), §5 #11–#15 (no relevant backend work for D1; this slice is Mercury-list-pattern, not an extension of the recommendations backend).
- `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` — Mercury / editorial register split; production-gate pattern; layered backend pattern.
- `docs/superpowers/specs/2026-05-07-slice-b-pr-s4-design.md` — sibling-method pattern (`ContactStore.listForPipeline`); Fastify ↔ Next-proxy ↔ core ↔ store layering; `ROUTE_AVAILABILITY` gate.
- `docs/superpowers/specs/2026-05-08-inbox-drawer-c1-design.md` — single-shot spec format precedent (Decisions ledger / file layout / layer respect / risks).

### Live code referenced

- `apps/dashboard/src/app/(auth)/reports/{page,reports-page,reports.module.css}.tsx` — Mercury page precedent.
- `apps/dashboard/src/app/(auth)/reports/components/{header,campaigns}.tsx` — Mercury header + hairline table.
- `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts:15` — production-gate pattern.
- `apps/dashboard/src/lib/agent-home/resolve-link.ts:8-14` — `ROUTE_AVAILABILITY` + the `/contacts/[id]` link target that already exists in code.
- `packages/core/src/lifecycle/contact-store.ts` — `ContactStore` interface; `listForPipeline` precedent.
- `packages/db/src/stores/prisma-contact-store.ts` — Prisma impl that gets the new `listForBrowse` method.
- `packages/schemas/src/lifecycle.ts` — `ContactStageSchema`, `OpportunityStageSchema`.
- `packages/schemas/src/agents.ts` — `AGENT_REGISTRY` (used by `ContactsHeader` for the inert agent-name nav placeholders).
- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:38-48` — editorial header that this slice deliberately does **not** modify.
- `apps/dashboard/src/app/globals.css:99-110` — Mercury tokens.

### Memory entries consulted

- `project_two_register_design.md` — Editorial vs. Mercury split.
- `project_canonical_agent_names.md` — Alex / Riley / Mira locked.
- `feedback_surface_agnostic_backend.md` — backend may not name UI surfaces.
- `feedback_modes_not_knobs.md` — opinionated chips over freeform facets.
- `feedback_ship_clean_not_followup.md` — read-only v1, no half-finished mutating actions.
- `feedback_api_test_mocked_prisma.md` — API tests use mocked Prisma, not Postgres.

---

## 12. Status

- **Spec drafted:** 2026-05-08 (single-shot, 20 OPENs).
- **Decisions locked:** 2026-05-09. See §2.0 ledger.
- **Next:** implementation plan at `docs/superpowers/plans/2026-05-09-contacts-d1.md`. Plan binds to §2.0; deviations require re-reviewing the ledger.
- **PR shape at impl time:** D1a (backend — schemas + core + API + Next proxy), D1b (frontend page). Both target `main` independently. D1 ships behind `NEXT_PUBLIC_CONTACTS_LIVE=false` until staging review.
