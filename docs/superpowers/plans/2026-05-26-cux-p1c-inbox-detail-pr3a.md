# CUX P1-C Inbox detail — PR3a (screen wiring + approval sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `/inbox` queue end-to-end (feed → filter → cards → empty/error) and add the **approval** detail drill-in (composed entirely from the `Decision`, with an inline confirm step), while leaving the handoff branch a minimal guard for PR3b.

**Architecture:** Build on the merged P1-C cards (PR2). `InboxScreen` owns the feed query, agent filter, detail open-state, and toasts; a per-card `InboxDecisionItem` owns the per-row `useRecommendationAction`; an `ApprovalDetailItem` (mounted only when an approval detail is open) owns the detail-commit hook and renders the presentational `ApprovalDetailSheet`. The handoff branch renders a tiny "coming next" guard — **no `HandoffDetailSheet`, no escalation fetch in PR3a.**

**Tech Stack:** Next 14 (app router, client components), TypeScript (ESM, no `.js` on dashboard imports), TanStack Query, vitest + Testing Library. Dashboard coverage gate 40/35/40/40. Source of visual truth: `/tmp/sbinboxv2/switchboard/project/inbox-v2/detail-approval.jsx` + `components.jsx` + `inbox.css`.

**Spec:** `docs/superpowers/specs/2026-05-26-cux-p1c-inbox-detail-design.md` (read the "Field-by-field verdict" table and "Correctness traps" before starting).

---

## Locked rules (apply to every task)

1. **Compose, don't fetch (approval).** The approval sheet is built ENTIRELY from the `Decision` object — no network call. No fake metrics: "What this changes" is a static placeholder ("preview not yet wired"); never invent before/after/confidence/$ numbers.
2. **`dataLines` is `string[][]`** on the wire (`presentation.dataLines: ReadonlyArray<unknown>`). Render each line by flattening (`Array.isArray(line) ? line.join(" · ") : String(line)`); hide the whole block when the array is empty.
3. **`undoableUntil` is absent on inbox approvals** — render the "undoable for Xm" line ONLY when `undoableFor(...)` returns non-null.
4. **No dead links** — "View conversation" renders only when `decision.threadHref` is non-null.
5. **Confirm gate** — `needsConfirm = !contract || contract.requiresConfirmation`. Primary opens the inline `ConfirmInline` step when `needsConfirm`, else commits directly. Commit calls `onCommit(note?)`; the optional audit note flows through.
6. **Handoff branch is a guard in PR3a** — `InboxScreen` mounts `ApprovalDetailSheet` for `kind==="approval"` only. The `kind==="handoff"` detail branch is a minimal placeholder; do NOT import `HandoffDetailSheet` or `useEscalationDetail`. A handoff card tap must not crash and must not commit anything.
7. **Do not touch PR2 `InboxDecisionCard` / filter / empty / error visuals.** Consume them as-is.
8. **Commit subjects lowercase** (commitlint rejects uppercase, e.g. "PR3a…").

## File structure

- `apps/dashboard/src/lib/decisions/time.ts` — MODIFY: add `undoableFor`.
- `apps/dashboard/src/lib/decisions/risk-chips.ts` — NEW: `riskChips(contract?)`.
- `apps/dashboard/src/components/inbox/approval-detail-sheet.tsx` — NEW: `ApprovalDetailSheet` + `ConfirmInline` + `AlreadyHandledBanner` (presentational; callbacks only).
- `apps/dashboard/src/components/inbox/inbox-decision-item.tsx` — NEW: per-card hook wrapper (owns `useRecommendationAction`, renders `InboxDecisionCard`).
- `apps/dashboard/src/components/inbox/inbox-screen.tsx` — NEW: the screen + the internal `ApprovalDetailItem` (owns the open-approval commit hook). 
- `apps/dashboard/src/app/(auth)/inbox/page.tsx` — MODIFY: thin `<InboxScreen/>`.
- Co-located `__tests__/*.test.{ts,tsx}` for each.

## Pre-flight (worktree setup — do once)

