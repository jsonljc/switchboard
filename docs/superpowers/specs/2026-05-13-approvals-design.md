# /approvals — Design Spec

**Status:** Spec
**Date:** 2026-05-13
**Author:** brainstorming session (Jason + Claude)
**Wave:** wave-1 (parallel with /mission, /activity, /reports, agent-home redesigns)
**Implementation track:** focused PR(s) on a feature branch consuming this spec from `main`
**Surface:** Mercury Tools, route `/approvals` (new), under `(auth)/(mercury)/` shell
**Locked design:** `docs/design-prompts/locked/switchboard/project/approvals-v2/`
**Backend prompt:** `docs/design-prompts/2026-05-13-approvals.md`

---

## Goal

Ship the dashboard surface for the single cross-agent approvals queue. Every mutating action proposed by an agent waits here until the operator signs it (approve), modifies it (patch & approve), or blocks it (reject). The page is the **integrity contract** between the operator and the system: the operator authorizes the cryptographic `bindingHash`, not the button.

Greenfield UI on a stable backend. The data contract is fixed (6 lifecycle statuses, 5 risk categories, 3 response actions — see Domain). Do not invent new statuses, categories, or hash semantics.

## Non-Goals

- Bulk actions ("approve all", multi-select). Each approval is one decision. The locked design is emphatic on this; do not introduce.
- A history / cleared-approvals tab. The "last cleared 13m ago" footer is the only nod to history; the full lifecycle history surface is `/activity`, not here.
- New approval statuses, new risk categories, new response actions. The contract is fixed.
- An audit-log / full-lifecycle drill-in. The locked design notes a quiet footer link to `/lifecycle/:id` _would_ live here, but that route does not exist yet. Out of scope.
- A real-time WebSocket transport. Polling is fine for v1; the live countdown is a client-side `setInterval`, not a stream.
- Mobile-first composition. Desktop two-pane is the design target; mobile is a graceful stack, not a redesign.
- New design tokens. Mirror the tokens already in the locked HTML/JSX (which themselves match `agent-home-v3/Pipeline` + Alex Home v2 editorial register).

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
    // approvalHashes[] when quorum > 1 (see Quorum section).
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

Returns `{ envelope, approvalState, executionResult, resumeWarning? }` on 200. Conflict-on-stale yields `409`.

**Risk categories** — `none | low | medium | high | critical`. The locked design treats `none` and `low` identically at the row level (1px hairline) but the filter strip still surfaces `low/medium/high/critical` as the four chip toggles. `none` rows fall into the "all" view and visually read as `low` (no separate hairline weight). This is intentional; see "Filter strip" below.

**Lifecycle statuses** — `pending` is the queue-resident state. `approved | rejected | expired | superseded` are terminal and not returned by `/api/approvals/pending` (the route filters by `state.expiresAt > now`, and other terminal states are filtered by `listPending`). `recovery_required` is a special non-terminal state that _is_ returned by `/pending` and needs distinct UI (see "Recovery state").

## Architecture

### Route + shell

- New route: `apps/dashboard/src/app/(auth)/(mercury)/approvals/page.tsx` + `approvals-page.tsx` (client component).
- Wrapped by the existing `(mercury)/layout.tsx` (`EditorialAuthShell`).
- Gated identically to other Tools: an `NEXT_PUBLIC_APPROVALS_LIVE` flag, wired via `isMercuryToolLive("approvals")`. Until the flag is true, the page renders a fixtures-only mode and the Tools ▾ overflow entry is hidden — same pattern `/contacts`, `/activity`, `/automations`, `/reports` already use (`apps/dashboard/src/lib/route-availability.ts`).
- Added to `TOOLS_NAV_ITEMS` in `apps/dashboard/src/components/layout/tools-overflow.tsx` (id `"approvals"`, href `/approvals`). New `ToolsNavId` member is the only non-additive change to that file.

### Data layer

The wire calls already exist:

- `client.listPendingApprovals()` → `/api/approvals/pending`
- `client.getApproval(id)` → `/api/approvals/:id`
- `client.respondToApproval(id, body)` → `POST /api/approvals/:id/respond`

