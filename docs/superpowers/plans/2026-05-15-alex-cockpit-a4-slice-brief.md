# Alex Cockpit A.4 — Activity Richness + Thread Previews (Slice Brief)

**Date:** 2026-05-15
**Parent spec:** [Alex Cockpit Home — Design Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices §A.4, §Activity stream, §Backend changes §5)
**Predecessor slices:**
- A.1 — `feat(cockpit): A.1 shell + basic Alex composition` (shipped)
- A.2 — `feat(cockpit): A.2 mission popover + Day-1 narrator + setup checklist` (#485, squash `67eb0618`)
- A.3 — `feat(cockpit): A.3 — KPI strip + ROI bar on /alex` (#500, squash `ed54c4a8`)

---

## Why A.4 lands now

A.3 closed out Phase A's KPI/ROI surface. The Alex cockpit now renders identity + mission popover + KPI strip + ROI bar + approval block + activity stream + inert composer. The activity stream is the only block in the steady-state render that is still operating on its A.1 stub shape: `ActivityRow` is declared at `apps/dashboard/src/components/cockpit/types.ts:102-111` with the full `{ time, kind, head, body?, who?, preview?, replyable?, tag? }` superset, but the production data path only ever populates `{ time, kind, head }` (verified at `apps/dashboard/src/lib/cockpit/activity-kind-map.ts:46-55`). Rows render collapsed-only — no expand affordance, no thread preview, no per-row body, no contact-name handles.

The umbrella spec calls this out as A.4 explicitly:

> **A.4 — Activity richness + thread previews**
> **Ships:** either the new `GET /api/dashboard/agents/[agentId]/activity` endpoint or an extension of the existing `/api/dashboard/agents/activity` (plan decides), `ActivityRow` superset (`body` / `preview` / `who` / `replyable` / `tag`), inline `thread-preview.tsx`, reply box routing to `/contacts/[id]`, "Tell Alex about {firstName}" affordance, activity filters (`all` / `booked` / `escalations`).
> — `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md:75-77`

A.4 is the **last data-plane slice** in Phase A. A.5 (composer + command palette) is shell-only — it does not extend the activity stream. A.6 is retirement of the legacy block components. After A.4 the cockpit has every steady-state surface the locked design calls for; A.5 then adds the input affordance and A.6 cleans up.

### Downstream consumers

- **Riley B.2b / B.3-followup** — Riley's activity stream stays on its B.1 baseline (collapsed rows, no previews). Riley does **not** consume A.4's preview path: Riley's `RileyApprovalView.campaign` carries a campaign reference, not a contact thread, so there is no thread to preview. Riley re-uses the `activity-row.tsx` component and the new `kind-meta` Riley extension, but the expand/preview path is feature-flagged off on `/riley` via `<ActivityRow showPreview={false} />` defaulting at the page level. **Mitigation:** the row's expand button is hidden when `replyable={false}` and `preview` is undefined; Riley's translator emits both as undefined, so the row stays visually identical to B.1.
- **Alex A.5 (composer + palette)** — A.5 reads no activity data; the composer reads `AGENT.composerPlaceholder` + `AGENT.commands` + the local `HaltProvider`. A.4 unblocks A.5 only in the sense that A.4 ships the last data-plane wiring; A.5 can build on a stable shell.

---

## Slice goal

Operators see a per-thread activity stream that they can expand to read the last 3–4 messages and click into the contact thread when Alex needs steering. The cockpit becomes legibly grounded in conversations: every `booked` / `qualified` / `replied` / `escalated` row anchors to a real contact name, with the conversation excerpt one click away.

The locked design's "honest impact language" guardrail carries over from A.2/A.3: activity-row body copy describes what Alex **did** (`"Booked Maya for Sat 2pm"`), not what Alex **changed** (`"Saved you 12 minutes"`). Causal claims live in the per-event audit trail, never in the cockpit stream.

---

## What ships

### Schema (single new Zod module — single source of truth)

A.4 ships **one new Zod schema module** at `packages/schemas/src/cockpit-activity.ts`, exporting `ActivityRow` (Zod `infer`) and `ThreadMessage` (Zod `infer`) plus their Zod-schema siblings. This becomes the **single source of truth** for the cockpit activity wire shape, consumed by `packages/core` (translator), `apps/api` (route response), and `apps/dashboard` (component types). The dashboard's existing `apps/dashboard/src/components/cockpit/types.ts:78-81,102-111` declarations are replaced with re-exports from `@switchboard/schemas`.

The `ConversationMessage` Prisma model at `packages/db/prisma/schema.prisma:861-873` already carries the `(contactId, orgId, direction, content, createdAt)` tuple the preview reader needs. **No Prisma migration, no `db:check-drift` concern.**

This single-source-of-truth approach replaces the previous "core declares parallel mirror; api enforces with compile-time assertion" plan after review feedback flagged (a) a fragile `apps/api → apps/dashboard` relative-path import for the mirror test, and (b) a bidirectional `from: "contact" | "alex" | "operator"` (core) ↔ `from: string` (dashboard) union mismatch that would have broken the assertion. Lifting to `@switchboard/schemas` eliminates both issues at once; per the dependency layer rules in `CLAUDE.md`, schemas imports nothing and is consumed by all higher layers — the correct home for shared wire types.

| Path | Change | Why touched |
|---|---|---|
| `packages/schemas/src/cockpit-activity.ts` | **New.** `ThreadMessageSchema` (Zod object with `from: z.enum(["contact","alex","operator"])`, `text: z.string().min(1)`); `ActivityKindSchema` (Zod enum mirroring today's `ActivityKind`); `ActivityRowSchema` (Zod object with `id?`, `time`, `kind`, `head`, `body?`, `who?`, `contactId?`, `preview?: ThreadMessage[]`, `replyable?`, `tag?`, `timestampIso?`). Exports inferred TS types. | Single wire-shape source. |
| `packages/schemas/src/__tests__/cockpit-activity.test.ts` | **New.** Parses populated row, contact-less row, missing-optional-fields row; rejects empty-string head; accepts `timestampIso` ISO-8601. | Coverage. |
| `packages/schemas/src/index.ts` | Add the new module to barrel exports. | Surface. |

### Core (surface-agnostic helpers)

| Path | Change | Why touched |
|---|---|---|
| `packages/core/src/agent-home/activity-preview-reader.ts` | **New.** `interface ActivityPreviewReader { readRecentBatch(args: { contactIds: readonly string[]; orgId: string; limit: number }): Promise<Record<string, ThreadMessageRecord[]>> }` where `ThreadMessageRecord = ThreadMessage & { createdAt: string }`. The translator drops `createdAt` from the emitted row shape. | Layer 3 surface-agnostic contract. Consumed by the API translator. No UI references. |
| `packages/core/src/agent-home/__tests__/activity-preview-reader.test.ts` | **New.** Interface-shape test (in-memory stub). | Pattern only — no Prisma. |
| `packages/core/src/agent-home/cockpit-activity-translator.ts` | **New.** `translateAuditToCockpitActivity(args: { entries: AuditEntryForTranslator[]; previewReader: ActivityPreviewReader; orgId: string; limit: number; expandPreview: boolean; agentKey: AgentKey }): Promise<ActivityRow[]>` — consumes audit entries, derives `kind` via the kind-classifier, extracts `who` / `contactId` from snapshot, populates `body` + `head` + `timestampIso` from snapshot-specific copy templates, and (when `expandPreview`) batches a single `previewReader.readRecentBatch` call per unique contact. **Returns the schemas-package `ActivityRow` type directly** — no parallel-mirror type. The internal `actorMatchesAgent` filter (`actorType === "agent" && (actorId === agentKey || snapshot.agentRole === agentKey)`) mirrors the legacy convention at `apps/dashboard/src/hooks/use-agent-activity.ts:44` + `apps/api/src/services/activity-translator.ts:25-31` (UUID fallback to alex). | Layer 3 server-side translator. |
| `packages/core/src/agent-home/__tests__/cockpit-activity-translator.test.ts` | **New.** Per-kind translation cases + batched-preview-fetch case + expandPreview=false short-circuit case + missing-contactId fallback case + actorRole-via-snapshot case (no `actorId` match but `snapshot.agentRole === "alex"` resolves) + UUID-actorId-falls-to-alex case. | Coverage. |
| `packages/core/src/agent-home/contact-snapshot-extractors.ts` | **New.** Per-event-type extractors: `extractContactRef(eventType: string, snapshot: Record<string, unknown>): { contactId: string; displayName: string } \| null`. Pure functions, one per kind. | Surface-agnostic snapshot parsing. |
| `packages/core/src/agent-home/__tests__/contact-snapshot-extractors.test.ts` | **New.** One case per supported event type + unknown-event fallback. | Coverage. |

### DB

| Path | Change | Why touched |
|---|---|---|
| `packages/db/src/prisma-activity-preview-reader.ts` | **New.** `class PrismaActivityPreviewReader implements ActivityPreviewReader`. **Batch-first contract:** the only method is `readRecentBatch({ contactIds, orgId, limit })`, which issues **exactly one** `prisma.conversationMessage.findMany({ where: { contactId: { in: contactIds }, orgId }, orderBy: { createdAt: "desc" }, take: contactIds.length × limit, select: { contactId, direction, content, createdAt, metadata } })` and groups by `contactId` in memory before returning `Record<string, ThreadMessageRecord[]>`. **No per-contact method exists.** The anti-N+1 guarantee is structural, not a translator convention. | Layer 4 Prisma impl. |
| `packages/db/src/__tests__/prisma-activity-preview-reader.test.ts` | **New.** Two cases: single-contact returns ordered desc; batch-fetch returns one bucket per `contactId`. Uses the mocked-Prisma pattern (`feedback_api_test_mocked_prisma.md`). | Coverage. |
| `packages/db/src/index.ts` | Add the new class to barrel exports. | Wiring. |

`MessageHistoryReader` already exists at `packages/db/src/prisma-message-history-reader.ts` but reads thread-grain "last in/out timestamps" only, not message bodies. The preview reader is a sibling interface, not an extension — different return shape, different consumer.

### API (Fastify)

| Path | Change | Why touched |
|---|---|---|
| `apps/api/src/routes/agent-home/activity.ts` | **New.** `GET /agents/:agentId/activity` Fastify route. Reads `limit` (default 50, max 200) + `expandPreview` (default `true`) query params. Resolves the audit ledger via an org-scoped Prisma query (`organizationId === orgId AND actorType === "agent"`), invokes `translateAuditToCockpitActivity` with a `PrismaActivityPreviewReader`, returns `{ rows: ActivityRow[] }` (from `@switchboard/schemas`). | Endpoint. |
| `apps/api/src/routes/agent-home/__tests__/activity.test.ts` | **New.** Integration test using mocked Prisma + in-memory audit fixture. | Coverage. |
| `apps/api/src/bootstrap/routes.ts:181-200` | Register the new route under the existing `agent-home` group. | Wiring. |
| `apps/api/src/lib/cockpit-activity-deps.ts` | **New.** Factory that wires `PrismaActivityPreviewReader` + the org-scoped audit query function and returns the bound translator dependency object. Mirrors `apps/api/src/lib/meta-spend-provider.ts` (A.3's wiring helper). | Dependency injection. |
| `apps/api/src/__tests__/api-cockpit-activity.test.ts` | **New.** Server-level integration test using `buildTestServer` + mocked Prisma. Asserts: 200 OK with `{ rows: [] }` when no audit; 200 with populated rows including preview when audit + messages exist; query param `expandPreview=false` returns rows with no `preview` field; `agentId=alex` filters to alex-actor entries. | Coverage. |

`limit` and `expandPreview` are the only query params A.4 ships. Filters (`all` / `booked` / `escalations`) stay client-side because they are visual filters over the same row list — there is no cost-savings from server-side filtering, and client-side filtering is already implemented at `apps/dashboard/src/components/cockpit/activity-stream.tsx:17-22`.

### Dashboard (Next.js proxy + hook)

| Path | Change | Why touched |
|---|---|---|
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/route.ts` | **New.** Next.js proxy. Mirrors the pattern in `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts`. | Proxy. |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/__tests__/route.test.ts` | **New.** Two cases (auth-required + happy path). | Coverage. |
| `apps/dashboard/src/hooks/use-agent-activity-cockpit.ts` | **New.** `useAgentActivityCockpit(agentId: AgentKey, opts?: { limit?: number; expandPreview?: boolean })` — TanStack Query hook returning `{ rows: ActivityRow[] }`. Refetch every 30s (matches `useAgentActivity`). | Hook. |
| `apps/dashboard/src/hooks/__tests__/use-agent-activity-cockpit.test.ts` | **New.** Mocked-fetch coverage. | Coverage. |

The existing `apps/dashboard/src/hooks/use-agent-activity.ts` and `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` **stay in place** until A.6. Their consumers are the legacy block components (`agent-home-client.tsx` / `*-block.tsx`), which A.6 retires. A.4 does not delete them and does not modify them — they remain the data path for `/[agentKey]` agents that have not yet migrated to the cockpit (i.e., Riley today renders the legacy client until Riley's own cockpit ships per its spec).

### Dashboard (components)

| Path | Change | Today | After A.4 |
|---|---|---|---|
| `apps/dashboard/src/components/cockpit/thread-preview.tsx` | **New.** | n/a | `<ThreadPreview messages={ThreadMessage[]} who={string} />` — renders a 3–4 message excerpt as a column, last message at the bottom, with `from` label + `text`. Inline reply box renders below the preview; pressing "Send as me" routes to `/contacts/[id]?takeover=true`. Inline send is **not wired** (umbrella spec §Out of scope item 9). |
| `apps/dashboard/src/components/cockpit/__tests__/thread-preview.test.tsx` | **New.** | n/a | Renders messages, separates by `from`, "Send as me" routes via `next/router` mock. |
| `apps/dashboard/src/components/cockpit/activity-row.tsx:14-71` | Modify. | Renders `{ time, kind, head }` only; `open` + `toggle` props are accepted but unused (`_open`, `_toggle`). | Renders `{ body, who, preview, replyable, tag }` when present. `open` toggles a sub-region containing (a) `body` if present, (b) `<ThreadPreview>` if `preview && replyable`, (c) a "Tell Alex about {firstName}" link routing to `/contacts/[contactId]?note=open` if `who && contactId`. Collapsed row gets a chevron affordance on the right when `replyable`. `<ActivityRow>` is **agent-agnostic** — Riley re-uses it with `preview` undefined and the expand affordance hides. |
| `apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx` | Extend. | Existing cases (if any). | Cases: collapsed renders head-only; click chevron expands body + preview; expanded "Tell Alex about {firstName}" routes to `/contacts/[id]?note=open`; "Send as me" routes to `/contacts/[id]?takeover=true`; row without `who` hides both affordances; row without `replyable` hides the chevron. |
| `apps/dashboard/src/components/cockpit/activity-stream.tsx:24-99` | Modify. | Renders rows with `open={false}` and stub `toggle`. | Manages per-row open state (`useState<Set<string>>` keyed by row id; for A.4 the row key is `row.time + ":" + row.head + ":" + i` since the wire shape has no stable id today). Passes `open` and `toggle` to `<ActivityRow>`. Filter chips unchanged. |
| `apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx` | Extend. | Existing cases. | Multi-row open/close, filter chip survives expand state. |
| `apps/dashboard/src/components/cockpit/types.ts:78-81,102-111` | Replace. | Local declarations of `ThreadMessage` (with `from: string`) and `ActivityRow`. | `export type { ActivityRow, ThreadMessage, ActivityKind } from "@switchboard/schemas";` — re-export from the schemas package. This narrows `ThreadMessage.from` from `string` to the union `"contact" \| "alex" \| "operator"`. Existing call sites (verified: only `types.ts:108` declaration + the new `<ThreadPreview>` consumer) are compatible because none pass arbitrary strings. |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx:18,22,31,54` | Modify. | Imports `translatedActionToActivityRow` from `activity-kind-map`; calls `useAgentActivity(1)` and maps to `ActivityRow[]`. | Imports `useAgentActivityCockpit`; calls `useAgentActivityCockpit("alex", { limit: 50, expandPreview: true })`; `activityRows = activityQ.data?.rows ?? []`. The legacy import + map are removed from this file but **the legacy hook + mapper stay in the repo** for `agent-home-client.tsx`. |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | Extend. | Existing cases (KPI/ROI/etc). | One case asserting the new hook is called and rows render with previews when the fixture provides them. |

### Tests added (summary)

| File | Cases |
|---|---|
| `packages/core/src/agent-home/__tests__/cockpit-activity-translator.test.ts` | Per-kind translation (booked / qualified / replied / sent / escalated / connected / waiting / passed / started, 9 cases); batched preview fetch (1 call for N unique contacts); `expandPreview=false` short-circuits the reader; missing-contactId rows emit row with no preview and `replyable=false`. |
| `packages/core/src/agent-home/__tests__/contact-snapshot-extractors.test.ts` | One case per event type; unknown event returns null; malformed snapshot returns null. |
| `packages/core/src/agent-home/__tests__/activity-preview-reader.test.ts` | Interface-shape via in-memory stub. |
| `packages/db/src/__tests__/prisma-activity-preview-reader.test.ts` | Single-contact ordered-desc returns; batch-fetch groups by contactId; empty result returns `[]`. Mocked-Prisma pattern. |
| `apps/api/src/routes/agent-home/__tests__/activity.test.ts` | Happy path; `expandPreview=false`; `limit` clamping (max 200); unknown agentId returns 400; agent-scope filter (alex actor only). |
| `apps/api/src/__tests__/api-cockpit-activity.test.ts` | Server-level integration. |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/__tests__/route.test.ts` | Proxy auth + happy path. |
| `apps/dashboard/src/hooks/__tests__/use-agent-activity-cockpit.test.ts` | Hook wiring + query key + 30s refetch. |
| `apps/dashboard/src/components/cockpit/__tests__/thread-preview.test.tsx` | Render, from-label, "Send as me" navigation. |
| `apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx` | Collapsed + expand + body + preview + tell-alex affordance + send-as-me + missing-replyable hides chevron + missing-who hides affordances. |
| `apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx` | Per-row open state; filter survives expand. |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | New hook is called; rows-with-preview render. |

### No changes to

- `apps/dashboard/src/hooks/use-agent-activity.ts` — legacy hook stays; deleted at A.6.
- `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` — legacy translator stays; deleted at A.6.
- `apps/dashboard/src/components/activity/event-translator.ts` — feeds the legacy `TranslatedAction.text`; untouched.
- `apps/api/src/services/activity-translator.ts` — feeds the legacy `/api/dashboard/activity` browse view; untouched. The cockpit translator is a sibling.
- `apps/api/src/routes/dashboard-activity.ts` — legacy browse endpoint; untouched.
- `apps/dashboard/src/components/cockpit/kind-meta.ts` — A.4 surfaces the same kinds A.1 already maps; no new kinds.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — Riley does not consume A.4. Riley's activity stream continues to map via the Riley-side translator and emits rows with `preview` undefined.
- `packages/db/prisma/schema.prisma` — no migration.
- Any Riley adapter file.
- The mission / metrics / pipeline / wins / decisions / greeting / readiness API routes — none of them touch the activity stream.

---

## What does NOT ship at A.4

Explicit non-goals — deferred to a later slice or out of Phase A entirely:

- ❌ **Inline-reply send-as-me API wiring.** Per umbrella spec §Out of scope item 9: "the reply box is **not wired to send** in v1 — pressing 'Send as me' routes to `/contacts/[id]` with the thread open." A.4 ships the routing only.
- ❌ **"Tell Alex about {firstName}" inline note-write API call.** Per umbrella spec §Out of scope item 10: routes to `/contacts/[id]?note=open`. No inline note-write endpoint.
- ❌ **Riley `/riley` activity expand.** Riley's spec defers thread previews entirely; Riley's activity stays collapsed-only. Riley's translator emits `preview: undefined` and `replyable: false`, which causes `<ActivityRow>` to hide the chevron.
- ❌ **Composer + command palette.** A.5 ships those. A.4 does not modify `composer-placeholder.tsx`, `topbar.tsx`, or introduce `command-palette.tsx`.
- ❌ **`tag: "+12"` batch-row rendering polish.** The translator emits `tag` for `message.batch_sent` rows, but the visual `+12` chip in the activity-row layout is **deferred** — A.4 ships the data field and an unstyled inline span; visual polish lands as part of A.6's design pass or in a separate ramp.
- ❌ **`TALKING` status state wiring.** Per umbrella spec §Status pill — A.1 ships `IDLE / WORKING / WAITING / HALTED`; the live-conversation `TALKING` variant lands when the backend signal is clean. A.4 does not touch `useCockpitStatusAlex` or `status-pill.tsx`.
- ❌ **New activity kinds.** `ActivityKind` already declares `watching` / `reviewing` / `paused` / `scaled` / `rotated` / `shifted` / `restructured` / `alert`; those are Riley-side and stay declared-but-unused for Alex.
- ❌ **`MessageStore.recent` as a new Layer 4 abstraction beyond preview reading.** The new `ActivityPreviewReader` is purpose-built for the cockpit and reads message bodies; it does **not** become a general "recent messages" reader. If a different consumer needs message history later, it can extend the interface or add a sibling.
- ❌ **Schema changes.** No Prisma migration. No new Zod schemas. The `ActivityRow` shape was declared at A.1 — A.4 is the first slice to populate it.
- ❌ **Cron-side activity-row backfill.** Translator runs on read, every request. No background job, no precomputed cache.
- ❌ **Send-as-me from `/riley` or `/team`.** Same as the inline-reply nonshipping rule; no surface other than the cockpit row consumes this affordance.

---

## Adapter-boundary invariant

The shared invariant from A.1/A.2/A.3 and Riley B.1/B.3 continues to hold:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}`.

A.4 adds **zero** new imports of those types to `components/cockpit/**` or `hooks/use-agent-*`. The new `use-agent-activity-cockpit.ts` consumes the wire shape `{ rows: ActivityRow[] }` returned by the Next.js proxy. The Prisma `ConversationMessage` model is read **only** under `packages/db/src/prisma-activity-preview-reader.ts` — the dashboard never imports it.

Pre-merge grep gate (same as Riley B.1/B.3):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as `main` before A.4 — no new matches. `use-agent-activity.ts` (legacy) is untouched and stays clean.

### Surface-agnostic backend invariant

Per `feedback_surface_agnostic_backend.md`: core/schemas/db must not reference UI surfaces. The new translator lives in `packages/core/src/agent-home/` (Layer 3) and consumes only audit-domain types + the `ActivityPreviewReader` interface + the schemas-package `ActivityRow` type. The Prisma reader lives in `packages/db/src/` (Layer 4) and depends only on `@switchboard/core`. Neither package references `apps/dashboard`. `ActivityRow` is defined once in `packages/schemas` (Layer 1) and consumed by both the translator (core) and the dashboard components — single source of truth, no parallel mirror to drift.

---

## Dependencies

- ✅ A.1 merged — `<ActivityStream>` + `<ActivityRow>` shells live; `ActivityRow` type already declares the superset.
- ✅ A.2 merged (#485, `67eb0618`) — `<EmptyState>` already replaces `<ActivityStream>` in cold-state; A.4 only renders when steady-state, so A.2 is the precondition for the cold/steady-state branching A.4 inherits.
- ✅ A.3 merged (#500, `ed54c4a8`) — `<KPIStrip>` + `<ROIBar>` consume the umbrella spec's metrics aggregator; A.4 is independent (no shared dependency beyond the cockpit page composition).
- ⚠ **Audit ledger shape.** A.4's server-side translator reads `AuditEntry` rows. The existing audit ledger interface (`listAuditEntriesForBrowse`) returns a paginated set with cursor; A.4 uses the same interface (cursor not used at request time — we read top-N). **Mitigation:** the translator is unit-tested against an in-memory fixture; route integration test asserts the wiring.
- ⚠ **`ConversationMessage` per-thread density.** A long-running thread may have hundreds of messages; we read top 4 per contact. **Mitigation:** the Prisma `findMany` uses `take: 4` and the existing `@@index([contactId, orgId])` index; no scan.
- ✅ Riley spec on `main` — no Riley dependency. Riley does not consume A.4.
- ❌ A.5 — does **not** block A.4. A.5 ships composer + palette; activity-row expansion is independent.

---

## Schema-side decisions ratified by this slice

1. **No new persistence.** `ConversationMessage` rows are sufficient. `Audit.snapshot` already carries `contactId` / `displayName` for the event types Alex emits (verified via the existing translator paths). No `Activity` table, no precomputed view.

2. **`ActivityRow` lives in `packages/schemas`, not core or dashboard.** Per the dependency-layer rules in `CLAUDE.md`, `schemas` is Layer 1 and imports nothing. Both `packages/core` (translator) and `apps/dashboard` (components) consume the same Zod-defined type. This eliminates the previous-draft proposal of declaring parallel types in core + dashboard with a compile-time mirror — the mirror approach hit (a) a fragile relative-path import from `apps/api` reaching into `apps/dashboard/src/...`, and (b) a bidirectional union mismatch between core's narrow `from: "contact" | "alex" | "operator"` and dashboard's existing `from: string`. Lifting to schemas is the cleaner single-source-of-truth move.

3. **`from: "contact" | "alex" | "operator"` is the canonical preview-message authorship vocabulary.** `ConversationMessage.direction` ("inbound" | "outbound") maps to `"contact"` (inbound) and `"alex"` (outbound + actor=agent) or `"operator"` (outbound + actor=operator). The reader chooses the label; the translator does not.

4. **`expandPreview` is a server-side switch, not a client-side toggle.** When `expandPreview=false`, the server returns rows with `preview: undefined`. The dashboard's expand affordance still toggles row open state (revealing `body`), but the preview region renders an empty state. This matches the umbrella spec's intent that previews are a render-time amenity, not a separate request flow. **Mitigation:** A.4 hardcodes `expandPreview=true` for the Alex cockpit; the flag exists to support /team-style aggregations later that may not want the preview cost.

5. **Translator runs on read, not on write.** No background job pre-aggregates. The cost is one `findMany` audit query + one batched `findMany` ConversationMessage query per request. At 30s refetch interval and N≤50 audit rows with ≤20 unique contacts, this is well under the API's existing per-request budget.

---

## Risks specific to A.4

1. **N+1 ConversationMessage queries.** Naive translation would issue one `findMany` per audit row. **Mitigation:** the translator collects all unique `contactId` values across the row set, issues **one** `previewReader.readRecentBatch({ contactIds, orgId, limit })`, and groups results in memory. The Prisma impl issues `findMany({ where: { contactId: { in: [...] }, orgId }, orderBy: { createdAt: "desc" } })` and groups by `contactId` post-fetch. The translator test asserts a single batch call for a 9-contact fixture.

2. **Audit snapshot variance.** Different event types stash `contactId` under different snapshot keys (`snapshot.contactId`, `snapshot.contact.id`, `snapshot.entityId` when `entityType=Contact`). **Mitigation:** the `contact-snapshot-extractors.ts` module owns per-kind extractors; each is unit-tested against a fixture matching the actual emitted shape. Unknown event types return `null` and the row renders without `who` / `contactId`.

3. **Preview author labeling drift.** `ConversationMessage.direction` does not distinguish "Alex wrote outbound" vs "operator wrote outbound". **Mitigation:** the Prisma reader checks `metadata.author` if present (set by the message-emitter when an operator takes over a thread); when absent, outbound defaults to `"alex"`. This matches today's behavior — operator takeovers are rare and explicitly logged.

4. **Activity-row stable key.** Today's stream uses `${row.time}-${row.head}-${i}` as the React key (verified at `activity-stream.tsx:76`: `key={\`${row.time}-${row.head}-${i}\`}`), which breaks when the same head is emitted twice with the same time. **Mitigation:** A.4 adds an optional `id: string` field to the wire shape (`auditEntry.id` passed through). The component falls back to the legacy key when `id` is missing.

5. **Expand state survives refetch.** TanStack Query refetches every 30s. The activity-stream's `Set<string>` open-state must survive a refetch that returns the same row with the same id. **Mitigation:** the stream uses `auditEntry.id` (now passed through) as the open-state key, not the array index.

6. **`<ThreadPreview>` and small viewports.** Operators may use the cockpit on a narrow window. **Mitigation:** the component uses the same `74rem` content-width constraint as the rest of the cockpit; preview text wraps; "Send as me" stays full-width on narrow viewports.

7. **Honest-impact language carryover.** Body copy renders authored snapshot text. **Mitigation:** the translator copy-templates ship locked strings (e.g., `"Calendar held."` for booked-row body) — no causal-impact phrasing. The plan's copy table is reviewed alongside the engine-side toast table from B.3.

8. **`/contacts/[id]?takeover=true` route handling.** That route handler must respect the `takeover=true` query and open the thread with operator-takeover mode. **Mitigation:** the existing `/contacts/[id]` page already accepts a `takeover` query param via the `/api/dashboard/agents/[agentId]/decisions` flow — A.4 only ships the link; the handler is verified-stable.

9. **Cross-org PII leak via `contactId` collision.** The translator derives `contactId` from snapshot data (operator-influenced indirectly via Alex's emit sites). If a `contactId` value ever appears in two different orgs' snapshots, a misaligned preview-reader query could return the wrong org's messages. **Mitigation:** the audit query in `cockpit-activity-deps.ts` filters `where: { organizationId: orgId, ... }` (every audit entry is scoped to the requesting org at the entry layer, before snapshot parsing); the preview reader independently scopes by `orgId` in its `ConversationMessage.findMany` where clause. Two-layer defense — the snapshot-derived `contactId` is treated as untrusted and must intersect both the org-scoped audit set AND the org-scoped message set to surface. A route integration test asserts an audit entry with a `contactId` belonging to another org returns rows with `preview: []`.

10. **`agentRole` filter convention divergence.** The legacy hook at `apps/dashboard/src/hooks/use-agent-activity.ts:44` reads `agentRole` from `snapshot.agentRole`, defaulting to `"unknown"`; the cockpit page filters `agentRole === "alex" || "unknown"`. The legacy server-side translator at `apps/api/src/services/activity-translator.ts:25-31` maps `actorId === <uuid>` to `"Alex"`. A naive `where: { actorId: "alex" }` filter on the new endpoint will miss entries with UUID `actorId` and entries that today rely on `snapshot.agentRole === "alex"`. **Mitigation:** the translator filters in TS, not Prisma: query by `actorType === "agent"` only, then in-memory filter by `(actorId === agentKey) || (snapshot.agentRole === agentKey) || (UUID_PATTERN.test(actorId) && agentKey === "alex")`. The translator test ships three explicit cases — `actorId` literal match, `snapshot.agentRole` match, UUID-actorId fallback — to lock the convention.

---

## Test contract

- **Core tests** (Vitest, `packages/core`): per-kind translation, batched preview fetch, expandPreview short-circuit, missing-contactId fallback, snapshot-extractor coverage.
- **DB tests** (Vitest, `packages/db`): mocked-Prisma single + batch reads, ordered desc, empty-result handling.
- **API tests** (Vitest, `apps/api`): route happy path + limit clamping + agent-scope filter + expandPreview off.
- **Dashboard hook tests** (Vitest, `apps/dashboard`): query-key, refetch, error mapping.
- **Dashboard component tests** (Vitest + Testing Library): thread-preview rendering + navigation; activity-row collapsed/expanded/affordances; activity-stream open-state + filter survival; cockpit-page wiring.
- **Pre-merge grep gate:** no new `Recommendation|AuditEntry|@switchboard/db|@prisma` imports under `components/cockpit/**` or `hooks/use-agent-*` (excluding the new `use-agent-activity-cockpit.ts` which imports neither).
- **Build gate:** `pnpm --filter @switchboard/dashboard build` clean (per `feedback_dashboard_build_not_in_ci.md` — dashboard `next build` is not in CI; the executor runs it locally).
- **Single source of truth:** `ActivityRowSchema` lives in `packages/schemas/src/cockpit-activity.ts`; core's translator, the API route response, and the dashboard's component types all import the same type. No compile-time mirror assertion is needed — the type is shared, not parallel.

- `pnpm typecheck`, `pnpm lint`, `pnpm test --filter @switchboard/core --filter @switchboard/db --filter @switchboard/api --filter @switchboard/dashboard`, `pnpm --filter @switchboard/dashboard build` all clean.

---

## What comes after A.4

- **A.5 — Composer + command palette.** Ships `parse-command.ts`, `command-palette.tsx`, `composer.tsx` with staging + Confirm/Undo, `⌘K` keyboard shortcut, `ALEX_COMMANDS` catalog, pause/resume/halt wired to local `HaltProvider`. Independent of A.4.
- **A.6 — Retirement + cleanup.** Deletes the legacy `agent-home-client.tsx` + `*-block.tsx` files after zero-reference verification. At that point the legacy `use-agent-activity.ts` + `activity-kind-map.ts` lose their last consumer and are also deleted. A.6 is the first slice where A.4's hook becomes the sole activity data path.
- **Riley B.3-followup** — Unaffected by A.4. Will wire `RILEY_COMMANDS` to the shared `<CommandPalette>` after Alex A.5 ships.
- **Inline-reply send-as-me wiring** — Post-Phase-A ramp. Reuses the `<ThreadPreview>` component A.4 ships; only the "Send as me" handler swaps from a route push to an `fetch("/api/dashboard/contacts/[id]/messages", { method: "POST" })` call.
- **`TALKING` status state** — Post-Phase-A. Backend signal cleanup (per umbrella spec §Status pill) is the precondition; the activity stream is unaffected.

---

## Spec-conflict resolution

If anything in this slice brief expands A.4's scope beyond the umbrella spec — new activity kinds, server-side filters, new mutation paths, inline-send wiring, Riley preview wiring — the umbrella spec wins and the conflicting text here is wrong. Resolve in favor of `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` and flag the discrepancy.
