# `/activity` (Slice D3) — Design Spec

_2026-05-10 · part of the agent-first redesign track · Phase D, surface 3 (Tools tier, Mercury register) · sibling to D1 (`/contacts`, shipped 2026-05-08) and D2 (`/automations`, spec'd 2026-05-09, in implementation)_

> **Reading posture:** opinionated by intent. The user delegated all judgment calls during brainstorming with the instruction "use your best judgment to build out the entire spec based off my existing codebase and my app direction and goals." Decisions are bound in §2.0 with flip notes for cheap reviewer redirection.

---

## 1. Problem & scope

### 1.0 One-line scope

`/activity` is a read-only operational register over the org's `AuditEntry` ledger — the Mercury list answer to "what has actually happened in this org, and who did it."

### 1.1 What this slice ships

The Tools-tier list view at `/activity` — a Mercury-register page that lists `AuditEntry` rows for the org with server-side filter, sort, and cursor pagination at 50 rows per page. It is the **fourth occupant of the Mercury register** (after `/reports`, `/contacts`, `/automations`) and the third Mercury _list_ surface in Phase D.

Concretely:

- New route `apps/dashboard/src/app/(auth)/activity/page.tsx` rendering a Mercury surface that mirrors `/contacts`, `/reports`, and `/automations` (cream + ink + hairline tables + tabular numerals + JetBrains Mono labels).
- New backend endpoint `GET /api/dashboard/activity` (Next.js proxy) → `GET /api/dashboard/activity` (Fastify) → `listAuditEntriesForBrowse(...)` (new core function) → `AuditLedger.listForBrowse(...)` (new method on the **existing** `AuditLedger` interface in `packages/core/src/audit/ledger.ts`). The existing `/api/audit/*` Fastify routes (`apps/api/src/routes/audit.ts`) are **untouched** — they feed the live-signal popover, deep-verify endpoint, and `getById` direct lookup.
- New shared schemas added to the **existing** `packages/schemas/src/audit.ts` (no surface-named file): `AuditEntriesListQuery`, `AuditEntryBrowseRow`, `AuditEntriesListResponse`, and a domain constant `OPERATIONAL_AUDIT_EVENT_TYPES`.
- **Two-chip filter:** `[Operational] [All events]`. `Operational` is the default and queries the curated allowlist (§2.4); `All events` lifts the allowlist filter. **No counts on chips** (audit volume is too high for cheap GROUP BY at scale; mirrors D2's status-count GROUP BY trade-off in reverse).
- **No actor-type chip, no event-type chip in v1.** Both deliberately cut for YAGNI — the chip set stays binary so the page reads as "operational reality vs. forensic firehose," not "build your own filter expression." Power-user filters (`?eventType=<type>`, `?actorType=<type>`, `?after=<iso>&before=<iso>`, `?entityType=<type>&entityId=<id>`) are accepted by the API and respected by the UI **as URL params** (no chrome), mirroring D2's `?triggerId=<id>` direct-lookup escape hatch.
- Sortable column: `Timestamp` (default DESC) only.
- No search input in v1. Audit text is freeform `summary` strings; full-text search over a high-volume table is not D3's lift. The URL params above are the named D3.5 escape hatches.
- Rows are **not links and have no detail route**, but **expand inline into a read-only details drawer** (§6.4) showing: full ids (entry, actor, entity, envelope, trace), `riskCategory`, `visibilityLevel`, `evidencePointers` count + truncated hashes, hash-chain anchors (`entryHash` + `previousEntryHash` mono-prefixed), and a redacted projection of `snapshot` (allowlisted key names only, never values).
- Production gate identical to `/contacts`, `/reports`, and `/automations`: `NEXT_PUBLIC_ACTIVITY_LIVE === "true"` flips fixtures off and live data on. Default `false` until staging review.
- Tests at three layers (core projection, hook+route, page composition) plus a pinned-set test for the operational allowlist (§4.4) so changes to it are deliberate.

### 1.2 What this slice does **not** ship

- **No mutating actions on audit entries.** The audit ledger is append-only and tamper-evident by design (`previousEntryHash` chain). Any mutating affordance would violate the integrity model. Not relitigated.
- **No `/activity/[id]` detail route.** The drawer covers inspection. Following D2's reasoning: nothing in the codebase links to `/activity/[id]`, so there's no inert-link debt to retire; per-row content is bounded; a separate route would only add weight.
- **No actor-name resolution to canonical agents (Alex/Riley/Mira).** The drawer renders raw `actorType + actorId`. Agent-name resolution requires reading the agent registry per row, which (a) couples a Tools-tier surface to an agent-tier registry that's still settling and (b) has no clean fallback for `actorType=user` or `service_account`. Deferred to D3.5; the affordance is a follow-up named `actor-name plumbing`.
- **No counts on chips.** Audit row counts grow unboundedly per org. A cheap GROUP BY at scale would still be a full index scan over `(organizationId, eventType IN (...))` — not the same calculus as D2's bounded `ScheduledTriggerRecord` table. If counts become operationally important, scope is a denormalised counter table (its own slice).
- **No date-range picker.** Cursor pagination via `(timestamp DESC, id DESC)` covers history; `?after=<iso>&before=<iso>` URL params handle range queries. A picker is chrome that v1 doesn't need.
- **No live polling on the list.** The existing `useAudit()` hook polls every 30s; it's used by event-stream surfaces where new-rows-prepend is desirable. On a paginated, filtered, drawer-expandable list, polling fights cursor stability. Page reload re-runs the query. Polling is **revisited** if D3.5 introduces a "tail mode" (live-tail of the operational stream).
- **No deep hash-chain verification UI.** `GET /api/audit/verify` already exists for forensic use. Wiring a "Verify chain" button in the drawer is its own slice — verification is a long-running operation with very different UX needs.
- **No hash-chain integrity widget on the page.** Same reasoning. The chain hashes appear in the drawer for inspection, not as a verification UI.
- **No editorial-shell nav target.** `EditorialAuthShell` does not gain a Tools-tier "Activity" link in D3. D1 and D2 deferred this; D3 keeps the deferral. Editorial-header consolidation is a Phase D wrap-up after D1/D2/D3 all ship.
- **No CSV export, no saved filters, no column chooser, no multi-select.** Read-side niceties; revisit post-launch.
- **No replacement of `/api/audit/*`, `useAudit()`, or `activity-translator.ts`.** D3 is additive. The existing surfaces consume raw audit; D3 consumes a redacted browse projection. The two coexist.

### 1.3 Why this surface, why now

Three forces converge:

1. **Operators have no in-product way to see "what happened."** The audit ledger is the authoritative record of every action, approval, override, and policy change. Today the only operator-visible audit surfaces are the live-signal popover (rolling 8 entries via `translateActivities`) and per-row event histories on agent components. To answer "did Alex actually execute that action yesterday?" or "who toggled this policy?" operators currently need direct DB access. A read-only browse closes the gap that `/contacts` and `/automations` open by analogy: visibility into the underlying control-plane.
2. **The Mercury list pattern is now load-bearing.** D3 is the third occupant after `/contacts` and (about-to-ship) `/automations`. Between D2's specced-but-not-yet-implemented status and D3 starting now, there's a real-time signal on whether the pattern needs an extracted shell. **D3 is specced as a clean copy** (per the brainstorm decision); if D2 implementation surfaces shell-divergence, this spec is cheap to revise before the D3a backend even runs.
3. **It's the lowest-novelty Phase-D surface.** `AuditEntry` is already org-scoped, already indexed on `(organizationId)` and `(timestamp)`, already exposed via a Fastify route, and already consumed by `useAudit()`. The novel surface area is small: a curated event-type allowlist + a redacted snapshot drawer + a Mercury page. PR pair should land at ~50% of D2's size, ~30% of D1's.

### 1.4 Out-of-scope decisions inherited from prior specs

These are **already locked** elsewhere and not re-debated:

- Two-register split — Mercury for Tools tier (`memory/project_two_register_design.md`; `2026-05-03-agent-first-redesign-roadmap.md` §3).
- Surface-agnostic backend rule (`memory/feedback_surface_agnostic_backend.md`). All new domain types live in the **existing** `packages/schemas/src/audit.ts` and use the domain noun (`AuditEntryBrowseRow`, `AuditEntriesListQuery`, `AuditEntriesListResponse`, `OPERATIONAL_AUDIT_EVENT_TYPES`). The core function is `listAuditEntriesForBrowse` in `packages/core/src/audit/list-entries.ts`. The frontend is the only place the word "activity" appears.
- Mercury design tokens already shipped (`apps/dashboard/src/app/globals.css` lines 99–110: `--mercury-cream`, `--mercury-ink`, `--mercury-accent`, `--mercury-hairline`, `--mercury-row-hover`, etc.). D3 consumes these via the same CSS-module aliasing pattern `/contacts`, `/reports`, `/automations` use.
- Production gate pattern (`NEXT_PUBLIC_<SURFACE>_LIVE`) from `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts:15` and `/contacts`/`/automations`.
- API route file convention (`apps/api/src/routes/dashboard-<thing>.ts`, URL `/api/dashboard/<thing>`) used by `dashboard-reports.ts`, `dashboard-overview.ts`, `dashboard-agents.ts`, `dashboard-contacts.ts`, and (incoming) `dashboard-automations.ts`.
- Hash-chain integrity model (`packages/core/src/audit/ledger.ts`). Append-only; entries are immutable; `previousEntryHash` links back. D3 reads, never writes.

---

## 2. Decisions

### 2.0 Decisions ledger

| #   | Question                        | Locked answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Surface subject                 | **Raw `AuditEntry` rows.** Not the `TranslatedActivity` shape; not a synthesized "decision feed." Audit is the authoritative record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | List vs. List+Detail in D3      | **List-only; no separate route.** Rows expand inline into a read-only **details drawer** (drawer, not page) showing full ids, hash anchors, evidence pointers, redacted snapshot. (See §2.2.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Mutating actions in v1          | **Read-only.** Audit ledger is append-only and tamper-evident; not relitigated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | Header strategy                 | **Own `ActivityHeader`** (clone of `AutomationsHeader`). Defer shared `MercuryAuthShell` extraction; revisit after D3 implementation lands and D4 is in flight (four occupants is when the duplication actually hurts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | Editorial-shell nav target      | Do **not** add Activity / Tools to `EditorialAuthShell` in D3. Same posture as D1, D2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Filter primitive                | **Two chips:** `[Operational] [All events]`. No counts. No actor-type chip, no event-type chip, no date picker in v1. URL params (`?eventType=`, `?actorType=`, `?after=`, `?before=`, `?entityType=`, `?entityId=`) accepted by the API and respected by the UI as power-user escape hatches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6a  | Default chip                    | **`Operational`.** The product question is "what has happened that an operator cares about." Forensic firehose is a deliberate switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Search                          | **Skip in v1.** Audit `summary` is freeform. Full-text search over a high-volume table is not D3's lift. URL params are the named escape hatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8   | Pagination strategy             | **Cursor-based** via `(timestamp DESC, id DESC)`, base64-encoded. Page size 50.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | Default sort                    | `timestamp DESC`. Sortable columns: `Timestamp` only. Other sorts (eventType alphabetical, actorType grouped) considered and dropped — `timestamp DESC` is the operationally correct default and the only one that pairs cleanly with cursor pagination.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 10  | Where the read lives in core    | New `packages/core/src/audit/list-entries.ts` exporting `listAuditEntriesForBrowse`. Sibling to `ledger.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Store interface extension       | Add `listForBrowse(filter: AuditLedgerBrowseFilter)` to the existing **`LedgerStorage`** interface (`packages/core/src/audit/ledger.ts:20`); implement on `InMemoryLedgerStorage` (already exists, same file, line 335) and `PrismaLedgerStorage` (`packages/db/src/storage/prisma-ledger-storage.ts`); add a thin pass-through `AuditLedger.listForBrowse` mirroring the existing `query()` pass-through (`ledger.ts:225`). The filter shape (precise definition in §5.3) takes `{organizationId, eventTypes, actorType, entityType, entityId, after, before, cursor, limit}` — no `scope`, no `sort`/`direction` (scope→eventTypes mapping happens in core; sort is always `(timestamp DESC, id DESC)` in v1). Do **not** overload existing `query()` — that's used by `auditRoutes` (`audit.ts`), `dashboard-overview.ts`, and core tests; shape change there is risky. Cursor encoding and trimming live in core (§5.2). |
| 12  | View-model + naming             | Page-ready `AuditEntryBrowseRow` projection (see §4.2). New types live in the **existing** `packages/schemas/src/audit.ts`. API never returns raw `AuditEntry`. **Hard invariant: response never carries `snapshot` values and never carries `evidencePointers[].storageRef` content.** The drawer surfaces a redacted projection only. (`redactedFields[]` is a separate ledger-level redaction mechanism in `packages/core/src/audit/redaction.ts` — D3 doesn't surface it.)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 13  | `eventLabel` derivation         | `eventType` rendered as the canonical dotted form (e.g., `action.executed`). No remapping to friendly text in v1; the dotted form **is** the contract operators learn. Display in mono caps mirrors D2's id-prefix style.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 14  | `actorLabel` derivation         | Table: `${actorType}:${actorId.slice(0, 8)}` mono-prefix (e.g., `agent:agent_al`). Drawer: `${actorType} · ${full actorId}` readable. **No agent-name resolution in v1** (deferred per §1.2). The 8-char prefix is enough to disambiguate UUID-shaped ids visually; non-UUID ids degrade gracefully (still mono-prefix, just less informative).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 15  | `entityLabel` derivation        | Table: `${entityType}:${entityId.slice(0, 8)}` mono-prefix. Drawer: `${entityType} · ${full entityId}` readable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 16  | `summaryLabel` rendering        | Server-trusted `summary` field rendered as plain text in the table (truncated to 80 chars), full text in the drawer. **No HTML, no markdown rendering** — `summary` is operator-readable prose written by the audit-emitter, not user-controlled input, but the rendering path treats it as text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 17  | `snapshot` redaction            | Drawer surfaces an **allowlisted** subset of `snapshot` key names plus a `redactedKeyCount` for the rest. Allowlist (§4.5): `id`, `kind`, `source`, `actionType`, `decisionId`, `recommendationId`, `approvalId`, `envelopeId`, `agentKey`, `targetEntityType`, `targetEntityId`, `correlationId`, `traceId`. Everything else (e.g., `patchValue`, `reason`, `amount`, `budget`, free-form content) is rolled into the redacted count. **No snapshot values, ever.** Allowlist seeded by inspecting actual audit emitters in `packages/core/src/platform/platform-lifecycle.ts`, `read-adapter.ts`, and `work-trace-integrity.ts`.                                                                                                                                                                                                                                                                                           |
| 18  | Hash-chain rendering            | `entryHash` + `previousEntryHash` shown in the **drawer only** (not the table) as truncated mono prefixes (`HASH:abcd1234`) with full string available via copy-to-clipboard. Inert (no link). No verification action. (See §6.4.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 19  | `evidencePointers` rendering    | Drawer shows: count + per-pointer `(type, hashPrefix)`. **No `storageRef` content, no inline content fetch.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 20  | Visibility scoping              | **Server filters by `visibilityLevel ∈ {public, org}`** at the SQL level. `admin` and `system` visibility levels are excluded from the browse projection regardless of operator role. (Operator role still needed; admin-visible entries surface only via direct `/api/audit/:id` lookup with admin-role gate.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 21  | Empty-state copy register       | Mercury voice. No agent prose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 22  | Filtered-empty distinct copy    | Yes, distinct from zero-state, with a `[Clear]` affordance (returns to default `Operational` chip + clears any URL params).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 23  | Gate variable name              | `NEXT_PUBLIC_ACTIVITY_LIVE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 24  | Gate default at launch          | `false` until staging review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 25  | Schema migration                | **One additive non-functional composite index:** `@@index([organizationId, timestamp(sort: Desc)])` on `AuditEntry`. The existing single-column `@@index([timestamp])` and `@@index([organizationId])` are insufficient for cursor-paginated org-scoped listing at scale. No model shape change, no data migration. (See §4.1.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 26  | Date / timezone formatting      | Backend always returns ISO8601 strings; frontend resolves the display timezone. Table cells: short human date in **org timezone** when the page shell already has it available, else browser timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, mirroring `apps/dashboard/src/app/(auth)/contacts/components/format.ts:6`), else UTC. Tz abbreviation displayed in the column header. Drawer: full ISO8601 with offset. **If org timezone is not already plumbed at impl time, D3b ships with browser-tz fallback** — same posture as D2.                                                                                                                                                                                                                                                                                                                                                                         |
| 27  | Responsive behaviour            | Desktop-first. Below ~960 px viewport: **horizontal scroll inside the Mercury container**, no stacked-row rewrite, no column hiding. Sticky first column (`TIMESTAMP`) so context survives the scroll. Same posture as D2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 28  | Polling cadence                 | **None on /activity v1.** Set explicit `staleTime: 30_000` on the query (TanStack Query default is `0`, so this needs to be set, not relied on) to dedup tab-switch refetches; no `refetchInterval`. (Compare `useAudit()`, which polls 30s; D3's list semantics are different.) Manual refresh = page reload. "Tail mode" deferred to D3.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 29  | Existing `/api/audit/*` posture | **Untouched.** The existing routes feed live-signal-popover, deep-verify, and `getById`. D3 adds a parallel browse endpoint; the two coexist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 30  | Operational allowlist location  | `OPERATIONAL_AUDIT_EVENT_TYPES` lives in `packages/schemas/src/audit.ts` as a `readonly AuditEventType[]`. It's a domain-shaped curation (operationally meaningful events), not a UI surface. Both core (for SQL `IN` filter) and frontend (for chip-toggle behavior) consume the same constant. The label "Operational" only appears in the frontend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 2.1 Why "raw audit rows" and not "decision feed history" or "translated activity"

The brainstorm question was "raw audit rows or operator-meaningful subset," and the user's answer was firehose-with-operator-default. The reasoning:

- The decision-feed (recs/escalations/handoffs) is a **synthesized** view over multiple sources and projects into prose-shaped fields (`humanSummary`, `dataLines`, `presentation`). It's the right shape for the agent-home Needs You block, not the right shape for `/activity`. Operators on `/activity` are asking forensic questions ("did this happen, when, by whom?"), not prose questions ("what should I attend to right now?").
- `TranslatedActivity` (`apps/api/src/services/activity-translator.ts:13`) is shaped for the live-signal popover (rolling 8 entries, narrative phrasing). It throws away `entryHash`, `previousEntryHash`, `evidencePointers`, and `visibilityLevel` — all of which are exactly what an operator wants when they go to `/activity` to debug. Reusing `TranslatedActivity` would lobotomize the surface.
- Audit is the source-of-truth; `TranslatedActivity` and the decision-feed are downstream views. D3 reads the source.

**Flip** to "translated activity rows" if reviewer reads `/activity` as a "what's happening now" feed: rename D3 to a synthesized stream and point this surface at `translateActivities`. The operational-allowlist + drawer architecture transfers; the redaction story tightens (translator already redacts).

### 2.2 Why an inline drawer, not a detail route (matches D2)

D2 settled this for the Tools tier: per-row content small, no inert links to retire, control-plane visibility means inspectability is required (a list of opaque rows is not enough). D3 inherits the same calculus with one addition: **hash-chain anchors are useful only when seen with their neighbors**, and a list view shows neighbors trivially. A separate `/activity/[id]` page would isolate the entry from its chain.

**Decision:**

- No `/activity/[id]` route in D3 or D3.5.
- Rows expand inline into a Mercury-style drawer (`activity-row-drawer.tsx`).
- Drawer is read-only — no verify button, no link to `WorkflowExecution` or `Action`, no export.
- Drawer never surfaces raw `snapshot` values, never surfaces `evidencePointers[].storageRef` content; only `snapshot` allowlisted-key names + redacted count, only evidence-pointer `(type, hashPrefix)` pairs.

**Flip** to "no drawer, just inert rows" if reviewer reverts the drawer call (cuts ~150 LoC + the redaction helper). **Flip** to "drawer + verify-chain button" only as part of D3.5 with explicit telemetry around verify duration; this slice stays read-only.

### 2.3 Why two chips, not chip-per-event-category

The user's brainstorm guidance considered a 7-category chip set (`Agents`, `Actions`, `Policies`, `Connections`, `Identity`, `System`) and explicitly preferred starting simpler with just `Operational | All events`, with event-type filter as a follow-up. This spec locks the simpler version because:

- Categories are an editorial taxonomy; they'll fight the `eventType` taxonomy. `agent.activated` is an `Agent` event but is also operationally a `Control` event; `action.approved` is an `Action` event but is also a `Decision` event. Whichever bucket a category-chip places it in, half the operators expect the other bucket. Two chips have no taxonomy collision.
- The URL param `?eventType=<type>` is already accepted by the existing `auditRoutes` and is preserved here. Power-user filtering exists; it just doesn't have chrome.
- D3.5 candidate: replace the binary chip with a multi-select event-type filter once we have user research on which events operators actually filter to. Today we don't.

**Flip** to "category chips" if reviewer wants discoverability: add a category dropdown above the chip row, mapping categories to event-type sets defined alongside `OPERATIONAL_AUDIT_EVENT_TYPES`. Backend already supports the `eventType` IN filter via the URL param.

### 2.4 The Operational allowlist — what's in, what's out, why

The allowlist defines what `Operational` shows. It is a **domain-shaped curation** (operationally meaningful events), not a UI configuration, and lives in `packages/schemas/src/audit.ts` next to `AuditEventTypeSchema`.

**In (Operational, default view):**

| Event type                  | Why operationally meaningful                       |
| --------------------------- | -------------------------------------------------- |
| `action.proposed`           | An action entered the queue.                       |
| `action.approved`           | A human/agent approved an action.                  |
| `action.partially_approved` | A scoped approval — needs operator visibility.     |
| `action.rejected`           | Someone said no — operator wants to know who/when. |
| `action.executed`           | The most-asked-about row in audit.                 |
| `action.failed`             | Failure modes are first-class debugging questions. |
| `action.denied`             | Policy refused; operator wants the record.         |
| `action.expired`            | Approval window lapsed; operator wants the record. |
| `action.cancelled`          | Operator-meaningful terminal state.                |
| `action.undo_requested`     | Reversal intent; operator wants the trail.         |
| `action.undo_executed`      | Reversal completed; operator wants the trail.      |
| `action.approval_expired`   | The approval-side analog of `action.expired`.      |
| `agent.activated`           | Control-plane change.                              |
| `agent.emergency-halted`    | Safety-critical operator-visible event.            |
| `agent.resumed`             | Pairs with `agent.emergency-halted`.               |
| `policy.created`            | Authority change.                                  |
| `policy.updated`            | Authority change.                                  |
| `policy.deleted`            | Authority change.                                  |
| `connection.established`    | External-surface gain.                             |
| `connection.revoked`        | External-surface loss.                             |
| `connection.degraded`       | Partial external-surface loss; on-call signal.     |
| `competence.promoted`       | Agent-capability change; operator-visible.         |
| `competence.demoted`        | Agent-capability change; operator-visible.         |
| `competence.updated`        | Agent-capability change; operator-visible.         |
| `identity.created`          | Identity-doctrine change (rare, very high signal). |
| `identity.updated`          | Identity-doctrine change.                          |
| `overlay.activated`         | Operational-mode change.                           |
| `overlay.deactivated`       | Operational-mode change.                           |

That's **28 event types in `Operational`** (out of 45 total in `AuditEventTypeSchema`).

**Out (forensic firehose, visible only under "All events"):**

- Low-level action lifecycle: `action.resolved`, `action.enriched`, `action.evaluated`, `action.patched`, `action.queued`, `action.executing`, `action.snapshot` — these are between-state ticks that the `proposed → approved/rejected → executed/failed` arc already implies. Operators reading them in the firehose without context get confused.
- Internal orchestration: `delegation.chain_resolved`, `event.published`, `event.reaction.triggered`, `event.reaction.created` — bookkeeping; not operator-shaped.
- Linkage bookkeeping: `entity.linked`, `entity.unlinked`, `entity.resolved` — useful for cross-system reconciliation, not for "what happened in my org today."
- Persistence telemetry: `work_trace.persisted`, `work_trace.updated`, `work_trace.integrity_override` — `work_trace.integrity_override` is arguably operationally meaningful (it's the only one of the three that involves a human override decision) but is rare enough that operators reach for `All events` when they want it; including it in `Operational` would give it disproportionate visual weight on the default view.

**Pinned-set test:** `packages/core/src/audit/__tests__/operational-allowlist.test.ts` snapshots the exact set against a literal expected list. Adding or removing an event type from the allowlist requires intentionally updating the test, which forces the change through review (mirrors D2's fallback-branch tests). The test also asserts every entry in `OPERATIONAL_AUDIT_EVENT_TYPES` is a member of `AuditEventTypeSchema` (catches drift if the master enum is renamed).

### 2.5 Why no polling

`useAudit()` polls every 30s today. D3 deliberately doesn't. The reasoning:

- `useAudit()`'s consumer (live-signal popover, event-history components) renders a **bounded latest-N feed** where new rows naturally prepend. Polling there is correct and obvious.
- D3 is **paginated, filtered, and drawer-expandable**. If polling fired while an operator was on page 3 with the `Operational` chip, the cursor (which is a tuple of `(timestamp, id)`) would silently drift — page 3 of an old snapshot is no longer page 3 of the new one. Either rows would re-shuffle (bad) or the cursor would lock and rows would go stale silently (worse).
- The right "live" affordance for an audit list is **tail mode**: pin to top, prepend new rows, suspend pagination. That's a separate UX (deferred to D3.5).
- Reload re-runs the query. `staleTime: 30_000` dedups tab-switches. That's enough for v1.

**Flip** to "30s polling" if reviewer wants the page to feel live: set `refetchInterval: 30_000` on the query. Cursor drift caveat above stands.

### 2.6 Why server-side visibility scoping (admin/system filtered out)

`AuditEntrySchema.visibilityLevel` is `public | org | admin | system`. The browse endpoint **filters server-side** to `{public, org}` regardless of operator role. Reasoning:

- `admin` and `system` entries can carry sensitive content (operator-internal actions, reconciliation passes). They have a deliberate gate elsewhere (`requireRole(request, reply, "admin", "operator")` on `/api/audit/verify`); browse is not the right place to relax it.
- An operator with admin role who genuinely needs admin-visible entries can use `GET /api/audit/:id` with the id in hand. Browse doesn't need to be the universal admin tool.
- This is a **WHERE clause**, not a UI hide — the rows never leave the database. Mirrors the surface-agnostic principle: the projection layer enforces the redaction, not the page.

**Flip** if reviewer wants admin-visible entries in the browse for admin operators: add `includeAdminVisibility?: boolean` to the query, default false, gate it on `request.userRole === "admin"`. The store method already takes the flag pattern; this is a one-line WHERE adjustment.

---

## 3. Architecture

### 3.1 Layer split (matches D2)

```
packages/schemas/src/audit.ts
  ├─ AuditEntrySchema (existing, unchanged)
  ├─ AuditEventTypeSchema (existing, unchanged)
  ├─ OPERATIONAL_AUDIT_EVENT_TYPES (new — domain curation)
  ├─ AuditEntryBrowseRowSchema (new — page-ready projection)
  ├─ AuditEntriesListQuerySchema (new — request shape)
  └─ AuditEntriesListResponseSchema (new — response shape)

packages/core/src/audit/
  ├─ ledger.ts (modify — add `listForBrowse` to LedgerStorage interface,
  │              extend InMemoryLedgerStorage impl, add AuditLedger pass-through)
  ├─ list-entries.ts (new — listAuditEntriesForBrowse)
  └─ __tests__/
      ├─ list-entries.test.ts (new — projection + redaction + cursor)
      └─ operational-allowlist.test.ts (new — pinned-set test)

packages/db/src/storage/
  └─ prisma-ledger-storage.ts (modify — implement listForBrowse)

apps/api/src/
  ├─ routes/dashboard-activity.ts (new — Fastify route)
  └─ __tests__/api-activity.test.ts (new)

apps/dashboard/src/app/(auth)/activity/
  ├─ page.tsx (new — server component, Suspense boundary)
  ├─ activity-page.tsx (new — client composition)
  ├─ activity.module.css (new)
  ├─ fixtures.ts (new — pre-gate fallback data)
  ├─ components/ (new — header, chips, table, row, drawer, footer, empty-state, format)
  ├─ hooks/use-activity-list.ts (new)
  └─ __tests__/ (new)

apps/dashboard/src/app/api/dashboard/activity/
  ├─ route.ts (new — Next.js proxy)
  └─ __tests__/route.test.ts (new)
```

### 3.2 Data flow

```
Page (server component)
  → activity-page (client) [reads NEXT_PUBLIC_ACTIVITY_LIVE]
    → useActivityList (TanStack Query)
      → fetch(/api/dashboard/activity?...) [Next.js proxy]
        → fetch(/api/dashboard/activity?...) [Fastify, org-scoped]
          → listAuditEntriesForBrowse({ orgId, scope, ...filters, cursor, limit })
            → AuditLedger.listForBrowse(...) [Prisma query — see §5.3]
              → SELECT ... FROM "AuditEntry"
                  WHERE "organizationId" = $1
                    AND "visibilityLevel" IN ('public', 'org')
                    AND "eventType" = ANY($2)        -- only when scope='operational' or eventType filter
                    AND "timestamp" < $3              -- only when cursor
                    OR  ("timestamp" = $3 AND "id" < $4)
                    AND ...                           -- other URL-param filters
                  ORDER BY "timestamp" DESC, "id" DESC
                  LIMIT 51
            ← raw rows (Prisma type)
          ← projected rows (AuditEntryBrowseRow), trimmed to 50, with nextCursor
        ← envelope { rows, nextCursor, scope, appliedFilters }
      ← envelope (cached by query-key)
    ← rows + chip state + drawer state
  ← rendered page
```

### 3.3 Tests at three layers (matches D2)

- **Core (`list-entries.test.ts`)**: projection from raw `AuditEntry` rows fed by an `InMemoryLedgerStorage` (the existing one in `packages/core/src/audit/ledger.ts:335`, extended in this slice), redaction discipline (no snapshot values; allowlisted keys only; `redactedKeyCount` correct), cursor encode/decode round-trip, scope=operational vs scope=all, URL-param overlay (eventType / actorType / after / before / entityType / entityId), visibility filter (admin/system filtered out).
- **Allowlist (`operational-allowlist.test.ts`)**: pinned-set snapshot of `OPERATIONAL_AUDIT_EVENT_TYPES`; assertion that every entry is a member of `AuditEventTypeSchema`.
- **API route (`api-activity.test.ts`)**: org-scope enforcement, query-shape validation, error pass-through, cursor pass-through, scope handling.
- **Next.js proxy (`route.test.ts`)**: forwards query string, propagates non-200 response, includes auth header.
- **Hook (`use-activity-list.test.ts`)**: query-key stability, cursor advance, chip toggle, URL-param state.
- **Drawer (`activity-row-drawer.test.tsx`)**: renders allowlisted keys + redacted count, never renders snapshot values, copy-to-clipboard for full hashes.
- **Chips (`filter-chips.test.tsx`)**: toggle behaviour, default selection, `Clear` from filtered-empty.
- **Page (`activity-page.test.tsx`)**: gate on/off, fixtures, empty-state vs filtered-empty distinction, drawer expand/collapse.
- **Format (`format.test.ts`)**: ISO → human cells under varying tz fallbacks; truncation rules.

---

## 4. Data shapes

### 4.1 Schema migration

Single additive composite index. No model shape change.

```prisma
model AuditEntry {
  // ... existing fields unchanged ...

  // existing indexes preserved:
  @@index([eventType])
  @@index([entityType, entityId])
  @@index([envelopeId])
  @@index([organizationId])
  @@index([traceId])
  @@index([timestamp])

  // D3 — efficient org-scoped browse cursor pagination
  @@index([organizationId, timestamp(sort: Desc)])
}
```

The new composite index covers the dominant query (`WHERE organizationId = $1 ORDER BY timestamp DESC, id DESC LIMIT 51`). The single-column `@@index([organizationId])` and `@@index([timestamp])` would each force one half of the query to be a heap scan; the composite covers both.

Migration generated via `pnpm db:migrate` — but per `feedback_prisma_migrate_dev_tty.md`, in agent sessions use `prisma migrate diff --from-url --to-schema-datamodel --script` then `prisma migrate deploy`.

### 4.2 New view-model — `AuditEntryBrowseRow`

```ts
/**
 * One row in the /activity Mercury list.
 *
 * Hard invariant: never carries `snapshot` values, never carries
 * `evidencePointers[].storageRef` content. Allowlisted snapshot key names
 * appear in `snapshotKeys`; everything else is rolled into `redactedKeyCount`.
 */
export const AuditEntryBrowseRowSchema = z.object({
  // Identity
  id: z.string(),
  eventType: AuditEventTypeSchema,
  timestamp: z.string(), // ISO8601, frontend resolves tz

  // Actor
  actorType: ActorTypeSchema,
  actorId: z.string(),

  // Entity
  entityType: z.string(),
  entityId: z.string(),

  // Classification
  riskCategory: RiskCategorySchema,
  visibilityLevel: VisibilityLevelSchema, // always 'public' or 'org' (server-filtered)

  // Content
  summary: z.string(), // freeform; server-trusted; rendered as text

  // Snapshot (redacted)
  snapshotKeys: z.array(z.string()), // allowlist intersection only
  redactedKeyCount: z.number().int().nonnegative(),

  // Evidence (counts + hash prefixes only)
  evidencePointers: z.array(
    z.object({
      type: z.enum(["inline", "pointer"]),
      hashPrefix: z.string(), // first 16 chars of full hash
    }),
  ),

  // Hash chain (drawer only — these are surfaced raw by design)
  entryHash: z.string(),
  previousEntryHash: z.string().nullable(),

  // References
  envelopeId: z.string().nullable(),
  traceId: z.string().nullable(),
});
export type AuditEntryBrowseRow = z.infer<typeof AuditEntryBrowseRowSchema>;
```

### 4.3 Query and response shapes

```ts
export const AuditEntriesListQuerySchema = z.object({
  scope: z.enum(["operational", "all"]).default("operational"),
  cursor: z.string().optional(), // base64 of {timestamp, id}
  limit: z.number().int().min(1).max(100).default(50),

  // URL-param escape hatches (no chrome)
  eventType: AuditEventTypeSchema.optional(),
  actorType: ActorTypeSchema.optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
});
export type AuditEntriesListQuery = z.infer<typeof AuditEntriesListQuerySchema>;

export const AuditEntriesListResponseSchema = z.object({
  rows: z.array(AuditEntryBrowseRowSchema),
  nextCursor: z.string().nullable(),
  scope: z.enum(["operational", "all"]),
  appliedFilters: z.object({
    eventType: AuditEventTypeSchema.nullable(),
    actorType: ActorTypeSchema.nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    after: z.string().nullable(),
    before: z.string().nullable(),
  }),
});
export type AuditEntriesListResponse = z.infer<typeof AuditEntriesListResponseSchema>;
```

### 4.4 `OPERATIONAL_AUDIT_EVENT_TYPES`

```ts
/**
 * Domain curation: events that map to operator-visible actions and
 * control-plane changes. Used by /activity Operational chip and any
 * future "operator-relevant" filter on event streams.
 *
 * Pinned by `operational-allowlist.test.ts`. Edits to this list are
 * contracts; the test forces the change through review.
 */
export const OPERATIONAL_AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "action.proposed",
  "action.approved",
  "action.partially_approved",
  "action.rejected",
  "action.executed",
  "action.failed",
  "action.denied",
  "action.expired",
  "action.cancelled",
  "action.undo_requested",
  "action.undo_executed",
  "action.approval_expired",
  "agent.activated",
  "agent.emergency-halted",
  "agent.resumed",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "connection.established",
  "connection.revoked",
  "connection.degraded",
  "competence.promoted",
  "competence.demoted",
  "competence.updated",
  "identity.created",
  "identity.updated",
  "overlay.activated",
  "overlay.deactivated",
] as const;
```

### 4.5 Snapshot allowlist

The drawer surfaces only these key names from `snapshot`, plus a `redactedKeyCount` for the rest. **No values, ever.**

```ts
const SNAPSHOT_KEY_ALLOWLIST: readonly string[] = [
  "id",
  "kind",
  "source",
  "actionType",
  "decisionId",
  "recommendationId",
  "approvalId",
  "envelopeId",
  "agentKey",
  "targetEntityType",
  "targetEntityId",
  "correlationId",
  "traceId",
];
```

The list was seeded by `grep -rE "snapshot:\s*\{" packages/core/src` to find what real audit emitters write — `actionType`, `approvalId`, `envelopeId` were added because they're emitted by `platform-lifecycle.ts`, `read-adapter.ts`, and `work-trace-integrity.ts` and are operationally meaningful identifiers. Excluded: `patchValue`, `reason`, `amount`, `budget`, `key`, `action`, `hashAlgorithm`, `hashVersion` — these are values, free-form text, financial amounts, or low-signal technical metadata. `envelopeId` and `traceId` are also top-level on `AuditEntry`; including them in the allowlist is harmless when they appear redundantly in `snapshot`. Adding a key requires updating this constant; no per-emitter customisation in v1.

---

## 5. Backend

### 5.1 New core function

`packages/core/src/audit/list-entries.ts`:

```ts
import {
  AuditEntryBrowseRowSchema,
  AuditEntriesListQuerySchema,
  AuditEntriesListResponseSchema,
  OPERATIONAL_AUDIT_EVENT_TYPES,
  type AuditEntry,
  type AuditEntryBrowseRow,
  type AuditEntriesListQuery,
  type AuditEntriesListResponse,
} from "@switchboard/schemas";
import type { AuditLedger } from "./ledger.js";

const SNAPSHOT_KEY_ALLOWLIST = new Set([
  "id",
  "kind",
  "source",
  "actionType",
  "decisionId",
  "recommendationId",
  "approvalId",
  "envelopeId",
  "agentKey",
  "targetEntityType",
  "targetEntityId",
  "correlationId",
  "traceId",
]);

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const HASH_PREFIX_LEN = 16;

interface CursorShape {
  timestamp: string; // ISO8601
  id: string;
}

function encodeCursor(c: CursorShape): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(s: string): CursorShape | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof parsed?.timestamp !== "string" || typeof parsed?.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function project(entry: AuditEntry): AuditEntryBrowseRow {
  const snapshotKeys: string[] = [];
  let redactedKeyCount = 0;
  for (const key of Object.keys(entry.snapshot)) {
    if (SNAPSHOT_KEY_ALLOWLIST.has(key)) snapshotKeys.push(key);
    else redactedKeyCount++;
  }

  return {
    id: entry.id,
    eventType: entry.eventType,
    timestamp: entry.timestamp.toISOString(),
    actorType: entry.actorType,
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    riskCategory: entry.riskCategory,
    visibilityLevel: entry.visibilityLevel,
    summary: entry.summary,
    snapshotKeys: snapshotKeys.sort(), // deterministic for tests + cache
    redactedKeyCount,
    evidencePointers: entry.evidencePointers.map((p) => ({
      type: p.type,
      hashPrefix: p.hash.slice(0, HASH_PREFIX_LEN),
    })),
    entryHash: entry.entryHash,
    previousEntryHash: entry.previousEntryHash,
    envelopeId: entry.envelopeId,
    traceId: entry.traceId ?? null,
  };
}

export async function listAuditEntriesForBrowse(
  ledger: AuditLedger,
  organizationId: string,
  rawQuery: unknown,
): Promise<AuditEntriesListResponse> {
  const query: AuditEntriesListQuery = AuditEntriesListQuerySchema.parse(rawQuery);
  const limit = Math.min(query.limit, MAX_LIMIT);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const eventTypeFilter = query.eventType
    ? [query.eventType]
    : query.scope === "operational"
      ? [...OPERATIONAL_AUDIT_EVENT_TYPES]
      : null; // null = no event-type filter (All events)

  const rawRows = await ledger.listForBrowse({
    organizationId,
    eventTypes: eventTypeFilter,
    actorType: query.actorType ?? null,
    entityType: query.entityType ?? null,
    entityId: query.entityId ?? null,
    after: query.after ? new Date(query.after) : null,
    before: query.before ? new Date(query.before) : null,
    cursor,
    limit: limit + 1, // fetch one extra to compute nextCursor
  });

  const trimmed = rawRows.slice(0, limit);
  const hasMore = rawRows.length > limit;
  const last = trimmed[trimmed.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ timestamp: last.timestamp.toISOString(), id: last.id }) : null;

  return AuditEntriesListResponseSchema.parse({
    rows: trimmed.map(project),
    nextCursor,
    scope: query.scope,
    appliedFilters: {
      eventType: query.eventType ?? null,
      actorType: query.actorType ?? null,
      entityType: query.entityType ?? null,
      entityId: query.entityId ?? null,
      after: query.after ?? null,
      before: query.before ?? null,
    },
  });
}
```

### 5.2 Cursor encoding — invariants

- **Encoding lives in core**, not the store. The store accepts a decoded `{timestamp, id} | null` and returns raw `AuditEntry[]`; core encodes the next cursor from the last trimmed row.
- **Stable tie-break.** Cursor is `(timestamp, id)`, not `(timestamp)`. Audit can have multiple entries at the same `timestamp` (especially in batch backfills); without an `id` tie-break, cursor pagination skips or duplicates rows at boundaries.
- **`base64url`, not `base64`.** Cursor goes in URL query strings; `base64url` avoids `+`, `/`, `=` URL-encoding contortions.
- **Decode tolerant.** `decodeCursor` returns `null` on any parse failure; the query falls back to "no cursor." Never throw on malformed cursors — operators may share URLs across staging/prod with ledger drift.
- **Encode deterministic.** `JSON.stringify({timestamp, id})` with the keys in that exact order. Test pins it.

### 5.3 Store interface extension

The audit subsystem has a two-layer architecture: `AuditLedger` (class, owns hashing/chain/redaction logic) → `LedgerStorage` (interface, the storage adapter) → `PrismaLedgerStorage` + `InMemoryLedgerStorage` (implementations). `listForBrowse` is purely a storage concern (filter + paginate; no chain or hash logic), so it lives on `LedgerStorage`. `AuditLedger` adds a thin pass-through mirroring `query()` (`packages/core/src/audit/ledger.ts:225`).

Add to `packages/core/src/audit/ledger.ts`:

```ts
export interface AuditLedgerBrowseFilter {
  organizationId: string;
  eventTypes: AuditEventType[] | null; // null = All events; [] = empty (returns no rows)
  actorType: ActorType | null;
  entityType: string | null;
  entityId: string | null;
  after: Date | null;
  before: Date | null;
  cursor: { timestamp: string; id: string } | null;
  limit: number;
}

// On the existing LedgerStorage interface (line 20):
export interface LedgerStorage {
  // ... existing methods unchanged ...
  listForBrowse(filter: AuditLedgerBrowseFilter): Promise<AuditEntry[]>;
}

// On the existing AuditLedger class (line 70) — thin pass-through:
//   async listForBrowse(filter: AuditLedgerBrowseFilter): Promise<AuditEntry[]> {
//     return this.storage.listForBrowse(filter);
//   }

// On the existing InMemoryLedgerStorage (line 335) — extend with:
//   async listForBrowse(filter: AuditLedgerBrowseFilter): Promise<AuditEntry[]> {
//     // mirror the predicate logic over `this.entries`,
//     // sort by (timestamp DESC, id DESC), apply cursor, take limit.
//   }
```

Prisma implementation in `packages/db/src/storage/prisma-ledger-storage.ts` (mirror the existing `query()` pattern at line 138; reuse the same row-to-domain conversion):

```ts
async listForBrowse(filter: AuditLedgerBrowseFilter): Promise<AuditEntry[]> {
  const where: Prisma.AuditEntryWhereInput = {
    organizationId: filter.organizationId,
    visibilityLevel: { in: ["public", "org"] },
  };

  if (filter.eventTypes !== null) where.eventType = { in: filter.eventTypes };
  if (filter.actorType !== null) where.actorType = filter.actorType;
  if (filter.entityType !== null) where.entityType = filter.entityType;
  if (filter.entityId !== null) where.entityId = filter.entityId;
  if (filter.after !== null) where.timestamp = { ...where.timestamp, gte: filter.after };
  if (filter.before !== null) where.timestamp = { ...where.timestamp, lt: filter.before };

  if (filter.cursor !== null) {
    // (timestamp, id) DESC tuple comparison: timestamp < cursor.timestamp
    // OR (timestamp = cursor.timestamp AND id < cursor.id)
    const cursorDate = new Date(filter.cursor.timestamp);
    where.OR = [
      { timestamp: { lt: cursorDate } },
      { timestamp: cursorDate, id: { lt: filter.cursor.id } },
    ];
  }

  const rows = await this.prisma.auditEntry.findMany({
    where,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: filter.limit,
  });

  return rows.map((r) => /* same row-to-domain conversion used by query() above */);
}
```

The in-memory implementation already exists — `InMemoryLedgerStorage` at `packages/core/src/audit/ledger.ts:335`. D3 extends it with a `listForBrowse` method that mirrors the predicate logic over `this.entries`. Used by both the core `list-entries.test.ts` and the api `api-activity.test.ts` (per `feedback_api_test_mocked_prisma.md` — CI has no Postgres).

### 5.4 Fastify route

`apps/api/src/routes/dashboard-activity.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { listAuditEntriesForBrowse } from "@switchboard/core";

export const dashboardActivityRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      schema: {
        description: "Browse audit entries for the authenticated org.",
        tags: ["Dashboard", "Activity"],
        querystring: {
          type: "object",
          properties: {
            scope: { type: "string", enum: ["operational", "all"] },
            cursor: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            eventType: { type: "string" },
            actorType: { type: "string", enum: ["user", "agent", "service_account", "system"] },
            entityType: { type: "string" },
            entityId: { type: "string" },
            after: { type: "string", format: "date-time" },
            before: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request, reply) => {
      const orgId = request.organizationIdFromAuth;
      if (!orgId) return reply.code(401).send({ error: "Org context required" });

      try {
        const result = await listAuditEntriesForBrowse(app.auditLedger, orgId, request.query);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "Invalid query", details: err.flatten() });
        }
        request.log.error({ err }, "dashboard-activity list failed");
        return reply.code(500).send({ error: "Internal error" });
      }
    },
  );
};
```

Mounted at `/api/dashboard/activity` via `apps/api/src/bootstrap/routes.ts`.

### 5.5 Next.js proxy

`apps/dashboard/src/app/api/dashboard/activity/route.ts` follows the existing proxy pattern (mirrors `apps/dashboard/src/app/api/dashboard/contacts/route.ts` and `…/automations/route.ts`):

- Forward `searchParams` verbatim to `${API_URL}/api/dashboard/activity`.
- Forward auth header.
- On non-200, surface `{ error: <upstream message or "Failed to load activity"> }` with the upstream status code.
- On network error: `{ error: "Failed to load activity" }` + 502.

---

## 6. Frontend

### 6.1 Page composition

`apps/dashboard/src/app/(auth)/activity/page.tsx` (server component):

```tsx
import { ActivityPage } from "./activity-page";