The Next.js proxy `apps/dashboard/src/app/api/dashboard/approvals/route.ts` already handles list, detail (via `?id=`), and POST. Use it unchanged.

Hooks (new file `apps/dashboard/src/hooks/use-approvals.ts`):

- `usePendingApprovals()` — `useQuery` on `keys.approvals.pending()`. Polls every **15 s** (sufficient for a live countdown to stay roughly synced; the countdown itself ticks every 1 s client-side from `expiresAt`). `staleTime: 0`.
- `useApprovalDetail(id)` — `useQuery` on `keys.approvals.detail(id)`. Enabled iff `id` is set. `staleTime: 5_000` so rapid selection toggles don't refetch.
- `useRespondToApproval()` — `useMutation`. On success, invalidate `keys.approvals.all()`. On `409`, surface as a typed conflict so the page can prompt the operator that someone else acted.

Query keys already exist at `apps/dashboard/src/lib/query-keys.ts:19–23`. No additions needed.

### Page composition

```
approvals-page.tsx
├── ApprovalsHeader        — eyebrow + title + 3 stat tiles (pending / <1h to expiry / last cleared)
├── ApprovalsFilterStrip   — risk chips (all/low/medium/high/critical), "expiring < 60m", sort hint
├── ApprovalsSplit
│   ├── ApprovalsQueue (left)
│   │   ├── QueueRow × N    — risk hairline edge, summary, meta line, timer
│   │   └── QueueEmpty | QueueSkeleton
│   └── ApprovalsDetail (right)
│       ├── DetailHeader        — risk pill, id, live timer, summary, dh-foot meta, parametersSnapshot grid
│       ├── HashCard            — block 2; eyebrow "INTEGRITY CHECK · BINDING HASH", full hash mono, copy button, envelope-id foot
│       ├── ApproversBlock      — quorum only (required > 1); n-of-m, per-approver state
│       ├── RecoveryBanner      — recovery_required only; striped paper, reason, proposedFix
│       ├── ActionDrawer        — idle | patch | reject modes; expired and recovery short-circuits
│       │   ├── ApproveCommit      — "I confirm hash 0x… and authorize <action>" + ack checkbox + amber CTA
│       │   ├── PatchRow           — opens PatchEditor (side-by-side diff)
│       │   └── RejectRow          — opens RejectDialog (optional reason)
│       └── DispatchBanner      — post-respond confirmation (green-left rule, mono workunit id)
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
  components/
    header.tsx
    filter-strip.tsx
    queue.tsx                       — Queue, QueueRow, RiskPips, QueueSkeleton, QueueEmpty
    detail/
      index.tsx                     — Detail orchestrator
      header.tsx                    — DetailHeader (incl. ParamsSnapshot dl)
      hash-card.tsx                 — HashCard + copy
      approvers.tsx                 — ApproversBlock (quorum)
      recovery-banner.tsx
      action-drawer.tsx             — ActionDrawer, ApproveCommit, PatchRow, RejectRow
      patch-editor.tsx              — PatchEditor (JSON textarea + diff renderer)
      reject-dialog.tsx
      dispatch-banner.tsx
      empty.tsx
  __tests__/
    queue.test.tsx
    hash-card.test.tsx
    patch-editor.test.tsx
    action-drawer.test.tsx
    approvers.test.tsx
    approvals-page.test.tsx         — integration (fixtures mode)
```

File-size budget: 400-line warn / 600-line error. The locked `detail.jsx` is ~530 lines — split into the components above so no single file exceeds the warn line.

### Live countdown

`expiresAt` countdown ticks every **1 s**. Implementation: a single `useNow()` hook at page level returns `now: number`, updated by `setInterval(setNow, 1000)`, cleared on unmount. Queue rows and the detail header consume it as a prop (do not start an interval per row).

When the page is in the background (`document.hidden`), pause the interval — saves cycles and prevents drift fights with the visibility timer. Resume on `visibilitychange`. Re-query `/pending` on visibilitychange-to-visible.

### Selection & URL state

