# CUX P1-C — Inbox redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `/inbox` list with the full redesigned Inbox queue — filterable by teammate, risk-tiered swipe cards for both approvals and handoffs, a decision-detail drill-in, a handoff takeover composer, financial confirm rows, and honest empty/error states — wired to the live decision feed + mutations.

**Architecture:** Build on the P1-B foundation. The swipe mechanics + risk gate already live in `SwipeDecisionCard` (`canSwipeApprove`/`needsConfirm` against `meta.riskContract`). We extract the gesture into a reusable hook, build inbox-flavoured cards (approval + handoff variants) that reuse it, add a RightDrawer-style detail panel and a takeover composer, and enrich the existing `ConfirmSheet` with optional financial rows. Home's `NeedsYouCard` path is left untouched.

**Tech Stack:** Next 14 (app router, client components), TypeScript (ESM, no `.js` on dashboard imports), CSS Modules, TanStack Query hooks, vitest + Testing Library. Dashboard coverage gate 40/35/40/40; `next build` not in CI (run locally).

**Source of visual truth:** the Claude-Design prototype at `/tmp/sb-inbox-v2/switchboard/project/inbox/{app,components,data}.jsx + inbox.css`. Match its visual output; do NOT copy its `window.SBInbox`/global-script structure. Field names already match the real `Decision` contract — EXCEPT the prototype puts risk flags flat on `meta` while the real contract nests them under **`meta.riskContract`** (read from there; absent ⇒ unsafe).

**Scope call (locked):** enrichment fields the prototype shows — `reasoning`, `replyPreview`, `financialDetails`, `channel`, `conversationSummary` — do NOT exist on the backend `Decision` today. Render them **only when present; degrade gracefully when absent.** Backend enrichment is a follow-up slice (P1-C.2), not part of this plan.

---

## Locked rules (from plan review — apply to every task)

1. **Kind discriminator = `decision.kind` ONLY.** Approval-vs-handoff branching reads the canonical `Decision.kind` (`"approval" | "handoff"`) field exclusively. NEVER infer from `presentation.*Label`, copy, intent, or source. (Verified: `lib/decisions/types.ts`.)
2. **Risk gate is data-only and fail-closed.** A missing `meta.riskContract`, or any of high / `financialEffect` / `clientFacing` / `externalEffect` / `requiresConfirmation`, can NEVER swipe-approve. A blocked swipe-right routes to `primeBlocked` → opens detail; it never commits. Tap-Approve on a `needsConfirm` decision routes through the confirm step. (The `canSwipeApprove`/`needsConfirm` predicates already enforce this — do not re-derive.)
3. **Financial/confirm flow path (explicit):** unsafe/financial swipe-right → `onOpenDetail` (never approve). Tap-Approve on `needsConfirm` → `ConfirmSheet`. The financial breakdown rows render in `ConfirmSheet` ONLY when a `financialDetails` object is passed (from the detail/docked-confirm path or a Home caller); absent → the generic confirm line. Commit happens only on the affirmative.
4. **Mutation ownership (component boundary):**
   - `InboxScreen` owns feed query, `agentFilter` state, detail/confirm/takeover open-state, and toasts.
   - A per-decision wrapper component (`InboxDecisionItem`) owns the per-card hooks — `useRecommendationAction(decision.sourceRef.sourceId)` (⚠️ **`sourceRef.sourceId`, NOT `decision.id`** — `decision.id` is namespaced `approval:<uuid>`; the mutation needs the raw row id, per `NeedsYouCard:46`) and, for handoffs, `useEscalationReply(sourceRef.sourceId)`. This honors the no-hooks-in-`.map()` rule.
   - `InboxDecisionCard` is presentational — it receives callbacks only, owns no mutation hooks.
5. **No dead links.** `View thread` renders ONLY when `decision.threadHref` is non-null; otherwise it is omitted (not a disabled-looking dead link).

## PR boundaries (do NOT ship as one PR)

Land as four sequenced PRs off main. The invariant to protect across all four: **Home swipe behavior must not regress while `/inbox` becomes the richer queue.**

- **PR 1 — Foundation (Tasks 1–2):** gesture extraction + `ConfirmSheet` financial rows. Low-risk; protects Home. Must merge green (Home tests unchanged) before PR 2.
- **PR 2 — Queue shell (Tasks 3, 6):** `InboxDecisionCard` (both kinds) + filter row + empty/error states. Gets the queue visually working against the live feed.
- **PR 3 — Workflow (Tasks 4, 5, 7):** detail panel + takeover composer + `InboxScreen`/page wiring. Completes behavior.
- **PR 4 — Polish (Tasks 8–9):** CSS port + responsive + full build/format verification + two-stage review.