- [ ] Create a fresh worktree off merged `main` (PR2 #704 is merged): `git fetch origin && git worktree add -b worktree-cux-p1c-inbox-pr3a <path> origin/main`, then `pnpm worktree:init` (or, if Postgres unreachable: `pnpm --filter @switchboard/schemas --filter @switchboard/core --filter @switchboard/db build` **and** `pnpm db:generate` — the generated Prisma client is needed or the dashboard test suite errors on a missing enum export, an unrelated pre-existing failure otherwise).
- [ ] Confirm PR2 artifacts exist: `apps/dashboard/src/components/inbox/inbox-decision-card.tsx`, `inbox-filter-row.tsx`, `inbox-empty-state.tsx`, `inbox-error-state.tsx`, and `lib/decisions/time.ts` (`relativeTime`, `dueIn`).

---

## Task 1: `undoableFor` helper

**Files:** Modify `lib/decisions/time.ts`; Test `lib/decisions/__tests__/time.test.ts`.

- [ ] **Step 1 — Failing test.** Add to `time.test.ts`:

```ts
import { undoableFor } from "../time";

describe("undoableFor", () => {
  const now = Date.UTC(2026, 4, 26, 9, 0, 0);
  it("returns null for absent or past windows", () => {
    expect(undoableFor(undefined, now)).toBeNull();
    expect(undoableFor(new Date(now - 60_000).toISOString(), now)).toBeNull();
  });
  it("formats minutes and hours", () => {
    expect(undoableFor(new Date(now + 5 * 60_000).toISOString(), now)).toBe("undoable for 5m");
    expect(undoableFor(new Date(now + 2 * 3_600_000).toISOString(), now)).toBe("undoable for 2h");
  });
});
```

- [ ] **Step 2 — Run, verify fail:** `pnpm --filter @switchboard/dashboard test time` → FAIL (`undoableFor` not exported).
- [ ] **Step 3 — Implement** in `time.ts` (port from `inbox-v2/components.jsx:127-135`):

```ts
/** "undoable for Xm/Xh" while the undo window is live; null when absent or elapsed. */
export function undoableFor(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `undoable for ${min}m`;
  return `undoable for ${Math.round(min / 60)}h`;
}
```

- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit:** `feat(inbox): undoableFor time helper`.

## Task 2: `riskChips` helper

**Files:** Create `lib/decisions/risk-chips.ts` + `lib/decisions/__tests__/risk-chips.test.ts`.

- [ ] **Step 1 — Failing test:**

```ts
import { riskChips } from "../risk-chips";

describe("riskChips", () => {
  it("returns a single needs-review chip when the contract is absent", () => {
    const chips = riskChips(undefined);
    expect(chips).toEqual([{ key: "missing", label: "Needs review before this can run", strong: true }]);
  });
  it("maps each boolean flag to a plain-English chip", () => {
    const chips = riskChips({ riskLevel: "high", financialEffect: true, externalEffect: true, clientFacing: true, requiresConfirmation: true });
    expect(chips.map((c) => c.key)).toEqual(["fin", "ext", "cli", "conf"]);
  });
  it("returns a soft 'no side effects' chip when nothing is flagged", () => {
    const chips = riskChips({ riskLevel: "low", financialEffect: false, externalEffect: false, clientFacing: false, requiresConfirmation: false });
    expect(chips).toEqual([{ key: "safe", label: "No side effects outside Switchboard", soft: true }]);
  });
});
```

- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement** (port from `inbox-v2/components.jsx:153-163`), typed against `RiskContract` from `@/lib/decisions/types`:

```ts
import type { RiskContract } from "./types";

export interface RiskChip {
  key: string;
  label: string;
  strong?: boolean;
  soft?: boolean;
}

export function riskChips(contract?: RiskContract): RiskChip[] {
  if (!contract) return [{ key: "missing", label: "Needs review before this can run", strong: true }];
  const out: RiskChip[] = [];
  if (contract.financialEffect) out.push({ key: "fin", label: "Affects your ad spend or credits" });
  if (contract.externalEffect) out.push({ key: "ext", label: "Changes something outside Switchboard" });
  if (contract.clientFacing) out.push({ key: "cli", label: "Goes out to a client" });
  if (contract.requiresConfirmation) out.push({ key: "conf", label: "Needs your explicit okay" });
  if (out.length === 0) out.push({ key: "safe", label: "No side effects outside Switchboard", soft: true });
  return out;
}
```

- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit:** `feat(inbox): riskChips plain-English risk helper`.

## Task 3: `ApprovalDetailSheet` (+ `ConfirmInline`, `AlreadyHandledBanner`)

**Files:** Create `components/inbox/approval-detail-sheet.tsx` + `__tests__/approval-detail-sheet.test.tsx`. Plain string classNames (no CSS module — styling is the later polish slice, matching PR2).

**Props:**

```ts
export interface AlreadyHandledState { kind: string; label: string; }
export interface ApprovalDetailSheetProps {
  decision: Decision;          // kind === "approval"
  nowMs?: number;              // default Date.now()
  alreadyHandled?: AlreadyHandledState | null;
  onClose: () => void;
  onCommit: (note?: string) => void;   // affirmative (after inline confirm when needsConfirm)
  onSecondary: () => void;
  onDismiss: () => void;
}
```

- [ ] **Step 1 — Failing tests** (RTL; build approval `Decision` fixtures inline). Cover:
  - (a) renders `humanSummary`, the agent head ("needs your okay"), and `RiskPill`-equivalent from `meta.riskContract`.
  - (b) `presentation.dataLines` as `string[][]` renders each line flattened; an empty `[]` hides the datalines block.
  - (c) risk chips: financial contract → a "Affects your ad spend or credits" chip; absent contract → the "Needs review…" missing chip.
  - (d) `undoableUntil` present → an "undoable for…" line; absent → no such line.
  - (e) "View conversation" renders only when `threadHref` non-null.
  - (f) **confirm gate:** with `requiresConfirmation:true` (or absent contract), clicking primary shows `ConfirmInline` (does NOT call `onCommit`); clicking its affirmative calls `onCommit(note)` with the typed note. With a safe contract (`needsConfirm` false), clicking primary calls `onCommit()` directly.
  - (g) `onSecondary` / `onDismiss` fire from their buttons; when `alreadyHandled` is set, the action buttons are disabled and the banner renders.
- [ ] **Step 2 — Run, verify fail:** `pnpm --filter @switchboard/dashboard test approval-detail-sheet` → FAIL.
- [ ] **Step 3 — Implement** by porting `inbox-v2/detail-approval.jsx` (lines 16-233). Real React client component (`"use client"`). Use `relativeTime`/`undoableFor` from `@/lib/decisions/time`, `riskChips` from `@/lib/decisions/risk-chips`, agent name from `AGENT_REGISTRY[decision.agentKey].displayName`. Inline `ConfirmInline` (textarea note + "Not now"/"Yes, …") and `AlreadyHandledBanner`. The "What this changes" section is the static placeholder markup verbatim — no data. `dataLines` flatten per rule 2. Buttons are real `<button type="button">`. Sheet has `role="dialog" aria-modal="true"` and a close button.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit:** `feat(inbox): approval detail sheet with inline confirm`.

## Task 4: `InboxDecisionItem` (per-card hook wrapper)

**Files:** Create `components/inbox/inbox-decision-item.tsx` + `__tests__/inbox-decision-item.test.tsx`.

**Why:** hooks can't run in a `.map()`. Each row owns its own `useRecommendationAction(decision.sourceRef.sourceId)` (⚠️ `sourceRef.sourceId`, NOT `decision.id`).

**Props:**

```ts
export interface InboxDecisionItemProps {
  decision: Decision;
  onOpenDetail: (decision: Decision) => void;   // bubble up to the screen
}
```

- [ ] **Step 1 — Failing tests** (mock `@/hooks/use-recommendation-action` and `@/components/ui/use-toast`):
  - approval swipe/tap-approve path → `action.primary()` called, and on success a toast with an Undo action that calls `action.undo()`. (Drive via the `InboxDecisionCard` `onApprove` callback — render the item and trigger approve through the card.)
  - skip → `action.dismiss()`.
  - `onOpenDetail` and `onTakeOver` both bubble to the passed `onOpenDetail(decision)` (handoff primary opens detail in PR3a).
  - the hook is constructed with `decision.sourceRef.sourceId` (assert via the mock's call arg).
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement** (mirror `components/home/needs-you-card.tsx` wiring): owns `useRecommendationAction(decision.sourceRef.sourceId)` + `useToast`; renders `<InboxDecisionCard decision onApprove onSkip onOpenDetail onTakeOver />`. `onApprove`→`primary()` then success toast w/ Undo (skip the toast when the result is `{silent:true}` — the 409 path); `onSkip`→`dismiss()`; `onOpenDetail`/`onTakeOver`→`onOpenDetail(decision)`. Swallow errors so the success toast never fires on rejection.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit:** `feat(inbox): per-card recommendation-action wrapper`.

## Task 5: `InboxScreen` + thin page (with handoff guard)

**Files:** Create `components/inbox/inbox-screen.tsx` (+ internal `ApprovalDetailItem`) + `__tests__/inbox-screen.test.tsx`; Modify `app/(auth)/inbox/page.tsx`.

**`ApprovalDetailItem`** (internal component, mounted only when an approval detail is open — so its hook is never conditional/looped): owns `useRecommendationAction(decision.sourceRef.sourceId)` + `useToast`, renders `<ApprovalDetailSheet decision onClose onCommit onSecondary onDismiss />`. `onCommit(note)`→`primary(note)` (the established approve verb — mirror `NeedsYouCard`'s `action.primary()`; the inline confirm is a UI gate, not a distinct API verb) then success toast w/ Undo + close (skip the toast on a `{silent:true}` 409 result); `onSecondary`→`secondary()` + close; `onDismiss`→`dismiss()` + close. Swallow errors so the success toast never fires on rejection.

- [ ] **Step 1 — Failing tests** (mock `@/hooks/use-decision-feed`):
  - `isError` → `InboxErrorState` rendered, and asserted **before** the empty check (feed `{isError:true, data:undefined}` must NOT show "That's everything.").
  - `isLoading` → a loading affordance (not empty, not error).
  - empty feed (`data.decisions: []`) → `InboxEmptyState` (unfiltered copy).
  - populated feed → one `InboxDecisionItem` per decision; the filter row shows per-agent counts derived from the unfiltered feed; selecting an agent chip switches the `useDecisionFeed` arg and filters the queue.
  - selecting an **approval** card's detail → `ApprovalDetailSheet` mounts (assert its dialog/heading).
  - selecting a **handoff** card's detail → the **guard** renders (assert a "handoff detail coming next"-style placeholder); `HandoffDetailSheet`/`useEscalationDetail` are NOT imported (grep-assert in review, not test).
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement.** `"use client"`. State: `agentFilter: AgentKey | null`, `open: { decision: Decision; kind: DecisionKind } | null`. `const { data, isLoading, isError, refetch } = useDecisionFeed(agentFilter)`. Compute per-agent counts from the **unfiltered** feed (a separate `useDecisionFeed(null)` or derive from `data` when `agentFilter===null`; simplest: keep an `useDecisionFeed(null)` for counts + the filtered one for the list — match the prototype's `useAgentTotals`). Render order: **isError → ErrorState (with `onRetry={refetch}`)**, else isLoading → skeleton, else filter row + (empty → EmptyState(filtered=agentFilter!==null, agentName) | queue of `InboxDecisionItem`). Detail layer: `open?.kind==="approval"` → `<ApprovalDetailItem decision={open.decision} onClose={() => setOpen(null)} />`; `open?.kind==="handoff"` → `<div className="inbox-handoff-guard">Handoff detail coming next.</div>` (or no-op). Undo-toast copy must use outcome phrasing (no internal words like "handoff"/"recommendation"). Make `page.tsx` a thin `<InboxScreen/>`.
- [ ] **Step 4 — Run → pass.**
- [ ] **Step 5 — Commit:** `feat(inbox): inbox screen wires feed, filter, approval detail (handoff guarded)`.

## Task 6: Full verification + finish

- [ ] `pnpm --filter @switchboard/dashboard test inbox decisions home` → green (Home + PR2 no-regression; new screen/sheet/item/helpers pass).
- [ ] `pnpm typecheck` → green.
- [ ] `pnpm --filter @switchboard/dashboard build` (`next build` — NOT in CI; catches missing-`.js`/import errors).
- [ ] `pnpm format:check` (CI runs prettier; local lint does not).
- [ ] Grep-confirm the PR3a guard: `git grep -n "HandoffDetailSheet\|useEscalationDetail" apps/dashboard/src` returns NOTHING.
- [ ] Open PR to `main` (squash). Two-stage review (spec compliance + code quality) per the overhaul process. PR body: note the handoff branch is a guard, the two-confirm-surface divergence, and link the spec's "Backend follow-ups discovered" section.

---

## Out of scope (PR3a)

- `HandoffDetailSheet`, `useEscalationDetail`, any escalation fetch (→ **PR3b**).
- CSS port / responsive (→ later polish slice; PR3a uses plain class names like PR2).
- The v2 `DecisionCard` editorial refinements (keep PR2's card).
- Any backend change; fetching the recommendation row for confidence/$; real before/after numbers (→ backend follow-up bucket #1).