- `?id=apr_…` query parameter holds the active selection. Deep-linkable; back-button works.
- On first load with no `?id`, auto-select the **first row of the sorted filtered queue** (sort = risk-rank-then-expiry, matching `app.jsx:90–96`).
- When the selected row falls out of the filtered set (filter change, dismissal, expiry-during-view), auto-select the new first row. If the queue is empty, render `ApprovalsEmptyDetail`.
- Filter chips are local state; only sort and id round-trip the URL.

### Responding (the hot path)

When the operator clicks **Approve & sign**:

1. Confirm the ack checkbox is ticked (button disabled otherwise).
2. Call `useRespondToApproval().mutate({ id, action: "approve", bindingHash, respondedBy })`.
3. On success: optimistic-remove the row from the pending list, render `DispatchBanner` in place of the action drawer, do not auto-navigate. Operator can move to the next row at their pace.
4. On `409` (stale-version): show inline "This approval was acted on by someone else" with a "Refresh" button that re-fetches `/pending` and re-selects the next row.
5. On network/5xx: inline error banner inside the action drawer ("POST /api/approvals/:id/respond failed — your envelope is unsigned; retry is safe.") with a Retry button. Mirrors the locked design's `errorMode` tweak.

**Patch flow**: same as approve, but `action: "patch"` and `patchValue: <parsed JSON object>`. Server applies patch → re-signs → approves; the dashboard treats this as a single mutation.

**Reject flow**: `action: "reject"`. `bindingHash` is optional (backend only requires it for approve/patch). Reason is captured locally as part of the optimistic dispatch banner ("rejected — '<reason>'") but is **not sent** to the API today — the existing schema has no field for it. Flag in shared-conventions input (see below).

### Quorum

For approvals where `request.approvalsRequired > 1`:

- The detail panel renders the `ApproversBlock` (suppressed otherwise — single-approver noise).
- The block reads `request.approvalsRequired`, `request.approvers[]`, `state.approvalHashes[]`.
- Operator-self detection: an approver id matches the authenticated principal id (from session). The locked design uses `"you"`; in the dashboard this is the session principal, not a hard-coded string.
- After local `respond`, the operator's row in the list flips to "signed (just now)" but the server-side quorum count is not re-queried until either the mutation success refetch lands or polling refreshes. The block must visibly reconcile when the refetch arrives (avoid flicker by keying off `approvalHashes.length + (localSigned ? 1 : 0)`).
- The Approve commit sub-line changes from "signing dispatches the action immediately" to `signing adds your envelope hash to the quorum (n+1 of N after signing)` when `approvalsRequired > 1` (per locked `detail.jsx:393–397`).

The backend rejects duplicate approvers; the UI does not need a separate guard, but on `400` with that specific error, surface "You've already signed this approval" inline rather than the generic error banner.

### Recovery state

Rows with `status === "recovery_required"`:

- Queue row: dashed `recovery` tag in the meta line; left-edge is a dashed (not solid) hairline (`styles.css:329–334`).
- Detail panel: shows the `RecoveryBanner` between Approvers and ActionDrawer (paper-warm striped background, italic Cormorant message, reason + proposedFix + lastAttemptAt mono foot).
- ActionDrawer is **blocked** (no Approve, no Patch). A "Reject lifecycle" button is offered as the only action, matching `detail.jsx:356–370`. Rationale: re-running the upstream cartridge is the upstream owner's job; the operator can't proceed from this hash because the binding is invalid until a fresh `parametersSnapshot` is captured.

The locked fixtures supply `recovery.reason / proposedFix / lastAttemptAt` fields. **These are not in today's `ApprovalDetail` wire shape.** They must be either:

1. Added to the backend response in a passthrough manner (zero-risk additive change to `apps/api/src/routes/approvals.ts:170–175` and `ApprovalDetail` type), or
2. Synthesized client-side from a generic recovery copy until backend lands them.

Pick option (2) for v1 — generic copy ("This approval cannot proceed until an upstream issue is resolved. The agent will re-propose with a fresh binding hash.") and **flag** option (1) in shared-conventions input as a follow-up. Do not synthesize fake `lastAttemptAt` timestamps.

### Expired-during-view

If `now >= expiresAt` for the active row (live countdown clears it):

