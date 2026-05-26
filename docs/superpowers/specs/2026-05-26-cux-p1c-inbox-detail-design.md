# CUX P1-C — Inbox detail drill-in (v2) Design

**Status:** approved for planning · **Date:** 2026-05-26 · **Scope:** frontend-bounded

## Goal

Make the `/inbox` queue fully interactive: tapping a decision card opens a rich **detail drill-in**, with two variants chosen by `decision.kind` — an **approval detail sheet** and a **handoff detail sheet** — built from the v2 Claude-Design bundle, wired to data the backend provides **today**, degrading gracefully where data is absent. This also includes the inbox **screen wiring** so the PR2 cards/filter/empty-error components actually render and the sheets have somewhere to open from.

This supersedes the original P1-C plan's **Task 4** (detail panel) and **Task 5** (separate takeover sheet) — the v2 design **consolidates the takeover composer into the handoff detail sheet** — and absorbs **Task 7** (InboxScreen + page wiring).

## Source of visual truth

The v2 bundle (`erJcM7zHV2ySRcgVh1WnRQ`, primary file `Switchboard Inbox v2.html`), extracted to `/tmp/sbinboxv2/switchboard/project/inbox-v2/`:

- `detail-approval.jsx` — `ApprovalDetailSheet` + inline `ConfirmInline` + `AlreadyHandledBanner`.
- `detail-handoff.jsx` — `HandoffDetailSheet` + `HandoffSkeleton` + `HandoffFetchError`.
- `components.jsx` — helpers: `relativeTime`, `dueIn`, `undoableFor`, `riskChips(contract)`, `RiskPill`. (The card revision in this file is **out of scope** — we keep the PR2-shipped `InboxDecisionCard`.)
- `inbox.css` — `ds-*` / `sheet` / `risk-pill` / `risk-chip` rules to port.

Match the visual output; do **not** copy the `window.SBInbox` global-script structure. Field names mostly match the real contract — adjust per the **correctness traps** below.

## Scope decisions (locked with the user)

1. **Option 1** — the detail sheets are the next slice ("PR3"); leave the merged PR2 cards as shipped.
2. **Frontend-bounded** — wire to existing endpoints; render real data where present and degrade where absent. No backend changes unless wiring hits a true blocker (then stop and report the exact blocker, do not expand scope).
3. **Build the handoff sheet now** (PR3b), degrading gracefully — the lead-snapshot / where-it-stands sections render empty today and auto-populate once backend follow-up #2 lands; the live conversation thread + composer + reply/resolve work now.
4. **Approval "what this changes" stays the honest placeholder** ("preview not yet wired"). Do **not** fetch the recommendation row for `confidence`/`dollarsAtRisk` in this work — that goes to backend follow-up #1.

## Backend reality (audit 2026-05-26)

`GET /api/escalations/:id`, `POST /:id/reply`, `POST /:id/resolve`, and `POST /api/recommendations` all exist and are org-scoped. The dashboard **already** has proxy routes (`app/api/dashboard/escalations/[id]/route.ts` GET, `/reply`, `/resolve`; `recommendations/route.ts`) and client methods (`getEscalation`, `replyToEscalationRaw`, `resolveEscalation` in `lib/api-client/governance.ts`). **No new proxy route or client method is needed** — the only missing client piece is a `useEscalationDetail(id)` query hook (the reply hook `use-escalation-reply.ts` already exists).

### Field-by-field verdict

**Approval detail (composed from the `Decision`; commit via recommendations):**

