# /approvals — Design Spec

**Status:** Spec
**Date:** 2026-05-13
**Author:** brainstorming session (Jason + Claude)
**Wave:** wave-1 (parallel with /mission, /activity, /reports, agent-home redesigns)
**Implementation track:** focused PR(s) on a feature branch consuming this spec from `main`
**Surface:** Mercury Tools, route `/approvals` (new), under `(auth)/(mercury)/` shell
**Locked design:** `docs/design-prompts/locked/switchboard/project/approvals-v2/` (visual reference; copy + token mapping in this spec **override** the locked CSS for operator-language and codebase-alignment reasons — see "Adapting the locked design" below)
**Backend prompt:** `docs/design-prompts/2026-05-13-approvals.md`

---

## Goal

Ship the dashboard surface for the single cross-agent approvals queue. Every mutating action proposed by an agent waits here until the operator approves or rejects it.

**The operator approves a specific action with specific details. The confirmation code proves those details have not changed.** The code is the integrity guarantee; the action is the thing being approved. The UI should make the operator feel they are saying "yes, do this exact thing", not "yes, sign this cryptographic artifact".

Greenfield UI on a stable backend. The data contract is fixed (6 lifecycle statuses, 5 risk categories, 3 response actions — see Domain). Do not invent new statuses, categories, or hash semantics.

**The end customer is a medspa operator, not a security engineer.** The locked design's cryptographic vocabulary ("binding hash", "envelope", "executable work unit") must be translated to operator language without weakening the integrity guarantee. Specifics in "Adapting the locked design" and the copy-rewrite tables throughout.

## Non-Goals

- Bulk actions ("approve all", multi-select). Each approval is one decision.
- A history / cleared-approvals tab. Cleared lifecycle history lives at `/activity`.
- New approval statuses, new risk categories, new response actions. The contract is fixed.
- An audit-log / full-lifecycle drill-in. Out of scope until `/lifecycle/:id` exists.
- A real-time WebSocket transport. The live countdown is a client-side tick; refresh is on focus + manual.
- Structured per-field parameter editing in v1. Patch is **hidden behind a "View JSON (advanced)" toggle** for v1 (see "Patch flow" below). A structured key-value editor is a follow-up.
- New global design tokens. Page-local aliases on top of existing `--mercury-*` tokens only.

## Adapting the locked design

The locked HTML/JSX at `docs/design-prompts/locked/switchboard/project/approvals-v2/` is the **visual contract** — composition, hierarchy, the queue/detail split, the bracketed confirmation-code section, the risk-aware row chrome, the action-drawer order. **It is not the copy contract** and **not the token contract**.

Where this spec and the locked design conflict, this spec wins. The conflicts are:

1. **Tokens.** The locked CSS introduces a fresh `--paper`/`--ink`/`--amber` palette that does not exist in the dashboard. The actual Mercury register uses `--mercury-cream`/`--mercury-ink`/`--mercury-accent` (per `apps/dashboard/src/app/globals.css` + `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css:13–30`). See "Tokens" below.
2. **Display font.** Locked CSS uses Cormorant Garamond. The dashboard loads Source Serif 4 (via next/font in `apps/dashboard/src/app/layout.tsx:2`). Cormorant Garamond is not loaded; loading it adds a new font payload for no gain. Use `var(--serif)`.
3. **Amber hue.** Locked `hsl(30 55% 46%)` is the marketing-site `--sw-accent`, not the dashboard's Mercury accent (`hsl(20 90% 55%)`). Use `var(--accent)`.
4. **Copy.** The locked design speaks in cryptography. Operators speak in actions. Every customer-facing string is rewritten in "Operator-language copy" below; engineering vocabulary stays only in developer-facing surfaces (`/activity`, error messages, log lines).
5. **Patch UI.** The locked design treats a JSON textarea as first-class. For a medspa operator that's unusable. Patch is gated behind a "View JSON (advanced)" toggle in v1.
6. **Confirmation gating.** The locked design forces a 3-step confirmation (statement-of-intent line + ack checkbox + click CTA) for every approval. v1 **grades confirmation by risk** (see "Responding (hot path)").
7. **Sort.** Locked default is risk-rank-then-expiry. v1 default is **expiring-soonest, with critical-and-<5min pinned to the top**.
8. **Quorum stamps.** Locked design shows other approvers as `kira.l · 0xK1RA`. v1 shows them as name + role + relative timestamp.
9. **Agent labels.** Locked design uses internal agent ids (`billing-agent`, `ops-agent`). v1 displays canonical agent display names (Alex / Riley / Mira), with a fallback for unknown ids.

These adaptations preserve the integrity contract — the binding hash is still visible, still bound to the parameters, still echoed on the CTA, still required for approve/patch — while making the page usable by a medspa owner.

## Domain (fixed contract)

Anchored to `packages/schemas/src/approval-lifecycle.ts`, `packages/schemas/src/risk.ts`, `apps/api/src/routes/approvals.ts`.

**`PendingApproval`** (`GET /api/approvals/pending` → `{ approvals: PendingApproval[] }`):

```ts
{
  id: string;
  summary: string;
  riskCategory: "none" | "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired" | "superseded" | "recovery_required";
  envelopeId: string;
  expiresAt: string; // ISO; server filters out already-expired pending rows
  bindingHash: string;
  createdAt: string; // ISO
}
```

