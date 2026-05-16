# `/automations` (Slice D2) — Design Spec

_2026-05-09 · part of the agent-first redesign track · Phase D, surface 2 (Tools tier, Mercury register) · sibling to D1 (`/contacts`, shipped 2026-05-08)_

> **Reading posture:** this spec is opinionated by intent. The user delegated all judgment calls during brainstorming with the instruction "use your best judgment, then we will review the spec." Every decision is bound in §2.0 — flip notes are preserved so reviewer redirection is cheap.

---

## 1. Problem & scope

### 1.0 One-line scope

`/automations` is a read-only operational register of every `ScheduledTriggerRecord` for the current org — the Mercury list answer to "what is my system going to do automatically, and when."

### 1.1 What this slice ships

The Tools-tier list view at `/automations` — a Mercury-register page that lists every scheduled trigger (timer / cron / event_match) for the org with server-side filter, sort, and cursor pagination at 50 rows per page. It is the **third occupant of the Mercury register, after `/reports` and `/contacts`**.

Concretely:

- New route `apps/dashboard/src/app/(auth)/automations/page.tsx` rendering a Mercury surface that mirrors `/contacts` and `/reports` (cream + ink + hairline tables + tabular numerals + JetBrains Mono labels).
- New backend endpoint `GET /api/dashboard/automations` (Next.js proxy) → `GET /api/dashboard/automations` (Fastify) → `listTriggersForBrowse(...)` (new core function) → `TriggerStore.listForBrowse(...)` (new store method, extends existing `TriggerStore`).
- New shared schemas added to the **existing** `packages/schemas/src/scheduler.ts` (no surface-named file): `ScheduledTriggersListQuery`, `ScheduledTriggerBrowseRow`, `ScheduledTriggersListResponse`. The existing `ScheduledTrigger` schema is the source-of-truth domain shape; `ScheduledTriggerBrowseRow` is the page-ready projection over it.
- Status-only filter chips with counts: `All N · Active N · Fired N · Cancelled N · Expired N`. Default chip is `Active` (the operational question is "what is my system going to do automatically", not "what has it done"). Counts come from a single GROUP BY query in the same store call.
- Type (`timer / cron / event_match`) is a column, not a chip, **and is not an API filter parameter in v1** — explicitly cut for YAGNI. Add both UI and API together if needed in D2.5.
- Sortable column: `Created` (default DESC) only. `Fires at` sorting was considered and dropped — see §2.0 #9.
- No search input in v1. Trigger tables stay small per-org (most orgs will have <50 active triggers); chips + sort are sufficient browse affordances. `?triggerId=<id>` is the named D2.5 escape hatch for "I have an id from logs."
- Rows are **not links and have no detail route**, but **expand inline into a read-only details drawer** that shows: full id, full `sourceWorkflowId`, `expiresAt`, `eventPattern` summary, redacted action view (`type` + an allowlisted subset of payload key names + a redacted-count for the rest, never raw payload values). No mutation, no navigation. This differs from D1 where rows are pure-inert and the page itself is browse-only.
- Production gate identical to `/contacts` and `/reports`: `NEXT_PUBLIC_AUTOMATIONS_LIVE === "true"` flips fixtures off and live data on. Default `false` until staging review.
- Tests at three layers (core projection, hook+route, page composition) mirroring the contacts D1 + reports patterns already on `main`.

### 1.2 What this slice does **not** ship

- **Mutating actions on triggers.** No cancel, no reschedule, no edit, no create-from-dashboard in v1. `active → cancelled` is a valid transition (`packages/core/src/scheduler/trigger-types.ts:3`) and would be a natural one-off mutation, but adding it breaks symmetry with D1's strict read-only posture and re-opens the modes-not-knobs discussion. **Cancel-trigger and "snooze a misfiring cron" are revisited as a D2.5 scope** if operators ask for them after the surface ships.
- A separate `/automations/[id]` detail route. The inline drawer (§6.4) covers the inspect-this-row use case; **no separate detail page is planned for D2 or D2.5.** If a future need (e.g., a "history of fires" timeline) emerges, that becomes its own surface decision.
- The "Tools ▾ / Automations" link inside the editorial agent-home header (`EditorialAuthShell`). Operators reach `/automations` by direct URL or (later) via the same Tools-tier nav consolidation that D1 deferred. Editorial-header expansion is a Phase D wrap-up after D1/D2/D3 all ship.
- `WorkflowExecution` browse. "What's running right now" is a different surface — read-only too, but with very different UX (in-flight steps, errors, agent attribution). Folding it in here doubles the scope and confuses the surface's identity ("rules" vs. "live executions"). Defer to D3 (`/activity`) or a dedicated `/automations/runs` — the disposition is part of D3's brainstorm, not D2's.
- Saved filter views, multi-select bulk actions, CSV export, column chooser. D1 deferred all of these too. Read-side niceties; revisit post-launch.
- `Policy` / `OrgAgentEnablement` / `CompetencePolicy` configuration. The user explicitly chose "scheduled triggers" as the D2 subject, not "what an agent is allowed to do automatically." Per-agent policy lives on the agent-home Identity / Behaviour pages today and should not be a Mercury surface.

### 1.3 Why this surface, why now

Three forces converge:

1. **The Mercury list pattern is now load-bearing for Phase D.** `/contacts` (D1) just shipped 2026-05-08. D3 (`/activity`) will reuse the same skeleton. Adding a third list-pattern occupant **before** committing to a shared `MercuryAuthShell` extraction is the right time to validate whether the pattern generalises beyond `/contacts`. If D2 forces an awkward header divergence or filter-chip mismatch, that's a signal to extract the shell during D2; if it doesn't, the third PR-tax accumulates.
2. **`ScheduledTriggerRecord` is invisible to operators today.** The scheduler already runs (`packages/core/src/scheduler/scheduler-service.ts`), triggers are persisted (`packages/db/prisma/schema.prisma:1389`), and there's no UI surface that shows what's queued. Operators currently have to read the database to answer "did Riley schedule a follow-up for Tuesday?" or "is the daily 7am UTC signal-health cron actually registered?". A read-only browse closes that gap.
3. **It's a smaller Phase-D surface than D1.** `/contacts` D1 was 2 PRs over 5 commits because it had filter chips + search + opportunity-count denormalisation + a deferred detail route. D2 keeps the chips (with status-counts denormalised in a single GROUP BY query, cheaper than D1's per-row opportunity count) and adds an inline drawer; it drops search, per-row joins, and the separate detail route. PR pair should land at ~50–60% of D1's size.

### 1.4 Out-of-scope decisions inherited from prior specs

These are **already locked** elsewhere and not re-debated here:

- Two-register split — Mercury for Tools tier (`memory/project_two_register_design.md`; `2026-05-03-agent-first-redesign-roadmap.md` §3).
- Surface-agnostic backend rule (`memory/feedback_surface_agnostic_backend.md`). All new domain types in this slice live in the **existing** `packages/schemas/src/scheduler.ts` and use the domain noun (`ScheduledTriggerBrowseRow`, `ScheduledTriggersListQuery`, `ScheduledTriggersListResponse`), never the surface name. The core function is `listTriggersForBrowse` in `packages/core/src/scheduler/list-triggers.ts`.
- Mercury design tokens already shipped to `apps/dashboard/src/app/globals.css` lines 99–110 (`--mercury-cream`, `--mercury-ink`, `--mercury-accent`, `--mercury-hairline`, `--mercury-row-hover`, etc.) — D2 consumes these via the same CSS-module aliasing pattern `/contacts` and `/reports` use.
- Production gate pattern (`NEXT_PUBLIC_<SURFACE>_LIVE`) from `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts:15` and `/contacts`.
- API route file convention (`apps/api/src/routes/dashboard-<thing>.ts`, URL `/api/dashboard/<thing>`) used by `dashboard-reports.ts`, `dashboard-overview.ts`, `dashboard-agents.ts`, and (newly) `dashboard-contacts.ts`.