| Field | Verdict | Note |
| --- | --- | --- |
| `humanSummary` | WIRE | always a real sentence |
| `presentation.{primary,secondary,dismiss}Label` | WIRE | real per-action labels |
| `meta.riskContract` (5 fields) | WIRE | populated for approvals; drives `riskChips` + `RiskPill` |
| `createdAt` | WIRE | ISO string |
| `presentation.dataLines` | DEGRADE | **`string[][]`, not `string[]`** for Riley recs; `[]` otherwise — render defensively, hide when empty |
| `meta.undoableUntil` | DEGRADE | **absent on queue-surface (inbox) approvals** → only show the "undoable for Xm" line if present |
| `meta.contactName` | DEGRADE | `undefined` for current producers (Riley sets campaign targets, no contact) |
| `threadHref` | DEGRADE | `null` for current producers → render "View conversation" only when non-null |
| before/after · impact · $-at-risk · confidence · structured financials | DEFER | not on the Decision; honest placeholder this PR (follow-up #1) |

Commit path: `POST /api/dashboard/recommendations { recommendationId: sourceRef.sourceId, action, note? }` — **`note` is persisted** (column + audit snapshot). `409` = already-terminal/expired/undo-window-closed → treat as silent success (existing `use-recommendation-action` behavior). The optional **audit note** in the inline confirm wires through `note`.

**Handoff detail (`GET /api/escalations/:id` → `{ escalation, conversationHistory }`):**

| Field | Verdict | Note |
| --- | --- | --- |
| `reason` (enum) | WIRE | always set; map via reason → label table |
| `status`, `slaDeadlineAt`, `createdAt` | WIRE | always present |
| `acknowledgedAt`, `resolvedAt`, `resolutionNote` | DEGRADE | null until acted; `POST /resolve` sets `resolvedAt` + `resolutionNote` |
| `conversationHistory` turns | DEGRADE | **live thread** from conversationState; renders today |
| `leadSnapshot` (name/phone/email/serviceInterest/source/leadId) | DEFER-data | producers set only `channel` → mostly empty (follow-up #2) |
| `qualificationSnapshot` (stage/score/signals) | DEFER-data | defaulted "unknown"/no score (follow-up #2) |
| `conversationSummary` (turnCount/keyTopics/objectionHistory/sentiment/suggestedOpening) | DEFER-data | assembled from empty `messages` → empty/generic; `suggestedOpening` optional (follow-up #2) |

Mutations: `POST /:id/reply { message }` → `200 { escalation, replySent:true }` or **`502 { escalation, replySent:false }`** (no session OR delivery failed) — reply IS persisted on 502, surface the "saved — couldn't deliver right now" branch (existing `use-escalation-reply` 200/502 split). `POST /:id/resolve { resolutionNote? }` → 200.

### Correctness traps (MUST bake into implementation + tests)

1. Conversation turns use **`text`**, not `content`; role **`"user"`** is the lead (not `"lead"`), **`"owner"`** is the operator. Tolerate unknown roles. `timestamp` is present (ISO).
2. Approval `presentation.dataLines` is **`string[][]`** — flatten/join per line; hide when `[]`.
3. `meta.undoableUntil` is **absent** on inbox approvals — gate the undoable affordance on presence.
4. `meta.contactName` / `threadHref` are **null** for current producers — render contact / "View conversation" only when present.
5. `confidence` / `dollarsAtRisk` are on the raw recommendation row, **not** the `Decision` — do not surface them here.

## Architecture

### New components (`apps/dashboard/src/components/inbox/`)

- **`approval-detail-sheet.tsx`** — composed entirely from the `Decision` (no fetch). Sections: header (avatar · "needs your okay" · `RiskPill` · "proposed {relativeTime}" · `undoableFor` when present); proposal (`humanSummary` + defensive `dataLines` + contact strip when present); **"What this changes" honest placeholder**; **risk chips** from `riskContract` (plain-English via `riskChips`); "View conversation" link only when `threadHref`; docked action row (dismiss / secondary / primary). Primary opens an **inline confirm step** (`ConfirmInline`, with optional audit note) when `needsConfirm` (absent contract OR `requiresConfirmation`), else commits directly. Optional `AlreadyHandledBanner` for terminal/expired local state.
- **`handoff-detail-sheet.tsx`** — fetches via `useEscalationDetail(sourceRef.sourceId)`. `isLoading` → `HandoffSkeleton`; `isError` → `HandoffFetchError` (retry). On data: header (agent · "is handing this to you" · reason chip · SLA); "The lead" (leadSnapshot card — degrades when empty); "Where it stands" (tone/turns/topics/objections + "Start with this" suggested opening — all render-if-present); "Conversation" (live thread, recent-first, expand earlier — uses `text`/`user`-role mapping); reply composer ("Send & hand back to {agent}") via `useEscalationReply` (200/502 branch); "Mark resolved" (collapsible note → resolve dispatch).
- **`inbox-screen.tsx`** + thin `app/(auth)/inbox/page.tsx` — owns `useDecisionFeed`, `agentFilter`, detail open-state `{ decision, kind } | null`, and toasts. Renders `InboxFilterRow` + queue of per-card `InboxDecisionItem` (each owns its own `useRecommendationAction(sourceRef.sourceId)` — no hooks in a loop), `InboxEmptyState`/`InboxErrorState` (**isError checked before empty** — P0-A regression guard), and mounts the detail sheet by `kind`. **PR3a constraint:** the screen mounts `ApprovalDetailSheet` for `kind === "approval"` only; the `kind === "handoff"` branch is a **minimal guard** (a small "handoff detail coming next" dev/test-visible placeholder, or no-op) — PR3a must **not import or reference `HandoffDetailSheet`** or any escalation fetch. PR3b replaces the guard with the real handoff branch. This keeps PR3a reviewable as approval + screen wiring only and prevents half-stubbing PR3b.

### New hook + helpers

- **`hooks/use-escalation-detail.ts`** — `useQuery` against the existing `GET /api/dashboard/escalations/[id]` proxy (returns `{ escalation, conversationHistory }`). Mirror `use-decision-feed` shape (scoped query keys, `enabled`).
- **`lib/decisions/`** — port `riskChips(contract)` and `undoableFor(iso, nowMs)` alongside the PR2 `relativeTime`/`dueIn`, with co-located tests.

### Mutation & fetch ownership

`InboxScreen` owns feed/filter/open-state/toasts. The per-card wrapper (`InboxDecisionItem`) owns the per-card `useRecommendationAction(sourceRef.sourceId)` for list-level swipe/tap commits (no hooks in a loop). The detail sheets are **presentational for mutations** — they receive `onCommit`/`onReply`/`onResolve` callbacks; the screen wires those to the action hooks for the single open decision (one hook instance, not in a loop). The **handoff sheet additionally owns its own read query** (`useEscalationDetail`) — fetch-on-open is local to the sheet since it is a single mounted instance, not list-iterated. The approval sheet owns only its inline-confirm local state (`confirming`, `note`).

## PR structure

Two sequenced PRs off merged `main`, subagent-driven (implementer → spec-compliance review → code-quality review per task), built in a **fresh session** off a fresh worktree.

- **PR3a — screen wiring + approval sheet (real data first):** `inbox-screen.tsx` + thin `page.tsx`, `approval-detail-sheet.tsx` (+ `ConfirmInline`, `AlreadyHandledBanner`), `riskChips`/`undoableFor` helpers, approval-sheet CSS module. **The handoff branch is a minimal guard only — no `HandoffDetailSheet`, no `useEscalationDetail`, no escalation fetch in PR3a** (see screen-wiring constraint above). Invariant: Home + PR2 suites stay green; isError-before-empty held; a handoff card tap does not crash and does not commit anything.
- **PR3b — handoff sheet:** `handoff-detail-sheet.tsx` (+ skeleton/error), `use-escalation-detail.ts` hook, reply (200/502) + resolve wiring, handoff-sheet CSS. Degrades to reason + SLA + status + live thread + composer when snapshots are empty.

## Known divergences (flag, do not fix here)

- Tap-Approve on the **card** routes through PR2's modal `ConfirmSheet`; the **detail sheet** uses the v2 **inline** confirm. Two confirm surfaces, each correct for its context — note for a later reconciliation rather than re-touching merged PR2 code.

## Testing

TDD, co-located `*.test.tsx`, real behavior (RTL):

- Approval sheet: composes from a `Decision`; inline-confirm gate (direct commit when safe, confirm step when `needsConfirm`/absent contract); `dataLines` `string[][]` rendered + hidden when empty; risk chips from contract; no dead "View conversation" when `threadHref` null; undoable line only when present; commit calls `useRecommendationAction` with optional note; 409 = silent.
- Handoff sheet: renders from a mocked `{ escalation, conversationHistory }`; loading/error/retry states; thread uses `text` + `user`→lead / `owner`→operator mapping + `relativeTime(timestamp)`; degrades when leadSnapshot/summary empty; composer send 200 + 502 branch; resolve sets the note.
- Screen: feed → filter → detail open by `kind`; isError before empty; Home + PR2 suites unchanged.

## Backend follow-ups discovered (OUT OF SCOPE — capture only)

Not implemented in this work. If wiring hits a true blocker, stop and report it instead of expanding scope.

1. **Approval enrichment fields** — before/after, expected impact, dollars-at-risk, confidence/evidence, structured financial details on the `Decision` (today only on the raw recommendation row; not carried by the feed adapter).
2. **Handoff payload hardening** — normalize/type the `conversationHistory` turn shape (`{role,text,timestamp}` raw JSONB today); consistently populate `leadSnapshot` (name/phone/email/serviceInterest/source/leadId) at escalation time across channels (whatsapp/skill/web all stub it); pass real `messages` into the assembler so `conversationSummary`/`turnCount`/topics are meaningful; guarantee `suggestedOpening` is present and owner-safe; verify SLA + acknowledged/resolved state handling.
3. **Decision contract extensions** — richer `dataLines` (typed, not `string[][]`); explicit contact-summary object; acted/expired state on the `Decision` (today only `status:"pending"` rows are listed; terminal state lives on the raw row); thread-availability metadata beyond `threadHref`.

## Out of scope

- The v2 `DecisionCard` editorial refinements (kind word, risk-pill placement, foot affordances) — keep the merged PR2 card.
- Any backend change (the three buckets above).
- The two-confirm-surface reconciliation.