- The row dims (`qrow-timer.expired` strike-through) but stays in the list **until the next refetch** (do not optimistically remove — refetch is the source of truth and the server already filters expired rows from `/pending`).
- The detail panel switches to the expired short-circuit in `ActionDrawer` ("expired N ago · no action available · agent must re-propose").
- The expired state is non-actionable. No buttons.

### Loading / empty / error coverage

- **Loading (no prior data):** queue renders 6 `SkeletonRow`s. Detail pane renders the `ApprovalsEmptyDetail` placeholder. No spinners anywhere.
- **Loading (refetch while data shown):** show subtle, dignified — a 1px progress hairline at the top of the queue or stat-tile shimmer; no spinner-over-content.
- **Empty queue:** `QueueEmpty` editorial panel — `"Nothing waiting."` in Cormorant, with sub copy ("When an agent proposes a mutating action that needs your sign-off, it'll appear here with full evidence and a binding hash.") and a "last cleared 13m ago" mono foot. Detail pane: `ApprovalsEmptyDetail`. The "last cleared" timestamp comes from an additional API field that **does not exist today** (`/pending` returns only active rows). Synthesize from `Math.min(client-side last-seen approved/rejected mutation timestamp)`; if no history is available this session, omit the line entirely. Flag in shared-conventions input.
- **Filter narrows to zero:** same `QueueEmpty` chrome but with copy "No approvals in this filter." + a quiet "Clear filters" button.
- **Inline error (`/pending` 5xx):** top-of-page inline banner ("`/api/approvals/pending` failed — last loaded N ago. Retry."), not a full-page replace. Keep stale rows visible.
- **Detail-fetch error:** same banner shape inside the detail pane only.

## Visual design

The locked HTML/JSX (`approvals-v2/`) IS the visual contract. Mirror it. Specifics worth calling out:

### Tokens (mirror from locked `styles.css`; do not invent)

```css
--paper: hsl(45 25% 98%);
--paper-warm: hsl(42 32% 95%);
--paper-raised: #ffffff;
--paper-deep: hsl(40 22% 93%);
--ink: #0e0c0a;
--ink-2: #3a332b;
--ink-3: #6b6052;
--ink-4: #a39786;
--ink-5: #c8beae;
--hair: rgba(14, 12, 10, 0.08);
--hair-soft: rgba(14, 12, 10, 0.04);
--hair-strong: rgba(14, 12, 10, 0.16);
--amber: hsl(30 55% 46%);
--amber-deep: hsl(30 60% 32%);
--amber-soft: hsl(38 70% 86%);
--amber-paper: hsl(42 70% 92%);
--risk-low: var(--ink-5);
--risk-med: hsl(34 35% 64%);
--risk-high: hsl(28 40% 48%);
--risk-crit: var(--ink);
--font-display: "Cormorant Garamond", Georgia, serif;
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
--duration-default: 280ms;
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
```

These overlap heavily with the existing `apps/dashboard/src/app/globals.css` tokens (`--sw-base`, `--sw-accent`, etc.). Where the locked design uses `--paper`/`--ink`/`--amber` and the globals use `--sw-base`/`--sw-text-primary`/`--sw-accent`, **use the dashboard's existing `--sw-*` tokens** at the page boundary and only introduce locally-scoped `--paper`/`--ink` aliases inside `approvals.module.css` if it makes the CSS readable. Do not add new globals.

The mapping is:

- `--paper` ≡ `--sw-base`
- `--paper-warm` ≡ a new local alias (close to `--sw-surface`)
- `--ink` ≡ `--sw-text-primary`
- `--ink-3` ≡ `--sw-text-secondary`
- `--ink-4` ≡ `--sw-text-muted`
- `--amber` ≡ `--sw-accent`

The other paper/ink/amber/risk derivatives are page-local aliases inside `approvals.module.css`. Flag in shared-conventions input: if other wave-1 surfaces also introduce `paper-warm` / `amber-deep` / `risk-med` etc., promote them to globals in a wave-1.5 cleanup PR.

### Fonts

Cormorant Garamond + Inter + JetBrains Mono are already loaded for the editorial register (Pipeline, Alex Home v2). No new font wiring needed; ensure the page's `font-family` rules resolve to the existing CSS variables.