---

## 2. Decisions

### 2.0 Decisions ledger

| #   | Question                                     | Locked answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Surface subject                              | **Scheduled triggers (`ScheduledTriggerRecord`).** Not `WorkflowExecution`, not policy/enablement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2   | List vs. List+Detail in D2                   | **List-only; no separate route.** Rows expand inline into a read-only **details drawer** (drawer, not page) that exposes id, full `sourceWorkflowId`, `expiresAt`, `eventPattern` summary, and a redacted `action` view. No mutation, no navigation. (See §2.2.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Mutating actions in v1                       | **Read-only.** Cancel-trigger considered and deferred to D2.5 (an optional, easy follow-up — `active→cancelled` is already a valid transition).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | Header strategy                              | **Own `AutomationsHeader`** (clone of `ContactsHeader`/`ReportsHeader`). Defer shared `MercuryAuthShell` extraction; revisit when adding D3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | Editorial-shell nav target                   | Do **not** add Automations / Tools to `EditorialAuthShell` in D2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | Filter primitive                             | **Status chips with counts:** `All N · Active N · Fired N · Cancelled N · Expired N`. Type is **not** a chip and is **not** an API filter in v1 (cut for YAGNI). Count comes from a single GROUP BY status query in `listForBrowse`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6a  | Default chip                                 | **`Active`.** The product question is "what is my system going to do automatically." History is reachable via `Fired / Cancelled / Expired / All`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Search                                       | **Skip in v1.** Per-org tables stay small. `?triggerId=<id>` direct-id lookup is the named D2.5 escape hatch (see §9 deferred list).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Pagination strategy                          | **Cursor-based** via `(createdAt DESC, id DESC)`, base64-encoded. Page size 50.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Default sort                                 | `createdAt DESC`. Sortable columns: `Created` only. `Fires at` removed for D2 — `fireAt` is null for `cron` and `event_match` rows, so the sort scatters most rows confusingly. The schedule column already shows the timer fire time inline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10  | Where the read lives in core                 | New `packages/core/src/scheduler/list-triggers.ts` exporting `listTriggersForBrowse`. Sibling to `scheduler-service.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | Store interface extension                    | Add `TriggerStore.listForBrowse({ orgId, status, sort, direction, cursor, limit })` — **no `type` parameter** (cut for YAGNI in #6). Store stays dumb about cursor encoding and trimming; core owns those (§5.2). Do **not** overload existing `findByFilters` — that's used by `SchedulerService` and skill-runtime callers; behaviour change there is risky.                                                                                                                                                                                                                                                                                                                                                                       |
| 12  | View-model + naming                          | Page-ready `ScheduledTriggerBrowseRow` projection (see §4.2). New types live in the **existing** `packages/schemas/src/scheduler.ts` (no surface-named file). API never returns raw `ScheduledTrigger`. **Hard invariant: response never carries `action.payload`.** The drawer surfaces a redacted projection only.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 13  | `scheduleLabel` derivation (with fallbacks)  | `cron` → `cronExpression ?? "cron:unknown"`. `timer` → `fireAt?.toISOString() ?? "timer:unknown"`. `event_match` → `event:${eventPattern?.type ?? "unknown"}`. Tests cover the fallback branches against handcrafted malformed rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 14  | `actionLabel` derivation + payload redaction | `action.type` only on the table (`spawn_workflow` / `resume_workflow` / `emit_event`). Drawer surfaces an **allowlisted** subset of payload key names plus a `redactedKeyCount` for the rest. Allowlist (§6.4): `workflowId`, `contactId`, `eventType`, `agentKey`, `triggerId`, `source`. Everything else is rolled into the redacted count. **No payload values, ever.**                                                                                                                                                                                                                                                                                                                                                           |
| 15  | `sourceWorkflowId` rendering                 | Mono-caps prefix of the UUID (`WF:abcd1234`) when present, em-dash when not. Inert (no link) — `WorkflowExecution` has no detail route either. Full UUID shown in the drawer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 16  | Empty-state copy register                    | Mercury voice. No agent prose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 17  | Filtered-empty distinct copy                 | Yes, distinct from zero-state, with a `[Clear]` affordance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 18  | Gate variable name                           | `NEXT_PUBLIC_AUTOMATIONS_LIVE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 19  | Gate default at launch                       | `false` until staging review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 20  | Schema migration                             | **One additive non-functional index only:** `@@index([organizationId, createdAt])` on `ScheduledTriggerRecord`. No model shape change, no data migration. (See §4.1.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 21  | Expired-trigger reaping                      | Out of scope. `TriggerStore.expireOverdue` already exists (`trigger-store.ts:9`); the existing scheduler invokes it. D2 reads what's there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 22  | Status-history gap                           | **Documented gap, not addressed in D2.** `ScheduledTriggerRecord` has no `updatedAt` / `firedAt` / `cancelledAt` / `expiredAt`. The `Created` column is therefore _creation_ time, not _last-state-change_ time — accurate but potentially misleading for non-Active rows. Mitigated by defaulting the chip to `Active` (§2.0 #6a). A proper status-history (`@updatedAt` field or `ScheduledTriggerStateChange` event log) is its own slice.                                                                                                                                                                                                                                                                                        |
| 23  | Date / timezone formatting                   | **Backend always returns ISO8601 strings; frontend resolves the display timezone.** Table cells: short human date in **org timezone** when the page shell already has it available (per the existing `module-state-resolver.ts:22` org-config plumbing), else browser timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, mirroring `apps/dashboard/src/app/(auth)/contacts/components/format.ts:6`), else UTC. Tz abbreviation displayed in the column header. Drawer cells: full ISO8601 with offset. **If org timezone is not already plumbed to the automations page shell at impl time, D2b ships with browser-tz fallback and a follow-up named `org-tz plumbing`** — D2 does not extend the org-config-fetch chain. |
| 24  | Responsive behaviour                         | Desktop-first. Below ~960 px viewport: **horizontal scroll inside the Mercury container**, no stacked-row rewrite, no column hiding. Sticky first column (`TYPE`) so context survives the scroll.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 2.1 Why "scheduled triggers" and not "workflow executions"

The user explicitly answered "scheduled triggers" when asked what the surface should show. The reasoning that makes that the right answer:

- "Workflow rules" in the redesign roadmap (`2026-05-03-agent-first-redesign-roadmap.md:141`) is most naturally read as **rules that are configured to fire**, not workflows that are currently running. Triggers are rules; executions are runs.
- `WorkflowExecution` rows have very different UX needs: in-flight steps, current step index, agent attribution, error surfacing. That's an `/activity`-shaped surface (D3), not a Mercury list.
- Triggers are smaller per row than `WorkflowExecution`s: id + type + schedule + action.type + status + source workflow + 3 timestamps + a small redacted drawer payload. Fits a hairline table; the drawer (§6.4) handles the few additional fields without needing a separate route.

**Flip** if reviewer reads "automations" as "things that are running right now": rename D2 to `/automations` over `WorkflowExecution`, defer `/automations/triggers` to a sibling slice. The store + core function pattern transfers.

### 2.2 Why an inline drawer, not a detail route (differs from D1)

D1 had to decide whether `/contacts/[id]` ships in the same slice. It split into D1+D1.5 because (a) `recommendation-adapter.ts:48` and `handoff-adapter.ts:22` already construct `/contacts/:id` URLs that 404 today, and (b) detail pages have substantial UX surface (sub-tabs, threading, mutating affordances).

D2's calculus is different in two ways. **First**, nothing in the codebase links to `/automations/[id]`, so there's no inert-link debt to retire. **Second**, the per-row content is small and bounded: the operator's question is "what _exactly_ will this do" — answerable with a few extra fields (full id, full source workflow id, expiresAt, eventPattern summary, redacted action). That's not a page; that's a drawer.

A drawer keeps D2 read-only and route-free, but removes the "I can see an automation exists but not what it actually does" gap that pure-inert rows would create. This is a control-plane product — visibility without inspectability would feel unfinished.

**Decision:**

- No `/automations/[id]` route in D2 or D2.5. Revisit only if trigger history (e.g., a fire timeline) becomes a first-class surface.
- Rows expand inline into a Mercury-style drawer (`automation-row-drawer.tsx`).
- Drawer is read-only — no cancel button, no edit field, no link to `WorkflowExecution` (it has no detail page either).
- Drawer never surfaces raw `action.payload`; only `action.type` plus a redacted summary (key list with values masked, see §6.4).

**Flip** to "no drawer, just inert rows" if reviewer reverts the drawer call (cuts ~120 LoC + the redaction helper). **Flip** to "drawer + cancel button" only as part of D2.5; this slice stays read-only.

### 2.3 Why status chips with counts, default Active

The trigger status enum has 4 values (`active / fired / cancelled / expired`) and each describes a meaningfully different operator state: "things that will fire", "things that have already done their job", "things I cancelled", "things that timed out". Status is the dominant browse axis.

**Default chip is `Active`,** not `All`. The product framing for `/automations` is "what is my system going to do automatically, and when" — that's the active set. History is reachable but not foregrounded. `All` defaults degrade over time as fired/cancelled/expired rows dominate the first page.

**Counts on the chips** (`Active 12 · Fired 83 · Cancelled 4 · Expired 2`) make the register feel operational immediately. Cost is one additional `GROUP BY status` query in `listForBrowse`, scoped to the org and respecting `expiresAt`-elision. Single query, indexed by `(organizationId, status)`. Worth it.

Type (`timer / cron / event_match`) is **not** a chip and is **not** an API filter parameter in v1. Type is a column. Adding type chips would create an N×M chip matrix violating `feedback_modes_not_knobs.md`; adding a type query parameter that no UI exposes would create a half-contract that future callers would discover and depend on. Cut both for YAGNI; add together if needed in D2.5.

### 2.4 Why no search; how to do direct-id lookup

Trigger volume is bounded by what agents and operators schedule. A heavily-instrumented org might have 50 active crons + 20 timers + 30 event_matches + thousands of expired/fired rows over time. Status filter + cursor pagination handles that fine.

**Direct-id lookup** is the one named D2.5 escape hatch. When an operator has a trigger id from logs, they shouldn't have to page-by-page through the list. Defer the actual implementation but pre-name it: `/automations?triggerId=abc-123` would `findById` and either render a single-row response or scroll/highlight the matching row.

**Flip** to "ship `?triggerId=` in D2": small surface — add to the query schema, route to `triggerStore.findById` when present, render in a single-row Mercury container. ~30 LoC.

**Flip** to "ship full string search": add `?q=<text>` to the schema, server-side `ILIKE` over `cronExpression || jsonb_extract_path_text(action, 'type') || jsonb_extract_path_text(eventPattern, 'type')`. No new index in v1; revisit if EXPLAIN shows full-table scans on 100k+ historical rows.

### 2.5 Why `createdAt DESC` only — no `fireAt` sort

Two arguments converge on dropping the `fireAt` sort:

1. **`fireAt` is null for `cron` and `event_match` triggers.** Sorting by it scatters those rows via `NULLS FIRST` / `NULLS LAST` semantics — useful for operators who only have timer triggers, but confusing for the typical mixed-type set. The schedule column already shows the timer fire time inline, so timer-rows-by-fire-time is already discoverable visually.
2. **The right field for "what fires next" is `nextRunAt`,** which would require materialising the next computed fire time for cron triggers (parsing `cronExpression` against `now()`). The current `ScheduledTrigger` shape doesn't carry it. That materialisation is its own slice, not D2's.

D2 sorts by `Created` only. **Flip** if reviewer wants `Fires at` back: re-add it as `Timer fire time` (renamed for clarity) and surface only when the row's type is `timer`. The status-history gap (#22) is a separate concern.

### 2.6 Production gate

- **Variable:** `NEXT_PUBLIC_AUTOMATIONS_LIVE` (`"true"` flips to live). Mirrors `NEXT_PUBLIC_REPORTS_LIVE` and `NEXT_PUBLIC_CONTACTS_LIVE`.
- **Default at launch:** `false`. Triggers contain action payloads that may include workflow IDs and event filters — not strictly PII, but also not auto-greenlit for a first look. Flip after one staging walkthrough.

---

## 3. Visual contract (Mercury, inherited)

D2 imports nothing new at the token layer. Tokens, fonts, and visual vocabulary inherit from `/reports` and `/contacts`:

- Page shell: cream background, single column, `max-width: 1080px`.
- Sticky header with hairline-bottom (`reports.module.css:57-65` pattern).
- Folios (caps + mono section labels), hairline tables, mono-caps thead, sans-medium tbody, `tabular-nums`, row hover at `--mercury-row-hover`.
- `apps/dashboard/src/app/(auth)/automations/automations.module.css` follows the same module-aliasing pattern as `contacts.module.css` and `reports.module.css`.

### 3.1 Page layout

```
┌ Header (sticky, cream, hairline-bottom) ─────────────────────────────┐
│ Switchboard ●   Alex · Riley · +     Live · Inbox · Halt · M         │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│ Automations                                                    MAY 9  │
│ ───────────────────────────────────────────────────────────────────── │
│                                                                       │
│ [Active 12]·[Fired 83]·[Cancelled 4]·[Expired 2]·[All 101]            │
│                                                                       │
│ TYPE   SCHEDULE                ACTION           STATUS   SOURCE        CREATED · SGT │
│ ───────────────────────────────────────────────────────────────────── │
│ cron   0 7 * * *               spawn_workflow   active   WF:a1b2c3d4   May 7        ▾│
│ timer  May 12, 18:00 SGT       emit_event       active   —             May 8        ▾│
│ event  event:lead.captured     spawn_workflow   active   WF:e5f6g7h8   May 8        ▾│
│ cron   */15 * * * *            resume_workflow  fired    WF:i9j0k1l2   Apr 30       ▾│
│ ...                                                                   │
│                                                                       │
│                                              Showing 1–50 · more →    │
└───────────────────────────────────────────────────────────────────────┘
```

Default chip is `Active` (12). Counts shown next to each chip label. The `▾` glyph is the row-expand affordance — clicking the row (or the chevron) opens the inline drawer (§6.4); clicking again collapses it. Hover applies `--mercury-row-hover`; cursor is `pointer` over the chevron, `default` over the row body to keep "this is read-only" legible.

**Responsive (<960px):** the table scrolls horizontally inside the Mercury container. The `TYPE` column is `position: sticky; left: 0` so context survives the scroll. No stacked-row rewrite, no column hiding — desktop-first surface.

### 3.2 Column rendering details

| Column           | Source                    | Render                                                                                                                                                                           |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type             | `ScheduledTrigger.type`   | Lowercase mono. `event_match` shortened to `event` for column width.                                                                                                             |
| Schedule         | derived (`scheduleLabel`) | Mono. `cron` → expression verbatim (or `cron:unknown` fallback). `timer` → human local datetime (or `timer:unknown`). `event` → `event:<type>` (or `event:unknown`).             |
| Action           | `action.type`             | Mono. Payload never rendered here.                                                                                                                                               |
| Status           | `ScheduledTrigger.status` | Caps mono pill: `active` (ink), `fired` (ink-3), `cancelled` (ink-3), `expired` (mercury-neg).                                                                                   |
| Source           | `sourceWorkflowId`        | Mono `WF:<first 8 chars>` or em-dash. Inert.                                                                                                                                     |
| Created · `<TZ>` | `createdAt`               | Short human date (`May 9`, `2026-05-09` if year differs from today). Tabular nums. Column header carries the resolved timezone abbreviation (`CREATED · SGT` / `CREATED · UTC`). |

Date / time formatting rule (frontend-only — backend always emits ISO8601):

1. If org timezone is already available in the page shell (per the existing org-config plumbing the dashboard uses elsewhere), render the table cell in that zone.
2. Else use the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone` — same `browserTimezone()` helper used by `apps/dashboard/src/app/(auth)/contacts/components/format.ts:6`.
3. Else fall back to `UTC`.
4. Drawer always shows the full ISO8601 with offset (no truncation), regardless of the column's short form.