---

## Reuse map (existing → role in P1-C)

| Existing                                | Path                                                                | Role                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `SwipeDecisionCard` + `ConfirmSheet`    | `components/decisions/swipe-decision-card.tsx`                      | gesture + gate + confirm — EXTRACT gesture, EXTEND confirm                           |
| `canSwipeApprove`/`needsConfirm`        | `lib/decisions/swipe-policy.ts`                                     | the gate — REUSE as-is                                                               |
| `useDecisionFeed(agentKey)`             | `hooks/use-decision-feed.ts`                                        | feed + per-agent filter (`GET /api/dashboard/decisions` or `/agents/:key/decisions`) |
| `useRecommendationAction`               | `hooks/use-recommendation-action.ts`                                | approval primary/secondary/dismiss/confirm/undo                                      |
| `useEscalationReply` + resolve dispatch | `hooks/use-escalation-reply.ts`, `lib/decisions/dispatch-action.ts` | handoff takeover + resolve                                                           |
| sprite avatars                          | `components/cockpit/sprite/`                                        | agent identity (with initial-disc fallback)                                          |
| `Decision` + `RiskContract`             | `lib/decisions/types.ts`                                            | wire shape — `meta.riskContract`                                                     |
| `AGENT_REGISTRY`                        | `@switchboard/schemas`                                              | display names (NOT colors — pull coral/teal/violet from dashboard tokens)            |

---

## File structure

- `components/decisions/use-card-swipe.ts` — NEW. Extract the drag/axis-lock/rubber-band/commit gesture from `SwipeDecisionCard` into a hook returning `{ dx, dragging, exiting, armed, handlers, commitApprove, commitSkip, primeBlocked }`.
- `components/decisions/swipe-decision-card.tsx` — MODIFY. Consume `use-card-swipe`; add optional `financialDetails` to `ConfirmSheet`. No behavior change for Home.
- `components/inbox/inbox-screen.tsx` — NEW. The screen: header + count, filter row, queue, empty/error switch. Page stays thin.
- `components/inbox/inbox-filter-row.tsx` — NEW. All + per-agent chips (Mira only if she has items).
- `components/inbox/inbox-decision-card.tsx` — NEW. Inbox-flavoured card for BOTH kinds: agent head (`needs you` / `is handing this to you`), risk pill OR SLA pill, contact line, reply-preview (swipeable approvals), foot row (Why · View thread · time), whole-card tap → detail. Reuses `use-card-swipe` + the gate.
- `components/inbox/decision-detail-panel.tsx` — NEW. The drill-in (bottom sheet mobile / docked right desktop): summary, why, drafted reply, financial rows, conversation-summary placeholder, thread link, docked actions, handoff "Mark resolved".
- `components/inbox/takeover-sheet.tsx` — NEW. Handoff reply composer → `useEscalationReply`.
- `components/inbox/inbox-empty-state.tsx`, `inbox-error-state.tsx` — NEW. Distinct calm-empty vs error.
- `components/inbox/inbox.module.css` — NEW. Inbox-specific styles ported from `inbox.css` (reuse existing tokens; do not redefine).
- `app/(auth)/inbox/page.tsx` — MODIFY. Render `<InboxScreen/>` (keep `useDecisionFeed` handling for isError BEFORE empty).
- Co-located `__tests__/*.test.tsx` for every new component.

---

## Task 1: Extract the swipe gesture into `use-card-swipe`

**Files:**

- Create: `components/decisions/use-card-swipe.ts`
- Create: `components/decisions/__tests__/use-card-swipe.test.ts`
- Modify: `components/decisions/swipe-decision-card.tsx` (consume the hook; delete the inline drag state)