(Today's wire shape per `apps/dashboard/src/lib/api-client-types.ts:29`.)

**`ApprovalDetail`** (`GET /api/approvals/:id`):

```ts
{
  request: {
    id: string;
    summary: string;
    riskCategory: RiskCategory;
    bindingHash: string;
    approvers: string[];
    createdAt: string;
    // Additional fields are returned passthrough; treat unknown keys as forward-compat.
  };
  state: {
    status: ApprovalLifecycleStatus;
    expiresAt: string;
    respondedBy?: string;
    respondedAt?: string;
    // approvalHashes[] when quorum > 1 (see Quorum prereq below).
  };
  envelopeId: string;
}
```

**`POST /api/approvals/:id/respond`** body (per `ApprovalRespondBodySchema` in `apps/api/src/validation.ts`):

```ts
{
  action: "approve" | "reject" | "patch";
  respondedBy: string;             // must match authenticated principal when auth is enforced
  bindingHash?: string;             // REQUIRED for approve and patch (400 otherwise, per route)
  patchValue?: Record<string, unknown>;   // ≤100KB serialized; required iff action === "patch"
}
```

There is **no `reason` field** on the body. v1 does not expose a reject-reason field in the UI either — a non-persisted textarea would mislead operators into thinking their note is saved. Reject is a single-step action; if a reason needs persistence later, the backend adds the field first. Flag in "Shared-conventions input".

Returns `{ envelope, approvalState, executionResult, resumeWarning? }` on 200. Conflict-on-stale yields `409`.

**`respondedBy` source.** Dashboard pulls the principal id from the next-auth session: `const { data: session } = useSession(); respondedBy = session?.principalId`. The field is exposed at `apps/dashboard/src/lib/session.ts:11`, `lib/dev-auth.ts:8`, and `lib/auth.ts:51`. Block submission when `principalId` is null (render an inline "sign in again" banner — should never happen inside a `(auth)` route group).

**Risk categories** — `none | low | medium | high | critical`. `none` rows are extremely rare in practice and visually collapse into `low` at the row level. The filter strip surfaces only the four chips (low/medium/high/critical) plus "all"; `none` rows aggregate into "all".

**Lifecycle statuses** — `pending` is the queue-resident state. `approved | rejected | expired | superseded` are terminal and not returned by `/api/approvals/pending` (the route filters by `state.expiresAt > now`; the underlying `approvals.listPending` filters by status). `recovery_required` is a special non-terminal state that _is_ returned by `/pending` and needs distinct UI (see "Recovery state").

## Architecture

### Route + shell

- New route: `apps/dashboard/src/app/(auth)/(mercury)/approvals/page.tsx` + `approvals-page.tsx` (client component).
- Wrapped by the existing `(mercury)/layout.tsx` (`EditorialAuthShell`).
- Gated via a new `NEXT_PUBLIC_APPROVALS_LIVE` env var, wired through `isMercuryToolLive("approvals")`. Until the flag is true, the page renders a fixtures-only mode and the Tools ▾ overflow entry is hidden — same pattern `/contacts`, `/activity`, `/automations`, `/reports` already use (`apps/dashboard/src/lib/route-availability.ts`).
- Code-level work for the gate (PR-A1 responsibilities):
  - Extend the `ToolsNavId` union in `apps/dashboard/src/lib/route-availability.ts` with `"approvals"`.
  - Add `approvals: "NEXT_PUBLIC_APPROVALS_LIVE"` to `TOOLS_LIVE_ENV` in the same file.
  - Append `{ id: "approvals", label: "Approvals", href: "/approvals" }` to `TOOLS_NAV_ITEMS` in `apps/dashboard/src/components/layout/tools-overflow.tsx`.
  - Add `NEXT_PUBLIC_APPROVALS_LIVE=false` to `.env.example`.

### Data layer

The wire calls already exist:

- `client.listPendingApprovals()` → `/api/approvals/pending`
- `client.getApproval(id)` → `/api/approvals/:id`
- `client.respondToApproval(id, body)` → `POST /api/approvals/:id/respond`

The Next.js proxy `apps/dashboard/src/app/api/dashboard/approvals/route.ts` already handles list, detail (via `?id=`), and POST. Use it unchanged.

Hooks (new file `apps/dashboard/src/hooks/use-approvals.ts`):

- `usePendingApprovals()` — `useQuery` on `keys.approvals.pending()`. **No `refetchInterval`** — mirrors the convention set by `use-activity-list.ts:60` ("NO refetchInterval — paginated lists with polling break cursor stability"). Settings: `staleTime: live ? 30_000 : Infinity`, `refetchOnWindowFocus: true`. The live countdown is a separate client-side 1-second tick (see "Live countdown") and does not depend on refetching.
- `useApprovalDetail(id)` — `useQuery` on `keys.approvals.detail(id)`. Enabled iff `id` is set. `staleTime: 5_000` so rapid selection toggles don't refetch.
- `useRespondToApproval()` — `useMutation`. On success, invalidate `keys.approvals.all()`. On `409`, surface as a typed conflict so the page can prompt the operator that someone else acted.

Query keys already exist at `apps/dashboard/src/lib/query-keys.ts:19–23`. No additions needed.

### Page composition

```
approvals-page.tsx
├── ApprovalsHeader        — eyebrow + title + 3 stat tiles (pending / <1h to expiry / last cleared)
├── ApprovalsFilterStrip   — risk chips (all/low/medium/high/critical) + sort hint; "expiring < 60m" demoted to secondary
├── ApprovalsSplit
│   ├── ApprovalsQueue (left)
│   │   ├── QueueRow × N    — risk hairline edge (decorative), textual risk label (primary), summary, meta line, timer
│   │   └── QueueEmpty | QueueSkeleton
│   └── ApprovalsDetail (right)
│       ├── DetailHeader        — risk pill, id, live timer, summary, dh-foot meta, parametersSnapshot grid
│       ├── ConfirmationCode    — block 2; eyebrow "CONFIRMATION CODE · LOCKS IN THE DETAILS ABOVE", full hash mono, copy button, foot
│       ├── ApproversBlock      — quorum only (required > 1); n-of-m, per-approver state (name + role + timestamp)
│       ├── RecoveryNotice      — recovery_required only; operator-language copy, Dismiss-only
│       ├── ActionDrawer        — idle | reject-confirm modes; expired + recovery short-circuits; risk-graded approve gating
│       │   ├── ApproveBlock        — risk-graded: low/medium = amber CTA only; high/critical = statement + ack checkbox + CTA
│       │   ├── AdvancedJsonToggle  — "View JSON (advanced) ▾" — when expanded, reveals the patch editor
│       │   └── RejectRow           — outline button → confirm-reject inline step (no reason field)
│       └── DispatchBanner      — post-respond confirmation; operator-language copy
└── ApprovalsEmptyDetail   — placeholder when no row selected
```

Files (proposed):

```
app/(auth)/(mercury)/approvals/
  page.tsx
  approvals-page.tsx
  approvals.module.css
  fixtures.ts                       — 12-row Aurora medspa fixture set (see below)
  hooks/
    use-approvals.ts                — usePendingApprovals, useApprovalDetail, useRespondToApproval
    use-now.ts                      — net-new 1s tick + visibility-pause; page-local for v1
    use-agent-display.ts            — maps agent id → display name (see "Agent display names")
  components/
    header.tsx
    filter-strip.tsx
    queue.tsx                       — Queue, QueueRow, QueueSkeleton, QueueEmpty
    detail/
      index.tsx                     — Detail orchestrator
      header.tsx                    — DetailHeader (incl. ParamsSnapshot dl)
      confirmation-code.tsx         — ConfirmationCode (formerly HashCard) + copy
      approvers.tsx                 — ApproversBlock (quorum); displays name+role
      recovery-notice.tsx           — operator-language recovery copy
      action-drawer.tsx             — ActionDrawer, ApproveBlock, AdvancedJsonToggle, RejectRow
      patch-editor.tsx              — PatchEditor (JSON textarea + diff renderer; gated behind advanced toggle)
      reject-confirm.tsx            — inline two-step "Reject" → "Confirm reject" (no reason textarea)
      dispatch-banner.tsx           — operator-language post-respond copy
      empty.tsx
  __tests__/
    queue.test.tsx
    confirmation-code.test.tsx
    patch-editor.test.tsx
    action-drawer.test.tsx
    approvers.test.tsx
    approvals-page.test.tsx         — integration (fixtures mode)
```

File-size budget: 400-line warn / 600-line error. Locked `detail.jsx` is ~530 lines; split as above so nothing exceeds the warn.

### Live countdown

`expiresAt` countdown ticks every **1 s**. Implementation: a new page-local `useNow()` hook returns `now: number`, updated by `setInterval(setNow, 1000)`, cleared on unmount. Queue rows and the detail header consume `now` as a prop (no per-row intervals).

When the page is hidden (`document.hidden`), pause the interval. Resume on `visibilitychange`, and on the same event re-query `/pending` to refresh `expiresAt` values that may have shifted.

This pattern is **net-new** to the dashboard (only `ambient-cream.tsx` uses `setInterval` at 60s). Keep `useNow` page-local for v1; promote to a shared hook if /mission or other surfaces adopt the same pattern (flagged in "Shared-conventions input").

### Selection & URL state

- `?id=apr_…` query parameter holds the active selection. Deep-linkable; back-button works.
- On first load with no `?id`, auto-select the first row of the sorted filtered queue (see "Sort" below).
- When the selected row falls out of the filtered set (filter change, dismissal, expiry-during-view), auto-select the new first row. If the queue is empty, render `ApprovalsEmptyDetail`.
- Filter chips are local state; only `id` round-trips the URL.

### Sort

Default sort = **expiring-soonest ascending**, with **critical-and-<5-min rows pinned at the top** in expiry order. Rationale: the operator's primary question is "what's about to time out?", not "what's risky?". Critical-near-expiry combines both — they float. The locked design's risk-rank-then-expiry remains accessible if needed, but is not the default.

Tertiary tiebreak: `createdAt` ascending (older first).

### Responding (the hot path)

When the operator clicks **Approve**:

1. For **high** or **critical** risk: confirm the ack checkbox is ticked (button disabled otherwise). For **low**, **medium**, or **none**: no ack required — the amber CTA fires on click.
2. Call `useRespondToApproval().mutate({ id, action: "approve", bindingHash, respondedBy })`.
3. On success: optimistic-remove the row from the pending list, render `DispatchBanner` in place of the action drawer, do not auto-navigate. The operator decides when to move on.
4. On `409` (stale-version): show inline "This was already decided by a teammate — refreshing your view" with a "Refresh" button that re-fetches `/pending` and re-selects the next row.
5. On network/5xx: inline error banner inside the action drawer ("Couldn't send your approval — your decision wasn't recorded. Safe to try again.") with a Retry button.

**Risk-graded confirmation rationale.** Operators triple-confirm 10+ times a day on routine $80 fee approvals; the friction transfers to high-risk decisions where it actually matters (a $4,820 refund). Scaling friction with risk keeps the integrity contract where it matters and removes alarm fatigue from routine ops. The confirmation code is **always visible** for every risk level — only the *additional ack* (statement-of-intent + checkbox) varies.

**Patch flow** (v1, advanced-only): a "View JSON (advanced) ▾" toggle inside the action drawer reveals the PatchEditor. The flow is then identical to the locked design: side-by-side diff against `parametersSnapshot`, JSON textarea, size budget readout, "Apply patch & approve" CTA. The mutation is `action: "patch"` and `patchValue: <parsed JSON object>`. Server applies patch → re-signs → approves; the dashboard treats this as a single mutation. The advanced toggle is closed by default and remembers per-session preference (`sessionStorage`). If the operator prefers structured editing, they Reject and the agent re-proposes — a structured editor lands in a follow-up.

**Reject flow**: `action: "reject"`. `bindingHash` is omitted. The flow is a two-step inline confirmation — clicking the outline `Reject` button replaces the row with `Confirm reject` (amber outline) + `Cancel`. No reason textarea in v1 — see the Domain note. If reason persistence is added to the backend later, this is the place to surface it.

### Quorum

For approvals where `approvalsRequired > 1`:

- The detail panel renders the `ApproversBlock` (suppressed otherwise — single-approver noise).
- The block reads `request.approvalsRequired`, `request.approvers[]`, `state.approvalHashes[]`.
- Operator-self detection: an approver id matches `session.principalId`.
- Per-approver row shows **name + role + relative timestamp** ("Kira Lim · Manager · signed 2m ago"), not a truncated mono hash. The hash belongs in the audit log, not in human-to-human UI.
- For non-operator approvers, name and role come from a reverse-lookup against the existing team roster (PR-A2 must confirm the lookup endpoint; if unavailable, fall back to the bare principal id with a "Teammate" role tag).
- After local respond, the operator's row flips to "signed just now" but the server-side quorum count is not re-queried until the mutation success refetch or polling. Reconcile keyed off `approvalHashes.length + (localSigned ? 1 : 0)` to avoid flicker.
- The approve-block sub-line changes from "Sends this action to be processed" (single approver) to "Adds your signature to the quorum (n+1 of N after this)" when `approvalsRequired > 1`.

The backend rejects duplicate approvers; on a `400` matching that case, surface "You've already approved this — waiting on others" inline rather than the generic error.

**Quorum payload prerequisite.** `request.approvalsRequired` and `state.approvalHashes[]` are **not** in today's `ApprovalDetail` TypeScript type (`apps/dashboard/src/lib/api-client-types.ts:40–56`) and the Zod schema in `packages/schemas/src/approval-lifecycle.ts` doesn't declare them either. The Fastify route at `apps/api/src/routes/approvals.ts:170–175` passes `approval.request` and `approval.state` through verbatim, so the fields **may** be on the wire depending on what the underlying store returns. **PR-A2 must confirm runtime shape against a quorum lifecycle and either** (a) extend `ApprovalDetail` + the Zod schema to declare the fields if they exist, or (b) extend the Fastify response to add them. If neither path is open within PR-A2, render single-approver-only and defer the Quorum block to a follow-up. Do not ship UI that assumes fields the wire doesn't return.

### Recovery state

Rows with `status === "recovery_required"`:

- Queue row: a small "Needs retry" tag in the meta line; left-edge is a dashed hairline.
- Detail panel: shows the `RecoveryNotice` block between Approvers and ActionDrawer. Copy: "**This action couldn't be prepared.** The agent ran into a problem and needs to try again. Dismiss this card; a new one will appear when the agent retries." No engineering-vocabulary fields. The locked-fixture `reason / proposedFix / lastAttemptAt` payload is **not** in today's `ApprovalDetail` wire and is not synthesized in v1.
- ActionDrawer is replaced with a single quiet **"Dismiss"** button. Clicking Dismiss calls `action: "reject"` with no reason (the rejection just marks the lifecycle so the agent can retry).

**No "Reject lifecycle" label, no "Trigger re-run from the lifecycle" copy.** That's developer language. The operator's mental model is "this card is broken, get rid of it".

If/when the backend adds the recovery payload fields, surface them in a follow-up (flagged in Shared-conventions input). v1 ships with the generic copy above.

### Expired-during-view

If `now >= expiresAt` for the active row (live countdown clears it):

- The row dims (timer strike-through) but stays in the list **until the next refetch** (do not optimistically remove — refetch is the source of truth and the server filters expired rows from `/pending`).
- The detail panel switches to the expired short-circuit in `ActionDrawer`: "This expired N ago. The agent will re-propose if it's still needed." No buttons.

### Loading / empty / error coverage

- **Loading (no prior data):** queue renders 6 skeleton rows. Detail pane renders the empty placeholder. No spinners.
- **Loading (refetch while data shown):** a 1px progress hairline at the top of the queue; no spinner-over-content.
- **Empty queue:** editorial panel — `"Nothing waiting."` in `var(--serif)`, sub copy: "When an agent proposes an action that needs your sign-off, it'll appear here with the full details and a confirmation code." Optional "last cleared N ago" footer is rendered only when a client-side last-decided timestamp exists from the current session; if none, omit. Backend doesn't yet supply this; flagged in Shared-conventions input.
- **Filter narrows to zero:** same chrome, copy "No approvals match this filter." + a quiet "Clear filters" button.
- **Inline error (`/pending` 5xx):** top-of-page inline banner ("Couldn't refresh — last loaded N ago. Retry."), not a full-page replace. Keep stale rows visible.
- **Detail-fetch error:** same banner shape inside the detail pane only.

### Mobile composition

Desktop is the target. Mobile (≤768px) collapses the split:

- Header + filter strip stack as today.
- Queue rendered full-width; the **active row's detail pane is inlined below the row** (accordion-like expansion), not stacked at page bottom. Tapping a different row collapses the current and expands the new. Rationale: keeps "context → action" together in a single eye-line on a phone.
- The action drawer remains at the bottom of the expanded detail, with the amber CTA full-width.
- The Patch advanced toggle is hidden entirely on mobile (≤768px). Operators on mobile either Approve or Reject; structured editing belongs on desktop.
- Filter strip wraps to two rows on narrow viewports; "expiring < 60m" wraps to the second row.
- No fixed/sticky CTA — the action drawer is reachable by scroll. Prevents thumb-zone confusion.

This is "functional mobile", not redesign. Operators at the spa front desk should be able to triage on a phone; deeper investigation is for desktop.

### Decision-feed reconciliation

Alex Home's `useDecisionFeed` (`apps/dashboard/src/hooks/use-decision-feed.ts`) and `components/decisions/decision-card.tsx` surface a cross-kind feed that today includes recommendations and handoffs. Whether/when it also surfaces approvals is an open product question (referenced by the `dispatchDecisionAction` comment in `decision-card.tsx`); this spec does not resolve it.

For v1: **`/approvals` is the single source of truth for the approval queue.** If/when the decision feed starts including approvals, the contract is:

1. The decision card on Alex Home links to `/approvals?id=<id>` and does **not** offer in-line approve/reject.
2. State invalidation: any mutation through `useRespondToApproval` invalidates both `keys.approvals.all()` and `keys.decisions.all()`. PR-A3 will wire both invalidations defensively even before the decision feed surfaces approvals, so we don't ship a stale-state bug later.
3. The /approvals page is the only place the confirmation-code + ack + risk-graded gating exists. Decision-card mini-CTAs would re-introduce the same integrity surface in a smaller space — explicitly prohibited.

### Agent display names

The locked fixtures use internal ids (`billing-agent`, `ops-agent`, `compliance-agent`, etc.). The customer-facing names in this codebase are **Alex / Riley / Mira** (per memory `project_canonical_agent_names`). Add `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-agent-display.ts`:

- A static map from known agent ids → display name + role (`billing-agent` → `{ display: "Alex", role: "Billing & Bookings" }`, `growth-agent` → `{ display: "Riley", role: "Growth" }`, etc.).
- Unknown ids fall back to "an agent" with no role tag. Never render the raw id in customer-facing UI.
- The map is the source of truth for /approvals and is intended to migrate to a shared util when other Mercury surfaces need it (flag in Shared-conventions input).

## Visual design

The locked HTML/JSX (`approvals-v2/`) carries the composition and hierarchy. Tokens and copy follow this spec.

### Tokens

Mirror the local-alias pattern used by `reports.module.css:13–30` and `activity.module.css:11–26`:

```css
.approvalsPage {
  /* Local aliases against the existing Mercury tokens. */
  --cream: var(--mercury-cream);
  --ink: var(--mercury-ink);
  --ink-2: var(--mercury-ink-2);
  --ink-3: var(--mercury-ink-3);
  --ink-4: var(--mercury-ink-4);
  --accent: var(--mercury-accent);
  --accent-soft: var(--mercury-accent-soft);
  --hair: var(--mercury-hairline);
  --hair-soft: var(--mercury-hairline-soft);
  --row-hover: var(--mercury-row-hover);
  --serif: var(--font-serif-mercury);
  --mono: var(--font-mono-mercury);
  --sans: "Inter", ui-sans-serif, system-ui, sans-serif;

  background: var(--cream);
  color: var(--ink);
  font-family: var(--sans);
}
```

Page-local additions (named to match the locked design selectors so the rest of the CSS reads cleanly, but **scoped to `.approvalsPage`**):

```css
.approvalsPage {
  /* Approvals-only extensions. Promote to globals via wave-1.5 if any other surface needs them. */
  --paper-warm: hsl(40 28% 92%); /* approve-drawer background, hairline striped recovery panel */
  --paper-raised: hsl(40 25% 96%); /* patch-editor canvas */
  --hair-strong: hsl(40 15% 78%); /* binding-code top/bottom rule */
  --accent-paper: hsl(20 70% 92%); /* high-risk pill fill */
  --risk-low: var(--ink-4);
  --risk-med: hsl(34 30% 56%);
  --risk-high: hsl(20 70% 48%); /* derived from --mercury-accent, deeper */
  --risk-crit: var(--ink);
}
```

**Do not** introduce `--paper` / `--ink-5` / `--amber` / `--amber-deep` / `--amber-soft` / `--amber-paper` from the locked CSS into globals. They duplicate `--mercury-*`. Flag in Shared-conventions input if any other wave-1 surface independently introduces them — promote to globals in wave-1.5.

### Fonts

- Display: `var(--serif)` → Source Serif 4 (loaded via next/font in `app/layout.tsx`).
- Body: `Inter` (existing).
- Mono: `var(--mono)` → JetBrains Mono via next/font.

**Do not** load Cormorant Garamond. The locked CSS uses it as a designer choice; the dashboard's editorial register is Source Serif 4. Loading a new font is unnecessary payload and inconsistent with /reports, /activity, agent-home.

### Risk visual vocabulary

Risk is communicated in **three layers**, with explicit precedence:

1. **Primary: textual label.** Each row shows `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` in the risk column, mono, uppercase, tracked. This is the operator's actual signal.
2. **Secondary: left-edge hairline weight.** 1px / 2px / 2px / 3px for low / medium / high / critical. Decorative reinforcement; not a primary signal. Recovery is a dashed 2px edge.
3. **Tertiary: detail-pane risk pill.** Low/medium are hollow with a hairline border. High gets `--accent-paper` fill. Critical inverts to filled `--ink` (cream text). This is the only place the pill flips to filled, and only at critical.

The locked design's **risk pips** (4-dot count) are removed. They were an arbitrary visual code competing with the textual label. The textual label carries the meaning; the hairline provides quiet reinforcement; no pips.

**Filter chips:** chip bullet dot uses the `--risk-*` token by category. The `none` category isn't surfaced (chips are low/medium/high/critical + all); `none` rows aggregate into "all".

### Confirmation-code section (the non-negotiable)

(Formerly "binding hash card" in the locked design.)

The block:

- Position: directly under `DetailHeader`, before Approvers, before ActionDrawer. **Cannot be hidden, collapsed, or behind an accordion.**
- Layout: top + bottom 1px `var(--hair-strong)` rules — a bracketed region of the page, not a card with chrome.
- Eyebrow: **`CONFIRMATION CODE · LOCKS IN THE DETAILS ABOVE`** (11px / weight 700 / 0.16em tracking, color `var(--ink)`).
- Code value: full 32-hex string in `var(--mono)` 18px / weight 600 / letter-spacing 0.04em / word-break: break-all. Selectable.
- Copy button: outline button to the right of the code. Click → `navigator.clipboard.writeText(bindingHash)` → 1.4 s "Copied" `--accent` fill state.
- Foot line: **"This code matches the exact details above. If any detail changes, the code changes. If something looks off, reject this and the agent can propose a corrected version."** Mono, 11px, `var(--ink-4)`. Below that, a smaller line: `Reference: <envelopeId>` (mono, 10px, `var(--ink-4)`) — kept for support-conversation traceability without using the word "envelope" in the primary copy.

**No "INTEGRITY CHECK", no "BINDING HASH", no "sha256 · 32 hex · envelope-scoped", no "signed by switchboard-prod".** Those phrases stay in `/activity` and developer-facing surfaces, never on this page.

### Approve block (the second non-negotiable, risk-graded)

Inside the action drawer. The block has **two shapes** depending on risk:

**Shape A — low / medium / none risk** (the common case):

- Brief context line: "Approving sends this to be processed by **Alex** (or whichever agent)." `var(--sans)` 13px, `var(--ink-3)`.
- Code-anchor sub-line (always rendered, so the confirmation code never reads as decorative): **"The confirmation code above locks these details before approval."** `var(--sans)` 12px italic, `var(--ink-4)`.
- Quorum sub-line if applicable: "Adds your signature to the quorum (n+1 of N after this)."
- Amber CTA `Approve` with the short-code chunk as a second line: `Code <ab12…2f5>`. No ack checkbox.

**Shape B — high / critical risk**:

- Statement-of-intent line in `var(--serif)` 20px: **"I've checked the details above. Approve this <action.displayName>."** No "I confirm hash 0x…" framing; the operator authorizes the action, not the hash. The short code chunk appears as a hairline-bordered mono pill at the end of the line.
- Ack checkbox: "I've read the details and the confirmation code `<ab12…2f5>` matches what I want to approve." Default unchecked.
- Quorum sub-line as in Shape A.
- Amber CTA `Approve & sign` with the short-code as a second line. Disabled until the ack checkbox is ticked.

`shortHash(bindingHash) = bindingHash.slice(0, 6) + "…" + bindingHash.slice(-3)` (slightly shorter than the locked design's 10/4 — easier to skim at a glance; the full code is in the section above for verification).

`action.displayName` is a human label derived from the action id (`billing.refund.issue` → "refund", `comms.sms.broadcast` → "SMS broadcast", etc.). PR-A3 includes a small mapper alongside `use-agent-display.ts`. Unknown actions fall back to a tidied version of the id ("billing.refund.issue" → "billing refund issue").

### Dispatch banner copy

Post-respond. Operator-language:

- **Approved (single)**: "**Approved.** Alex is processing this now — check **Activity** in a moment to see the result." Includes a quiet "View in Activity" link.
- **Approved (quorum, your signature added but quorum not yet complete)**: "**Signed.** Waiting on N more teammate(s). You'll get an in-app notification once everyone's approved."
- **Patched & approved**: "**Approved with changes.** Alex is processing the updated version now."
- **Rejected**: "**Rejected.** The card is closed; the agent has been told to stand down."

**No "ExecutableWorkUnit", no "Frozen for 12h", no "idempotency guaranteed by envelope", no `wu_99102` ids in the primary copy.** Those facts live in `/activity` and the audit log. The dispatch banner is reassurance, not telemetry.

### Anti-patterns

- No red/green status traffic lights. Risk uses textual label (primary) + hairline weight (secondary) + filled pill at critical (tertiary).
- No "approve all" mega-button. No multi-select. No bulk operations.
- The confirmation code is **never** behind a click, a tooltip, an accordion, a "View details" toggle, or a hover-only reveal.
- The JSON patch editor **is** behind an "advanced" toggle in v1 — this is deliberate. Non-technical operators must not encounter a JSON textarea by default.
- No cryptography vocabulary in customer-facing copy. "Confirmation code", not "binding hash". "Signed", not "envelope hash". "Processed", not "dispatched".
- No raw agent ids in customer-facing copy. Always go through `use-agent-display`.

## Operator-language copy (rewrite reference)

Locked → operator-facing:

| Surface                          | Locked copy                                                                                  | Operator copy                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Hash-card eyebrow                | `INTEGRITY CHECK · BINDING HASH`                                                             | `CONFIRMATION CODE · LOCKS IN THE DETAILS ABOVE`                                                                       |
| Hash-card foot                   | `sha256 · 32 hex · envelope-scoped`                                                          | (removed; replaced by the foot paragraph above)                                                                        |
| Hash-card meta                   | `envelope <id> · signed by switchboard-prod · signing this hash binds ONLY the params above` | `This code matches the exact details above. If any detail changes, the code changes.` + `Reference: <id>` (line below) |
| Approve commit line              | `I confirm hash 0x1a2b…2f5 and authorize <action>.`                                          | `I've checked the details above. Approve this <action.displayName>.`                                                   |
| Ack checkbox                     | `I have read the parameters and the hash <…> matches what I intend to approve.`              | `I've read the details and the confirmation code <…> matches what I want to approve.`                                  |
| Approve sub (single)             | `signing dispatches the action immediately`                                                  | `Approving sends this to be processed by <Alex>.`                                                                      |
| Approve sub (quorum)             | `signing adds your envelope hash to the quorum (n+1 of N after signing)`                     | `Adds your signature to the quorum (n+1 of N after this).`                                                             |
| Patch row                        | `Modify parameters before approving · opens a JSON editor · diff against parametersSnapshot` | `View JSON (advanced) ▾` (toggle revealing the same editor)                                                            |
| Patch button                     | `Apply patch & approve`                                                                      | `Apply changes & approve`                                                                                              |
| Reject confirm                   | `no hash echo required. recorded against the lifecycle.`                                     | (no copy — two-step inline `Reject` → `Confirm reject`, no reason field in v1)                                         |
| Recovery banner                  | `Approval cannot proceed until upstream recovery completes. Trigger re-run from lifecycle.`  | `This action couldn't be prepared. The agent ran into a problem and needs to try again.`                               |
| Recovery button                  | `Reject lifecycle`                                                                           | `Dismiss`                                                                                                              |
| Dispatch banner                  | `ExecutableWorkUnit captured against binding 0x… Frozen for 12h; idempotency by envelope.`   | `Approved. <Alex> is processing this now — check Activity in a moment to see the result.`                              |
| Quorum approver stamp            | `kira.l · 0xK1RA`                                                                            | `Kira Lim · Manager · signed 2m ago`                                                                                   |
| Queue meta — agent               | `agent: billing-agent`                                                                       | `Alex · Billing & Bookings`                                                                                            |
| Expired action                   | `expired N ago · no action available · agent must re-propose`                                | `This expired N ago. The agent will re-propose if it's still needed.`                                                  |
| Network-error inside drawer      | `POST /api/approvals/respond timed out after 8s. Your envelope is unsigned; retry is safe.`  | `Couldn't send your approval — your decision wasn't recorded. Safe to try again.`                                      |
| 409 conflict                     | (locked design didn't cover)                                                                 | `This was already decided by a teammate — refreshing your view.`                                                       |
| Empty-state pending sub          | `When an agent proposes a mutating action that needs your sign-off, it'll appear here with full evidence and a binding hash.` | `When an agent proposes an action that needs your sign-off, it'll appear here with the full details and a confirmation code.` |

## Accessibility

- Each queue row is a `<button>` with full keyboard support: ↑/↓ navigate within the list when focus is on the queue, Enter selects.
- The ConfirmationCode "Copied" state uses an `aria-live="polite"` region.
- The ack checkbox (Shape B) is fully label-bound; keyboard checking must work.
- Amber-on-amber color contrast for the CTA label: verify against `--mercury-accent` (`hsl(20 90% 55%)`). White text on that hue is ~4.4:1 — borderline AA at 14px+ weight 600. PR-A3 must measure with a real contrast tool and adjust the label weight or background depth if needed (e.g. shift to `--mercury-accent-soft` at `hsl(20 60% 50%)` if AA fails). Document the measurement in the component test.
- Risk hairline is decorative (`aria-hidden`); the textual risk label carries the semantic.
- Patch `<textarea>` (when revealed) is reachable by keyboard; the side-by-side diff renders the snapshot as semantic text (not an image).
- Live countdown: do not announce every second. A polite live-region announcement fires only when crossing into <5 minutes for the active row.
- Respect `prefers-reduced-motion`: disable skeleton shimmer and the copy-button transition.
- Mobile accordion expansion uses `aria-expanded` on the row and `role="region"` with an `aria-labelledby` on the inlined detail.

## Fixtures

Inline `approvals-v2/data.js` (12 rows, Aurora Aesthetics medspa context) into `fixtures.ts` as the gate-off dataset, with these mandatory adaptations:

- `Date.now()`-relative timestamps → ISO strings at module load.
- Agent ids stay as wire-faithful internals (`billing-agent` etc.) so the `use-agent-display` mapper has something to map. The mapper produces the customer-facing names.
- Fixtures cover every required scenario: 1 critical <5min from expiry (`apr_2f1a08`), 2 quorum (`apr_9b73c1` at 2/3, `apr_4e082a` at 1/2), 1 patch worked example (`apr_d77c20`, 10% → 25% — used to test the advanced JSON toggle integration), 1 recovery_required (`apr_e0c4a5`), and a mix of low/medium/high.
- Convert to typed TS — every fixture must satisfy `PendingApproval` + `ApprovalDetail`, with optional `recovery` and `patchProposal` decorations typed as `?:` extensions. These extensions are **fixture-only** and not part of the wire contract.
- In fixture mode, the `DispatchBanner` after a fake-approve renders a synthesized id (`wu_99102`-style) but that id appears **only as a "View in Activity" link target**, never as primary copy.

## Telemetry

Events to emit (via the existing dashboard event helper; if none exists yet, defer to a small follow-up — do not block PR-A1..A5 on this):

- `approvals.viewed` — page mount, with pending count
- `approvals.row_selected` — row click, with id + riskCategory
- `approvals.code_copied` — copy button click (renamed from `hash_copied`)
- `approvals.approve_clicked` — id + riskCategory + quorum?
- `approvals.advanced_json_opened` — when the operator opens the advanced toggle (signal for whether to invest in a structured editor)
- `approvals.patch_submitted` — changed-key **names** only (no values; PII risk)
- `approvals.reject_clicked` — reason length (not the text)
- `approvals.expired_during_view` — when the live countdown crosses zero on the active row
- `approvals.conflict_409` — when the mutation returns 409

Do not emit the confirmation code (verbose; not useful in telemetry). Emit `id` only.

## Test plan

Component tests (Vitest + React Testing Library, matching `(mercury)/activity/__tests__/`):

- **`confirmation-code.test.tsx`**: full code visible at mount (not behind click); code value is selectable text (has no `user-select: none`); copy button writes `bindingHash` verbatim to `navigator.clipboard`; **clipboard-write rejection** (mock `navigator.clipboard.writeText` to throw) renders the fallback "Couldn't copy" message and does not throw past the boundary; reference id renders; no "binding"/"envelope" strings appear in the rendered visible text.
- **`approvers.test.tsx`**: hidden when `approvalsRequired === 1`; renders n-of-m when ≥ 2; non-operator approvers map onto `approvalHashes` by their position in the non-you slice; operator-self detection by `session.principalId`; each row renders name + role + timestamp, never a raw hash.
- **`patch-editor.test.tsx`**: hidden by default (advanced toggle closed); when open, invalid JSON disables submit; size >100KB disables submit and shows the budget readout; diff highlights changed keys; cancel returns to idle without losing seeded patch.
- **`action-drawer.test.tsx`**: low/medium/none → no ack checkbox, CTA enabled on render, code-anchor sub-line present; high/critical → ack required, CTA disabled until ticked, **pressing Enter on the form does not submit** until the box is ticked; expired short-circuits to read-only; recovery short-circuits to "Dismiss" only; responded state renders DispatchBanner; advanced JSON toggle remembers per-session state but is hidden on mobile regardless of stored preference; Reject is two-step inline with no reason field; Reject submission does **not** include `bindingHash`; Patch submission **does** include `bindingHash`; missing `session.principalId` shows the "Sign in again" notice and blocks all three actions.
- **`queue.test.tsx`**: skeleton on loading; empty state copy distinct from filter-narrowed-to-zero copy; selection click bubbles up; no risk-pips render anywhere.
- **`approvals-page.test.tsx`** (integration, fixture mode): full page renders; selecting a row updates URL `?id`; filter chip toggle re-sorts; deep-link with `?id=apr_…` selects on first paint; a `recovery_required` row offers only Dismiss; the 5-min-from-expiry critical row floats to the top of the sort; agent ids render as canonical display names (Alex / Riley / Mira).

Behavioral tests (jsdom + mock fetch):

- 409 on `/respond` triggers operator-language conflict copy and refetches `/pending`.
- 5xx on `/respond` shows retryable operator-language error inside the drawer.
- 5xx on `/pending` shows top-of-page banner without clearing stale rows.
- Mutation success invalidates both `keys.approvals.all()` and `keys.decisions.all()` (regression for the decision-feed reconciliation case).
- Copy-language audit: render the page in every state (idle / approving / patching / rejecting / recovery / expired / dispatched) and walk the **visible text** (Testing Library's `screen.queryByText` over `document.body.textContent`, after excluding `[aria-hidden="true"]`, `<script>`, `<style>`, and elements with `[data-testid="confirmation-code-value"]`) and assert it contains zero engineering-vocabulary strings (denylist: `binding`, `envelope`, `sha256`, `lifecycle`, `dispatch`, `idempotency`, `executable work unit`, `frozen for`, `cartridge`). The `confirmation-code-value` exclusion is so the actual 32-hex code (which happens to **be** a hash) doesn't false-positive a substring match. Data attributes, test ids, ARIA labels on non-visible nodes, and API payload field names are **not** audited — they're developer-facing and may use the internal vocabulary.

Accessibility tests:

- ConfirmationCode "Copied" state announces via aria-live.
- Mobile detail expansion uses `aria-expanded` and is keyboard-operable.
- Approve CTA label contrast (Shape A and Shape B) hits AA at 14px+ weight 600.

Visual regression: out of scope for v1.

## Sequencing

Suggested implementation slices (each ~1 PR, on a feature branch consuming this spec from `main`). The sequencing prioritizes small, reviewable PRs and keeps speculative-UI risk low by deferring quorum until the wire shape is confirmed.

1. **PR-A1a — Route, gate, fixtures, queue (no live behavior)**
   Files: `page.tsx`, `approvals-page.tsx`, `fixtures.ts`, `header.tsx`, `queue.tsx`, `approvals.module.css` (queue/header sections), `use-approvals.ts` (list-only), `use-agent-display.ts`, Tools overflow wiring, `route-availability.ts` + `ToolsNavId` + `TOOLS_LIVE_ENV` updates, `.env.example` addition for `NEXT_PUBLIC_APPROVALS_LIVE`, queue/empty/skeleton tests. **No** filter strip yet, **no** live countdown, **no** detail pane. Sort = expiring-soonest. Static timestamps (no second-by-second tick). This PR is small enough to merge cleanly even if everything downstream slips.

2. **PR-A1b — Filter strip + live countdown + sort behavior**
   `filter-strip.tsx`, `use-now.ts` (page-local 1s tick with visibility-pause), `approvals.module.css` (filter section), `refetchOnWindowFocus` wiring. Includes the critical-and-<5min pinned-to-top sort tweak (since "pinned" only matters once the timer is live). Tests for filter chip toggle, expiring-soonest order, critical-pinning behavior, visibility-pause.

3. **PR-A2 — Detail pane: header, confirmation-code, params (single-approver only)**
   `detail/index.tsx`, `detail/header.tsx`, `detail/confirmation-code.tsx`, `detail/empty.tsx`. **No quorum block in this PR.** The page renders single-approver detail; if the wire returns a quorum row, the page treats it as single-approver until A2b lands (acceptable: the Approve action still works against the wire). Live countdown consumed in `detail/header.tsx`. No action drawer yet; "coming next" placeholder.

4. **PR-A2b — Quorum block (gated on backend payload confirmation)**
   **Prerequisite, must be done at the start of this PR:** confirm `approvalsRequired` + `approvalHashes` runtime shape from the API against a real quorum lifecycle. Then either (a) extend `ApprovalDetail` + the Zod schema in `packages/schemas/src/approval-lifecycle.ts`, or (b) extend the Fastify response in `apps/api/src/routes/approvals.ts`. **Do not write UI against fixture-only assumptions.** Once the runtime shape is proven, ship `detail/approvers.tsx`. If neither path is open, this PR doesn't ship and quorum stays deferred.

5. **PR-A3 — Action drawer: approve (risk-graded) + reject + dispatch banner**
   `detail/action-drawer.tsx`, `detail/reject-confirm.tsx`, `detail/dispatch-banner.tsx`. Wire `useRespondToApproval` for approve and reject. Risk-graded gating (Shape A vs B). Two-step inline reject (no reason field). Operator-language copy throughout. 409 + 5xx handling. Defensive invalidation of `keys.decisions.all()` alongside `keys.approvals.all()`. Contrast verification for the amber CTA label.

6. **PR-A4 — Patch flow (gated behind advanced toggle)**
   `detail/patch-editor.tsx`. The `AdvancedJsonToggle` lives inside the action drawer (added in PR-A3 as a placeholder, wired in PR-A4). Editor closed by default; `sessionStorage` remembers preference. **Hidden entirely on mobile (≤768px)** — even if `sessionStorage` says it was previously open, the mobile breakpoint takes precedence. Worked example: `apr_d77c20` (10% → 25%).

7. **PR-A5 — Recovery + expired-during-view + polish + telemetry**
   `detail/recovery-notice.tsx`, expired short-circuit, telemetry events, mobile accordion polish, copy-language denylist test, finalize fixtures-vs-live parity.

8. **(Optional, post-launch) PR-A6 — Flag flip**
   Set `NEXT_PUBLIC_APPROVALS_LIVE=true`, add to deploy env documentation, verify live API behavior matches fixture mode end-to-end for the single-approver case. If A2b shipped, also verify quorum.

PR-A1a is the gating PR for Tools-overflow visibility; the flag stays false in any non-dev env until PR-A5 lands. PR-A2b is independently optional: a working single-approver experience is the v1 floor.

## Shared-conventions input

Wave 1.5 (`docs/design-prompts/shared-conventions.md`) is being authored in parallel. Decisions to flag for that doc:

- **Mercury Tools surface chrome** — the editorial topbar / brand cluster / `eyebrow + display title + stat-tile row` header is now used by /reports, /activity, and /approvals. Promote to a shared `MercuryToolsHeader` component in wave-1.5.
- **Risk vocabulary** — textual label + hairline weight + filled-only-at-critical is Switchboard-wide for any surface that exposes `RiskCategory`. The page-local `--risk-low/med/high/crit` tokens should be promoted to globals if any other wave-1 surface introduces them.
- **Amber CTA reservation** — `--mercury-accent` is reserved for **mutating-action commit CTAs only** (Approve, Confirm execute, etc.), never for navigation, filter "on" states, or informational badges. Confirm across surfaces.
- **Live-clock pattern** — the `useNow(1000)` + visibility-pause pattern is net-new in /approvals and will likely appear on /mission and other real-time surfaces. Promote `use-now.ts` to a shared hook in wave-1.5.
- **Confirmation-code display** — if other surfaces (e.g. /activity detail drawer) ever need to display a `bindingHash`, the ConfirmationCode component should be promoted to a shared component, not re-implemented. Hold for wave-1.5.
- **Empty-state "last cleared N ago"** — backend doesn't supply this. Either add `lastClearedAt` to `/api/approvals/pending` or each surface synthesizes from session-local state. Pick one convention.
- **Reject reason persistence** — `ApprovalRespondBodySchema` has no `reason` field. Decide whether to add `reason: string` (backend change → also surfaces in `/activity`) or drop the reason field from the UI. v1 captures locally only and is explicit about it in the dialog.
- **Recovery payload** — `recovery.reason / proposedFix / lastAttemptAt` aren't on the wire. Decide whether to add them or keep operator-language generic copy (v1 picks generic).
- **Quorum payload** — `approvalsRequired` and `approvalHashes` aren't in `ApprovalDetail` types or Zod schema. PR-A2 confirms runtime shape and extends type/schema/response as needed.
- **Agent id → display name mapper** — `use-agent-display.ts` is page-local. Promote to `lib/agent-display.ts` (or similar) once other surfaces (`/activity`, recommendations) need the same map.
- **Decision-feed × approval surface** — `/approvals` is the source of truth. If `dispatchDecisionAction` later surfaces approvals on Alex Home, decision cards link to `/approvals?id=`, never approve inline. Pin this rule in shared-conventions.

## Risks

- **Customer-language copy drift over time.** As engineers iterate, "binding hash" creeps back in. Mitigation: the test suite includes a copy-language denylist that fails any PR that re-introduces banned vocabulary in the rendered DOM (see "Test plan").
- **Risk-graded confirmation undertested.** Operators might still click through high/critical without reading. Mitigation: telemetry on `approvals.approve_clicked` with riskCategory + ack-checkbox-tick-to-click latency. If <500ms consistently for critical, the ack isn't doing its job — re-tighten in a follow-up.
- **JSON patch hidden behind advanced toggle = surprising for power users.** Mitigation: the toggle is one click away, labeled "View JSON (advanced)"; once opened it remembers per session. Telemetry on `approvals.advanced_json_opened` will reveal whether power users find it.
- **Quorum payload prerequisite blocks PR-A2b.** PR-A2 ships single-approver-only by design, so PR-A2 is not blocked. If neither extending the Zod schema nor extending the Fastify response is achievable in PR-A2b, the quorum block stays deferred — no speculative UI ships.
- **Operators may not read the code-anchor sub-line.** The low/medium approve path has no hard gate beyond the amber CTA. Mitigation: the sub-line is always rendered (never decoration); if telemetry shows code copies trending to zero on low/medium approvals while high/critical stay healthy, that's a signal the sub-line is being skipped — re-evaluate gating in a follow-up.
- **Spec drift vs shared-conventions.md if it lands first.** Synchronization checkpoint before PR-A1 merges.
- **Live-countdown drift on long-lived tabs.** The 1s tick can drift from server time. Mitigation: refetch `/pending` on `visibilitychange-to-visible` and `refetchOnWindowFocus`.
- **Optimistic dispatch banner without server confirmation.** If the operator approves and navigates away, the banner doesn't persist. Acceptable for v1 (the action is recorded in `/activity` regardless).
- **Mobile accordion expansion vs deep-link.** A `?id=apr_…` deep-link must auto-expand the corresponding row on mobile. Covered in PR-A1 selection logic.

## Acceptance criteria

A reviewer should be able to verify, against this spec and the locked HTML, that:

1. The page renders at `/approvals` under the Mercury editorial shell, gated by `NEXT_PUBLIC_APPROVALS_LIVE`, and appears in the Tools ▾ overflow when the flag is true.
2. The default queue sort is expiring-soonest, with critical-and-<5min pinned at the top.
3. The full confirmation code (bindingHash) is visible — not behind a click — inside the ConfirmationCode block for the active row.
4. **Risk-graded approve gating:** low/medium/none rows enable the amber CTA on render; high/critical rows require ticking the ack checkbox first. A low-risk approval can be completed **without ever interacting with a checkbox** because no checkbox is rendered.
5. The short-code chunk on the approve line, the checkbox (when shown), and the button all match `bindingHash.slice(0,6) + "…" + bindingHash.slice(-3)`.
6. Low/medium approve blocks render the code-anchor sub-line ("The confirmation code above locks these details before approval.") — the code is never visually decorative.
7. High-risk approvals **cannot be submitted by pressing Enter** unless the ack checkbox is ticked (Enter on the form submits the CTA, which is `disabled` until then).
8. Quorum approvals — when shipped (PR-A2b) — render the ApproversBlock with name + role + relative timestamp per approver; never raw hashes or raw ids. Single-approver approvals don't render the block. Prior to PR-A2b, the page renders single-approver UI even for quorum rows and the Approve action still posts correctly.
9. Patch is hidden behind a "View JSON (advanced) ▾" toggle, closed by default, remembered per session, and **hidden entirely on mobile** (≤768px) — even if `sessionStorage` says it was previously open, the mobile breakpoint takes precedence.
10. Reject is a two-step inline confirmation (`Reject` → `Confirm reject`) with **no reason field** in v1. Submitting calls `action: "reject"` and **does not** send `bindingHash`.
11. Patch **does** send `bindingHash` alongside `patchValue` (backend requires it for both approve and patch).
12. `recovery_required` rows show operator-language copy ("This action couldn't be prepared…") and offer **only a "Dismiss" button**, no "Reject lifecycle".
13. Expired rows dim with operator-language copy ("This expired N ago…") and keep the row visible until the next refetch.
14. Empty queue shows "Nothing waiting." in `var(--serif)`; filter-narrowed-to-zero shows "No approvals match this filter."
15. No engineering vocabulary in rendered customer-facing copy (per the denylist test's scope rules: visible text only, excluding the confirmation-code value).
16. Agent ids never render raw in queue rows or detail meta; they go through `use-agent-display` and surface as canonical names (Alex / Riley / Mira) with roles.
17. The confirmation code value is **selectable text** (user can drag-select and copy via system shortcut).
18. The "Copy code" button's clipboard write failure (e.g. permissions-denied in some browsers) **does not break the page** — the button shows a transient "Couldn't copy — select and copy manually" message; the rest of the UI is unaffected.
19. If `session.principalId` is missing, approve / reject / patch are blocked with a "Sign in again" inline notice; this state should never occur inside the `(auth)` group but the guard exists.
20. Successful mutations invalidate both `keys.approvals.all()` and `keys.decisions.all()` — verified by an explicit test even though the decision feed does not yet surface approvals.
21. Mobile (≤768px) collapses to a single-column queue with inline accordion expansion of the active row; `?id=apr_…` deep-links auto-expand the corresponding row on mobile.
22. No new global tokens are introduced; the page uses Mercury tokens locally aliased.
23. Display font is Source Serif 4 (via `var(--serif)`); Cormorant Garamond is not loaded.
24. No red/green status colors anywhere.
25. The risk-pip 4-dot count from the locked design is **not** rendered.
26. The amber CTA label hits WCAG AA contrast at the chosen background (verified in component tests).

---

## Next step

After spec approval, invoke `writing-plans` to produce a detailed implementation plan keyed to PR-A1..A5.