D2 does **not** plumb org timezone if it's not already plumbed; the named follow-up `org-tz plumbing` covers that work separately. With browser-tz fallback the dashboard is correct for single-operator orgs and explicitly imprecise for multi-tz orgs — flagged via the column-header abbreviation so operators can read the timezone they're seeing.

---

## 4. Data model

### 4.1 Existing Prisma — what we read from, unchanged

```
ScheduledTriggerRecord (schema.prisma:1389)
  id, organizationId,
  type ("timer" | "cron" | "event_match"),
  fireAt (DateTime?),
  cronExpression (String?),
  eventPattern (Json?),
  action (Json),
  sourceWorkflowId (String?),
  status ("active" | "fired" | "cancelled" | "expired"),
  createdAt, expiresAt
  Indexes used by D2:
    (organizationId, status)         ← chip filter
    (status, type)                   ← cross-org type-grouping (not used by D2 directly)
    (sourceWorkflowId)
    (fireAt)
    + we add:
    (organizationId, createdAt)      ← drives default sort + cursor
```

D2 reads this table only. **The only Prisma diff in D2a is one additive non-functional index:** `@@index([organizationId, createdAt])`. No model shape change, no data migration. Required to make the cursor sort efficient at scale; ships via `prisma migrate diff --from-url … --to-schema-datamodel … --script | prisma migrate deploy` per `feedback_prisma_migrate_dev_tty.md`.