- [ ] **Step 1 — Write the failing test.** Render a host component using the hook; simulate a right drag past `COMMIT_THRESHOLD` with `swipeApproves=true` → asserts `commitApprove` fired; with `swipeApproves=false` → asserts `primeBlocked` fired and NOT `commitApprove`; left drag → `commitSkip`. (Mirror the existing `swipe-decision-card.test.tsx` gesture assertions.)
- [ ] **Step 2 — Run, verify it fails** (`pnpm --filter @switchboard/dashboard test use-card-swipe` → FAIL: module not found).
- [ ] **Step 3 — Implement** the hook by lifting the exact constants (`COMMIT_THRESHOLD=100`, `AXIS_LOCK_DEADZONE=6`, `EXIT_MS=280`, `RUBBER_MAX=110`, `RUBBER_RESIST_FROM=60`) and the `onDown/onMove/onUp` logic verbatim from `swipe-decision-card.tsx:110-178`. Signature: `useCardSwipe({ swipeApproves, onApprove, onSkip, onPrimeBlocked })`.
- [ ] **Step 4 — Rewire** `SwipeDecisionCard` to consume the hook; keep its JSX, copy, classnames, and `ConfirmSheet` **byte-for-byte identical** — the ONLY change is that drag state now comes from the hook. No visual or behavioral change to Home.
- [ ] **Step 5 — Run** the FULL existing decisions suite (`pnpm --filter @switchboard/dashboard test decisions`) AND Home (`test home`) → all pass **unchanged** (no test edits beyond import location). This is the Home-no-regression gate; if any existing assertion needs changing, STOP — the extraction altered behavior.
- [ ] **Step 6 — Commit** `refactor(inbox): extract swipe gesture into useCardSwipe hook`.

## Task 2: Financial rows on `ConfirmSheet`

**Files:** Modify `components/decisions/swipe-decision-card.tsx`; Test `components/decisions/__tests__/swipe-decision-card.test.tsx`.

- [ ] **Step 1 — Failing test:** `ConfirmSheet` with a `financialDetails` prop renders the current/proposed/impact/guardrail rows; without it, renders the existing generic line.
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement:** add optional `financialDetails?: { current; proposed; impact; guardrail: { label; value } }` to `ConfirmSheetProps`; render rows when present (port markup from prototype `components.jsx` `ConfirmSheet`/`confirm-rows`). Affirmative still commits via `onConfirm`.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit** `feat(inbox): financial breakdown rows in ConfirmSheet`.

## Task 3: `InboxDecisionCard` (both kinds)

**Files:** Create `components/inbox/inbox-decision-card.tsx` + `__tests__/inbox-decision-card.test.tsx`; styles in `inbox.module.css` (Task 8 ports CSS — stub classnames now).