### Risk visual vocabulary

- **Row left edge:** hairline at 1px / 2px / 2px / 3px for low / medium / high / critical (no hue change; weight + amber depth communicates risk). Recovery is a dashed 2px edge.
- **Risk pips (row meta):** 4 dots, `low=1 on`, `medium=2`, `high=3`, `critical=4`. Off-pips use `var(--ink-5)`. On-pips use `currentColor` of the parent `.qrow-risk` label (low=ink-4, medium=ink-3, high=amber-deep, critical=ink). No red/green.
- **Detail risk pill (`.dh-pill[data-risk=…]`):** low/medium hollow with hairline border; high gets `amber-paper` fill; critical inverts to filled ink (paper text). This is the **only** place the pill flips to filled, and only at `critical`.
- **Filter chips:** chip bullet dot uses the `--risk-*` token by category. `none` rows are not surfaced in the filter strip (the four chips are low/medium/high/critical); `none`-category rows aggregate into "all" and visually read as low.

### Integrity-check card (the non-negotiable)

The `HashCard` block:

- Position: directly under `DetailHeader`, before Approvers, before ActionDrawer. **Cannot be hidden, collapsed, or behind an accordion.**
- Layout: top + bottom 1px `var(--ink)` rules (not a "card" with chrome — a _bracketed_ region of the page).
- Eyebrow: `INTEGRITY CHECK · BINDING HASH` (11px / 700 / 0.18em tracking, color `var(--ink)` not muted).
- Hash value: full 32-hex string in JetBrains Mono 18px / weight 600 / letter-spacing 0.04em / word-break: break-all. Selectable.
- Copy button: outline button to the right of the hash. Click → `navigator.clipboard.writeText(bindingHash)` → 1.4 s "copied" amber fill state.
- Foot line: `envelope <envelopeId> · signed by switchboard-prod · signing this hash binds ONLY the parameters shown above`. Mono, 11px, ink-4 with ink-2 on the envelope id.

### Approve commit (the second non-negotiable)

Inline inside the action drawer. **Required** before the amber CTA enables:

- Cormorant 22px statement-of-intent line: `I confirm hash <0x1a2b…2f5> and authorize <action.name>.` The hash and action are visually emphasized: the hash chunk is in a hairline-bordered mono pill (`.ic`); the action name is in amber italic Cormorant (`.actv`).
- Sub-line: `signing dispatches the action immediately` (single approver) or `signing adds your envelope hash to the quorum (n+1 of N after signing)`.
- Ack checkbox: `I have read the parameters and the hash <0x1a2b…2f5> matches what I intend to approve.` Default unchecked.
- Amber CTA `Approve & sign` with the short hash as a second line on the button. Disabled until the ack checkbox is ticked.
- The short-hash chunk (`shortHash`) is `bindingHash.slice(0,10) + "…" + bindingHash.slice(-4)`. Mirror exactly — operators pattern-match the same chunk in the card, the line, the checkbox, and the button.

### Anti-patterns (re-stated from doctrine)

- No red/green status traffic lights. Risk uses hairline weight + amber depth + filled-vs-hollow pill at critical only.
- No "approve all" mega-button. No multi-select. No bulk operations.
- The binding hash is **never** behind a click, a tooltip, an accordion, a "View details" toggle, or a hover-only reveal.
- Patch is **not** a hidden option behind "More" — it is a first-class row in the action drawer, second only to Approve.
- No Material/Fluent SaaS chrome. Editorial-utilitarian: thin rules, generous whitespace, mono+serif tension.

## Accessibility