**Flip to omit the new index** if reviewer prefers a true zero-migration slice — at launch volumes (50–500 rows per org) the unfiltered `All` chip's per-org sort is fine without it. Revisit when EXPLAIN shows it matters.

### 4.2 New schemas (added to existing `packages/schemas/src/scheduler.ts`)

The browse projection lives in the same file as the source-of-truth `ScheduledTrigger` schema — it's the same domain, and a separate surface-named file would violate `feedback_surface_agnostic_backend.md`.

```ts
// Appended to packages/schemas/src/scheduler.ts (existing).

// One row in the browse list — page-ready, surface-agnostic projection.
// Hard invariant: never carries action.payload. Drawer surfaces a redacted
// summary, see ScheduledTriggerBrowseDrawerSchema below.
export const ScheduledTriggerBrowseRowSchema = z.object({
  id: z.string(),
  type: TriggerTypeSchema, // "timer" | "cron" | "event_match"
  status: TriggerStatusSchema, // "active" | "fired" | "cancelled" | "expired"
  scheduleLabel: z.string(), // derived (see §2.0 #13)
  actionType: TriggerActionTypeSchema, // = action.type
  sourceWorkflowId: z.string().nullable(), // raw uuid; UI truncates
  createdAt: z.string(), // ISO
  fireAt: z.string().nullable(), // ISO or null (cron/event_match)
  expiresAt: z.string().nullable(), // ISO or null
  // For drawer reveal — small, redaction-safe.
  drawer: z.object({
    eventPatternSummary: z.string().nullable(), // e.g. "lead.captured (filters: contactId, source)"
    // Allowlisted keys only — see §6.4 for the explicit allowlist. Anything not on
    // the allowlist is redacted to a count, preventing accidental leakage of
    // sensitive vocabulary like "stripeCustomerId" or "passwordResetToken".
    visibleActionPayloadKeys: z.array(z.string()),
    redactedKeyCount: z.number().int().min(0),
  }),
});
export type ScheduledTriggerBrowseRow = z.infer<typeof ScheduledTriggerBrowseRowSchema>;

export const ScheduledTriggersListQuerySchema = z.object({
  status: TriggerStatusSchema.optional(), // null → all statuses
  // No `type` filter in v1 — intentionally cut for YAGNI. Add to UI and API together when needed.
  cursor: z.string().optional(), // opaque base64 (createdAt|id)
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Only `createdAt` sort in v1. `fireAt` was considered and dropped (see §2.5).
  sort: z.enum(["createdAt"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type ScheduledTriggersListQuery = z.infer<typeof ScheduledTriggersListQuerySchema>;

export const ScheduledTriggersListResponseSchema = z.object({
  rows: z.array(ScheduledTriggerBrowseRowSchema),
  // Counts per status for chip rendering — single GROUP BY in the same store call.
  // Always populated regardless of the query's status filter (chips show counts across
  // the full org, not the filtered subset).
  //
  // Counts reflect *persisted* ScheduledTriggerRecord rows only. If the scheduler
  // has reaped or deleted old expired rows (TriggerStore.deleteExpired runs in the
  // existing scheduler service), they are not counted here. D2 does not recompute
  // expiry state and does not surface the reaping cadence — operators may see an
  // `Expired 0` chip even if triggers expired in the past.
  statusCounts: z.object({
    all: z.number().int().min(0),
    active: z.number().int().min(0),
    fired: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    expired: z.number().int().min(0),
  }),
  nextCursor: z.string().nullable(), // null = final page
  hasMore: z.boolean(),
});
export type ScheduledTriggersListResponse = z.infer<typeof ScheduledTriggersListResponseSchema>;
```

**Action-payload redaction (hard invariant):** the API response carries `actionType` plus `drawer.visibleActionPayloadKeys` (allowlisted key names only) and `drawer.redactedKeyCount` — but **never** the raw `action.payload` values, and never any non-allowlisted key names. The allowlist + tests live in §6.4 and §8.1.

### 4.3 Cursor encoding

`base64(JSON.stringify({ ts: createdAt.toISOString(), id }))`. Decoded server-side, opaque to the client. The store fetches `limit + 1` rows; the response returns at most `limit` rows; `hasMore` is `true` when the fetch returned more than `limit`.

```sql
WHERE organizationId = $1
  [AND status = $2]
  AND (createdAt, id) < ($cursor.ts, $cursor.id)   -- DESC; flip operator + ORDER BY for ASC
ORDER BY createdAt DESC, id DESC
LIMIT $limit + 1
```

A separate single-statement `GROUP BY status` (scoped to the org) populates `statusCounts`. No additional indexes required beyond the existing `(organizationId, status)`.

---

## 5. Backend (surface-agnostic boundary)