- [ ] **Step 1 — Failing tests:** (a) approval with low+safe `riskContract` → swipe-right calls `onApprove`; (b) approval financial → swipe-right does NOT call `onApprove`, calls `onOpenDetail`; (c) handoff → renders SLA pill + "is handing this to you", NO swipe-approve, primary label from `presentation.primaryLabel`; (d) whole-card tap (no drag) → `onOpenDetail`; (e) contact line + foot render from `meta`.
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement:** compose `useCardSwipe` (Task 1). **Branch on `decision.kind` ONLY** (rule #1) — for `kind === "handoff"` force `swipeApproves=false` and route primary → `onTakeOver`. Render head (agent name + `needs you` for approval / `is handing this to you` for handoff), risk pill OR `dueIn(slaDeadlineAt)` SLA pill, `humanSummary`, optional `replyPreview` (swipeable approvals only), optional contact line, foot (Why → `onOpenDetail`; `View thread` **only when `threadHref` is non-null** (rule #5) → `onOpenDetail`; relative time). Buttons `stopPropagation`. Pull agent color from dashboard token classnames, never on the button.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit** `feat(inbox): InboxDecisionCard for approvals + handoffs`.

## Task 4: `DecisionDetailPanel` drill-in

**Files:** Create `components/inbox/decision-detail-panel.tsx` + test.

- [ ] **Step 1 — Failing tests:** renders `humanSummary`; shows "Why {agent} is asking" only when `meta.reasoning`; shows drafted-reply only when `meta.replyPreview` && approval; renders financial rows when `meta.financialDetails`; conversation summary shows the "Summary · v1 preview" placeholder tag when `meta.conversationSummary`; thread link only when `threadHref`; handoff shows "Mark resolved"; docked actions fire `onPrimary`/`onSecondary`.
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement** porting markup from prototype `components.jsx` `DetailPanel`. Mobile = bottom sheet, desktop = docked right panel (data-layout / media query in CSS). Compose ALL content from the `Decision` object — no fetch.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit** `feat(inbox): decision detail drill-in panel`.

## Task 5: `TakeoverSheet` (handoff composer) + escalation wiring

**Files:** Create `components/inbox/takeover-sheet.tsx` + test.

- [ ] **Step 1 — Failing tests:** seeds composer with "Hi {first name} — "; Send disabled when empty; Send calls `onSend(decision, message)`; shows the "goes out as you, not as {agent}" note.
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement** the composer (port from prototype `TakeoverSheet`). The screen wires `onSend` → `useEscalationReply(sourceId).send(message)`; handle the 502 "saved — delivery retrying" branch; `onResolve` → resolve dispatch.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit** `feat(inbox): handoff takeover composer wired to escalation reply`.

## Task 6: `InboxFilterRow` + empty/error states

**Files:** Create `components/inbox/inbox-filter-row.tsx`, `inbox-empty-state.tsx`, `inbox-error-state.tsx` + tests.

- [ ] **Step 1 — Failing tests:** filter renders All/Alex/Riley; Mira chip ONLY when her count > 0; clicking a chip calls `onSelect(agentKey)`; empty state copy differs filtered vs unfiltered ("Nothing from {name}." vs "That's everything."); error state is its own component (never the empty copy).
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement** (port from prototype). Sprite avatar in chip with initial-disc fallback.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit** `feat(inbox): filter row + honest empty/error states`.

## Task 7: `InboxScreen` + page wiring

**Files:** Create `components/inbox/inbox-screen.tsx` + test; Modify `app/(auth)/inbox/page.tsx`.

- [ ] **Step 1 — Failing tests:** `isError` → ErrorState (asserted BEFORE empty — regression guard from P0-A); `isLoading` → skeleton; empty feed → EmptyState; populated → queue of `InboxDecisionCard`; agent filter switches the `useDecisionFeed` arg; selecting a card opens `DecisionDetailPanel`; approving an approval calls `useRecommendationAction.primary` + Undo toast; taking over a handoff opens `TakeoverSheet`.
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement** the screen: local `agentFilter` state → `useDecisionFeed(agentFilter)`; per-card `useRecommendationAction` must stay per-card (hooks-in-loop rule) → keep the one-hook-per-card component pattern from `NeedsYouCard`; detail/confirm/takeover open-state in the screen; Undo toast copy must NOT leak internal words ("handoff"/"request") — use outcome phrasing. Make `page.tsx` a thin `<InboxScreen/>`.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit** `feat(inbox): InboxScreen wires queue, filter, detail, takeover to live feed`.

## Task 8: CSS port + responsive

**Files:** Create `components/inbox/inbox.module.css`; ensure tokens come from `globals.css`/P0-B (do NOT redefine `--coral`/`--teal`/`--violet`/amber/ink/cream).

- [ ] **Step 1** — Port `inbox.css` classes (header serif, filter chips, queue, SLA pill, foot, empty/error, detail panel, takeover, fly-off keyframes) to the module, mapping prototype CSS vars to the real token names (verify names in `globals.css` first; P0-B aliased mercury → canonical).
- [ ] **Step 2** — Desktop (≥1024px): tabs→topbar already handled by AppShell; detail panel docks right; column ~640px. Verify against prototype `data-layout="desktop"` rules.
- [ ] **Step 3 — Commit** `style(inbox): port warm-editorial inbox styles + responsive`.

## Task 9: Full verification + finish

- [ ] Build lower layers if needed (`pnpm reset` — DB was unreachable at worktree-init so dist may be stale) then:
- [ ] `pnpm --filter @switchboard/dashboard test` → full dashboard suite green.
- [ ] `pnpm typecheck` → green.
- [ ] `pnpm --filter @switchboard/dashboard build` (`next build` — NOT in CI; catches missing-`.js`/import errors).
- [ ] `pnpm format:check` (CI runs prettier; local lint doesn't).
- [ ] Manual: `pnpm dev` → `/inbox` on phone width + desktop; verify swipe-approve only fires on low+safe, financial opens confirm with rows, handoff opens takeover, detail composes, empty≠error, Undo works, no agent color on any button, Mira chip hidden.
- [ ] Open PR to `main` (squash). Two-stage review (architecture + codebase-alignment + soundness) per the overhaul process before merge.

---

## Out of scope (follow-ups)

- **P1-C.2 backend enrichment:** add `reasoning`/`replyPreview`/`financialDetails`/`channel`/`conversationSummary` to the `Decision` contract + adapters so the detail panel/cards show real content instead of degrading.
- Handoff snooze persistence (prototype snooze is local-only).
- Real thread route target for `View thread` (today `threadHref` may be null/placeholder).