- Each `QueueRow` is a `<button>` with full keyboard support: ↑/↓ navigate within the list when focus is on the queue, Enter selects.
- The `HashCard` `<output>` for the copy state uses `aria-live="polite"` so screen readers announce "copied".
- The ack checkbox label is fully bound; checking via keyboard must work.
- Amber-on-amber color contrast: verify the `Approve & sign` button label hits WCAG AA at 14px+ weight 600 against `--amber` background. The locked design uses `#fff` text on `hsl(30 55% 46%)` — contrast ratio 4.6:1, passes AA for normal text. Document in component test.
- `RiskPips` are decorative (`aria-hidden`); the textual risk label on the row carries the semantic.
- The patch editor `<textarea>` is reachable by keyboard; the side-by-side diff renders the snapshot as semantic text (not an image).
- Live countdown: do not announce every second. Use a polite live region only when crossing thresholds (e.g. crossing into <5 minutes) to avoid SR spam.
- Respect `prefers-reduced-motion`: disable the skeleton shimmer animation and the copy-button transition when set.

## Fixtures

Inline `approvals-v2/data.js` (12 rows, Aurora Aesthetics medspa context) verbatim into `fixtures.ts` as the gate-off mode dataset. The fixtures already cover every required scenario:

- 1 critical within 5 min of expiry (`apr_2f1a08`, refund)
- 2 quorum (`apr_9b73c1` at 2/3, `apr_4e082a` at 1/2)
- 1 patch worked example (`apr_d77c20`, discount 10% → 25%)
- 1 recovery_required (`apr_e0c4a5`, GDPR export)
- Mix of low/medium/high risk across 12 rows