export const metadata = { title: "Activity · Switchboard" };

export default function Page() {
  return <ActivityPage />;
}
```

`activity-page.tsx` (client component):

- Reads `process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true"`.
- If gate `false`: renders header + chips + table from `fixtures.ts` (~12 rows representing the operational allowlist plus one `event.published` row that only shows under `All events`).
- If gate `true`: mounts `useActivityList()` hook, passes data to `ActivityTable`.
- Owns chip state (`scope: "operational" | "all"`) and drawer state (`expandedRowId: string | null`).
- Reads URL params via `useSearchParams()` to populate optional filters; pushes chip changes into the URL via `useRouter().replace()` so back-button works.

Components (in `components/`):

- `header.tsx` — clone of `automations/components/header.tsx`. Title `"Activity"`, subtitle `"Audit ledger — every action, approval, and override."`.
- `filter-chips.tsx` — two-chip toggle (`Operational` / `All events`).
- `activity-table.tsx` — hairline table; columns `TIMESTAMP / EVENT / ACTOR / ENTITY / SUMMARY`. Sticky first column. Mono-prefix labels in `EVENT / ACTOR / ENTITY`. `SUMMARY` truncated to 80 chars.
- `activity-row.tsx` — single row. Click anywhere expands into the inline drawer below.
- `activity-row-drawer.tsx` — drawer content (§6.4).
- `pagination-footer.tsx` — `[← Prev] [Next →]` buttons; cursor-based; `Prev` is a stack of cursors held in component state (no `prevCursor` API).
- `empty-state.tsx` — distinct copy for zero-state vs. filtered-empty.
- `format.ts` — date/time formatting helpers (clone of `contacts/components/format.ts`).