The rule from `memory/feedback_surface_agnostic_backend.md`: nothing in `core` / `schemas` / `db` may name a UI surface or path. `/automations` exists only in `apps/dashboard`. The backend talks about scheduled triggers, not pages.

The new browse types **live in the existing `packages/schemas/src/scheduler.ts`** — same file as the source-of-truth `ScheduledTrigger` schema. Type names use the domain noun (`ScheduledTriggerBrowseRow` etc.), never the surface name. The core function is `listTriggersForBrowse` in `packages/core/src/scheduler/list-triggers.ts`. The frontend is the only place where the word "automation" appears.

### 5.1 Layered structure

```
apps/dashboard/src/app/(auth)/automations/
  ├ page.tsx                       (Server component, metadata + AutomationsPage)
  ├ automations-page.tsx           ("use client", composition of components)
  ├ automations.module.css         (Mercury aliases + horizontal-scroll responsive rule)
  ├ components/
  │   ├ header.tsx                 (AutomationsHeader — clone of ContactsHeader for now)
  │   ├ filter-chips.tsx           (5 status chips, with counts)
  │   ├ automations-table.tsx      (hairline table with createdAt sort, sticky TYPE col)
  │   ├ automation-row.tsx         (one row; inert click EXCEPT for the expand chevron)
  │   ├ automation-row-drawer.tsx  (inline expanded panel — id, source workflow, eventPattern summary, redacted action)
  │   ├ pagination-footer.tsx      ("Showing N–M · more →")
  │   ├ empty-state.tsx            (zero / filtered-empty / error)
  │   └ format.ts                  (tiny — schedule label w/ fallbacks, action label, status pill, sourceWf truncate, tz-aware date)
  ├ hooks/
  │   └ use-automations-list.ts    (React Query, keyed by (org, query))
  ├ fixtures.ts                    (6 hand-written rows: type × status coverage, including expired)
  └ __tests__/
      ├ automations-page.test.tsx
      ├ automations-table.test.tsx
      ├ automation-row-drawer.test.tsx
      ├ filter-chips.test.tsx
      └ use-automations-list.test.ts

apps/dashboard/src/app/api/dashboard/automations/
  └ route.ts                       (Next proxy → /api/dashboard/automations on Fastify)

apps/api/src/routes/
  └ dashboard-automations.ts       (Fastify route, validates ScheduledTriggersListQuerySchema, calls core)

packages/core/src/scheduler/
  ├ list-triggers.ts               (NEW: listTriggersForBrowse(input, deps))
  └ __tests__/
      └ list-triggers.test.ts      (shared in-memory store, exercises sort + cursor + filter + counts + redaction)

packages/core/src/scheduler/trigger-store.ts
  + listForBrowse(args: {
      orgId: string;
      status?: TriggerStatus;
      sort: "createdAt";
      direction: "asc" | "desc";
      cursor?: { ts: Date; id: string };  // already-decoded; store does not own cursor encoding
      limit: number;                       // store fetches up to limit + 1 internally
    }): Promise<{
      rows: ScheduledTrigger[];                     // up to limit + 1 — core trims
      statusCounts: Record<TriggerStatus | "all", number>;
    }>
  // Note: no `type` parameter — type filtering was cut for YAGNI in §2.0 #6.
  // The store stays dumb about cursor encoding and trimming; core owns those
  // semantics (see §5.2). Implementation extends prisma-trigger-store.ts.
  // The in-memory test fixture currently lives inline in scheduler-service.test.ts:14
  // (`createInMemoryTriggerStore`); D2a extracts it to a shared
  // `packages/db/src/stores/in-memory-trigger-store.ts` so list-triggers.test.ts
  // and scheduler-service.test.ts both import it. Cleanup-while-here, not a new abstraction.

packages/schemas/src/scheduler.ts   (existing — append browse types; no new file)
```

### 5.2 Core function shape

```ts
// packages/core/src/scheduler/list-triggers.ts
import type { TriggerStore } from "./trigger-store.js";
import type {
  ScheduledTriggersListQuery,
  ScheduledTriggersListResponse,
} from "@switchboard/schemas";

export interface ListTriggersDeps {
  triggerStore: TriggerStore;
}

export async function listTriggersForBrowse(
  input: { orgId: string; query: ScheduledTriggersListQuery },
  deps: ListTriggersDeps,
): Promise<ScheduledTriggersListResponse> {
  // 1. Decode cursor (opaque base64 → { ts, id }) — core owns this; store never sees the encoded form.
  // 2. Call triggerStore.listForBrowse({ orgId, status, sort, direction, cursor, limit }).
  //    Store fetches up to limit+1 rows and returns them as-is, plus statusCounts.
  // 3. Trim core-side: hasMore = rows.length > limit; rows = rows.slice(0, limit).
  // 4. Project each ScheduledTrigger → ScheduledTriggerBrowseRow:
  //    - scheduleLabel (with fallbacks for malformed legacy data):
  //        cron        → trigger.cronExpression ?? "cron:unknown"
  //        timer       → trigger.fireAt?.toISOString() ?? "timer:unknown"
  //        event_match → `event:${trigger.eventPattern?.type ?? "unknown"}`
  //    - actionType:   trigger.action.type
  //    - drawer.eventPatternSummary: null for non-event_match, otherwise
  //        `${pattern.type} (filters: ${Object.keys(pattern.filters).join(", ")})`
  //    - drawer.visibleActionPayloadKeys + drawer.redactedKeyCount: see §6.4 (allowlist).
  //    - dates: trigger.createdAt.toISOString(), etc. — backend always emits ISO; frontend formats.
  // 5. Encode nextCursor from the last *kept* row when hasMore (core owns encoding).
  // 6. Return ScheduledTriggersListResponse with statusCounts attached.
}
```

The function knows nothing about `/automations`, React Query, or Next.js. It is a pure projection over a `TriggerStore`-shaped dependency, exactly like `contacts/list.ts`, `agent-home/wins.ts`, and `agent-home/pipeline.ts`.

### 5.3 Why `TriggerStore.listForBrowse` is a new method (not an overload of `findByFilters`)

`TriggerStore.findByFilters(filters)` already exists (`trigger-store.ts:5`) and is consumed by `SchedulerService.matchEvent` and `listPendingTriggers`. Its semantics are "exact-match filter, no pagination, no sort" — adding cursor + sort to it would change the contract for every existing caller. The browse method is sibling-shaped (`listForBrowse` next to `findByFilters` — same store, additional method, no breaking change), exactly mirroring how D1's PR-D1a added `ContactStore.listForBrowse` next to `list`. The new method also returns `statusCounts` (single GROUP BY) so the frontend can render chip counts without a second round-trip.

### 5.4 Fastify route + Next proxy

Follows the `dashboard-<thing>.ts` route-file convention:

- `apps/api/src/routes/dashboard-automations.ts` — `GET /api/dashboard/automations?status=&cursor=&limit=&sort=&direction=`. (No `type` param — cut for YAGNI.) Auth: same org-scoping middleware as everything else; `req.organizationIdFromAuth` derives from the API key in production and from `x-org-id` in `authDisabled` mode. Validates query against `ScheduledTriggersListQuerySchema`, calls `listTriggersForBrowse`, returns the projection.
- `apps/dashboard/src/app/api/dashboard/automations/route.ts` — thin Next proxy that forwards via `getApiClient().getAutomations(...)` (a new method on `SwitchboardDashboardClient`). No `notFound()` gating — the page itself is gated by `NEXT_PUBLIC_AUTOMATIONS_LIVE`.

### 5.5 ESLint / layer enforcement