Convert the JS to typed TS — every fixture must satisfy the `PendingApproval` + `ApprovalDetail` shapes (extended with the optional `recovery` and `patchProposal` decorations the live API doesn't yet return; type these as `?:` extensions).

`Date.now()`-relative timestamps in the locked fixtures must convert to ISO strings at the boundary, since the API ships ISO. Compute them at module load (`new Date(Date.now() + 4 * 60_000).toISOString()`).

The dispatched / responded UI also needs a worked example — when the operator approves a fixture row, the `DispatchBanner` renders a synthesized `wu_99102`-style id. This is purely client-side feedback in fixture mode.

## Telemetry

Minimum events (mirror existing dashboard convention; emit via the existing client-side audit-event helper if one exists, otherwise via `useTelemetry` if available; otherwise defer):

- `approvals.viewed` — page mount, with pending count + filter state
- `approvals.row_selected` — row click, with id + riskCategory
- `approvals.hash_copied` — copy button click
- `approvals.approve_clicked` — with id + quorum present?
- `approvals.patch_opened` — patch editor opened
- `approvals.patch_submitted` — with changed-key list (NOT the patch value itself; PII risk)
- `approvals.reject_clicked` — with optional reason length
- `approvals.expired_during_view` — when the live countdown crosses zero on the active row
- `approvals.conflict_409` — when the mutation returns 409

Do not emit hashes themselves (they are envelope-scoped, not secret, but they're not useful in telemetry and they're verbose). Emit `id` only.

## Test plan

Component tests (Vitest + React Testing Library, matching `(mercury)/activity/__tests__/` patterns):

- **`hash-card.test.tsx`**: full hash visible at mount (not behind click); copy button writes to `navigator.clipboard`; envelope id renders.
- **`approvers.test.tsx`**: hidden when `approvalsRequired === 1`; renders n-of-m when ≥ 2; non-operator approvers map onto `approvalHashes` by their position in the non-you slice (regression for the bug fixed in chat12 round 2); operator-self detection by session principal.
- **`patch-editor.test.tsx`**: invalid JSON disables submit; size >100KB disables submit and shows the budget readout; diff highlights changed keys; cancel returns to idle mode without losing seeded patch.
- **`action-drawer.test.tsx`**: ack checkbox gates the approve button; expired short-circuits to read-only; recovery short-circuits to "Reject lifecycle" only; responded state renders dispatch banner.
- **`queue.test.tsx`**: skeleton on loading; empty state on zero rows; filter-narrowed-to-zero copy distinct from empty-queue copy; selection click bubbles up.
- **`approvals-page.test.tsx`** (integration, fixture mode): full page renders, selecting a row updates the URL `?id`, filter chip toggle re-sorts the queue, "expiring < 60m" toggle narrows correctly, deep-link with `?id=apr_…` selects that row on first paint, a `recovery_required` row blocks Approve+Patch, the 5-min-from-expiry row's timer reads `critical`-class.

Behavioral tests (jsdom + mock fetch):

- 409 on `/respond` triggers the inline conflict copy and refetches `/pending`.
- 5xx on `/respond` shows retryable inline error inside the action drawer.
- 5xx on `/pending` shows top-of-page banner without clearing the stale rows.

Visual regression: out of scope for v1; the locked HTML is the visual reference.

## Sequencing

Suggested implementation slices (each ~1 PR, all on a feature branch consuming this spec from `main`):

1. **PR-A1 — Route shell + fixtures + queue**
   Files: `page.tsx`, `approvals-page.tsx`, `fixtures.ts`, `header.tsx`, `filter-strip.tsx`, `queue.tsx`, `approvals.module.css` (queue/header/filter sections), `use-approvals.ts` (list-only), Tools overflow wiring + `route-availability.ts` + tests. Gate-off via `NEXT_PUBLIC_APPROVALS_LIVE`. Selection + URL plumbing. No respond actions yet.

2. **PR-A2 — Detail pane: header, hash card, params, quorum**
   `detail/index.tsx`, `detail/header.tsx`, `detail/hash-card.tsx`, `detail/approvers.tsx`, `detail/empty.tsx`. Live countdown hook. No action drawer yet; render a "coming next" placeholder where the drawer will be.

3. **PR-A3 — Action drawer: approve + reject**
   `detail/action-drawer.tsx`, `detail/reject-dialog.tsx`, `detail/dispatch-banner.tsx`. Wire the `useRespondToApproval` mutation for approve+reject. Hash-echo. Ack-checkbox gate. 409 + 5xx handling.

4. **PR-A4 — Patch flow**
   `detail/patch-editor.tsx`. JSON diff, size budget, apply-patch-and-approve. The locked design's worked example (`apr_d77c20` 10% → 25%) should be the integration test fixture.

5. **PR-A5 — Recovery + expired-during-view + polish**
   `detail/recovery-banner.tsx`, expired short-circuit, visibility-pause for the interval, polish pass, all telemetry events, finalize fixtures-vs-live parity.

6. **(Optional, post-launch) PR-A6 — Flag flip**
   Set `NEXT_PUBLIC_APPROVALS_LIVE=true`, add it to deploy env documentation, confirm live API behavior matches fixture mode for at least the 1-of-N single-approver case.

Each PR carries its own tests. PR-A1 is the gating PR for Tools-overflow visibility; until PR-A5 lands, the flag must stay false in any non-dev env.

## Shared-conventions input

Wave 1.5 (`docs/design-prompts/shared-conventions.md`) is being authored in parallel. From this surface, flag the following cross-surface decisions for that doc:

- **Mercury Tools surface chrome** — the editorial topbar / brand cluster / `eyebrow + display title + stat-tile row` header pattern in the locked design IS the Mercury Tools page-head template. /reports and /activity already use a close variant. Confirm one canonical implementation (e.g. a shared `MercuryToolsHeader` component) versus per-surface copies. This spec assumes per-surface for now and flags the duplication.
- **Risk vocabulary** — hairline-weight + amber-depth + filled-only-at-critical is a Switchboard-wide risk vocabulary (it will also apply to /recommendations queue, /agent-home pipeline, and other surfaces that surface `RiskCategory`). The tokens `--risk-low/med/high/crit` should be promoted from page-local to global if any other wave-1 surface introduces them.
- **Amber CTA reservation** — `--amber` is the operator's signature color. Confirm the rule across surfaces: amber is reserved for **mutating-action commit CTAs only** (Approve & sign, Confirm execute, etc.), never for navigation, never for filter "on" states, never for informational badges.
- **Live-clock pattern** — the `useNow(1000)` + visibility-pause pattern will appear on /mission, /activity (if we surface real-time), and /approvals. Standardize.
- **Integrity-hash display** — if other surfaces ever need to display a `bindingHash` (e.g. /activity detail drawer), the HashCard component should be promoted to a shared component, not re-implemented. Don't promote in v1; flag for wave 1.5.
- **Empty-state "last cleared N ago" footer** — the timestamp source isn't in today's `/pending` wire. Either backend adds `lastClearedAt` to the `/pending` response or each surface synthesizes from session-local state. Pick one convention.
- **Reject reason field** — `POST /api/approvals/:id/respond` accepts no `reason` parameter today. Decide whether to add `reason: string` to `ApprovalRespondBodySchema` (backend change) and capture it persistently, or drop the optional reason textarea from the locked design (UI change). This spec captures locally for the dispatch banner but does not persist. Flag in shared-conventions.
- **Recovery payload** — the locked design renders `recovery.reason / proposedFix / lastAttemptAt` on recovery rows. None of those fields are in today's `ApprovalDetail` wire. Decide whether to add them to the backend response or fall back to a generic recovery copy (this spec picks generic copy as v1).
- **Quorum payload** — `request.approvalsRequired` and `state.approvalHashes[]` are referenced by the locked design and used by the Quorum block, but they are not in today's `ApprovalDetail` TypeScript type (`apps/dashboard/src/lib/api-client-types.ts:40–56`). The Fastify route passes `approval.request` and `approval.state` through verbatim, so the fields may be on the wire depending on what `approvals.getById` returns. Action item: confirm the runtime shape from the API for a quorum lifecycle, then either (a) add the fields to `ApprovalDetail` if they exist, or (b) extend the backend response. This spec assumes the fields exist on the wire and treats their absence as "single-approver" (gracefully hide the Quorum block when `approvalsRequired === 1` or missing).

## Risks

- **Spec drift if shared-conventions.md lands first and contradicts.** This spec mirrors the locked HTML/JSX exactly, so any conflict will be resolved in favor of shared-conventions; document a synchronization checkpoint before PR-A1 merges.
- **Wire-shape additions for recovery/last-cleared.** v1 ships with synthesized fallback copy. The schemas are not blocked, but if the backend adds those fields later, a small follow-up adjusts the UI; flagging here so it doesn't surprise.
- **Live-countdown drift on long-lived tabs.** The `useNow` interval can drift from server time. Mitigation: the page refetches `/pending` on visibilitychange-to-visible, which carries fresh `expiresAt` values; the local countdown reconciles on each refetch.
- **Optimistic dispatch banner without server confirmation.** If the operator approves and immediately navigates away, the banner does not persist. Acceptable for v1 (the audit log persists); if pain emerges, add a session-level "recently dispatched" toast queue in a follow-up.
- **Patch JSON editing is unforgiving.** A 100-line `parametersSnapshot` is hard to patch in a raw textarea. v1 ships the textarea; if telemetry shows long abandon rates on the patch flow, upgrade to a structured editor in a follow-up. Out of scope here.

## Acceptance criteria

A reviewer should be able to verify, against this spec and the locked HTML, that:

1. The page renders at `/approvals` under the Mercury editorial shell, gated by `NEXT_PUBLIC_APPROVALS_LIVE`, and appears in the Tools ▾ overflow when the flag is true.
2. The queue's risk-rank-then-expiry sort matches the locked design (`app.jsx:90–96`).
3. The full binding hash is visible (not behind a click) inside the `HashCard` for the active row.
4. The `Approve & sign` button is disabled until the ack checkbox is ticked; the short hash chunk on the line, the checkbox, and the button all match `shortHash(bindingHash)`.
5. Quorum approvals render the `ApproversBlock`; single-approver approvals do not.
6. The patch flow opens a side-by-side diff against `parametersSnapshot`, validates JSON, enforces ≤100KB, and submits via `action: "patch"` with the `patchValue` payload.
7. Reject opens the optional-reason dialog; submitting calls `action: "reject"` without `bindingHash`.
8. `recovery_required` rows block Approve and Patch and offer only "Reject lifecycle".
9. The expired-during-view case dims the row, switches the detail panel to read-only, and keeps the row visible until the next refetch.
10. The empty queue shows the editorial "Nothing waiting" panel; filter-narrowed-to-zero shows the distinct "No approvals in this filter" copy.
11. No new design tokens are introduced at the globals level; the visual register matches Pipeline / Alex Home v2 editorial tier.
12. No red/green status colors anywhere in the UI.

---

## Next step

After spec approval, invoke `writing-plans` to produce a detailed implementation plan keyed to PR-A1..A5.
