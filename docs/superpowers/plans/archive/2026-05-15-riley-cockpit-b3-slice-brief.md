# Riley Cockpit B.3 — Voice + Accent + Toast Schema (palette-deferred split of B.3)

**Date:** 2026-05-15
**Parent spec:** [Riley Cockpit — Wave A Slicing Design](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) (§Slice B.3)
**Target spec:** [Riley Cockpit Home — Design Spec](../specs/2026-05-13-riley-cockpit-home-design.md) (§Riley voice, §Composer, §Command palette)
**Predecessor slices:**

- Riley B.1 — `feat(riley-cockpit): B.1 — core operator loop at /riley` (#488, squash `5ef3910a`)
- Riley B.2a — `docs(riley-cockpit): B.2a slice brief + implementation plan` (#494, OPEN) — mission popover wiring; not a blocker for B.3
- Alex A.2 — `feat(cockpit): A.2 mission popover + Day-1 narrator` (#485, squash `67eb0618`)

---

## Why B.3 is split

The Wave A slicing spec scopes B.3 as five bundled deliverables in a single PR:

1. Riley accent applied uniformly.
2. **Command palette pre-populated with `RILEY_COMMANDS`; ⌘K opens it; commands grouped.**
3. **Composer placeholder + NL parsing + bounded `Allowed-in-B.3` command set.**
4. `RecommendationPresentation.acceptToast` + `declineToast` schema fields; engine populates; cockpit toasts use them with fallback to `rileyToast()`.
5. Final empty / error copy pass.

Items 2 and 3 carry a hard dependency the slicing spec names explicitly: **"Alex A.5 must merge first (command palette + composer + toast infrastructure)."** Alex A.5 has not shipped (A.3 is implemented on a worktree branch, not merged; A.4/A.5 do not exist on `main` today). Until A.5 lands, the dashboard has no `<CommandPalette>` component, no composer NL parser, no ⌘K handler, no command-grouping primitives — there is nothing for Riley's `RILEY_COMMANDS` catalog to plug into.

B.3 ships the four sub-deliverables that **do not** depend on A.5's shell infrastructure:

- **Riley accent applied uniformly** — parameterize the four shell components that today hardcode Alex tokens (`<StatusPill>`, `<ApprovalCard>` eyebrow, `<ComposerPlaceholder>` sender label, plus a verification pass on the activity stream) and pass Riley accent values from `RileyCockpitPage`.
- **Riley voice on approval-card accept/decline** — `RecommendationPresentation.acceptToast` + `declineToast` Zod fields, engine population in `recommendation-sink.ts`, `rileyToast()` voice helper, **and the missing B.1 deferral**: wire `RileyCockpitPage.onResolve` to `useRecommendationAction` (B.1 shipped this as a no-op stub).
- **`RILEY_COMMANDS` + `RILEY_COMPOSER_PLACEHOLDER` typed catalog** exported from `riley-config.ts` so Alex A.5 can consume them without re-deriving the spec.
- **Riley copy on the inert composer placeholder** — sender label `→ RILEY`, Riley-voice placeholder text, Riley accent on the chrome. The placeholder remains non-interactive (no submit handler, no NL parser, no ⌘K binding) until A.5.

Items 2–3's _interactive behavior_ moves to a B.3-followup slice opened after Alex A.5 lands. That follow-up consumes the `RILEY_COMMANDS` catalog this slice ships and wires the composer's `Allowed-in-B.3` semantics. **Riley's surfaced personality moment (accent + accept/decline voice) ships now**; the palette/composer interactive layer ships when the shell exists.

This split is consistent with the slicing spec's load-bearing rule (adapter boundary) — B.3 introduces no new substrate, no new mutation paths, and no new view-model fields. The `ApprovalView` interface already exposes optional `acceptToast` / `declineToast` (declared in B.1's `types.ts` but never consumed); B.3 reads them.

---

## Slice goal

Make Riley sound and look like Riley everywhere the operator already sees Riley today: the `/riley` status pill, the approval-card eyebrow and palette, the composer placeholder copy, and the toast that fires when the operator accepts or declines a Riley recommendation. The slicing spec's "honest impact language" guardrail from B.2 carries over: nothing in this slice claims Riley _improved_ a metric — accept/decline toasts narrate what Riley **did with the operator's instruction**, not causal impact.

B.1 stubbed approval resolution with a no-op (`// B.1 stops at view assembly; resolution wires up at a future slice.` — `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx:43-45`). B.3 is that future slice for the resolution-wiring concern.

---

## What ships

### Schema (`packages/schemas/src/recommendations.ts`)

| Change                                                                                                                                                            | Responsibility                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend `RecommendationPresentationSchema` with two optional fields: `acceptToast: z.string().min(1).optional()` and `declineToast: z.string().min(1).optional()`. | Persisted toast copy authored by the engine when context exists. Both optional — the existing 4 required fields stay required; older recommendation rows continue to parse. |
| Extend `packages/schemas/src/__tests__/recommendations.test.ts` `describe("RecommendationPresentationSchema", …)` block.                                          | Three new cases: (a) presentation parses when both toasts present, (b) presentation parses when toasts absent, (c) empty-string toasts are rejected.                        |

No Prisma migration is required. `presentation` is embedded inside the `PendingActionRecord.parameters` JSON column (verified at `packages/db/prisma/schema.prisma:1459-1494` — there is no typed `presentation` Prisma column; `extractPresentation(row.parameters)` at `packages/core/src/decisions/adapters/recommendation-adapter.ts:19` reads it as freeform JSON). Adding optional fields to the embedded Zod shape is a non-breaking schema-layer change.

### Engine (`packages/ad-optimizer/src/recommendation-sink.ts`)

| Change                                                                                                                                                                                                   | Responsibility                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend `buildPresentation(rec)` at `packages/ad-optimizer/src/recommendation-sink.ts:126-155` to populate `acceptToast` + `declineToast` for each of the 14 Riley action variants in the `labels` table. | Engine-side authorship — the lines per action are short, first-person, action-specific. Values lock into the toast-copy table in the implementation plan. |
| Extend `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`.                                                                                                                                | One new case asserting `acceptToast` + `declineToast` are present and well-formed on the emitted recommendation for each action variant.                  |

The router (`packages/core/src/recommendations/router.ts`) and the existing `extractPresentation` adapter pass `parameters` through untouched, so the engine-emitted toast copy reaches the cockpit hooks without any router/adapter change.

### Dashboard — accent parameterization

Three shell components today hardcode Alex tokens. Each gains two new optional props with Alex defaults, so Alex's cockpit-page need not change.

| File                                                                   | Today                                                                                                 | After B.3                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/cockpit/approval-card.tsx:24-30`        | Eyebrow renders the literal `"Alex needs you"` in `T.amberDeep`.                                      | Accepts `accent?: { base; deep; soft; paper }` (default = Alex amber tokens) and `senderLabel?: string` (default = `"Alex needs you"`). Eyebrow, card background, and border use `accent` tokens.                                                                                                 |
| `apps/dashboard/src/components/cockpit/composer-placeholder.tsx:38-43` | `→ ALEX` sender label hardcoded; placeholder string `"Tell Alex what to do — coming soon"` hardcoded. | Accepts `senderLabel?: string` (default `"ALEX"`), `placeholderCopy?: string` (default `"Tell Alex what to do — coming soon"`), and `accentColor?: string` (default `T.ink4` — the existing Alex-muted color used by the sender label).                                                           |
| `apps/dashboard/src/components/cockpit/status-pill.tsx:3-13`           | Hard-imports `statusColor` and `statusPulse` from `@/lib/cockpit/alex-config`.                        | Accepts optional `colorFor?: (s: CockpitStatus, halted: boolean) => string` and `pulseFor?: (s: CockpitStatus, halted: boolean) => boolean`; defaults remain Alex's exports. Riley page passes the Riley exports already defined at `apps/dashboard/src/lib/cockpit/riley/riley-config.ts:24-49`. |

The activity stream uses per-kind colors via `kind-meta` (`apps/dashboard/src/components/cockpit/kind-meta.ts` and the Riley extension at `kind-meta-riley.ts`); the Riley sender-label color on activity rows is satisfied by the existing Riley kind-meta colors and **does not need B.3 changes**. This is verified in the implementation plan's pre-merge grep check.

### Dashboard — Riley toast voice

New module: `apps/dashboard/src/lib/cockpit/riley/riley-toast.ts`.

```ts
export type RileyToastVerdict = "accept" | "decline";

export function rileyToast(args: {
  verdict: RileyToastVerdict;
  approval: RileyApprovalView; // narrow view-model — no Recommendation, no AuditEntry
}): { title: string; description?: string };
```

- When `args.verdict === "accept"` and `args.approval.acceptToast` is non-empty, return `{ title: args.approval.acceptToast }`.
- When `args.verdict === "decline"` and `args.approval.declineToast` is non-empty, return `{ title: args.approval.declineToast }`.
- Otherwise, return the fallback generic line keyed off `args.approval.kind` (e.g., `pause` → `"Paused — standing by."` on accept, `"Holding — back to scanning."` on decline). The fallback table lives inline in the module; the implementation plan locks the 11 kind keys + 2 verdicts = 22 fallback strings.

`rileyToast()` lives in `lib/cockpit/riley/**` because that is the adapter layer; it consumes only the `RileyApprovalView` view-model (no Prisma, no schemas/recommendations).

### Dashboard — Riley command catalog (typed config; not interactive)

`apps/dashboard/src/lib/cockpit/riley/riley-config.ts` gains:

```ts
export const RILEY_COMPOSER_PLACEHOLDER =
  "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…";

export interface RileyCommand {
  id: string;
  label: string;
  group: "control" | "thread" | "rules" | "nav";
  // B.3-followup will add: handler, semantic action, etc.
  // B.3 ships the catalog as typed data only.
}

export const RILEY_COMMANDS: readonly RileyCommand[] = [
  { id: "open-meta", label: "Open Meta", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "rules" },
  { id: "open-targets", label: "Open targets", group: "rules" },
  { id: "pause-1h", label: "Pause Riley for 1h", group: "control" },
  { id: "resume", label: "Resume Riley", group: "control" },
  { id: "brief-eod", label: "Brief me at EOD", group: "thread" },
  { id: "cpl-30", label: "Show CPL — last 30d", group: "thread" },
  // … full catalog locked in the implementation plan.
];
```

The catalog ships as typed data only — no consumer wires it in this slice. The composer placeholder stays inert; the topbar already passes `paletteEnabled={false}` (`apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx:34`).

### Dashboard — Riley voice consumption in `RileyCockpitPage`

`useRecommendationAction(id)` is keyed by recommendation id, so multi-card scenarios (which B.1 supports per its acceptance criterion #3, "Approval cards stack with `urgency = immediate` first…") require **per-row hook binding**, not a single page-level hook call. B.3 introduces a tiny `<RileyApprovalRow>` wrapper inside `riley-cockpit-page.tsx` that owns one `useRecommendationAction(approval.id)` and one `useToast()`-bound `onResolve`. The page maps `approvals` to a list of these wrappers inside a flex container that inlines the same gap + margin layout `<ApprovalBlock>` provides. Alex's page continues to use `<ApprovalBlock>` unchanged — its API is **not** extended in this slice.

The wrapper enforces three behaviors:

1. **Success-only toast.** Resolution uses `promise.then(...)`, not `promise.finally(...)`. A failed `primary()` / `dismiss()` must not produce a success-sounding toast like "Paused Cold Interests" if the action actually failed. Errors surface through TanStack Query's `error` state on `useRecommendationAction`; B.3 does not add error toasts.
2. **External primary actions open the Meta URL and stop.** When `approval.primaryAction.kind === "external"`, the accept click opens `approval.primaryAction.url` in a new tab via `window.open(url, "_blank", "noopener,noreferrer")`. No `useRecommendationAction.primary()` call. No toast. The new tab opening is the visible confirmation. This covers `review_budget`, `fix_signal_health`, `harden_capi_attribution`.
3. **Decline always dispatches.** The decline path is identical for internal and external action kinds: call `action.dismiss()` and fire `rileyToast({ verdict: "decline", approval })`.

| Change                            | Today (`apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`)                                                                                                  | After B.3                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onResolve` callback              | No-op stub at lines 43-45.                                                                                                                                              | Per-row wrapper. Internal accept → `action.primary().then(toast)`. External accept → `window.open(primaryAction.url, …)` only. Decline (always) → `action.dismiss().then(toast)`. The wrapper keys each hook to the row's `approval.id`, so the multi-card invariant holds.                                  |
| `<ApprovalCard>` accent           | Renders Alex amber + "Alex needs you" eyebrow.                                                                                                                          | Wrapper passes `accent={RILEY_APPROVAL_ACCENT}` and `senderLabel="Riley needs you"`.                                                                                                                                                                                                                         |
| `<ApprovalBlock>` use on `/riley` | B.1 wraps approvals via `<ApprovalBlock>`.                                                                                                                              | Riley page maps approvals directly to `<RileyApprovalRow>` (which renders `<ApprovalCard>` internally). `<ApprovalBlock>` stays in the codebase for Alex unchanged. The `<ApprovalBlock>` API is **not** extended — pass-through props can be added later if Alex needs theming, but B.3 does not need them. |
| `<ComposerPlaceholder>` props     | `halted={haltCtx.halted}` only.                                                                                                                                         | Adds `senderLabel="RILEY"`, `placeholderCopy={RILEY_COMPOSER_PLACEHOLDER}`, `accentColor={RILEY_ACCENT.deep}`.                                                                                                                                                                                               |
| `<StatusPill>` props              | Today the pill is rendered inside `<Identity>` which already wraps `StatusPill`; B.3 plumbs the per-agent color/pulse functions through `<Identity>` to `<StatusPill>`. | Riley page passes Riley `statusColor` + `statusPulse` via Identity's new optional props. Alex page omits → defaults apply.                                                                                                                                                                                   |

The B.1 cockpit-status integration test (`apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`) gains a `describe("RileyCockpitPage — B.3 voice + accent", …)` block (8 new cases):

- **Internal accept** — click rec-1's primary; verify `primary()` is called on rec-1's hook and `toast({ title: rec.acceptToast })`.
- **Internal decline** — click rec-1's secondary button; assert `dismiss()` on rec-1's hook + `toast({ title: rec.declineToast })`.
- **Per-row binding** — multi-card fixture, click rec-2's primary → expect `primary()` to fire on rec-2's hook, not rec-1's. Proves the per-row wrapper pattern.
- **Fallback toast** — toast copy when engine emits no `acceptToast`/`declineToast` falls back to `rileyToast()` per-kind line.
- **Eyebrow** — every approval card in a multi-card render shows `"Riley needs you"`.
- **External primary opens URL, no mutation, no toast** — fixture with `primaryAction.kind === "external"`; click primary; `window.open` spy receives the Meta URL with `_blank` + `noopener,noreferrer`; `actionCalls` stays empty; `toast` never called.
- **External decline still dismisses and toasts** — same external fixture; click secondary; assert `dismiss()` is called and decline toast fires.
- **Success-only suppression** — `primary()` rejects; assert `toast` is **not** called. Guards against `.finally()` regression.

### Tests added (summary)

| File                                                                            | New cases                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/__tests__/recommendations.test.ts`                        | 3 cases on `RecommendationPresentationSchema` (toasts present / absent / empty-string rejected). 2 cases on `RecommendationInputSchema` carrying toasts end-to-end.                                                                                                                                                                            |
| `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`               | 1 case per action variant in the `labels` table (14 cases) asserting `acceptToast` + `declineToast` are emitted, non-empty, action-specific.                                                                                                                                                                                                   |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-toast.test.ts`            | New file. Cases: accept reads `acceptToast`; decline reads `declineToast`; missing toast → kind-based fallback; empty-string toast → fallback; one case per RileyApprovalKind fallback (11 kinds × 2 verdicts = 22 fallback assertions).                                                                                                       |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts`           | Extended. `RILEY_COMMANDS` exports the locked catalog; `RILEY_COMPOSER_PLACEHOLDER` is the locked string.                                                                                                                                                                                                                                      |
| `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`        | Default-accent + custom-accent rendering; default-senderLabel + custom-senderLabel rendering. Existing Alex cases stay green (defaults).                                                                                                                                                                                                       |
| `apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx` | Default-sender + Riley-sender rendering; placeholder copy override; halt copy unchanged.                                                                                                                                                                                                                                                       |
| `apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx`          | Custom `colorFor`/`pulseFor` overrides; default behavior unchanged.                                                                                                                                                                                                                                                                            |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`   | 8 cases — internal accept/decline with engine toasts; per-row binding (rec-2 primary calls rec-2's hook); engine-empty fallback; "Riley needs you" eyebrow on every card; external primary opens URL with no mutation and no toast; external decline still dismisses + toasts; success-only suppression (rejected mutation produces no toast). |

### No changes to

- `apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts` — `acceptToast` / `declineToast` already pass-through via the view-model (B.1 declared `ApprovalViewBase.acceptToast` and `.declineToast` at `apps/dashboard/src/components/cockpit/types.ts:52-53`). Verify, do not re-derive.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` (Alex) — Alex cockpit keeps default props. B.3 must not change Alex's render.
- `apps/dashboard/src/lib/cockpit/alex-config.ts` — `statusColor`/`statusPulse` exports stay as defaults exposed by `StatusPill`.
- `apps/dashboard/src/components/cockpit/kind-meta.ts` / `kind-meta-riley.ts` — activity row colors already per-kind; no Riley palette concern.
- `apps/dashboard/src/components/cockpit/identity.tsx` — gains optional `colorFor`/`pulseFor` forwarding props; the Identity body and mission-popover wiring (B.2a's scope) are untouched.
- `apps/dashboard/src/components/cockpit/topbar.tsx` — `paletteEnabled={false}` stays; B.3 does not turn it on.
- `apps/dashboard/src/hooks/use-recommendation-action.ts` — existing, agent-agnostic; Riley consumes it as-is.
- Any Prisma schema, migration, or seed file.
- `packages/core/src/decisions/adapters/recommendation-adapter.ts` — `extractPresentation()` already passes JSON through; new optional fields land in the view-model without adapter changes.

---

## What does NOT ship at B.3

Explicit non-goals — these move to the B.3-followup or later:

- ❌ **Interactive ⌘K command palette.** Depends on Alex A.5's `<CommandPalette>` component. The catalog ships as data; no consumer wires it.
- ❌ **Composer NL parsing.** Depends on A.5's parser. The composer stays inert; placeholder visuals are correct.
- ❌ **`Allowed-in-B.3` command semantics** (`pause-1h` / `resume` against `HaltProvider`; `open-meta` / `open-rules` navigation; `brief-eod` / `cpl-30` summaries). All deferred until the composer/palette can dispatch them.
- ❌ **`Topbar.paletteEnabled = true`.** Stays `false` until A.5.
- ❌ **`REVIEWING` status state wiring.** Inngest `system.scoring_run_in_progress` audit instrumentation remains deferred per slicing spec §Status pill. Riley `statusPulse` returns `true` for `REVIEWING` (already in `riley-config.ts`); the state itself never derives in B.3 so the pulse path stays dead-code-but-tested.
- ❌ **ROI bar Riley accent.** ROI bar is B.2b; not on `/riley` today. Riley accent on the ROI bar lands in B.2b's wiring.
- ❌ **Anything in Wave B** — no WorkTrace mirror, no PlatformIngress route, no outcome attribution, no learning memory, no governance hook unification.
- ❌ **New mutation paths.** B.3 wires the existing `useRecommendationAction` hook; it adds zero new endpoints, zero new actions, zero new approval flows.
- ❌ **Toast on external-action cards.** `review_budget` / `fix_signal_health` / `harden_capi_attribution` open Meta URLs via `primaryAction.url`. They are not internal mutations; no `primary()` call fires, so no `rileyToast()` fires. The cockpit page distinguishes `primaryAction.kind === "internal"` for accept-wiring; external-action accept stays the existing "open URL" behavior. Decline (dismiss) on external cards still fires `dismiss()` + the decline toast.

---

## Adapter-boundary invariant

The B.1 load-bearing rule continues to hold:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/riley/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}`.

B.3 adds **zero** new imports of those types to `components/cockpit/**` or `hooks/use-riley-*.ts`. `riley-toast.ts` lives under `lib/cockpit/riley/**` and consumes only `RileyApprovalView` from `components/cockpit/types.ts`. `useRecommendationAction` is exempt (it consumes the wire `/api/dashboard/recommendations` endpoint, not Prisma; this matches B.1's pattern for `useRecommendations`).

Pre-merge grep gate (same as B.1, B.2a):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: no new matches vs `main` baseline.

---

## Dependencies

- ✅ Riley B.1 merged (#488, `5ef3910a`) — `RileyCockpitPage`, `riley-config.ts`, view-model `acceptToast`/`declineToast` fields, adapters all on `main`.
- ✅ Alex A.2 merged (#485, `67eb0618`) — `<Identity>` + `<MissionPopover>` shape stable. B.3 touches Identity to plumb optional `colorFor`/`pulseFor`; this is additive.
- ⚠ Riley B.2a (#494) **does not block B.3 merge**. B.3 touches `riley-cockpit-page.tsx` lines 23-58 (approvals + composer + status); B.2a touches the Identity wrap to mount `<MissionPopover>`. The two diffs are in adjacent regions of the same file but do not overlap — both can land in either order. Rebase resolves trivially.
- ❌ Alex A.5 — **does not block B.3 as defined here** (palette/composer interactive behavior is explicitly deferred). A.5 is the precondition for the B.3-followup that wires `RILEY_COMMANDS` into the actual palette.
- ⚠ Riley spec/slicing/parity docs **still not on `main`** — they live on `docs/riley-cockpit-home-spec` (#497, OPEN). Per CLAUDE.md branch & worktree doctrine those should land first. The B.3 plan's spec links assume #497 merges before or alongside this docs PR. **Mitigation:** the spec PR has been open since 2026-05-14 and B.1/B.2a have already landed against the same docs; B.3 follows the same precedent.

---

## Schema-side decisions ratified by this slice

1. **`acceptToast` / `declineToast` are optional, not required.** Older recommendation rows in production have no toast copy; they must continue to parse. Optional + cockpit fallback covers both.
2. **Min-length-1 strings, not `z.string().optional()`.** An empty-string toast would render an empty Sonner/shadcn toast, which is worse than the fallback. Enforce `min(1)` at the schema layer so the engine cannot accidentally ship blank lines.
3. **No DB migration.** `presentation` is JSON-embedded in `PendingActionRecord.parameters`. Verified at `packages/db/prisma/schema.prisma:1459-1494`. Optional Zod field additions to a freeform JSON column are backwards-compatible by construction.
4. **Engine populates the toast pair at emission time, not at adapter time.** This puts the action-specific voice next to the action-specific `humanSummary` and `presentation.primaryLabel`, where the engine already has the campaign name and the action vocabulary. Adapter-side (cockpit) authoring would re-derive context the engine already holds.
5. **Toast voice is Riley-only in B.3.** Alex's cockpit reads the same view-model fields but has no `alexToast()` helper today; the cockpit Alex toast path is already covered by existing shadcn primitives in `agent-controls.tsx` style. The engine emits Riley toasts only because `recommendation-sink.ts` is Riley's emitter (`agentKey: "riley"` hardcoded at line 180). When Alex starts emitting recommendations through its own sink, that sink will populate its own toast copy; B.3 does not block on it.

---

## Risks specific to B.3

1. **B.1 no-op `onResolve` is the gating risk.** B.1 shipped approval cards without resolution wiring — clicking primary or dismiss on a Riley approval card today does nothing. B.3 takes on that wiring as a side-effect of toast wiring (you cannot fire a toast without invoking the action). The resolution path uses a **per-row `<RileyApprovalRow>` wrapper** rather than a page-level hook call, because `useRecommendationAction(id)` is keyed by recommendation id and B.1's multi-card stacking would otherwise resolve the wrong row. **Mitigation:** the implementation plan ships the per-row pattern from the start (not as a "fix later" caveat) and the page test asserts the multi-card binding explicitly.

2. **Default-vs-override drift between Alex and Riley.** Three shell components gain `?: defaults` props. If a future Alex change forgets to pass an override and silently inherits Alex defaults, no test catches the mistake. **Mitigation:** approval-card / composer-placeholder / status-pill tests assert _both_ the default-render path (Alex) and the explicit-override path (Riley) — two test cases per component. Snapshot tests are not added (they over-couple to inline CSS); explicit-style assertions on the eyebrow text and accent token suffice.

3. **`acceptToast` / `declineToast` round-trip through Json column.** The recommendation flows: engine → `emit()` → `PendingActionRecord.parameters` JSON → `extractPresentation()` → `Recommendation` row in API → wire JSON to dashboard → `RileyApprovalView`. Any layer that drops unrecognized JSON keys would silently lose the toast copy. **Mitigation:** the engine test asserts both fields are present at emission; the adapter test asserts both reach `RileyApprovalView.acceptToast` / `.declineToast`; the page test asserts both reach the toast call. End-to-end coverage of the JSON pass-through path.

4. **`useToast` from `@/components/ui/use-toast` vs Sonner.** Two toast libraries coexist in the codebase. The cockpit must consume the same one Alex Cockpit A.2's Day-1 narrator uses (`@/components/ui/use-toast`). **Mitigation:** the implementation plan grep-checks `import.*sonner` in `apps/dashboard/src/components/cockpit/` before the toast task lands; if Sonner has been introduced elsewhere, the task switches without breaking the other surface.

5. **Composer placeholder copy change is operator-visible.** Today `/riley` renders `"Tell Alex what to do — coming soon"`. After B.3 it renders `"Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…"`. This is a deliberate UX improvement aligned with the target spec, but it is a copy change that a reviewer may flag as "scope creep." **Mitigation:** the slice brief and PR description name this explicitly; the implementation plan locks the exact string in `riley-config.ts` so reviewers can grep one location for the wording.

6. **Riley accent on approval cards changes background + border** (today amber paper → after B.3 Riley clay paper). Some adapters/tests assert against `T.amberPaper` style values for Riley fixtures. **Mitigation:** the implementation plan grep-checks `amberPaper|amberSoft|amberDeep` references in `apps/dashboard/src/components/cockpit/__tests__/` for Riley-shaped tests and updates any that assert Alex tokens on Riley fixtures.

7. **`acceptToast` fallbacks must not claim Riley improved metrics.** Honest-impact-language guardrail carries over from B.2. Fallback toast lines describe what Riley **did with the operator's instruction** (e.g., `"Paused — standing by."`), never causal claims (`"Saved you $40."`). **Mitigation:** the implementation plan includes a copy review pass over both the engine-side toast table and the fallback table; PR template adds an "honest-impact-language" reviewer checkbox.

---

## Test contract

- Schema tests (Vitest, `packages/schemas`): optional-field parsing, min-1 rejection, end-to-end `RecommendationInputSchema` carrying toasts.
- Engine tests (Vitest, `packages/ad-optimizer`): one assertion per action variant that both toasts are emitted non-empty.
- Adapter / lib tests (Vitest, `apps/dashboard`): `rileyToast` fallback table coverage; `riley-config` catalog locked.
- Component tests (Vitest + Testing Library, `apps/dashboard`): default-vs-override paths for three shell components.
- Page-level integration (`riley-cockpit-page.test.tsx`): accept/decline → action hook + toast hook + correct copy; fallback toast when engine omits; Riley accent on eyebrow + pill.
- Adapter-boundary grep (gate): no new `Recommendation|AuditEntry|@switchboard/db|@prisma` imports under `components/cockpit/**` or `hooks/use-riley-*`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test --filter @switchboard/schemas --filter @switchboard/ad-optimizer --filter @switchboard/dashboard`, `pnpm --filter @switchboard/dashboard build` all clean.

---

## What comes after B.3

- **B.3-followup** (post-Alex-A.5) — Wire `RILEY_COMMANDS` into the shared `<CommandPalette>`, enable `Topbar.paletteEnabled=true` on `/riley`, hook the composer NL parser to the `Allowed-in-B.3` semantic set (`pause-1h` / `resume` / `open-*` / `brief-eod` / `cpl-30`). Plan written when A.5 lands.
- **B.2b** (after Alex A.3) — KPI strip + ROI bar + `AgentRoster.avgValueCents`/`targetCpbCents` migration + `/metrics` extension. Riley accent on the ROI bar lands here, not in B.3.
- **Wave B** — doctrine workstream tracked in `2026-05-14-riley-agent-infra-parity-design.md`. `acceptToast`/`declineToast` schema additions in B.3 are forward-compatible with the WorkTrace mirror; the toast copy travels with the `Recommendation` row regardless of which substrate the cockpit reads from.