`packages/core/src/scheduler/list-triggers.ts` imports only `@switchboard/schemas` and the `TriggerStore` interface from `./trigger-store.js`. No imports from `apps/`, no string literals matching `/automations` or `/api/`. ESLint already flags layer violations across the monorepo — D2 does not change those rules.

All new schemas land in the existing `packages/schemas/src/scheduler.ts`. There is no `automations.ts` file in `packages/schemas/` — the surface name appears only in `apps/dashboard/`. Reviewers should hold this line.

---

## 6. Frontend — composition

### 6.1 Hook: `useAutomationsList(query)`

Mirror of `useContactsList`:

```ts
// apps/dashboard/src/app/(auth)/automations/hooks/use-automations-list.ts
"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { FIXTURE } from "../fixtures";
import type {
  ScheduledTriggersListQuery,
  ScheduledTriggersListResponse,
} from "@switchboard/schemas";

const isLive = process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true";

export function useAutomationsList(query: Omit<ScheduledTriggersListQuery, "cursor">) {
  const keys = useScopedQueryKeys();

  return useInfiniteQuery<ScheduledTriggersListResponse>({
    queryKey: keys?.automations.list(query) ?? ["__disabled_automations__"],
    enabled: isLive && !!keys,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        ...query,
        ...(pageParam ? { cursor: pageParam } : {}),
      } as Record<string, string>);
      const res = await fetch(`/api/dashboard/automations?${params}`);
      if (!res.ok) throw new Error(`Failed to load automations: ${res.status}`);
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
```

When `!isLive`, the hook returns a synthesised fixture page.

`useScopedQueryKeys` already exists; we add an `automations` namespace next to `contacts`:

```ts
// apps/dashboard/src/hooks/use-query-keys.ts (existing — append):
automations: {
  list: (q: object) => [...base, "automations", "list", q] as const,
}
```

### 6.2 Filter / sort URL state

Status chips and sort headers commit instantly via `useSearchParams` + `router.replace`. URL shape: `/automations?status=active&sort=createdAt&direction=desc`. The default URL (no params) renders status=active. Cursor stays out of the URL — pagination is in-page only, not deep-linkable.

Same posture as `/contacts` — filter changes reset cursor automatically because React Query keys include the full query object.

### 6.3 Fixtures

`apps/dashboard/src/app/(auth)/automations/fixtures.ts` — **6** hand-written rows covering every `type` × `status` combination needed for design review and tests:

- `cron / active / spawn_workflow` ("0 7 \* \* \*" → daily report)
- `timer / active / emit_event` (follow-up reminder)
- `event_match / active / spawn_workflow` (`lead.captured` → enrich)
- `cron / fired / resume_workflow` (a recently-fired one)
- `timer / cancelled / spawn_workflow`
- `cron / expired / emit_event` (one expired row, ensures `--mercury-neg` pill renders)

Used in the `!isLive` branch and component tests. `statusCounts` is hardcoded in the fixture file so chips render with non-zero counts during design review.

### 6.4 Inline drawer (`automation-row-drawer.tsx`)