### 6.2 Header

```
ACTIVITY
Audit ledger — every action, approval, and override.
```

Mercury-shaped: cream background, ink-on-cream typography, hairline divider below, `JetBrains Mono` for the section label `ACTIVITY`. No CTAs in the header (read-only surface).

### 6.3 Filter chips

```
[Operational]   [All events]
```

- Default: `Operational` selected.
- `Operational` → `?scope=operational` in the URL (or omitted, since it's the default).
- `All events` → `?scope=all`.
- Chip selected state: amber underline + `--mercury-accent` text colour. Unselected: muted-ink + `--mercury-hairline` underline. Both use the shared chip primitives from D1/D2 if available, or copy them locally if D2 hasn't extracted them yet.
- **No counts.** No badge on either chip.

### 6.4 Drawer

Layout:

```
┌─ Drawer (expanded under the row) ─────────────────────────────────────────┐
│                                                                              │
│ EVENT      action.executed                                                  │
│ ID         01J5QX...                                       [copy]            │
│ TIMESTAMP  2026-05-10T14:23:51.420Z (UTC)                                    │
│ ACTOR      agent · agent_alex_001                                            │
│ ENTITY     Action · 01J5QW...                              [copy]            │
│ RISK       low                                                               │
│ VISIBILITY org                                                               │
│                                                                              │
│ SUMMARY    Booked appointment for contact CTC:abcd1234 in calendar           │
│            "Operations" at 2026-05-12 09:00 PT.                             │
│                                                                              │
│ SNAPSHOT   id, kind, decisionId, agentKey, targetEntityType, targetEntityId  │
│            (4 keys redacted)                                                 │
│                                                                              │
│ EVIDENCE   2 pointers                                                        │
│            • inline   sha256:a3f9b2c1d4e6789a                                │
│            • pointer  sha256:b8e2c4d6f1a3789b                                │
│                                                                              │
│ TRACE      trace_01J5QX...                                                   │
│ ENVELOPE   env_01J5QW...                                                     │
│                                                                              │
│ HASH       HASH:a3f9b2c1...                                [copy full]      │
│ PREV HASH  HASH:b8e2c4d6...                                [copy full]      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes:

- Labels in `JetBrains Mono` caps (`EVENT`, `ID`, etc.); values in body sans-serif.
- `[copy]` and `[copy full]` are inline ghost buttons — they copy the full id/hash to clipboard. The drawer never displays the full hash inline (60+ chars would wrap awkwardly); the prefix + copy button is the affordance.
- `SNAPSHOT` line lists allowlisted key names comma-separated, then `(N keys redacted)` on the next line if `redactedKeyCount > 0`.
- `EVIDENCE` shows count + per-pointer `(type, hashPrefix)`. Never fetches storageRef content.
- No verify-chain button; no link-out to `/api/audit/:id`; no download.
- Drawer uses the same `aria-expanded` / `role="region"` pattern as D2's `automation-row-drawer.tsx`.

### 6.5 Empty states

**Zero-state** (org has no audit entries — should be impossible in practice but possible in fixtures):

```
No activity yet.
The audit ledger records every action, approval, and override.
```

**Filtered-empty** (chips/URL params filtered everything out):

```
No matching activity.
[Clear filters]
```

`Clear filters` → resets chip to `Operational`, removes all URL params except `scope` itself.

### 6.6 Production gate

Identical posture to D2:

- `NEXT_PUBLIC_ACTIVITY_LIVE` defaults `false`.
- When `false`: page renders with `fixtures.ts` data; chip toggles work against the fixture; drawer expand works; pagination footer is hidden (single page of fixtures).
- When `true`: `useActivityList()` mounts; React Query handles loading + error; pagination footer appears.
- Fixtures live in `apps/dashboard/src/app/(auth)/activity/fixtures.ts` and are typed as `AuditEntryBrowseRow[]` so they exercise the same UI code paths as live data.

---

## 7. Tests (concrete)

### 7.1 Core — `list-entries.test.ts`

- `lists default scope=operational, returns rows in timestamp DESC order`
- `applies operational allowlist when scope=operational`
- `lifts allowlist when scope=all`
- `URL-param eventType overrides scope filter`
- `URL-param actorType narrows results`
- `URL-param after/before applies range`
- `URL-param entityType + entityId narrows to specific entity`
- `cursor encode/decode round-trip`
- `cursor pagination — fetches one extra, trims, computes nextCursor`
- `nextCursor null when fewer rows than limit`
- `cursor decoding tolerant of malformed input`
- `cursor pagination stable across (timestamp, id) ties`
- `projection redacts non-allowlisted snapshot keys`
- `projection sets redactedKeyCount correctly`
- `projection truncates evidence-pointer hashes to 16 chars`
- `projection drops admin-visibility entries (server filter)`
- `limit clamped to MAX_LIMIT`
- `default limit is 50`
- `empty result returns rows: [], nextCursor: null`

### 7.2 Allowlist — `operational-allowlist.test.ts`

- `OPERATIONAL_AUDIT_EVENT_TYPES matches expected literal set` (snapshot)
- `every entry is a member of AuditEventTypeSchema`
- `excludes work_trace.* events` (regression)
- `excludes event.* events` (regression)
- `excludes entity.* events` (regression)

### 7.3 API — `api-activity.test.ts`

Following `feedback_api_test_mocked_prisma.md` and the `buildTestServer` pattern in `apps/api/src/__tests__/`.

- `requires org context (401 without)`
- `returns 200 with rows for valid org`
- `passes scope=all to ledger`
- `passes URL-param filters to ledger`
- `passes cursor through`
- `400 on invalid scope`
- `400 on invalid limit`
- `400 on invalid date format`
- `500 on ledger throw`

### 7.4 Hook — `use-activity-list.test.ts`

- `initial query uses scope=operational`
- `chip toggle updates scope`
- `cursor advance updates query key`
- `URL params populate query`
- `error response surfaces as { error }`

### 7.5 Page — `activity-page.test.tsx`, `activity-table.test.tsx`, `activity-row-drawer.test.tsx`, `filter-chips.test.tsx`, `format.test.ts`

- gate-on / gate-off rendering
- empty-state vs filtered-empty distinction
- chip toggle clears drawer
- drawer renders allowlisted keys + redacted count
- drawer never renders snapshot values (regression — string-search the rendered DOM)
- copy-to-clipboard wired (mocked)
- date formatting under tz fallbacks

---

## 8. Risks

### 8.1 Audit volume hits the index hard

The composite index `(organizationId, timestamp DESC)` covers the common case. Worst case is `WHERE organizationId = $1 AND eventType IN (28 values) ORDER BY timestamp DESC LIMIT 51` — Postgres should use the index for the org-scope and timestamp ordering, then filter eventType in-memory. For orgs with millions of audit rows, the in-memory filter could be expensive on `Operational` because the allowlist excludes only a minority of rows; for orgs heavy in `work_trace.*` or `event.*` it could be substantial.

**Mitigation:** if profiling shows eventType-filtering as a hot path, add a partial index `@@index([organizationId, timestamp(sort: Desc)], where: eventType IN (operational set))`. Defer until evidence. Document as a D3.5 candidate.

### 8.2 Cursor drift across writes

Audit is append-only at the head; `(timestamp, id)` cursors paginate **backwards in time**, so writes during pagination never invalidate an in-flight cursor. This is structurally safer than D2's `createdAt`-cursored triggers (where status changes don't move rows but feel like they do). No mitigation needed.

### 8.3 Snapshot redaction false-negatives

The allowlist of 10 keys is opinionated. If an audit emitter writes a key like `customerEmail` or `phoneNumber` directly into snapshot, the allowlist would silently leak nothing (good — it's not allowlisted), but if an emitter writes `id: "user-john@example.com"` (using the email as a literal id), the value never leaves the row anyway because we only project key _names_, not values. **The redaction architecture is value-based, not key-based** — `snapshotKeys` is a list of strings, never a `Record<key, value>`. The allowlist is defence-in-depth against a future regression that tries to "helpfully" surface values.

**Test discipline:** `activity-row-drawer.test.tsx` asserts via DOM string-search that no snapshot value is rendered. Regression-class.

### 8.4 Hash-chain anchors visible to operators

`entryHash` and `previousEntryHash` are deliberately surfaced in the drawer. They are not secrets — they're integrity anchors derived from public-by-design audit content. Surfacing them lets operators correlate with `/api/audit/verify` and gives the surface a "this is the source-of-truth" feeling. Confirmed acceptable; flagged here so it's not a review surprise.

### 8.5 Existing `/api/audit/*` and the new `/api/dashboard/activity` diverge over time

The two endpoints have different shapes (`AuditEntry` vs. `AuditEntryBrowseRow`), different filtering models (legacy supports `envelopeId`-only lookups; new supports `eventType IN (...)` via `scope`). Maintenance cost: 2 endpoints, 2 callers each. Mitigation: don't merge them. They serve different surfaces with different semantics. The "convergence" answer is the post-D5 cleanup, not D3.

---

## 9. Deferred (D3.5+)

Concrete candidates, in rough priority order:

1. **Tail mode** — pin to top, prepend new rows, suspend pagination. Re-enables the "live" feel that polling would break.
2. **Multi-select event-type filter** — replaces the binary chip with a dropdown sourced from `AuditEventTypeSchema`. Trigger: user research showing operators reaching for specific event types.
3. **Actor-name resolution** — render `actorType=agent + actorId=<canonical agent>` as `Alex` / `Riley` / `Mira`. Requires touching the agent registry from the browse projection.
4. **Date-range picker** — proper UI affordance over the URL params `?after=` / `?before=`.
5. **`?triggerId=`-style direct lookup** for entry id (`?entryId=<id>`). API already supports it via the existing `/api/audit/:id`; D3.5 plumbs a single-row mode through the browse page.
6. **Verify-chain button in the drawer** — delegates to `/api/audit/verify?from=<entryId>&limit=N`. Long-running; needs spinner + cancel.
7. **CSV export** for an open filter.
8. **Saved filters** ("My team's actions this week") once URL params + named-views model is settled.
9. **Counts on chips** — would require a denormalised counter table or a fast approximate count. Defer until counts are operationally important.
10. **Cancel-in-flight-action drawer affordance** for `action.proposed`/`action.executing` rows — pulls cross-surface mutating actions into `/activity`. Crosses the read-only line; only consider after D4's old-route disposition tells us where mutating affordances actually belong.
11. **D4 link-out** — once `/escalations` is retired, surface escalation-resolved entries with a richer drawer. Coupled to D4.

---

## 10. Acceptance criteria

D3 ships when:

- [ ] `/activity` route exists at `apps/dashboard/src/app/(auth)/activity/page.tsx` and renders without auth errors when authenticated.
- [ ] Page renders Mercury-style header `ACTIVITY` + subtitle.
- [ ] Two-chip filter row visible; default `Operational` selected; toggle to `All events` works without navigation.
- [ ] Hairline table renders 50 rows by default; `[Next →]` advances cursor; `[← Prev]` returns to the previous page; pagination footer hides when `nextCursor === null`.
- [ ] Row click expands an inline drawer; drawer shows full ids, hash anchors, evidence pointer prefixes, and allowlisted snapshot key names + redacted-count.
- [ ] Drawer never renders any snapshot value (DOM-string-search regression test passes).
- [ ] URL params `?eventType=`, `?actorType=`, `?entityType=`, `?entityId=`, `?after=`, `?before=` filter results without UI chrome.
- [ ] `?scope=all` renders firehose; `?scope=operational` (or absent) renders curated.
- [ ] Empty-state and filtered-empty render distinct copy; `Clear filters` returns to default.
- [ ] Production gate `NEXT_PUBLIC_ACTIVITY_LIVE=false` renders fixtures; `=true` renders live data.
- [ ] All tests in §7 pass; `pnpm typecheck` clean; `pnpm lint` clean.
- [ ] Composite index `@@index([organizationId, timestamp(sort: Desc)])` on `AuditEntry` exists in `schema.prisma` and a migration is generated.
- [ ] Existing `/api/audit/*` Fastify routes, `useAudit()` hook, and `activity-translator.ts` are untouched and continue to feed live-signal-popover and event-history components.

---

## Appendix A — Reviewer flip notes (single-line summaries)

| Decision                              | Flip target                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Two chips                             | Add category dropdown above chips; backend already supports `eventType` IN.                                  |
| Drawer (no detail route)              | Cut the drawer for inert rows (~150 LoC + redaction helper).                                                 |
| No polling                            | `refetchInterval: 30_000` on `useActivityList`.                                                              |
| Server-filter admin/system visibility | Gate on `request.userRole === "admin"` to opt-in admin-visible rows.                                         |
| Scope=operational default             | Swap to scope=all default; chip default flips.                                                               |
| Snapshot key allowlist                | Drop `correlationId`/`traceId` to be conservative, or expand to add `workflowId`.                            |
| Hash-chain anchors in drawer          | Hide; anchors only surface via `/api/audit/:id` direct lookup.                                               |
| Two endpoints                         | Merge `/api/dashboard/activity` into `/api/audit` with a `?dashboard=true` param. Not recommended (couples). |

---

## Appendix B — Where this fits in the redesign roadmap

- **D1** (`/contacts`) shipped 2026-05-08 (PRs #399, #402, #405).
- **D2** (`/automations`) spec'd 2026-05-09; implementation in flight in `worktree-feat+automations-d2a`.
- **D3** (`/activity`) — this spec.
- **D4** — old-route disposition. Dependent on D3 only insofar as audit surfaces some entries that today are owned by `/decide` and `/escalations`. D4 is a strategy-doc workshop, not a slice-shaped spec.
- **D5** — `useAgentFirstNav` flag cleanup. Mechanical.
- **`MercuryAuthShell` extraction** — revisit after D3 implementation lands. Trigger: a fourth Mercury occupant in D4, or evidence that D3 forced shell-divergence.
