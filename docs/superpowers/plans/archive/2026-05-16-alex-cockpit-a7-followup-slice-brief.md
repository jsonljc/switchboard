# Alex Cockpit A.7 Follow-up — Critical-Bug Sweep (Slice Brief)

**Date:** 2026-05-16
**Parent spec:** [Alex Cockpit Home — Design Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Acceptance criteria 5, 6 — silently unmet by A.1–A.6)
**Predecessor slices:**

- A.1 — `feat(cockpit): A.1 shell + basic Alex composition` (shipped)
- A.2 — `feat(cockpit): A.2 mission popover + Day-1 narrator + setup checklist` (#485, squash `67eb0618`)
- A.3 — `feat(cockpit): A.3 — KPI strip + ROI bar on /alex` (#500, squash `ed54c4a8`)
- A.4 — `feat(cockpit): A.4 — activity richness + thread previews` (#529, squash `c3ee595d`)
- A.5 — `feat(cockpit): A.5 — composer + command palette on /alex` (#542, squash `5a4fe7dc`)
- A.6 — `refactor(cockpit): a.6 — retirement + cleanup (closes Alex Cockpit Phase A)` (#550, squash `4ec91ccf`)

---

## Why A.7 lands now

Phase A is "feature complete" on paper — every input and output affordance the umbrella spec calls for is on disk. A holistic code review run 2026-05-15 against `main` at `4ec91ccf` (covering A.1 through A.6, ~11,761 LOC delta) walked all 16 acceptance criteria and found **four Critical issues** that silently break operator-facing functionality in production:

1. **`metrics.ts:51-52` agentRole lookup bug.** The dashboard's `/api/dashboard/agents/:agentId/metrics` route looks up `AgentRoster` by `agentRole: agentId`, but `agentId` is `"alex"` / `"riley"` while `AgentRoster.agentRole` values are `"responder"` / `"optimizer"`. `rosterRow` is always `null`, so `getAgentTargets({ config: {} })` always returns `{ avgValueCents: null, targetCpbCents: null }`. Both agents' ROI bars always show the degraded "Set average booking value…" hint. Riley's CPL comparator pill always shows `target: "—"`.

2. **`cockpit-page.tsx:138-142` approval Accept/Decline buttons are inert.** The empty stub left over from A.1 was never wired. A.5 claimed to deliver it (per `[[alex-cockpit-a5-shipped]]`); it didn't. Operators on `/alex` click Accept on an approval card → no toast, no card removal, no API call. Acceptance criterion 6 silently unmet.

3. **`legacy-pending-approval-to-approval-view.ts:19-21` hardcodes `kind = "pricing"`.** Every approval — pricing, refund, escalation, regulatory (medical claims!), safety-gate, qualification — renders as a generic "pricing" card. The urgency-colored eyebrow and primary CTA copy are wrong for 5 of 6 kinds. The umbrella spec's strongest differentiation point (medical-regulatory red urgency) is unreachable. Acceptance criterion 5 silently unmet.

4. **`cockpit-page.tsx:67-69` Alex approvals aren't sorted by urgency.** The dashboard `.map(...)` step omits the sort. Riley sorts in `recommendation-to-approval-view.ts:184-192` (`URGENCY_ORDER` then dollarsAtRisk). Alex doesn't. A pending `refund` (immediate) can render _below_ an older `pricing` (this_week). Operators see urgency wrong.

All four bugs were re-verified against current `main` at brief-write time (2026-05-15, post #551 `7bbd270f`):

- `apps/api/src/routes/agent-home/metrics.ts:51-54` — bug present, `agentRole: agentId` still on disk; the canonical fix pattern lives at `apps/api/src/routes/agent-home/mission.ts:253` (`const rosterRole = agentId === "alex" ? "responder" : "optimizer";`).
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx:138-142` — bug present, empty stub with original A.1 comment still on disk.
- `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts:19-21` — bug present, `inferKind` returns the hardcoded `"pricing"` literal.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx:67-69` — bug present, the `.map(...).sort(...)` step is `.map(...)` only.

A.7 is the **bug-sweep slice**: every change closes a Critical that was silently shipped during Phase A. No new features. No new surface. Per `[[ship-clean-not-followup]]`: these gaps are real follow-up debt that should have been caught pre-merge — A.7 is the sober reminder that they are still production debt today.

### Downstream consumers

- **Riley cockpit** — Touched by A.7a only. The metrics-route fix flips Riley's ROI bar from always-degraded to fully-populated (Riley spec'd this comparator in B.2b). Riley's own approval-respond wiring + row-extraction landed in B.3-followup (#548) + reviewer cleanup (#551) — `RileyApprovalRow` already lives inline in `riley-cockpit-page.tsx:44-81`, and §"Important findings" below proposes A.7b extract Alex's twin to `lib/cockpit/alex/`. The Riley row may opportunistically be extracted to `lib/cockpit/riley/` at the same time; the brief flags this as a `B.3-cleanup-tag-along` (see §Design Decisions §6).
- **Wave B / Riley emitter** — Unaffected. The cockpit-side bugs are independent of the recommendations emitter pipeline.
- **`/contacts`, `/automations`, `/reports`** — Unaffected by A.7. The bugs are localized to the cockpit surface and the agent-home metrics route.

---

## Slice goal

Close all four Critical bugs identified by the 2026-05-15 holistic review before any further ramps (post-Phase-A workstreams like `brief`/`followup` cron, `pausedUntil` auto-resume, `TALKING` status pill). Operators on `/alex` must be able to (a) see real ROI numbers, (b) click Accept/Decline on an approval card and see it dispatch + dismiss, (c) see correct urgency + copy per approval kind, and (d) see approvals sorted urgency-first.

One sentence: **A.7 fixes the four silent-production bugs left over from Phase A.**

---

## Slicing decision — Option A (bundled) vs Option B (three sub-slices)

The Critical findings memo (`[[alex-cockpit-a7-followup-scope]]`) proposes two paths. This brief locks **Option B (three sub-slices)**. Rationale:

- **A.7a (1-line metrics fix + missing test + sort)** is mechanical and ships immediately. Operators see real ROI numbers within hours of merge, on both `/alex` and `/riley`. Bundling it inside a 600–800 LOC review just delays the highest-leverage fix.
- **A.7b (approval respond wiring + row extraction)** is medium-sized and mostly mechanical — it imports an already-shipped hook (`useRespondToApproval` at `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts:100`) into the cockpit page, adds a single-owner toast dispatcher, optimistically dismisses, and extracts an `AlexApprovalRow` to `lib/cockpit/alex/` mirroring Riley's `RileyApprovalRow`. Independent of A.7c's schema work.
- **A.7c (six-kind classification + schema additions + adapter rewrite)** is the largest piece — it spans `apps/api/src/routes/approvals.ts` (wire-shape projection), `apps/dashboard/src/lib/api-client-types.ts` (typed wire shape), the dashboard adapter (`legacy-pending-approval-to-approval-view.ts` → `rich-pending-approval-to-approval-view.ts`), and the emitter sites in `packages/core/src/skill-runtime/{tool-result.ts, hooks/{deterministic-safety-gate,claim-classifier}.ts}` plus the qualification/refund/escalation sites. The blast radius warrants a focused review.

Bundling = one review burden, but a defect in A.7c gates A.7a (mechanical + already-tested fix) from shipping. Sliced = three reviews, partial ramp, A.7a in production within a day. The discipline matches A.3/A.4/A.5/A.6's one-focused-slice-per-PR cadence (memory: `[[alex-cockpit-a6-shipped]]`, `[[alex-cockpit-a5-shipped]]`, `[[alex-cockpit-a4-shipped]]`, `[[alex-cockpit-a3-shipped]]`). The Riley-cockpit B.2a 3-PR chain (`[[riley-cockpit-b2a-shipped]]`) is the closest precedent for chaining small slices with a shared theme.

**Three sub-slices, three PRs:**

| Sub-slice | Critical(s) fixed                                 | Approx scope                                                                                          | Ships when                            |
| --------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **A.7a**  | #1 (metrics agentRole) + #4 (Alex approvals sort) | 1 file modified + 1 test added + adapter sort + 1 test added (~50 LOC)                                | First — within hours of brief landing |
| **A.7b**  | #2 (approval respond wiring)                      | Cockpit page edit + new `AlexApprovalRow` in `lib/cockpit/alex/` + dispatcher + tests (~200 LOC)      | After A.7a, independent track         |
| **A.7c**  | #3 (six-kind classification)                      | Wire-shape addition + server-route projection + new rich adapter + emitter updates + tests (~600 LOC) | Last; biggest review                  |

PRs ship to `main` independently. A.7a does not block A.7b or A.7c; A.7b does not block A.7c. They may merge in any order once each is reviewed-green.

---

## Per sub-slice scope

### A.7a — `metrics.ts` agentRole fix + Alex approvals sort

**Critical fixed:** #1, #4.

**Why this pair sits together:** Both are mechanical, both are 1-PR-quality, neither depends on schema additions or new components. Pairing them gets two Criticals out of the way in the smallest possible PR.

**Files modified (3):**

- `apps/api/src/routes/agent-home/metrics.ts` — replace the buggy `agentRole: agentId` lookup with the canonical `agentRole: rosterRole` pattern from `mission.ts:253`.
- `apps/api/src/routes/agent-home/__tests__/metrics.test.ts` — add a test case that seeds an `AgentRoster` row with `agentRole: "responder"` + `config: { avgValueCents: 17900, targetCpbCents: 3000 }` and asserts the response surfaces those targets via `getAgentTargets`. The bug is uncovered by tests today (every existing case passes `prisma=null`).
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` — add a `.sort(...)` step after the `.map(...)` at line 67-69. Sort key: `URGENCY_ORDER[urgency]` ascending, then `createdAt` descending within band (matches spec §Card sort order: immediate → this_week, then createdAt desc within band).

**Files modified (1 test):**

- `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` — add a fixture of three approvals with mixed urgencies and assert post-adapter order is `[immediate, this_week, this_week]`.

**Files explicitly NOT touched at A.7a:**

- `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts` — its `urgencyForRisk` is correct as written; the bug is at the **caller** (no sort step). A.7c may rename this file when the rich adapter lands; A.7a does not.
- `apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts` — Riley already sorts (line 184-192). The sort pattern is copied **shape-only** (Alex doesn't have `risk`-as-dollars; the within-band tiebreak is `createdAt desc`, not `dollarsAtRisk`). The Riley sort utility is intentionally not extracted to a shared helper — premature abstraction; per `CLAUDE.md` §Code Basics: "No premature abstractions — check existing utils first; >3 new files needs justification." Two callsites is not three.
- Anything under `packages/**` — no schema change. The metrics-route bug is a 1-line app-level fix.
- Riley-side `cockpit-page` — Riley already maps via `mapRecommendationsToApprovalViews` which sorts internally. No Riley change required.

**Tests:**

- New: `metrics.test.ts` seeds `agentRole: "responder"` row, asserts `getAgentTargets` returns the configured `avgValueCents` / `targetCpbCents`. Symmetric case for `agentRole: "optimizer"` (Riley).
- New: `cockpit-page.test.tsx` fixture of three approvals (`immediate`, `this_week`, older `this_week`), assert post-adapter order.
- Regression: no other test should change. If a snapshot moves, investigate — the only intentional change is metric values flipping from "degraded" to "populated" inside fixtures that previously asserted degraded copy.

**Acceptance:**

- `/api/dashboard/agents/alex/metrics` and `/api/dashboard/agents/riley/metrics` return populated `targets` when an `AgentRoster` row exists with `config` set. Empty config still degrades gracefully.
- `/alex` renders a populated ROI bar (booking value + on-target comparator) when targets are configured. Riley's CPL comparator pill shows the configured target.
- `/alex` approvals render in urgency order (`immediate` → `this_week` → `next_cycle`), then `createdAt desc` within band.

---

### A.7b — Approval respond wiring + row extraction

**Critical fixed:** #2.

**Why this slice is bounded here:** Wiring `useRespondToApproval` into the cockpit page is the bare-minimum bug-fix. The reviewer also flagged Riley's `RileyApprovalRow` (`riley-cockpit-page.tsx:44-81`) as embedding an audit-domain hook inside a shell component (an adapter-boundary smell). A.7b lands the matching fix on the Alex side (extract `AlexApprovalRow` to `lib/cockpit/alex/`) so both surfaces follow the same boundary. Per Design Decision §6, Riley's row may opportunistically be extracted in the same PR; brief flags this as optional tag-along, not required.

**Files created (2):**

- `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx` — new component, mirrors `RileyApprovalRow` shape. Owns the `useRespondToApproval` mutation, the optimistic-dismiss state, the single-owner toast. Receives an `AlexApprovalView` + `idx` + `total` + an optional `onResolved` callback for parent-side bookkeeping (e.g., refetch).
- `apps/dashboard/src/lib/cockpit/alex/__tests__/alex-approval-row.test.tsx` — tests Accept dispatches `mutate({ id, action: "approve", bindingHash })`, Decline dispatches `mutate({ id, action: "reject" })`, error path keeps the card visible, success path hides + toasts.

**Files modified (2):**

- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` — remove the empty stub at 138-142. Replace the `<ApprovalBlock data={approvals} onResolve={...stub...}>` with a sequence of `<AlexApprovalRow approval={a} idx={i} total={approvals.length} />` mirroring Riley's pattern at `riley-cockpit-page.tsx:177-184`, OR keep `<ApprovalBlock>` as the layout container if its responsibilities make sense to retain (decided at implementation time per §Design Decision §5).
- `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` — drop the now-obsolete "approval Accept/Decline silently no-op" assertion (if any); add an integration smoke that `<AlexApprovalRow>` is rendered for each approval row.

**Files explicitly NOT touched at A.7b:**

- `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts` — its `primaryAction` already correctly emits `{ kind: "respond", bindingHash, verdict: "accept" }`. The bug is at the consumer site (empty stub), not at the adapter.
- `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts` — `useRespondToApproval` is already shipped and tested (`__tests__/use-respond.test.tsx`). A.7b imports it; no edits.
- `packages/schemas/**` — the wire shape stays. A.7c is the schema-additions slice.
- Riley-side `riley-cockpit-page.tsx` — opportunistic extraction is allowed per §Design Decision §6 but not required. If extraction happens, it lands in the same PR with its own tests.

**Toast doctrine:** Per `[[riley-b3-followup-shipped]]` ("single-owner-toast doctrine") and `[[alex-cockpit-a5-shipped]]` ("toast-boundary lock"), the toast is dispatched from inside `AlexApprovalRow` (the audit-domain owner), not from `cockpit-page.tsx`. `useToast` is consumed by the row, not by the page. The Riley pattern at `riley-cockpit-page.tsx:53-69` is the template — copy with care: Alex uses `useRespondToApproval` not `useRecommendationAction`, and the verdict shape is `"approve" | "reject"` (action), not `"accept" | "decline"` (verdict). The row's internal `onResolve(verdict)` signature stays the user-facing `"accept" | "decline"` for parity with the `ApprovalCard` interface; the row translates to the mutation's `action: "approve" | "reject"` at the call site.

**Verdict-to-action mapping (lock this at brief-time):**

- User clicks `Accept` → row's `onResolve("accept", idx)` → mutate `{ id: approval.id, action: "approve", bindingHash: approval.primaryAction.bindingHash }`.
- User clicks `Decline` → row's `onResolve("decline", idx)` → mutate `{ id: approval.id, action: "reject" }` (no `bindingHash` for reject per `use-approvals.ts:113`).
- `approval.primaryAction.kind === "internal"` (escalation/handoff variants) → route per `intent` rather than mutate. A.7b ships only the `kind: "respond"` branch; `kind: "internal"` is **handled but routed through `useAlexActionDispatcher`** with the existing `dispatch` function from the cockpit page. If the dispatcher doesn't already cover the specific intent, A.7b adds a stubbed `console.warn` and a TODO referencing A.7c.

**Tests:**

- New: row Accept dispatches `mutate({ id, action: "approve", bindingHash })`.
- New: row Decline dispatches `mutate({ id, action: "reject" })`.
- New: error path (mutation throws) keeps the card visible — no optimistic hide.
- New: success path hides + toasts (single-owner; toast count = 1).
- New: page-level smoke — three approvals render three rows.

**Acceptance:**

- Operator clicks Accept on `/alex` approval card → mutation fires, card disappears optimistically, success toast renders. Network failure → card stays visible, error toast.
- Operator clicks Decline → same with `action: "reject"`.
- `RileyApprovalRow`-like row component now lives at `lib/cockpit/alex/alex-approval-row.tsx`; no audit-domain hook (`useRespondToApproval`) imports remain inside `apps/dashboard/src/components/cockpit/cockpit-page.tsx`.

---

### A.7c — Six-kind classification (schema + emitters + adapter)

**Critical fixed:** #3.

**Why this is the biggest slice:** It crosses three packages (`packages/schemas`, `packages/core`, `apps/api`, `apps/dashboard`), touches every approval-emission site, and adds a new richer adapter. Splitting the writers from the readers risks a half-cutover state where the wire shape claims `kind: "regulatory"` but no emitter writes it; bundling them ensures the cutover is single-PR-atomic.

**Files created (2):**

- `apps/dashboard/src/lib/cockpit/rich-pending-approval-to-approval-view.ts` — new adapter that reads `payload.kind`, `payload.body`, `payload.quote`, `payload.quoteFrom` from the wire shape (now populated by the server-route projection in this same slice). Falls back to `legacyPendingApprovalToApprovalView` when `payload.kind` is absent (older approvals before this slice landed).
- `apps/dashboard/src/lib/cockpit/__tests__/rich-pending-approval-to-approval-view.test.ts` — one case per kind (6 cases). Asserts the correct urgency-colored eyebrow, primary CTA copy, body/quote display. Fixture-driven.

**Files modified (~10):**

- `apps/dashboard/src/lib/api-client-types.ts:29-38` — extend `PendingApproval` with optional fields:
  ```ts
  export interface PendingApproval {
    // ...existing
    kind?: "pricing" | "refund" | "qualification" | "regulatory" | "safety-gate" | "escalation";
    body?: string;
    quote?: string;
    quoteFrom?: string;
  }
  ```
- `apps/api/src/routes/approvals.ts:136-145` — the `/api/approvals/pending` projection extracts `kind`/`body`/`quote`/`quoteFrom` from `a.request.payload` (if present) and forwards. Treats absent fields as undefined; never crashes on legacy approvals.
- `packages/schemas/src/approval-lifecycle.ts` — **no Prisma migration needed** because `Approval.payload` is already a `Json` column (verified at `packages/db/prisma/schema.prisma:1137`). But the Zod schema in `packages/schemas/src/**` SHOULD validate the typed fields for emitters that opt in. New: a `pendingApprovalPayload` Zod schema with the same six-kind enum plus optional `body`/`quote`/`quoteFrom`. **Existing `ApprovalLifecycleSchema` is unchanged** — the typed-payload schema sits beside it and is referenced only by emitters and adapters that opt in.
- `packages/core/src/skill-runtime/tool-result.ts:99` — extend `pendingApproval(message: string)` to accept an optional `payload?: { kind?, body?, quote?, quoteFrom? }` argument. Default behavior unchanged when callers pass only `message`.
- `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts` — emit `kind: "safety-gate"` when constructing the `pendingApproval` result.
- `packages/core/src/skill-runtime/hooks/claim-classifier.ts` — emit `kind: "regulatory"` plus `body` (the flagged claim).
- `packages/core/src/conversation-lifecycle/qualification/disqualification-resolver.ts` — emit `kind: "qualification"`. (Path verified at brief-time; if the file has moved, re-verify before implementation; the implementation plan's precondition checks ship a grep.)
- Refund-detection site — `rg "refund" packages/core/src/` at implementation time; emit `kind: "refund"`.
- Escalation site — same grep pattern; emit `kind: "escalation"`.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx:67-69` — swap `legacyPendingApprovalToApprovalView` for `richPendingApprovalToApprovalView`. The legacy adapter stays on disk as the fallback path (called when `payload.kind` is undefined), so no orphan deletion happens at A.7c.

**Migration / backwards-compat strategy:**

- `Approval.payload` is a JSON column. Adding TypeScript-level fields to the Zod schema and the wire shape is forward-compatible: older approvals serialize the same JSON, the new fields are absent at read-time, the new adapter falls back to `legacyPendingApprovalToApprovalView` which returns `kind: "pricing"`. No Prisma migration, no backfill, no flag period.
- **The cutover is monotonic.** Once A.7c merges, new approvals carry `kind` in their payload; old approvals fall through the legacy adapter. The legacy adapter stays on disk until every in-flight approval expires (~24h per spec); a follow-up sweep can delete it then, but **A.7c does not authorize the deletion** — that's a post-A.7c cleanup PR.

**Files explicitly NOT touched at A.7c:**

- `apps/dashboard/src/components/cockpit/approval-block.tsx` — the rendering layer reads `kind` + `urgency` and styles accordingly. Already wired during A.1 (verified at brief-time); A.7c does not modify it.
- `apps/dashboard/src/components/cockpit/types.ts` — `AlexApprovalKind` already enumerates the six kinds (line 16-23, verified). No type change.
- Prisma schema (`packages/db/prisma/schema.prisma`) — no migration. The payload column already exists as `Json`.
- `apps/chat/**`, `apps/mcp-server/**` — no consumers of the typed payload at brief-time. If verification at implementation-time finds a consumer, halt and re-scope.

**Tests:**

- New: `rich-pending-approval-to-approval-view.test.ts` — six kind cases; each asserts the correct `kind`, `urgency`, `body`/`quote` display.
- New: per-emitter unit test — `deterministic-safety-gate` emits `kind: "safety-gate"`, `claim-classifier` emits `kind: "regulatory"`, `disqualification-resolver` emits `kind: "qualification"`, refund + escalation sites each emit their kind.
- New: server-route projection test — `apps/api/src/routes/__tests__/approvals.test.ts` (or wherever pending-approvals tests live; verify at impl-time) seeds an approval with `payload.kind = "regulatory"`, asserts the GET projection forwards `kind: "regulatory"`. Symmetric case for absent `kind` (legacy approval) → undefined in projection.
- Regression: existing `legacy-pending-approval-to-approval-view.test.*` keeps passing — it is now the fallback path for approvals without `payload.kind`.

**Acceptance:**

- An emitter writes `payload.kind = "regulatory"` → `/api/approvals/pending` projects `kind: "regulatory"` → dashboard adapter returns `AlexApprovalView` with `kind: "regulatory"` → ApprovalBlock renders the regulatory-red urgency eyebrow and the regulatory CTA copy.
- Symmetric for all six kinds (six-kind acceptance grid).
- Legacy approvals (no `payload.kind`) still render via fallback as `kind: "pricing"` — no UI break.

---

## What does NOT ship in A.7 (all three sub-slices)

Explicit non-goals, preserved against scope creep:

- ❌ **No `TALKING` status pill wiring.** Depends on conversation-grain backend signals not yet built. Out of A.7's scope per `[[alex-cockpit-a7-followup-scope]]`.
- ❌ **No `pausedUntil` auto-resume.** Adds a scheduler + `HaltProvider` state. Post-A.7.
- ❌ **No `brief` / `followup` cron + delivery.** Separate slice.
- ❌ **No thread-context wire-through from expanded activity rows.** Spec'd in `[[alex-cockpit-a5-shipped]]`'s "What comes after A.5"; not part of the four Criticals.
- ❌ **No Mira tab (Wave 4).**
- ❌ **No pre-existing orphan hook cleanup** (`use-roi`, `use-entrance-played`, `use-first-run`).
- ❌ **No backend route cleanup** for `/wins` + `/pipeline` (separate post-A.6 PR per `[[alex-cockpit-a6-shipped]]`).
- ❌ **No `lib/agent-home/types.ts` orphan-export trim.**
- ❌ **No `{/* Sparkline */}` JSX comment cleanup** in marketplace.
- ❌ **No "Ask Alex to draft" button or reply `<textarea>`.** Both are missing from the A.5 implementation; see `[[alex-cockpit-a7-followup-scope]]` §"Important findings" — flagged for a separate brief-decision PR or spec amendment, not A.7.
- ❌ **No composer staging-Confirm/Undo restoration.** Spec amendment vs. implementation amendment is a separate decision; A.5 brief Decision #6 already reinterpreted; A.7 does not re-litigate.
- ❌ **No `thread-preview.tsx:56` route fix** (`?takeover=true` vs spec's `/contacts/[id]`). Flagged for spec amendment or fix in a separate PR.
- ❌ **No coverage-threshold lowering.** Per `CLAUDE.md` thresholds (dashboard runs 40/35/40/40 not 55/50/52/55 per `[[dashboard-coverage-threshold]]`). If A.7c's adapter rewrite dips coverage below the dashboard floor, the slice halts and the brief re-opens. Per `[[ship-clean-not-followup]]`.

---

## Adapter-boundary invariant

The shared invariant from A.1/A.2/A.3/A.4/A.5/A.6 and Riley B.1/B.2a/B.2b/B.3 continues to hold:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit,approval-lifecycle}`.

A.7 implications per sub-slice:

- **A.7a:** zero new imports anywhere. The metrics-route fix is server-side; the dashboard sort is on already-imported view-models.
- **A.7b:** `useRespondToApproval` is imported into `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx` — **inside the `lib/cockpit/**`boundary**, mirroring how Riley's`useRecommendationAction`lives in`riley-cockpit-page.tsx`today (which the brief flags as the smell). The fix moves Alex's import to the correct side of the boundary, not back into the shell component. Page-level`cockpit-page.tsx`does **not** import`useRespondToApproval` directly.
- **A.7c:** the new `pendingApprovalPayload` Zod schema sits in `packages/schemas/**` (no surface-awareness). The wire-shape additions in `apps/dashboard/src/lib/api-client-types.ts` are UI-typed; the server projection forwards from `request.payload` agnostic of surface. The rich adapter sits under `apps/dashboard/src/lib/cockpit/**`. No surface name appears in any package boundary.

Pre-merge grep gate (same as A.5/A.6):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma|approval-lifecycle" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: A.7a result is a strict subset (or equal set) of `main`'s. A.7b result is equal to `main`'s — the new `useRespondToApproval` import goes into `lib/cockpit/alex/`, not into `components/cockpit/`. A.7c result is equal to `main`'s — the rich adapter sits under `lib/cockpit/**` per the boundary.

### Surface-agnostic backend invariant

Per `[[surface-agnostic-backend]]`: `core/schemas/db/ad-optimizer` must not reference UI surfaces.

- A.7a: only `apps/api/src/routes/agent-home/metrics.ts` edited under api; no surface name in the diff.
- A.7b: zero edits under `packages/**` or `apps/api/**`.
- A.7c: `packages/schemas/src/**` adds the typed payload schema; `packages/core/src/skill-runtime/**` and `apps/api/src/routes/approvals.ts` add `kind` plumbing. None of these reference `/alex`, `/riley`, `/console`, or any other UI surface.

```bash
git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server | grep -E "alex|riley|console|mira|cockpit" | grep -v "^-" | grep -v "AlexApproval\|RileyApproval\|test\."
```

Expected: empty (the test files may reference `alex`/`riley` for `agentId` fixtures, which is fine).

---

## Dependencies

- ✅ A.1–A.6 all merged. Alex Cockpit Phase A is feature-complete on `main` (per `[[alex-cockpit-a6-shipped]]`).
- ✅ Riley cockpit fully shipped (B.2a #497/#494/#493, B.2b #522, Wave B PR-1 #538, production emitter #541, B.3-followup #548, reviewer cleanup #551). Provides the `RileyApprovalRow` precedent for A.7b's `AlexApprovalRow` extraction.
- ✅ `useRespondToApproval` shipped at `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts:100`. A.7b consumes it directly; no new hook needed.
- ✅ `AlexApprovalKind` enum already in `apps/dashboard/src/components/cockpit/types.ts:16-23`. A.7c consumes it; no type addition needed on the dashboard side.
- ✅ `Approval.payload` already a `Json` column on Prisma (`packages/db/prisma/schema.prisma:1137`). No migration required.
- ❌ **No A.7a → A.7b dependency.** A.7b's wiring is independent of the metrics-route fix. Either may merge first.
- ❌ **No A.7a → A.7c dependency.** Same.
- ❌ **No A.7b → A.7c dependency.** A.7b operates on `primaryAction.kind === "respond"`, which the legacy adapter already emits correctly. A.7c's richer adapter also emits `primaryAction.kind === "respond"` for response-type approvals, so A.7b's wiring keeps working post-A.7c without changes. The schema additions for `kind`/`body`/`quote` don't affect the respond flow.

---

## Design decisions ratified by this slice

1. **A.7 ships as three independent sub-slices (Option B), not one bundled PR.** Rationale: A.7a is high-leverage and 1-PR-mechanical; bundling it inside A.7c's 600-LOC schema work delays the ROI fix. Cadence matches A.3/A.4/A.5/A.6 (one focused slice per PR) per `[[alex-cockpit-a6-shipped]]` and Riley B.2a's 3-PR chain (`[[riley-cockpit-b2a-shipped]]`).

2. **The metrics-route fix in A.7a uses the canonical `agentRole: rosterRole` pattern from `mission.ts:253`, not a new helper.** Two callsites is not three; per `CLAUDE.md` §Code Basics "No premature abstractions — check existing utils first; >3 new files needs justification." If a third callsite emerges, extract to `apps/api/src/lib/agent-role.ts` then.

3. **Alex's approvals sort lives in `cockpit-page.tsx` (caller-side), not in the adapter.** Riley sorts in `recommendation-to-approval-view.ts` because Riley's orchestrator owns the rows-to-views step (grouping + sorting). Alex's adapter is per-row; sorting belongs at the consumer. The within-band tiebreak is `createdAt desc`, not `dollarsAtRisk` (Riley's tiebreak) because Alex's `risk` field is a copy-string, not a dollar amount.

4. **A.7b's `AlexApprovalRow` lives at `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx`**, mirroring `apps/dashboard/src/lib/cockpit/riley/` for symmetry. Creates the `alex/` directory if absent. The component imports `useRespondToApproval` and `useToast`; the cockpit page does not. Single-owner-toast doctrine per `[[riley-b3-followup-shipped]]`.

5. **`<ApprovalBlock>` vs per-row `<AlexApprovalRow>` is decided at A.7b implementation time.** Two paths:
   - **Path X (preferred):** keep `<ApprovalBlock>` as the layout container (handles the section header + spacing); replace its `data` prop + stub `onResolve` with `children` so it renders `<AlexApprovalRow>` per approval. Smallest diff.
   - **Path Y:** drop `<ApprovalBlock>` entirely; render rows directly in `cockpit-page.tsx`. Matches Riley's pattern at `riley-cockpit-page.tsx:168-186`. Larger diff but more consistent.
     The implementation plan inspects `<ApprovalBlock>` before locking; if its responsibilities are exclusively "render a list of rows," Path Y is preferred. If it owns section copy or empty-state messaging, Path X.

6. **Optional Riley tag-along.** A.7b may opportunistically extract `RileyApprovalRow` from `riley-cockpit-page.tsx:44-81` to `apps/dashboard/src/lib/cockpit/riley/riley-approval-row.tsx` if the implementation engineer judges the symmetry valuable. Brief flags this as **not required for A.7b acceptance** — Riley's row is functionally correct today; extraction is a tidiness improvement. If extracted, lands in the same PR with tests; if not, a future Riley cleanup PR sweeps it.

7. **A.7c's wire-shape addition is fields-on-the-existing-`PendingApproval`-interface**, not a new sibling type.** Rationale: a new sibling (`RichPendingApproval`) would force a discriminated union at every callsite. Extending the existing interface with optional fields is forward-compatible (older callers ignore the new fields). The Zod schema in `packages/schemas/**` is a new sibling (`pendingApprovalPayloadSchema`) because it's a writer-side validator, not a reader-side type — emitters opt in by passing typed payload.

8. **A.7c does NOT delete `legacy-pending-approval-to-approval-view.ts`.** It stays on disk as the fallback path for approvals lacking `payload.kind`. A.7c renames it conceptually (now "fallback adapter"); a post-A.7c sweep deletes it once all in-flight approvals expire. Per `[[ship-clean-not-followup]]`, this is **not** a "follow-up TODO" violation because the fallback adapter serves real production traffic during the cutover window — it's a load-bearing fallback, not deferred work.

9. **Schema additions in A.7c are TypeScript + Zod only — no Prisma migration.** `Approval.payload` is already `Json`; adding typed shape to the validator + the wire schema is forward-compat. The decision avoids a `db:check-drift` failure path and keeps A.7c's blast radius inside `schemas/core/api/dashboard` (no `db` package change). Per `[[prisma-migrate-dev-tty]]` and `[[prisma-index-name-63-char-limit]]`: agent-session Prisma migrations are operationally fraught; avoiding one here is intentional.

10. **A.7 does NOT modify the umbrella spec.** The four Criticals are silently-unmet acceptance criteria (5 + 6 explicitly; 1 + 4 implicitly via the urgency-color and the ROI-bar mounts); the spec is correct, the implementation drifted. Fixing the implementation closes the gap. If A.7 work surfaces a spec defect (e.g., the urgency tiebreak should be `riskScore` not `createdAt`), it's flagged in the PR description and resolved in a follow-up spec amendment per `[[riley-cockpit-b2a-shipped]]`'s pattern.

---

## Risks specific to A.7

1. **A hidden caller has landed for the `metrics.ts` route that depends on the always-degraded ROI bar.** Unlikely — the bug surfaces as "ROI always degraded"; no consumer would intentionally rely on that. Mitigation: A.7a's test asserts the populated path. If a downstream snapshot moves, investigate.

2. **`useRespondToApproval` semantics differ between cockpit-row expectations and the existing approvals page.** Verified: the hook expects `action: "approve" | "reject" | "patch"` (per `use-approvals.ts:86`), while the cockpit's `onResolve` callback signature uses `verdict: "accept" | "decline"` (per `ApprovalCard` interface in `approval-card.tsx`). A.7b translates at the row's call site (Design Decision §5). Mitigation: the unit test asserts the translation explicitly.

3. **Riley's `RileyApprovalRow` symmetry is tempting; bundling it expands A.7b's blast radius.** Per Design Decision §6, Riley extraction is optional. Mitigation: if the implementation engineer pulls the Riley row in, the test surface roughly doubles and the PR scope grows ~50%. Brief recommends deferring unless the diff is already touching `riley-cockpit-page.tsx` for another reason.

4. **A.7c's schema additions ripple to emitter sites in `packages/core/src/conversation-lifecycle/qualification/` and the refund/escalation sites.** These paths are noted in `[[alex-cockpit-a7-followup-scope]]` but not verified at brief-time. Mitigation: the implementation plan's precondition checks grep each emitter site by name; if any has moved, the plan halts and re-investigates. Per `[[verify-against-codebase]]`.

5. **A.7c's wire-shape addition (`PendingApproval.kind?`) needs to be projected from the server route, not just typed.** If A.7c's server-route edit slips (e.g., the projection forwards `kind` but a refactor of `apps/api/src/routes/approvals.ts:136-145` lands first), the dashboard adapter receives `undefined` and falls through to the legacy adapter — visible regression on all kinds. Mitigation: the implementation plan's tests assert end-to-end (seed payload → curl `/api/approvals/pending` → assert response includes `kind`).

6. **A.7c's emitter updates can leak a kind to the wrong site.** The `kind` for a regulatory check vs. a safety-gate vs. an escalation can be subtly wrong (`"regulatory"` should fire from `claim-classifier.ts`, not `deterministic-safety-gate.ts`). Mitigation: per-emitter unit tests; reviewer-grep gate that no emitter file contains two distinct `kind` literals.

7. **`pnpm reset` rebuild ordering: schemas → core → db.** A.7c adds a new export to `packages/schemas/**`; if the schemas package isn't rebuilt before `apps/dashboard` typechecks, the new field is invisible. Per `CLAUDE.md` §Build / Test / Lint: "If `pnpm typecheck` reports missing exports from `@switchboard/schemas` — run `pnpm reset` first." The implementation plan's precondition gate runs `pnpm reset && pnpm typecheck` before claiming green.

8. **Dashboard `next build` not in CI.** Per `[[dashboard-build-not-in-ci]]`: regressions in `.js`-extension imports slip past CI. A.7c adds new imports into `apps/dashboard/src/lib/cockpit/**`; the implementation plan ships `pnpm --filter @switchboard/dashboard build` as a local gate before push.

9. **CI prettier check passes locally but fails on push.** Per `[[ci-prettier-not-in-local-lint]]`: `pnpm format:check` is the gate; the implementation plan runs it before push for all three sub-slices.

10. **Auto-merge captures stale HEAD.** Per `[[auto-merge-captures-head-early]]`: if a late fix lands after CI eligibility, `gh pr merge --auto --squash` orphans it. A.7a, A.7b, A.7c each manually merge once green, no `--auto`.

11. **Dashboard coverage threshold dip.** Per `[[dashboard-coverage-threshold]]`: the dashboard floor is **40/35/40/40** (lower than the global `CLAUDE.md` 55/50/52/55 because the root vitest config excludes `apps/dashboard/**`). A.7c's adapter rewrite adds ~200 LOC of new code that must be tested; per-sub-slice coverage gate confirms each PR stays at-or-above the dashboard floor.

12. **Pre-existing db integrity test flakes** (per `[[db-integrity-tests-pg-advisory-lock]]`) surface during full-suite runs. Mitigation: the implementation plan documents these as baseline flakes; A.7's PRs don't block on them. Per `CLAUDE.md`: "reproduces on baseline, don't block PRs on it."

13. **Subagent dispatches drifting cwd** (per `[[subagent-worktree-drift]]`). Mitigation: each task's pre-commit step runs `git branch --show-current` to verify the implementation branch (`feat/alex-cockpit-a7a-metrics-fix`, etc.) matches expectation.

---

## Test contract

Per sub-slice:

### A.7a test contract

- **New test:** `apps/api/src/routes/agent-home/__tests__/metrics.test.ts` — seed `AgentRoster` row with `agentRole: "responder"` + `config: { avgValueCents: 17900, targetCpbCents: 3000 }`; assert response surfaces those targets. Symmetric for `"optimizer"`.
- **New test:** `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` — fixture three approvals with mixed urgencies; assert post-adapter order.
- **Pre-merge gates:**
  - `pnpm reset && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @switchboard/dashboard build`
  - `pnpm format:check`
  - `pnpm --filter @switchboard/dashboard test -- --coverage` ≥ 40/35/40/40
- **Manual:** open `/alex` + `/riley` in dev stack; confirm ROI bar surfaces populated values when `AgentRoster.config` is set; confirm approval order is urgency-first.

### A.7b test contract

- **New tests:** `apps/dashboard/src/lib/cockpit/alex/__tests__/alex-approval-row.test.tsx` — Accept dispatches `mutate({ action: "approve", ... })`, Decline dispatches `mutate({ action: "reject" })`, error keeps card visible, success hides + toasts.
- **New smoke:** cockpit-page renders one row per approval.
- **Pre-merge gates:** same as A.7a + adapter-boundary grep returns equal-to-`main`.
- **Manual:** click Accept + Decline on `/alex` in dev; confirm dispatch, dismiss, toast.

### A.7c test contract

- **New tests:** `apps/dashboard/src/lib/cockpit/__tests__/rich-pending-approval-to-approval-view.test.ts` — six kind cases.
- **New tests:** per-emitter unit (5 emitter sites: safety-gate, claim-classifier, qualification, refund, escalation).
- **New test:** `apps/api/src/routes/__tests__/approvals.test.ts` (or sibling) — server projection includes `kind` when payload sets it; absent for legacy approvals.
- **Regression:** existing `legacy-pending-approval-to-approval-view.test.*` keeps passing.
- **Pre-merge gates:** same + `pnpm reset` mandatory (schemas package gains an export).
- **Manual:** trigger a regulatory claim flow → confirm `/alex` renders red-urgency regulatory card with correct copy. Symmetric for safety-gate, refund, escalation, qualification.

### Aggregate gates (all three sub-slices)

- Adapter-boundary grep returns a non-strict-superset of `main`'s match set.
- Surface-agnostic backend grep: zero new UI-surface references in `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`.
- Format clean.
- Coverage at-or-above floor.

---

## What comes after A.7

**Phase A is closed.** A.7 is the final correctness sweep; everything below is post-Phase-A:

- **Post-Phase-A Alex ramps** (deferred per umbrella spec):
  - Auto-resume on `pause N(h)` — adds `pausedUntil` to `HaltProvider` and a scheduler. Spec'd in `[[alex-cockpit-a7-followup-scope]]` §Out of scope.
  - `brief` / `followup` cron + delivery — separate slice.
  - `TALKING` status pill wiring — depends on clean live-conversation backend signals.
  - Thread-context wire-through from expanded activity rows to composer's `threadContext`.
- **Post-A.7c cleanup follow-up:**
  - Delete `legacy-pending-approval-to-approval-view.ts` once all in-flight approvals from before A.7c have expired (~24h post-merge).
  - Sweep the now-unused `legacy-pending-approval-to-approval-view.test.*`.
- **Composer staging-Confirm/Undo restoration** (or spec amendment) — `[[alex-cockpit-a7-followup-scope]]` §"Important findings" flagged a spec-vs-impl divergence at A.5; separate decision PR.
- **"Ask Alex to draft" button + reply textarea** — A.5 brief deferred the send-handler but not the UI; both missing. Separate decision PR.
- **`thread-preview.tsx:56` route reconciliation** — `?takeover=true` vs spec's `/contacts/[id]`. Spec amendment or fix.
- **`RileyApprovalRow` extraction to `lib/cockpit/riley/`** — if not bundled into A.7b, a tidy follow-up PR.
- **Backend route cleanup for `/wins` + `/pipeline`** — pending from `[[alex-cockpit-a6-shipped]]`.
- **`lib/agent-home/types.ts` orphan-export trim** — opportunistic.

---

## Spec-conflict resolution

The umbrella spec at `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` is correct in intent for all four Criticals; the implementation drifted. A.7 closes the drift without amending the spec. Specifically:

1. **Spec §Acceptance criterion 5 ("approval cards surface the correct urgency and copy per kind")** — implementation always renders `kind: "pricing"`. A.7c restores spec compliance.
2. **Spec §Acceptance criterion 6 ("operator can Accept or Decline an approval and see it dispatch")** — implementation is an empty stub. A.7b restores spec compliance.
3. **Spec §Card sort order ("immediate → this_week, then createdAt desc within band")** — implementation omits the sort. A.7a restores spec compliance.
4. **Spec §ROI bar ("on-target comparator when targets are configured")** — implementation always-degraded due to roster lookup bug. A.7a restores spec compliance.

If any of these is found to be a spec defect (e.g., the urgency tiebreak should be `riskScore` not `createdAt`), the brief is re-opened and a spec-amendment PR ships separately. A.7 itself does not amend the spec.

---

## Reference

Holistic code review run 2026-05-15 against `main` at `4ec91ccf`. The review covered Phase A in entirety (A.1 through A.6, ~11,761 LOC delta) and walked all 16 acceptance criteria. Critical findings are documented at `[[alex-cockpit-a7-followup-scope]]`. The review also flagged ~10 Minor items (hardcoded "Alex" defaults, missing aria-labels, etc.) that are nice-to-have polish, deferred from A.7.

Related: [[alex-cockpit-a6-shipped]] (Phase A close), [[alex-cockpit-a5-shipped]] (the slice whose "approval-respond wires at A.5" promise this brief catches up on), [[verify-against-codebase]] (the reviewer's findings were verified file:line at brief-write-time; same discipline applies in implementation), [[ship-clean-not-followup]] (sober reminder — these gaps are real follow-up debt that should have been caught pre-merge).