The chevron is a real `<button>` (not a clickable glyph), with `aria-expanded={open}` and `aria-controls={drawerId}`. The drawer `<tr>` has the matching stable `id={drawerId}`. `Enter` and `Space` on the button toggle the drawer. The row body itself is non-interactive — only the chevron button toggles the drawer. Only one drawer open at a time per page (opening another row's chevron closes the previous one). Drawer is part of the same `<tbody>` — implemented as a `<tr>` with `colSpan` covering the table width and a Mercury-styled inset.

#### Drawer content (read-only)

| Field                | Source                                | Render                                                                                                                                |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger id           | `row.id`                              | Full UUID, mono. Adjacent **copy-to-clipboard `<button>`** with `aria-label="Copy trigger id"`.                                       |
| Source workflow      | `row.sourceWorkflowId`                | Full UUID or em-dash. Mono. Inert (no link — `WorkflowExecution` has no detail surface). Copy button identical pattern to trigger id. |
| Created              | `row.createdAt`                       | Full ISO8601 with offset (e.g., `2026-05-09T10:23:45+08:00`).                                                                         |
| Expires              | `row.expiresAt`                       | Full ISO8601 with offset, or em-dash.                                                                                                 |
| Schedule             | `row.scheduleLabel`                   | Verbatim. Includes the fallback strings (`cron:unknown` etc.) when source data is malformed.                                          |
| Event pattern        | `row.drawer.eventPatternSummary`      | Mono one-liner; `null` rows render `—`.                                                                                               |
| Action type          | `row.actionType`                      | Mono.                                                                                                                                 |
| Visible payload keys | `row.drawer.visibleActionPayloadKeys` | Comma-separated list of allowlisted key names. Empty list renders `—`.                                                                |
| Redacted             | `row.drawer.redactedKeyCount`         | If > 0, render `· N redacted`. If 0, omit.                                                                                            |

The two payload rows render together as e.g. `Payload: workflowId, contactId · 3 redacted`.

#### Action-payload redaction (allowlist)

The hard invariant is values never leave the backend. Key names are also a leakage vector — e.g. `["passwordResetToken", "stripeCustomerId", "internalRiskScore"]` would leak product-internal vocabulary. So D2 also constrains _which_ key names are visible, via an allowlist:

```ts
// packages/core/src/scheduler/list-triggers.ts
const VISIBLE_PAYLOAD_KEYS = new Set([
  "workflowId",
  "contactId",
  "eventType",
  "agentKey",
  "triggerId",
  "source",
]);
```

Projection rule:

```
visibleActionPayloadKeys = Object.keys(payload).filter((k) => VISIBLE_PAYLOAD_KEYS.has(k));
redactedKeyCount         = Object.keys(payload).length - visibleActionPayloadKeys.length;
```

This list is intentionally small. If a future caller routinely uses a key name that should be visible (e.g. `campaignId`), adding it to the allowlist is a focused, reviewable change. The allowlist lives in core, not schemas, because it's a backend-only redaction policy — clients only ever see the post-redaction projection.

There is no client-side toggle to "show full payload." Tests:

- `list-triggers.test.ts` plants `action.payload = { sentinel: "REDACTION_PROBE_X9", workflowId: "wf-abc" }` and asserts the projected JSON contains `"workflowId"` but neither `"sentinel"` nor `"REDACTION_PROBE_X9"`.
- The same test asserts `redactedKeyCount === 1`.

---

## 7. Empty / loading / error states

| State          | Trigger                                     | Copy (Mercury voice — short, no agent prose)                                               |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Loading        | First fetch in flight                       | Single hairline-row skeleton repeated 8× under header (no spinner)                         |
| Zero-state     | `statusCounts.all === 0`                    | `No automations yet. Triggers scheduled by your agents will appear here.`                  |
| Filtered-empty | `statusCounts.all > 0 && rows.length === 0` | `No matches. Try a different filter.` + `[Clear]` button (resets to default `Active` chip) |
| Error          | API non-2xx / network error                 | `Couldn't load automations. <button>Try again</button>` (retries the query)                |

All four states share the same Mercury container.

---

## 8. Test strategy

Three layers, mirroring the contacts D1 + reports patterns already on `main`.

### 8.1 Core (projection)

`packages/core/src/scheduler/__tests__/list-triggers.test.ts` — uses an in-memory `TriggerStore`. Today that fixture lives inline as `createInMemoryTriggerStore` in `scheduler-service.test.ts:14`; D2a moves it to a shared `packages/db/src/stores/in-memory-trigger-store.ts` so both test files import it. The new `listForBrowse` method is implemented on that shared fixture.

Coverage:

- Default sort = `createdAt DESC`.
- Status filter applies before pagination.
- Cursor round-trip — `nextCursor` from page 1 → page 2 → final page with `nextCursor === null`.
- `hasMore` semantics — store fetches `limit + 1`, response trims to `limit`, `hasMore` is `true` when the fetch returned more than `limit`.
- `scheduleLabel` derivation per type happy path: cron expr verbatim / ISO / `event:<type>`.
- `scheduleLabel` derivation **fallback paths** for malformed legacy rows: missing `cronExpression` → `cron:unknown`; missing `fireAt` on a `timer` row → `timer:unknown`; missing `eventPattern.type` → `event:unknown`. Tests plant each malformed row directly via the in-memory store.
- `actionType` projects from `action.type`.
- `drawer.eventPatternSummary` is `null` for non-`event_match` rows; for `event_match` rows it lists pattern type + filter key names.
- `drawer.visibleActionPayloadKeys` includes only allowlisted keys; `drawer.redactedKeyCount` equals `Object.keys(payload).length - visibleActionPayloadKeys.length`.
- **Value-redaction invariant** — a fixture row carries `action.payload = { sentinel: "REDACTION_PROBE_X9", workflowId: "wf-abc" }`; the projected response is JSON-stringified and asserted to not contain `"sentinel"` or `"REDACTION_PROBE_X9"` anywhere, while `"workflowId"` _does_ appear.
- **Key-allowlist invariant** — a separate fixture row carries `action.payload = { stripeCustomerId: "cus_x", contactId: "c-1", workflowId: "wf-y" }`; the projection's `visibleActionPayloadKeys` is exactly `["contactId", "workflowId"]` (order-insensitive) and `redactedKeyCount === 1`.
- `statusCounts` reflects the org's full-table tallies regardless of the query's status filter (filtering active rows still returns the count of fired/cancelled/expired alongside).
- Empty result returns `{ rows: [], statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 }, nextCursor: null, hasMore: false }`.
- Org-scoping: triggers in another org never appear in `rows` and never contribute to `statusCounts`.

Targets the core 65/65/70/65 coverage thresholds (per CLAUDE.md).

### 8.2 API (Fastify) + Next proxy

`apps/api/src/__tests__/api-automations.test.ts` — uses `buildTestServer` + mocked Prisma per `memory/feedback_api_test_mocked_prisma.md`.

Coverage:

- `GET /api/dashboard/automations` returns 200 with the projected shape on a happy path.
- Missing auth → 401 (existing middleware behaviour).
- Invalid query (`status=foo`) → 400 with Zod error path.
- `limit > 100` → 400 (schema clamp).
- Cursor decode failure → 400.
- Cross-org isolation — another org's triggers never returned.

`apps/dashboard/src/app/api/dashboard/automations/__tests__/route.test.ts` — proxy correctness only (forwards query + auth header, doesn't transform body). Two tests; the projection logic is already covered upstream.

### 8.3 Component / hook

- `automations-page.test.tsx` — renders all four state transitions (loading, populated, empty, error) using a mocked `useAutomationsList`. Verifies default URL with no params resolves to `status=active`.
- `automations-table.test.tsx` — sort header click toggles direction; mono-caps thead; row hover applies `--row-hover`; clicking a row body does nothing; clicking the chevron opens the drawer; opening another row's drawer closes the first.
- `automation-row-drawer.test.tsx` — drawer renders id, source workflow, ISO dates, eventPattern summary, allowlisted payload key list, redacted-count line. Asserts no buttons exist whose accessible name suggests a mutation (regex match for `Cancel|Edit|Delete|Pause|Reschedule`); copy-to-clipboard buttons (`aria-label="Copy …"`) are explicitly allowed. Asserts the rendered DOM never contains a sentinel string planted in the fixture's `action.payload`. ARIA: chevron is `<button aria-expanded>`, drawer `<tr>` has matching `id`; `Enter`/`Space` toggle the drawer; clicking the row body does not toggle.
- `filter-chips.test.tsx` — chip labels include counts from `statusCounts`; chip click updates URL via mocked `useRouter.replace`; only one chip active at a time; default-active is `Active`; counts re-render when the response refreshes.
- `use-automations-list.test.ts` — fixtures branch when `NEXT_PUBLIC_AUTOMATIONS_LIVE !== "true"`; live branch wires `useInfiniteQuery` correctly.
- Date formatting test (`format.test.ts`) — three branches: org-tz set (`OrganizationConfig.timezone = "Asia/Singapore"`), browser-tz fallback, UTC fallback. Asserts the column-header timezone abbreviation matches the resolved zone.

### 8.4 What we explicitly do **not** test

- E2E (Playwright) for `/automations` — no E2E suite for `/contacts` either; following precedent.
- Visual regression beyond the existing `security-headers.test.ts` snapshot pattern.
- PostgreSQL-specific cursor behaviour — exercised in store tests with the shared in-memory store; integration test skipped for D2 (fold into a future Mercury-list-scaling slice).
- Responsive scroll behaviour — covered by manual review on the staging walkthrough; no jsdom viewport simulation.

---

## 9. PR sequencing

D2 ships in **two PRs**, both targeting `main`. The second consumes shipping of the first, but otherwise they're independent.

### PR-D2a — Backend (schemas + core + API + Next proxy + index)

- Append browse types to **existing** `packages/schemas/src/scheduler.ts` — `ScheduledTriggerBrowseRow`, `ScheduledTriggersListQuery`, `ScheduledTriggersListResponse`. Update barrel.
- `TriggerStore.listForBrowse` interface + Prisma + shared in-memory impls.
- Extract the in-memory trigger fixture from `scheduler-service.test.ts:14` to `packages/db/src/stores/in-memory-trigger-store.ts` and rewire both test files.
- `packages/core/src/scheduler/list-triggers.ts` + tests (including the redaction-sentinel test).
- `apps/api/src/routes/dashboard-automations.ts` + tests.
- `apps/dashboard/src/app/api/dashboard/automations/route.ts` + minimal proxy test.
- One additive Prisma index `@@index([organizationId, createdAt])` on `ScheduledTriggerRecord` + migration via `migrate diff … --script | migrate deploy` per `feedback_prisma_migrate_dev_tty.md`.

No UI. No CSS. No new public route.

### PR-D2b — Frontend page

- `apps/dashboard/src/app/(auth)/automations/{page,automations-page}.tsx` + `automations.module.css`.
- All `components/` (including `automation-row-drawer.tsx`) and `hooks/`.
- `apps/dashboard/src/hooks/use-query-keys.ts` — append `automations.list(query)` key.
- 6-row fixture file + tests (including redaction component test + tz formatting test).
- No `EditorialAuthShell` change. No `ROUTE_AVAILABILITY` change (no detail route).

PR-D2b is gated to staging-only by `NEXT_PUBLIC_AUTOMATIONS_LIVE`. Production flip is a `.env.production` change after a deliberate staging review.

### Out of D2 scope, ordered

- **D2.5 (optional, demand-driven)** — possible follow-ups, each independent: (a) `Cancel trigger` button on active rows, (b) `?triggerId=<id>` direct-id lookup escape hatch, (c) `Timer fire time` sort + column for timer-only views, (d) `?q=<text>` string search, (e) type filter (UI chip + API param shipped together), (f) status-history substrate (`@updatedAt` field or `ScheduledTriggerStateChange` log) so the `Created` column can be augmented with "last changed".
- **D3** — `/activity` (Mercury, audit log + workflow execution browse). Reuses everything D1/D2 settled (header, chips, hairline table, cursor pagination).
- **D4** — Legacy route disposition (`/me`, `/my-agent`, `/conversations`, `/escalations`, `/decide`, `/tasks`, etc.).

---

## 10. Risks + mitigations

| Risk                                                                               | Mitigation                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mercury surface count grows past three and shared-chrome refactor gets harder      | When D3 lands, extract `MercuryAuthShell` from `ReportsHeader` / `ContactsHeader` / `AutomationsHeader` as that PR's tax. Don't try to extract during D2.                                                                                                                                                                                                                              |
| `ScheduledTriggerRecord` exposes payload data operators don't expect to see        | **Hard invariant:** the API response never carries `action.payload` values. Drawer surfaces only `actionType` + an **allowlisted** subset of payload key names (§6.4) plus a `redactedKeyCount` for the rest — preventing leakage of sensitive vocabulary like `stripeCustomerId`. Sentinel-string test verifies values absence; allowlist test verifies non-allowlisted keys absence. |
| Cursor pagination + filter changes create stale-page UX                            | React Query keys include the full query; changing filter resets pagination automatically (queryKey changes → fresh first-page fetch).                                                                                                                                                                                                                                                  |
| Backend grows surface-coupled by accident                                          | Core function is `listTriggersForBrowse`. New schemas live in `scheduler.ts` and use the domain noun. No file in `packages/schemas/` carries the surface name. Reviewer watches for path strings + page names in `core/scheduler/list-triggers.ts` during D2a review.                                                                                                                  |
| `listForBrowse` interface gets reused as a generic CRM-like browse and over-grows  | Method docstring says "browse only — UI list view"; mutating callers and event-matching keep using the existing scheduler-service methods.                                                                                                                                                                                                                                             |
| `Created` column is misleading for fired/cancelled/expired rows (#22 gap)          | Default chip is `Active`, so the dominant view shows rows for which `createdAt` is the most relevant timestamp. Documented as a known gap (#22); a proper status-history substrate is its own slice. Drawer surfaces `expiresAt` for additional context.                                                                                                                               |
| Trigger volume grows past tens of thousands with no search                         | Status + cursor scales; revisit search in D2.5 only if operators ask. Adding `?triggerId=<id>` first is the cheaper escape hatch.                                                                                                                                                                                                                                                      |
| Malformed legacy trigger rows (missing `cronExpression` etc.) crash the projection | Fallback derivations (`cron:unknown` etc.) plus tests for each fallback path. Browse surfaces tend to expose legacy dirt; defensive defaults beat an exception.                                                                                                                                                                                                                        |
| Operator on a different timezone sees UTC and misreads timer fire times            | Date formatting follows org-tz → browser-tz → UTC fallback chain. Column header carries the resolved abbreviation. Drawer shows full ISO with offset for unambiguous reading.                                                                                                                                                                                                          |

---

## 11. References

### Specs already on `main`

- `docs/superpowers/specs/2026-05-08-contacts-d1-design.md` — direct precedent for D2's structure (Mercury list, `NEXT_PUBLIC_<SURFACE>_LIVE` gate, two-PR split, projection schemas, store-method extension, in-memory test pattern).
- `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` §3 (two registers), §4 (Phase D ordering: D1 → D2 → D3 → D4).
- `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` — Mercury / editorial register split; production-gate pattern; layered backend pattern.
- `docs/superpowers/specs/2026-05-07-slice-b-pr-s4-design.md` — sibling-method pattern (`ContactStore.listForPipeline`); Fastify ↔ Next-proxy ↔ core ↔ store layering.

### Live code referenced

- `apps/dashboard/src/app/(auth)/contacts/{page,contacts-page}.tsx` + `contacts.module.css` — direct visual + structural template for D2.
- `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts:15` — production-gate pattern.
- `apps/api/src/routes/dashboard-contacts.ts` — direct template for `dashboard-automations.ts`.
- `packages/core/src/scheduler/scheduler-service.ts` — sibling to the new `list-triggers.ts`.
- `packages/core/src/scheduler/trigger-store.ts` — `TriggerStore` interface that gets `listForBrowse`.
- `packages/core/src/scheduler/trigger-types.ts:3` — `VALID_TRIGGER_TRANSITIONS` (`active → cancelled / fired / expired`); informs the deferred D2.5 cancel-affordance discussion.
- `packages/db/prisma/schema.prisma:1389` — `ScheduledTriggerRecord` model.
- `packages/schemas/src/scheduler.ts` — `ScheduledTrigger`, `TriggerType`, `TriggerStatus`, `TriggerActionType`, `TriggerFilters` (the existing source-of-truth shapes that D2 projects from).
- `packages/schemas/src/contacts.ts` — D1 precedent for projection shapes (D2 instead extends the existing `scheduler.ts` rather than creating a new file).
- `apps/dashboard/src/app/globals.css:99-110` — Mercury tokens.

### Memory entries consulted

- `project_two_register_design.md` — Editorial vs. Mercury split.
- `feedback_surface_agnostic_backend.md` — backend may not name UI surfaces.
- `feedback_modes_not_knobs.md` — opinionated chips over freeform facets.
- `feedback_ship_clean_not_followup.md` — read-only v1, no half-finished mutating actions.
- `feedback_api_test_mocked_prisma.md` — API tests use mocked Prisma, not Postgres.
- `feedback_prisma_migrate_dev_tty.md` — additive index ships via `migrate diff` + `migrate deploy`, not `migrate dev`.

---

## 12. Status

- **Spec drafted:** 2026-05-09 by the model under user delegation ("use your best judgment").
- **Revision 1:** 2026-05-09 against the first design review. 14 of 15 items accepted; pushback on item 5 (`lastChangedAt` substrate). See entry below.
- **Revision 2:** 2026-05-09 against the second design review. 9 of 9 items accepted: (1) `type` removed from store/API/query signatures; (2) cursor ownership pinned — store fetches `limit+1` raw, core trims and encodes; (3) timezone responsibility pinned — backend emits ISO, frontend resolves with the existing dashboard plumbing, falls back to browser-tz, names `org-tz plumbing` as a follow-up; (4) action-payload key exposure replaced with an allowlist (`workflowId`, `contactId`, `eventType`, `agentKey`, `triggerId`, `source`) plus `redactedKeyCount`; (5) drawer ARIA contract — chevron `<button>`, `aria-expanded`, `aria-controls`, drawer `<tr>` `id`, keyboard toggle, non-interactive row body; (6) drawer-test mutation-button assertion is regex-on-accessible-name (`Cancel|Edit|Delete|Pause|Reschedule`), allowing copy-to-clipboard buttons; (7) `statusCounts` clarified to reflect persisted rows only; (8) "ever" softened to "in D2 or D2.5; revisit if history becomes first-class"; (9) "second occupant" → "third occupant" arithmetic fix.
- **Sustained pushback (item 5 from revision 1):** the `lastChangedAt` denormalisation — `ScheduledTriggerRecord` has no `updatedAt` today, and adding `@updatedAt` would write a misleading migration-time value to all existing fired/cancelled/expired rows. Documented as known gap (#22) and listed as a possible D2.5 substrate addition; mitigated by defaulting the chip to `Active`.
- **Next:** implementation plan at `docs/superpowers/plans/2026-05-09-automations-d2.md`. Plan binds to §2.0; deviations require re-reviewing the ledger.
- **PR shape at impl time:** D2a (backend — schemas + core + API + Next proxy + index), D2b (frontend page). Both target `main` independently. D2 ships behind `NEXT_PUBLIC_AUTOMATIONS_LIVE=false` until staging review.
