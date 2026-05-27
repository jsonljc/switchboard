# Riley Cockpit B.3 — Voice + Accent + Toast Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Riley's surface personality — `RecommendationPresentation.acceptToast` / `declineToast` schema fields, engine-side toast copy for every Riley action, `rileyToast()` voice helper with per-kind fallbacks, Riley accent parameterized through three shell components (`<StatusPill>`, `<ApprovalCard>`, `<ComposerPlaceholder>`), and the `RileyCockpitPage` wiring that turns the B.1 no-op `onResolve` into a real `useRecommendationAction` + `useToast` round-trip. Interactive ⌘K palette and composer NL parsing remain deferred until Alex A.5 ships the shell infrastructure.

**Architecture:** Three layers move in lockstep without crossing the adapter boundary. Schema layer (`packages/schemas`) gains two optional Zod fields; engine layer (`packages/ad-optimizer/src/recommendation-sink.ts`) populates them per action variant; dashboard layer adds a new `lib/cockpit/riley/riley-toast.ts` adapter that consumes only the `RileyApprovalView` view-model, and three shell components grow `?: defaults` props so Alex's render is unchanged while Riley's page passes Riley values. `RileyCockpitPage.onResolve` becomes a real handler that invokes `useRecommendationAction(id).primary()` or `.dismiss()`, then fires `useToast().toast(rileyToast({ verdict, approval }))`. No Prisma migration (the presentation lives inside `PendingActionRecord.parameters` JSON); no new mutation paths; no new wire endpoints; no Alex render diff.

**Tech Stack:** Zod (`packages/schemas`), Vitest (all layers), TypeScript (ESM, `.js` extensions in relative imports per `CLAUDE.md`; dashboard imports omit `.js` per `feedback_dashboard_no_js_on_any_import`), Next.js 14 App Router + React 18 + `@tanstack/react-query` (dashboard), shadcn `useToast` (`apps/dashboard/src/components/ui/use-toast.ts`).

**Parent docs:**

- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b3-slice-brief.md`](./2026-05-15-riley-cockpit-b3-slice-brief.md) — scope, what-ships-vs-defers, risks.
- [`docs/superpowers/specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md`](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) — §Slice B.3 (authoritative contract; B.3 ships the A.5-independent subset).
- [`docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md`](../specs/2026-05-13-riley-cockpit-home-design.md) — Riley target spec (voice catalog, command catalog, accent palette).
- [`docs/superpowers/plans/2026-05-14-riley-cockpit-b1-implementation.md`](./2026-05-14-riley-cockpit-b1-implementation.md) — B.1 template for adapter-boundary discipline.
- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b2a-slice-brief.md`](./2026-05-15-riley-cockpit-b2a-slice-brief.md) — sibling slice (mission popover); not a blocker.

> **The slicing spec is authoritative.** If anything in this plan expands B.3's scope beyond the slice brief — interactive palette behavior, composer NL parsing, ROI bar accent, new mutation paths — the spec wins and the conflicting text in this plan is wrong. Resolve in favor of the slicing spec and flag the discrepancy.

---

## Precondition checks

Run before Task 1.

- [ ] **Step 0a: Confirm worktree, branch, and base.**

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: branch `docs/riley-cockpit-b3-plan`. Status clean. The log shows only the two docs commits added by this PR (slice brief + this plan). If the branch has feature commits, stop — the docs PR must be docs-only.

- [ ] **Step 0b: Verify B.1 artifacts exist on `main`.**

```bash
ls apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
   apps/dashboard/src/components/cockpit/types.ts \
   apps/dashboard/src/components/cockpit/approval-card.tsx \
   apps/dashboard/src/components/cockpit/composer-placeholder.tsx \
   apps/dashboard/src/components/cockpit/status-pill.tsx \
   apps/dashboard/src/lib/cockpit/riley/riley-config.ts \
   apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts \
   apps/dashboard/src/hooks/use-recommendation-action.ts \
   apps/dashboard/src/components/ui/use-toast.ts
```

Expected: all 9 files exist. If any is missing, B.1 baseline has shifted — stop and investigate.

- [ ] **Step 0c: Verify view-model already declares `acceptToast` / `declineToast`.**

```bash
grep -n "acceptToast\|declineToast" apps/dashboard/src/components/cockpit/types.ts
```

Expected: two matches around lines 52–53. The view-model is pre-wired; B.3 only needs to populate from the schema side and consume on the cockpit side.

- [ ] **Step 0d: Verify the B.1 no-op onResolve is still in place.**

```bash
grep -n "B.1 stops at view assembly" apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
```

Expected: one match. This is the line B.3 is replacing with real wiring. If the line is gone, another PR may have already wired resolution — investigate before adding redundant code.

- [ ] **Step 0e: Verify baseline tests pass.**

```bash
pnpm --filter @switchboard/schemas test -- --run recommendations && \
  pnpm --filter @switchboard/ad-optimizer test -- --run recommendation-sink && \
  pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: all green. If any fail on `main`, fix or escalate before adding new code (per CLAUDE.md feedback memories, the `prisma-work-trace-store-integrity` / `prisma-greeting-signal-store` flakes are pre-existing and may be ignored if reproduced on the baseline branch).

---

## File Structure

### Files created

| Path                                                                 | Responsibility                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/cockpit/riley/riley-toast.ts`                | Pure `rileyToast({ verdict, approval })` function. Reads `approval.acceptToast` / `approval.declineToast` when non-empty; otherwise returns a per-kind fallback string. Returns `{ title: string; description?: string }` shaped for the shadcn `toast()` call. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-toast.test.ts` | Unit tests. Covers the engine-emits-toast path, the fallback path for every `RileyApprovalKind`, and the empty-string-is-fallback edge.                                                                                                                         |

### Files modified

| Path                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Why touched                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/schemas/src/recommendations.ts`                                       | Extend `RecommendationPresentationSchema` with optional `acceptToast` + `declineToast` (`z.string().min(1).optional()`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Persistable toast copy authored by emitters.                    |
| `packages/schemas/src/__tests__/recommendations.test.ts`                        | Add 3 cases to `describe("RecommendationPresentationSchema", ...)` + 2 cases to the `RecommendationInputSchema` block carrying toasts end-to-end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Coverage.                                                       |
| `packages/ad-optimizer/src/recommendation-sink.ts`                              | Extend `buildPresentation(rec)` at lines 126–155 to include `acceptToast` + `declineToast` in the per-action label table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Engine-side authorship.                                         |
| `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`               | Add a test that asserts every action variant emits both toasts non-empty.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Coverage.                                                       |
| `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`                          | Add `RILEY_COMPOSER_PLACEHOLDER` string + `RILEY_COMMANDS` typed array + `RileyCommand` interface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Catalog for B.3-followup post-A.5 wiring.                       |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts`           | Add cases locking `RILEY_COMPOSER_PLACEHOLDER` and `RILEY_COMMANDS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Coverage.                                                       |
| `apps/dashboard/src/components/cockpit/approval-card.tsx`                       | Add optional `accent?: { base; deep; soft; paper }` (default = Alex amber tokens from `T`) and `senderLabel?: string` (default `"Alex needs you"`). Use accent for eyebrow color, card background, border.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Riley accent.                                                   |
| `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`        | Add 4 cases: default-accent renders Alex amber; custom accent renders Riley clay; default sender renders "Alex needs you"; custom sender renders "Riley needs you".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Coverage.                                                       |
| `apps/dashboard/src/components/cockpit/composer-placeholder.tsx`                | Add optional `senderLabel?: string` (default `"ALEX"`), `placeholderCopy?: string` (default current "Tell Alex what to do — coming soon"), `accentColor?: string` (default `T.ink4`). Use accent for sender label color.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Riley composer chrome.                                          |
| `apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx` | Add 3 cases: default-sender + default-copy, override-sender + override-copy, halted-with-override-copy stays halted-copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Coverage.                                                       |
| `apps/dashboard/src/components/cockpit/status-pill.tsx`                         | Add optional `colorFor?: (s: CockpitStatus, halted: boolean) => string` + `pulseFor?: (s: CockpitStatus, halted: boolean) => boolean`. Defaults to the existing `alex-config` imports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Riley status colors.                                            |
| `apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx`          | Add 2 cases: default behavior unchanged; custom `colorFor` + `pulseFor` overrides reach the rendered `<Dot>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Coverage.                                                       |
| `apps/dashboard/src/components/cockpit/identity.tsx`                            | Forward optional `colorFor` + `pulseFor` props through to `<StatusPill>`. Pass-through only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Plumbing.                                                       |
| `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`             | Add 1 case asserting `colorFor` / `pulseFor` reach `StatusPill`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Coverage.                                                       |
| `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`                  | Introduce a per-row `<RileyApprovalRow>` wrapper that owns `useRecommendationAction(approval.id)` + `useToast()`. The wrapper's `onResolve` (a) opens `primaryAction.url` in a new tab on external accept (no mutation, no toast), (b) calls `action.primary()` then `toast(rileyToast(...))` on internal accept, (c) calls `action.dismiss()` then `toast(rileyToast(...))` on decline regardless of action kind. Toast uses `.then()` not `.finally()` (success-only). The page bypasses `<ApprovalBlock>` and maps approvals directly to a list of `<RileyApprovalRow>` inside a flex container inlining `<ApprovalBlock>`'s gap + margin. The wrapper passes `accent={RILEY_APPROVAL_ACCENT}` + `senderLabel="Riley needs you"` to `<ApprovalCard>`. Page also passes `senderLabel="RILEY"`, `placeholderCopy={RILEY_COMPOSER_PLACEHOLDER}`, `accentColor={RILEY_ACCENT.deep}` to `<ComposerPlaceholder>` and `colorFor={statusColor}` + `pulseFor={statusPulse}` through `<Identity>` to `<StatusPill>`. | The page is the only Riley-specific consumer of accent + voice. |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`   | Add 8 cases — internal accept/decline → action hook + engine toasts; per-row binding (rec-2 primary → rec-2's hook, not rec-1's); engine-empty → per-kind fallback; "Riley needs you" eyebrow on every card; external primary opens URL with no `primary()` call and no toast; external decline still calls `dismiss()` + decline toast; rejected mutation suppresses the toast (success-only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Page-level integration.                                         |

### Files explicitly NOT modified

- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` (Alex) — passes no new props; defaults preserve current Alex render byte-for-byte.
- `apps/dashboard/src/lib/cockpit/alex-config.ts` — Alex `statusColor` / `statusPulse` stay the `<StatusPill>` defaults.
- `apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts` — adapter already maps `presentation.acceptToast` / `.declineToast` onto `RileyApprovalView` via the existing pass-through; the new optional fields require no new adapter code.
- `apps/dashboard/src/components/cockpit/kind-meta.ts` / `kind-meta-riley.ts` — activity row colors stay per-kind.
- `apps/dashboard/src/components/cockpit/topbar.tsx` — `paletteEnabled` stays `false`. No ⌘K binding.
- `apps/dashboard/src/hooks/use-recommendation-action.ts` — agent-agnostic; consumed as-is.
- `packages/core/src/decisions/adapters/recommendation-adapter.ts` — `extractPresentation(parameters)` passes JSON through; the optional fields ride along.
- `packages/core/src/recommendations/router.ts` — routing decisions read `confidence` / `dollarsAtRisk` / `reversible`, never `presentation`. Untouched.
- `packages/db/prisma/schema.prisma` — `presentation` is embedded in `PendingActionRecord.parameters` JSON. No migration. No `db:check-drift` concern.
- Any Riley adapter file beyond `riley-config.ts` and the new `riley-toast.ts`.

---

## Adapter boundary (unchanged from B.1)

B.3 adds **zero** new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/recommendations` / `@switchboard/schemas/audit` under `apps/dashboard/src/components/cockpit/**` or `apps/dashboard/src/hooks/use-riley-*.ts`. The new `riley-toast.ts` lives in `apps/dashboard/src/lib/cockpit/riley/**` (the adapter layer) and imports only `RileyApprovalView` from `@/components/cockpit/types`. `useRecommendationAction` is exempt — it consumes the wire `/api/dashboard/recommendations` endpoint, not Prisma.

Pre-merge grep gate (Task 11):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as `main` before B.3 — no new matches outside `lib/cockpit/riley/**`.

---

## Toast copy table (locked)

This is the canonical engine-side authorship + cockpit fallback table. The implementation plan refers back to this in Tasks 2 (engine) and 7 (fallbacks). **All lines are first-person, descriptive of what Riley did with the operator's instruction. No causal-impact claims** (honest-impact-language guardrail).

### Engine-side `buildPresentation` (per action — populates both fields, requires campaign name interpolation)

| Engine action               | `acceptToast`                              | `declineToast`                                       |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `scale`                     | `Scaling ${name} 20%.`                     | `Holding ${name} where it is.`                       |
| `pause`                     | `Paused ${name}. Standing by.`             | `Leaving ${name} running.`                           |
| `refresh_creative`          | `Queued a creative refresh for ${name}.`   | `Holding the current creative on ${name}.`           |
| `restructure`               | `Restructure plan opened for ${name}.`     | `Holding the structure on ${name}.`                  |
| `hold`                      | `Holding ${name}. Watching.`               | `Acknowledged — back to scanning.`                   |
| `test`                      | `Test variant queued for ${name}.`         | `Skipping the test on ${name}.`                      |
| `review_budget`             | `Opening Meta to review ${name}'s budget.` | `Holding ${name}'s budget where it is.`              |
| `add_creative`              | `Routed an add-creative ask for ${name}.`  | `Holding off on adding creatives to ${name}.`        |
| `expand_targeting`          | `Targeting expansion queued for ${name}.`  | `Keeping targeting where it is on ${name}.`          |
| `consolidate`               | `Consolidation plan opened for ${name}.`   | `Leaving ${name} as-is.`                             |
| `shift_budget_to_source`    | `Shifting budget on ${name}.`              | `Holding the current budget split on ${name}.`       |
| `switch_optimization_event` | `Switched optimization event on ${name}.`  | `Holding the current optimization event on ${name}.` |
| `harden_capi_attribution`   | `Opening Meta to harden CAPI attribution.` | `Holding the current CAPI configuration.`            |
| `fix_signal_health`         | `Opening Events Manager for the pixel.`    | `Acknowledged — back to scanning the pixel.`         |

### Cockpit fallback `rileyToast()` (per `RileyApprovalKind` — no campaign name available; generic voice)

| Kind                        | accept fallback                               | decline fallback                             |
| --------------------------- | --------------------------------------------- | -------------------------------------------- |
| `pause`                     | `Paused — standing by.`                       | `Holding — back to scanning.`                |
| `scale`                     | `Scaling — back to scanning.`                 | `Holding — back to scanning.`                |
| `refresh_creative`          | `Creative refresh queued — back to scanning.` | `Holding the current creative.`              |
| `restructure`               | `Restructure plan opened.`                    | `Holding the current structure.`             |
| `shift_budget_to_source`    | `Shifting budget — back to scanning.`         | `Holding the current split.`                 |
| `switch_optimization_event` | `Switched optimization event.`                | `Holding the current event.`                 |
| `harden_capi_attribution`   | `Opening Meta to harden attribution.`         | `Holding the current CAPI configuration.`    |
| `hold`                      | `Holding — watching.`                         | `Acknowledged — back to scanning.`           |
| `add_creative`              | `Add-creative ask routed.`                    | `Holding off on adding creatives.`           |
| `review_budget`             | `Opening Meta to review budget.`              | `Holding the current budget.`                |
| `signal_health_group`       | `Opening Events Manager.`                     | `Acknowledged — back to scanning the pixel.` |

The fallback table covers 11 kinds × 2 verdicts = 22 strings. Empty-string `acceptToast` / `declineToast` from the engine are treated as missing and fall back to this table.

---

## Tasks

### Task 1: Extend `RecommendationPresentationSchema` with optional toast fields

**Files:**

- Modify: `packages/schemas/src/recommendations.ts:28-34`
- Test: `packages/schemas/src/__tests__/recommendations.test.ts:53-68`

- [ ] **Step 1: Write the failing tests.**

Append to the existing `describe("RecommendationPresentationSchema", ...)` block in `packages/schemas/src/__tests__/recommendations.test.ts`:

```ts
it("accepts optional acceptToast and declineToast strings", () => {
  const ok = RecommendationPresentationSchema.parse({
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
    acceptToast: "Paused Whitening Set B. Standing by.",
    declineToast: "Leaving Whitening Set B running.",
  });
  expect(ok.acceptToast).toBe("Paused Whitening Set B. Standing by.");
  expect(ok.declineToast).toBe("Leaving Whitening Set B running.");
});

it("parses when acceptToast and declineToast are absent (backwards-compatible)", () => {
  const ok = RecommendationPresentationSchema.parse({
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
  });
  expect(ok.acceptToast).toBeUndefined();
  expect(ok.declineToast).toBeUndefined();
});

it("rejects empty-string acceptToast / declineToast (min-1 guards blank toasts)", () => {
  expect(() =>
    RecommendationPresentationSchema.parse({
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [],
      acceptToast: "",
    }),
  ).toThrow();
  expect(() =>
    RecommendationPresentationSchema.parse({
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [],
      declineToast: "",
    }),
  ).toThrow();
});
```

Append to the existing `describe("RecommendationInputSchema", ...)` block (after the minimal-valid-input test):

```ts
it("propagates acceptToast and declineToast through presentation when present", () => {
  const ok = RecommendationInputSchema.parse({
    orgId: "org-1",
    agentKey: "riley",
    intent: "recommendation.pause",
    action: "pause",
    humanSummary: "Pause Whitening Set B — saves $40/day",
    confidence: 0.9,
    dollarsAtRisk: 25,
    riskLevel: "low",
    parameters: {},
    presentation: {
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [],
      acceptToast: "Paused Whitening Set B. Standing by.",
      declineToast: "Leaving Whitening Set B running.",
    },
  });
  expect(ok.presentation.acceptToast).toBe("Paused Whitening Set B. Standing by.");
  expect(ok.presentation.declineToast).toBe("Leaving Whitening Set B running.");
});

it("accepts a RecommendationInput without acceptToast / declineToast (backwards-compatible)", () => {
  const ok = RecommendationInputSchema.parse({
    orgId: "org-1",
    agentKey: "riley",
    intent: "recommendation.pause",
    action: "pause",
    humanSummary: "Pause Whitening Set B — saves $40/day",
    confidence: 0.9,
    dollarsAtRisk: 25,
    riskLevel: "low",
    parameters: {},
    presentation: {
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
  });
  expect(ok.presentation.acceptToast).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

```bash
pnpm --filter @switchboard/schemas test -- --run recommendations
```

Expected: 5 new test failures because `acceptToast` / `declineToast` are unknown keys. The existing 4-field tests must remain green.

- [ ] **Step 3: Add the optional fields to the schema.**

Edit `packages/schemas/src/recommendations.ts:28-34`:

```ts
export const RecommendationPresentationSchema = z.object({
  primaryLabel: z.string().min(1),
  secondaryLabel: z.string().min(1),
  dismissLabel: z.string().min(1),
  dataLines: z.array(z.unknown()),
  acceptToast: z.string().min(1).optional(),
  declineToast: z.string().min(1).optional(),
});
export type RecommendationPresentation = z.infer<typeof RecommendationPresentationSchema>;
```

- [ ] **Step 4: Run the tests and verify they pass.**

```bash
pnpm --filter @switchboard/schemas test -- --run recommendations
```

Expected: all green (including existing cases).

- [ ] **Step 5: Commit.**

```bash
git add packages/schemas/src/recommendations.ts \
        packages/schemas/src/__tests__/recommendations.test.ts
git commit -m "feat(schemas): RecommendationPresentation acceptToast + declineToast optional fields (B.3)"
```

---

### Task 2: Engine — populate `acceptToast` + `declineToast` in `buildPresentation`

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts:126-155`
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`

- [ ] **Step 1: Write the failing test.**

Append to `describe("runRecommendationSink", ...)` in `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`:

```ts
it("buildPresentation emits action-specific acceptToast and declineToast for every action", async () => {
  const presentations: Array<{
    action: RecommendationOutput["action"];
    acceptToast: string | undefined;
    declineToast: string | undefined;
  }> = [];
  const emit: RecommendationEmitter = vi.fn(async (input) => {
    presentations.push({
      action: input.action as RecommendationOutput["action"],
      acceptToast: input.presentation.acceptToast,
      declineToast: input.presentation.declineToast,
    });
    return mockRoute(input);
  });
  const actions: RecommendationOutput["action"][] = [
    "scale",
    "pause",
    "refresh_creative",
    "restructure",
    "hold",
    "test",
    "review_budget",
    "add_creative",
    "expand_targeting",
    "consolidate",
    "shift_budget_to_source",
    "switch_optimization_event",
    "harden_capi_attribution",
    "fix_signal_health",
  ];
  await runRecommendationSink({
    orgId: "org-1",
    auditRunId: "audit-toasts",
    recommendations: actions.map((a, i) =>
      baseRec({ action: a, campaignId: `c-${i}`, confidence: 0.9 }),
    ),
    emit,
  });
  expect(presentations).toHaveLength(actions.length);
  for (const p of presentations) {
    expect(p.acceptToast, `${p.action} acceptToast must be non-empty`).toBeTruthy();
    expect(p.declineToast, `${p.action} declineToast must be non-empty`).toBeTruthy();
    // Sanity: mention the campaign name in the engine voice (we humanized
    // by interpolating campaignName, not by dumping the raw action label).
    expect(p.acceptToast ?? "").toContain("Whitening Set B");
  }
  // Spot-check a few action-to-line mappings to lock the toast table.
  const pause = presentations.find((p) => p.action === "pause")!;
  expect(pause.acceptToast).toBe("Paused Whitening Set B. Standing by.");
  expect(pause.declineToast).toBe("Leaving Whitening Set B running.");
  const scale = presentations.find((p) => p.action === "scale")!;
  expect(scale.acceptToast).toBe("Scaling Whitening Set B 20%.");
  expect(scale.declineToast).toBe("Holding Whitening Set B where it is.");
  const fix = presentations.find((p) => p.action === "fix_signal_health")!;
  expect(fix.acceptToast).toBe("Opening Events Manager for the pixel.");
  expect(fix.declineToast).toBe("Acknowledged — back to scanning the pixel.");
});
```

- [ ] **Step 2: Run the test and verify it fails.**

```bash
pnpm --filter @switchboard/ad-optimizer test -- --run recommendation-sink
```

Expected: the new test fails because `presentation.acceptToast` / `.declineToast` are `undefined`. The 4 existing cases stay green.

- [ ] **Step 3: Extend `buildPresentation` and reach the campaign name.**

`buildPresentation` today takes only `rec: RecommendationOutput` and does not know the campaign name. Update its return type and body to include the two toast strings; reach `rec.campaignName` (already on the `RecommendationOutput` shape, used by `humanizeRecommendation`).

Edit `packages/ad-optimizer/src/recommendation-sink.ts:126-155`:

```ts
/**
 * Surface-agnostic presentation. Defines the canonical button labels, data
 * lines, and optional first-person toast copy that any surface (queue card,
 * /riley page, inbox drawer) can render. The router sets `surface`; this
 * presentation is identical regardless.
 *
 * acceptToast / declineToast are first-person Riley voice. Honest-impact
 * language: they describe what Riley did with the operator's instruction,
 * never causal claims about metric improvement.
 */
function buildPresentation(rec: RecommendationOutput): {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: string[][];
  acceptToast: string;
  declineToast: string;
} {
  const labels: Record<
    RecommendationOutput["action"],
    { primary: string; secondary: string; accept: string; decline: string }
  > = {
    scale: {
      primary: "Scale 20%",
      secondary: "Hold",
      accept: `Scaling ${rec.campaignName} 20%.`,
      decline: `Holding ${rec.campaignName} where it is.`,
    },
    pause: {
      primary: "Pause",
      secondary: "Reduce 50%",
      accept: `Paused ${rec.campaignName}. Standing by.`,
      decline: `Leaving ${rec.campaignName} running.`,
    },
    refresh_creative: {
      primary: "Refresh creative",
      secondary: "Hold",
      accept: `Queued a creative refresh for ${rec.campaignName}.`,
      decline: `Holding the current creative on ${rec.campaignName}.`,
    },
    restructure: {
      primary: "Restructure",
      secondary: "Review",
      accept: `Restructure plan opened for ${rec.campaignName}.`,
      decline: `Holding the structure on ${rec.campaignName}.`,
    },
    hold: {
      primary: "Hold",
      secondary: "Investigate",
      accept: `Holding ${rec.campaignName}. Watching.`,
      decline: `Acknowledged — back to scanning.`,
    },
    test: {
      primary: "Run test",
      secondary: "Skip",
      accept: `Test variant queued for ${rec.campaignName}.`,
      decline: `Skipping the test on ${rec.campaignName}.`,
    },
    review_budget: {
      primary: "Review budget",
      secondary: "Hold",
      accept: `Opening Meta to review ${rec.campaignName}'s budget.`,
      decline: `Holding ${rec.campaignName}'s budget where it is.`,
    },
    add_creative: {
      primary: "Add creatives",
      secondary: "Adjust later",
      accept: `Routed an add-creative ask for ${rec.campaignName}.`,
      decline: `Holding off on adding creatives to ${rec.campaignName}.`,
    },
    expand_targeting: {
      primary: "Expand",
      secondary: "Wait",
      accept: `Targeting expansion queued for ${rec.campaignName}.`,
      decline: `Keeping targeting where it is on ${rec.campaignName}.`,
    },
    consolidate: {
      primary: "Consolidate",
      secondary: "Review",
      accept: `Consolidation plan opened for ${rec.campaignName}.`,
      decline: `Leaving ${rec.campaignName} as-is.`,
    },
    shift_budget_to_source: {
      primary: "Shift budget",
      secondary: "Wait",
      accept: `Shifting budget on ${rec.campaignName}.`,
      decline: `Holding the current budget split on ${rec.campaignName}.`,
    },
    switch_optimization_event: {
      primary: "Switch event",
      secondary: "Wait",
      accept: `Switched optimization event on ${rec.campaignName}.`,
      decline: `Holding the current optimization event on ${rec.campaignName}.`,
    },
    harden_capi_attribution: {
      primary: "Fix attribution",
      secondary: "Skip",
      accept: `Opening Meta to harden CAPI attribution.`,
      decline: `Holding the current CAPI configuration.`,
    },
    fix_signal_health: {
      primary: "Fix signal",
      secondary: "Skip",
      accept: `Opening Events Manager for the pixel.`,
      decline: `Acknowledged — back to scanning the pixel.`,
    },
  };
  const found = labels[rec.action];
  return {
    primaryLabel: found.primary,
    secondaryLabel: found.secondary,
    dismissLabel: "Dismiss",
    dataLines: [[rec.estimatedImpact], [`Learning phase: ${rec.learningPhaseImpact}`]],
    acceptToast: found.accept,
    declineToast: found.decline,
  };
}
```

- [ ] **Step 4: Run the test and verify it passes.**

```bash
pnpm --filter @switchboard/ad-optimizer test -- --run recommendation-sink
```

Expected: all green (5 cases now).

- [ ] **Step 5: Commit.**

```bash
git add packages/ad-optimizer/src/recommendation-sink.ts \
        packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts
git commit -m "feat(ad-optimizer): engine populates acceptToast + declineToast per Riley action (B.3)"
```

---

### Task 3: Parameterize `<StatusPill>` with optional `colorFor` / `pulseFor` props

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/status-pill.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx`

- [ ] **Step 1: Write the failing test.**

Add to `apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "../status-pill";
import type { CockpitStatus } from "../types";

describe("StatusPill — colorFor / pulseFor overrides", () => {
  it("uses the supplied colorFor and pulseFor when provided", () => {
    const colorFor = (_s: CockpitStatus, _halted: boolean) => "rgb(184, 108, 80)"; // RILEY_ACCENT.base
    const pulseFor = (_s: CockpitStatus, _halted: boolean) => true;
    const { container } = render(
      <StatusPill statusKey="WAITING" halted={false} colorFor={colorFor} pulseFor={pulseFor} />,
    );
    // Label text color uses the Riley base
    const label = container.querySelector("span > span") as HTMLElement;
    expect(label.style.color).toBe("rgb(184, 108, 80)");
    // The Dot child should reflect pulse=true via its style (existing Dot
    // contract); verify the label and Dot were rendered with the same color.
    expect(label.textContent).toBe("WAITING");
  });

  it("falls back to alex-config statusColor / statusPulse when overrides are absent", () => {
    const { container } = render(<StatusPill statusKey="WAITING" halted={false} />);
    const label = container.querySelector("span > span") as HTMLElement;
    // Alex WAITING amber from alex-config — assert color string is non-empty,
    // not the Riley base. (Exact hex lives in alex-config; we assert behavior
    // — defaults still apply.)
    expect(label.style.color).not.toBe("rgb(184, 108, 80)");
    expect(label.style.color.length).toBeGreaterThan(0);
  });
});
```

If `apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx` already exists, append to it; do not overwrite existing cases.

- [ ] **Step 2: Run the test and verify it fails.**

```bash
pnpm --filter @switchboard/dashboard test -- --run status-pill
```

Expected: first new test fails (`colorFor` / `pulseFor` props unknown). Existing cases stay green.

- [ ] **Step 3: Add the optional props.**

Edit `apps/dashboard/src/components/cockpit/status-pill.tsx`:

```tsx
// apps/dashboard/src/components/cockpit/status-pill.tsx
import { Dot } from "./dot";
import {
  statusColor as defaultStatusColor,
  statusPulse as defaultStatusPulse,
} from "@/lib/cockpit/alex-config";
import type { CockpitStatus } from "./types";

export interface StatusPillProps {
  statusKey: CockpitStatus;
  halted: boolean;
  colorFor?: (s: CockpitStatus, halted: boolean) => string;
  pulseFor?: (s: CockpitStatus, halted: boolean) => boolean;
}

export function StatusPill({
  statusKey,
  halted,
  colorFor = defaultStatusColor,
  pulseFor = defaultStatusPulse,
}: StatusPillProps) {
  const color = colorFor(statusKey, halted);
  const pulse = pulseFor(statusKey, halted);
  const label = halted ? "HALTED" : statusKey;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Dot color={color} pulse={pulse} />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes.**

```bash
pnpm --filter @switchboard/dashboard test -- --run status-pill
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/status-pill.tsx \
        apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx
git commit -m "feat(cockpit): StatusPill colorFor + pulseFor props (B.3 prep)"
```

---

### Task 4: Forward `colorFor` / `pulseFor` through `<Identity>` to `<StatusPill>`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/identity.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`

- [ ] **Step 1: Read the current `Identity` props to confirm location.**

```bash
grep -n "StatusPillProps\|StatusPill\|export interface IdentityProps\|export function Identity" \
  apps/dashboard/src/components/cockpit/identity.tsx | head -10
```

Expected: locate the `<StatusPill statusKey=… halted=…>` usage inside `<Identity>`. The new props pass through that call site.

- [ ] **Step 2: Write the failing test.**

Append to `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`:

```tsx
it("forwards colorFor / pulseFor through to StatusPill", () => {
  const colorFor = vi.fn((_s: CockpitStatus, _halted: boolean) => "rgb(184, 108, 80)");
  const pulseFor = vi.fn((_s: CockpitStatus, _halted: boolean) => false);
  render(
    <Identity
      statusKey="WAITING"
      halted={false}
      subtitle="Optimizing Meta Ads"
      line={null}
      onHaltToggle={() => {}}
      colorFor={colorFor}
      pulseFor={pulseFor}
    />,
  );
  expect(colorFor).toHaveBeenCalledWith("WAITING", false);
  expect(pulseFor).toHaveBeenCalledWith("WAITING", false);
});
```

Adjust the existing import block at the top of the file to include `vi` (Vitest) and `CockpitStatus` if not already present.

- [ ] **Step 3: Run the test and verify it fails.**

```bash
pnpm --filter @switchboard/dashboard test -- --run identity
```

Expected: failure — `colorFor` / `pulseFor` not a known `IdentityProps` field.

- [ ] **Step 4: Add the pass-through props.**

In `apps/dashboard/src/components/cockpit/identity.tsx`, extend `IdentityProps` with the same two optional props and forward them in the `<StatusPill … />` call:

```tsx
export interface IdentityProps {
  // … existing fields unchanged …
  colorFor?: (s: CockpitStatus, halted: boolean) => string;
  pulseFor?: (s: CockpitStatus, halted: boolean) => boolean;
}

// inside the function body, at the StatusPill usage:
<StatusPill statusKey={statusKey} halted={halted} colorFor={colorFor} pulseFor={pulseFor} />;
```

Add `import type { CockpitStatus } from "./types";` at the top if not already imported.

- [ ] **Step 5: Run the test and verify it passes.**

```bash
pnpm --filter @switchboard/dashboard test -- --run identity
```

Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/identity.tsx \
        apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
git commit -m "feat(cockpit): Identity forwards colorFor + pulseFor to StatusPill (B.3 prep)"
```

---

### Task 5: Parameterize `<ApprovalCard>` with optional `accent` + `senderLabel` props

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/approval-card.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Append to `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`:

```tsx
it("renders the default sender label and Alex accent when no overrides are passed", () => {
  const fixture = makeAlexApprovalFixture(); // existing helper
  const { container } = render(
    <ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />,
  );
  expect(container.textContent).toContain("Alex needs you");
});

it("renders custom senderLabel when supplied", () => {
  const fixture = makeRileyApprovalFixture(); // existing helper
  const { container } = render(
    <ApprovalCard
      data={fixture}
      idx={0}
      total={1}
      onResolve={() => {}}
      senderLabel="Riley needs you"
    />,
  );
  expect(container.textContent).toContain("Riley needs you");
  expect(container.textContent).not.toContain("Alex needs you");
});

it("renders custom accent on the eyebrow color", () => {
  const fixture = makeRileyApprovalFixture();
  const accent = { base: "#B86C50", deep: "#7E4533", soft: "#ECD4C8", paper: "#F6E7DE" };
  const { container } = render(
    <ApprovalCard
      data={fixture}
      idx={0}
      total={1}
      onResolve={() => {}}
      accent={accent}
      senderLabel="Riley needs you"
    />,
  );
  const eyebrow = container.querySelector("span") as HTMLElement;
  // Riley deep clay color on the eyebrow
  expect(eyebrow.style.color.toLowerCase()).toBe("rgb(126, 69, 51)");
});

it("renders Alex amber on the eyebrow when accent is not overridden", () => {
  const fixture = makeAlexApprovalFixture();
  const { container } = render(
    <ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />,
  );
  const eyebrow = container.querySelector("span") as HTMLElement;
  // Whatever T.amberDeep resolves to — assert it is NOT the Riley deep.
  expect(eyebrow.style.color.toLowerCase()).not.toBe("rgb(126, 69, 51)");
  expect(eyebrow.style.color.length).toBeGreaterThan(0);
});
```

If `makeAlexApprovalFixture` / `makeRileyApprovalFixture` helpers don't exist in the test file, inline a minimal `ApprovalView` literal (the existing tests pattern) — do not introduce new helpers for this slice.

- [ ] **Step 2: Run the tests and verify they fail.**

```bash
pnpm --filter @switchboard/dashboard test -- --run approval-card
```

Expected: the "custom senderLabel" and "custom accent" tests fail. Existing tests stay green.

- [ ] **Step 3: Add the optional props and use them.**

Edit `apps/dashboard/src/components/cockpit/approval-card.tsx`. Replace the existing `ApprovalCardProps` interface and the hardcoded `"Alex needs you"` / `T.amberPaper` / `T.amberSoft` / `T.amberDeep` references with parameterized accent + senderLabel. Defaults preserve current Alex behavior.

```tsx
// apps/dashboard/src/components/cockpit/approval-card.tsx
import { T } from "./tokens";
import type { ApprovalView } from "./types";

export interface ApprovalAccent {
  base: string;
  deep: string;
  soft: string;
  paper: string;
}

export const ALEX_APPROVAL_ACCENT: ApprovalAccent = {
  base: T.amber,
  deep: T.amberDeep,
  soft: T.amberSoft,
  paper: T.amberPaper,
};

export interface ApprovalCardProps {
  data: ApprovalView;
  idx: number;
  total: number;
  onResolve: (verdict: "accept" | "decline", idx: number) => void;
  compact?: boolean;
  accent?: ApprovalAccent;
  senderLabel?: string;
}

export function ApprovalCard({
  data,
  idx,
  total,
  onResolve,
  compact = false,
  accent = ALEX_APPROVAL_ACCENT,
  senderLabel = "Alex needs you",
}: ApprovalCardProps) {
  return (
    <section
      style={{
        padding: compact ? "16px 18px" : "20px 22px",
        background: accent.paper,
        borderRadius: 8,
        border: `1px solid ${accent.soft}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: accent.deep,
            textTransform: "uppercase",
          }}
        >
          {senderLabel}
        </span>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: accent.deep }}>
          · {data.askedAt}
        </span>
        {/* … rest of the existing card body — replace every T.amberPaper / T.amberSoft / T.amberDeep with accent.paper / accent.soft / accent.deep, and T.amber with accent.base. … */}
      </div>
      {/* (Preserve every other line of the existing body verbatim; only the
          token references change.) */}
    </section>
  );
}
```

The verbatim diff is: replace `T.amberPaper` → `accent.paper`, `T.amberSoft` → `accent.soft`, `T.amberDeep` → `accent.deep`, `T.amber` → `accent.base`, and the literal `"Alex needs you"` → `{senderLabel}`. The structure, layout, and every other style value stays unchanged.

- [ ] **Step 4: Run the tests and verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run approval-card
```

Expected: all green (existing + 4 new).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/approval-card.tsx \
        apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
git commit -m "feat(cockpit): ApprovalCard accent + senderLabel props (B.3 prep)"
```

---

### Task 6: Parameterize `<ComposerPlaceholder>` with optional sender + copy + accent

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/composer-placeholder.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Append to `apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx`:

```tsx
it("renders Alex sender + Alex copy when overrides are absent", () => {
  const { container } = render(<ComposerPlaceholder halted={false} />);
  expect(container.textContent).toContain("→ ALEX");
  expect(container.textContent).toContain("Tell Alex what to do — coming soon");
});

it("renders override sender + override copy when supplied", () => {
  const { container } = render(
    <ComposerPlaceholder
      halted={false}
      senderLabel="RILEY"
      placeholderCopy="Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…"
    />,
  );
  expect(container.textContent).toContain("→ RILEY");
  expect(container.textContent).toContain("Tell Riley what to do");
  expect(container.textContent).not.toContain("Tell Alex");
});

it("preserves halted copy regardless of placeholderCopy override", () => {
  const { container } = render(
    <ComposerPlaceholder halted={true} senderLabel="RILEY" placeholderCopy="anything" />,
  );
  expect(container.textContent).toContain("Halted — resume to send instructions");
  expect(container.textContent).not.toContain("anything");
});

it("uses accentColor for the sender label when supplied", () => {
  const { container } = render(
    <ComposerPlaceholder halted={false} senderLabel="RILEY" accentColor="rgb(126, 69, 51)" />,
  );
  const sender = Array.from(container.querySelectorAll("span")).find((s) =>
    (s.textContent ?? "").includes("→ RILEY"),
  ) as HTMLElement | undefined;
  expect(sender).toBeDefined();
  expect(sender!.style.color.toLowerCase()).toBe("rgb(126, 69, 51)");
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

```bash
pnpm --filter @switchboard/dashboard test -- --run composer-placeholder
```

Expected: 3 of the 4 new tests fail. The default-render test stays green if existing assertions don't conflict.

- [ ] **Step 3: Add the optional props.**

Edit `apps/dashboard/src/components/cockpit/composer-placeholder.tsx`:

```tsx
// apps/dashboard/src/components/cockpit/composer-placeholder.tsx
import { T } from "./tokens";

export interface ComposerPlaceholderProps {
  halted: boolean;
  compact?: boolean;
  senderLabel?: string;
  placeholderCopy?: string;
  accentColor?: string;
}

export function ComposerPlaceholder({
  halted,
  compact = false,
  senderLabel = "ALEX",
  placeholderCopy = "Tell Alex what to do — coming soon",
  accentColor = T.ink4,
}: ComposerPlaceholderProps) {
  return (
    <div
      style={{
        borderTop: `1px solid ${T.hair}`,
        background: T.bg,
        padding: compact ? "10px 18px 12px" : "12px 28px 14px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 6,
          padding: "5px 14px",
          opacity: halted ? 0.55 : 1,
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: accentColor,
            letterSpacing: "0.08em",
          }}
        >
          → {senderLabel}
        </span>
        <span style={{ fontSize: 13, color: T.ink4, padding: "8px 0" }}>
          {halted ? "Halted — resume to send instructions" : placeholderCopy}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run composer-placeholder
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/composer-placeholder.tsx \
        apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx
git commit -m "feat(cockpit): ComposerPlaceholder senderLabel + placeholderCopy + accentColor props (B.3 prep)"
```

---

### Task 7: Extend `riley-config.ts` with `RILEY_COMPOSER_PLACEHOLDER` + `RILEY_COMMANDS`

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts`

- [ ] **Step 1: Write the failing test.**

Append to `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts`:

```ts
it("RILEY_COMPOSER_PLACEHOLDER carries the locked Riley voice placeholder", () => {
  expect(RILEY_COMPOSER_PLACEHOLDER).toBe(
    "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…",
  );
});

it("RILEY_COMMANDS exports the locked Riley command catalog grouped into control / thread / rules / nav", () => {
  const ids = RILEY_COMMANDS.map((c) => c.id);
  expect(ids).toEqual([
    "open-meta",
    "open-rules",
    "open-targets",
    "pause-1h",
    "resume",
    "brief-eod",
    "cpl-30",
  ]);
  const groups = new Set(RILEY_COMMANDS.map((c) => c.group));
  expect([...groups].sort()).toEqual(["control", "nav", "rules", "thread"]);
  RILEY_COMMANDS.forEach((c) => {
    expect(c.label.length).toBeGreaterThan(2);
    expect(["control", "thread", "rules", "nav"]).toContain(c.group);
  });
});
```

Update the import block at the top of the test file:

```ts
import {
  RILEY_ACCENT,
  RILEY_TABS,
  RILEY_MISSION_SUBTITLE,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_COMMANDS,
  statusColor,
  statusPulse,
} from "../riley-config";
```

- [ ] **Step 2: Run the test and verify it fails.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-config
```

Expected: failure — missing exports.

- [ ] **Step 3: Add the catalog to `riley-config.ts`.**

Append to `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`:

```ts
export const RILEY_COMPOSER_PLACEHOLDER =
  "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…";

export interface RileyCommand {
  id: string;
  label: string;
  group: "control" | "thread" | "rules" | "nav";
}

// Catalog ships as typed data only in B.3. The B.3-followup (after Alex A.5)
// wires these into the shared <CommandPalette>. Order matches the order the
// palette renders groups: nav → rules → control → thread.
export const RILEY_COMMANDS: readonly RileyCommand[] = [
  { id: "open-meta", label: "Open Meta", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "rules" },
  { id: "open-targets", label: "Open targets", group: "rules" },
  { id: "pause-1h", label: "Pause Riley for 1h", group: "control" },
  { id: "resume", label: "Resume Riley", group: "control" },
  { id: "brief-eod", label: "Brief me at EOD", group: "thread" },
  { id: "cpl-30", label: "Show CPL — last 30d", group: "thread" },
];
```

- [ ] **Step 4: Run the test and verify it passes.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-config
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/riley/riley-config.ts \
        apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts
git commit -m "feat(cockpit): riley-config RILEY_COMPOSER_PLACEHOLDER + RILEY_COMMANDS catalog (B.3)"
```

---

### Task 8: Create `riley-toast.ts` voice helper

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/riley/riley-toast.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-toast.test.ts`

- [ ] **Step 1: Write the failing tests.**

Create `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-toast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rileyToast } from "../riley-toast";
import type { RileyApprovalView, RileyApprovalKind } from "@/components/cockpit/types";

const baseView = (overrides: Partial<RileyApprovalView> = {}): RileyApprovalView => ({
  id: "rec-1",
  kind: "pause",
  urgency: "immediate",
  askedAt: "2m",
  title: "Pause Cold Interests",
  presentation: { primaryLabel: "Pause", dismissLabel: "Dismiss" },
  primary: "Pause",
  secondary: "Reduce 50%",
  campaign: { kind: "campaign", name: "Cold Interests", id: "c-1" },
  confidence: 0.9,
  learningPhaseImpact: "no impact",
  reversible: true,
  primaryAction: { kind: "internal", intent: "recommendation.pause", parameters: {} },
  ...overrides,
});

describe("rileyToast", () => {
  it("reads acceptToast verbatim when present", () => {
    const toast = rileyToast({
      verdict: "accept",
      approval: baseView({ acceptToast: "Paused Cold Interests. Standing by." }),
    });
    expect(toast.title).toBe("Paused Cold Interests. Standing by.");
  });

  it("reads declineToast verbatim when present", () => {
    const toast = rileyToast({
      verdict: "decline",
      approval: baseView({ declineToast: "Leaving Cold Interests running." }),
    });
    expect(toast.title).toBe("Leaving Cold Interests running.");
  });

  it("falls back to per-kind accept line when acceptToast is missing", () => {
    const toast = rileyToast({ verdict: "accept", approval: baseView({ kind: "scale" }) });
    expect(toast.title).toBe("Scaling — back to scanning.");
  });

  it("falls back to per-kind decline line when declineToast is missing", () => {
    const toast = rileyToast({ verdict: "decline", approval: baseView({ kind: "scale" }) });
    expect(toast.title).toBe("Holding — back to scanning.");
  });

  // 11 kinds × 2 verdicts = 22 fallback assertions. Locks the table.
  const FALLBACK_TABLE: Record<RileyApprovalKind, { accept: string; decline: string }> = {
    pause: { accept: "Paused — standing by.", decline: "Holding — back to scanning." },
    scale: { accept: "Scaling — back to scanning.", decline: "Holding — back to scanning." },
    refresh_creative: {
      accept: "Creative refresh queued — back to scanning.",
      decline: "Holding the current creative.",
    },
    restructure: {
      accept: "Restructure plan opened.",
      decline: "Holding the current structure.",
    },
    shift_budget_to_source: {
      accept: "Shifting budget — back to scanning.",
      decline: "Holding the current split.",
    },
    switch_optimization_event: {
      accept: "Switched optimization event.",
      decline: "Holding the current event.",
    },
    harden_capi_attribution: {
      accept: "Opening Meta to harden attribution.",
      decline: "Holding the current CAPI configuration.",
    },
    hold: { accept: "Holding — watching.", decline: "Acknowledged — back to scanning." },
    add_creative: {
      accept: "Add-creative ask routed.",
      decline: "Holding off on adding creatives.",
    },
    review_budget: {
      accept: "Opening Meta to review budget.",
      decline: "Holding the current budget.",
    },
    signal_health_group: {
      accept: "Opening Events Manager.",
      decline: "Acknowledged — back to scanning the pixel.",
    },
  };

  it.each(
    Object.entries(FALLBACK_TABLE) as Array<
      [RileyApprovalKind, { accept: string; decline: string }]
    >,
  )("fallback for kind %s renders the locked lines", (kind, lines) => {
    const accept = rileyToast({ verdict: "accept", approval: baseView({ kind }) });
    const decline = rileyToast({ verdict: "decline", approval: baseView({ kind }) });
    expect(accept.title).toBe(lines.accept);
    expect(decline.title).toBe(lines.decline);
  });

  it("treats empty-string acceptToast / declineToast as missing", () => {
    const accept = rileyToast({ verdict: "accept", approval: baseView({ acceptToast: "" }) });
    expect(accept.title).toBe("Paused — standing by."); // pause fallback
    const decline = rileyToast({ verdict: "decline", approval: baseView({ declineToast: "" }) });
    expect(decline.title).toBe("Holding — back to scanning.");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-toast
```

Expected: file-not-found failure. No `riley-toast` module yet.

- [ ] **Step 3: Create the `riley-toast.ts` module.**

Create `apps/dashboard/src/lib/cockpit/riley/riley-toast.ts`:

```ts
// apps/dashboard/src/lib/cockpit/riley/riley-toast.ts
//
// Riley voice helper. Reads `RileyApprovalView.acceptToast` / `.declineToast`
// (populated engine-side by `packages/ad-optimizer/src/recommendation-sink.ts`)
// when present; otherwise falls back to a per-kind generic line.
//
// Honest impact language: no line claims Riley improved metrics; lines
// describe what Riley did with the operator's instruction.

import type { RileyApprovalView, RileyApprovalKind } from "@/components/cockpit/types";

export type RileyToastVerdict = "accept" | "decline";

interface ToastPayload {
  title: string;
  description?: string;
}

const FALLBACK: Record<RileyApprovalKind, { accept: string; decline: string }> = {
  pause: { accept: "Paused — standing by.", decline: "Holding — back to scanning." },
  scale: { accept: "Scaling — back to scanning.", decline: "Holding — back to scanning." },
  refresh_creative: {
    accept: "Creative refresh queued — back to scanning.",
    decline: "Holding the current creative.",
  },
  restructure: {
    accept: "Restructure plan opened.",
    decline: "Holding the current structure.",
  },
  shift_budget_to_source: {
    accept: "Shifting budget — back to scanning.",
    decline: "Holding the current split.",
  },
  switch_optimization_event: {
    accept: "Switched optimization event.",
    decline: "Holding the current event.",
  },
  harden_capi_attribution: {
    accept: "Opening Meta to harden attribution.",
    decline: "Holding the current CAPI configuration.",
  },
  hold: { accept: "Holding — watching.", decline: "Acknowledged — back to scanning." },
  add_creative: {
    accept: "Add-creative ask routed.",
    decline: "Holding off on adding creatives.",
  },
  review_budget: {
    accept: "Opening Meta to review budget.",
    decline: "Holding the current budget.",
  },
  signal_health_group: {
    accept: "Opening Events Manager.",
    decline: "Acknowledged — back to scanning the pixel.",
  },
};

export function rileyToast(args: {
  verdict: RileyToastVerdict;
  approval: RileyApprovalView;
}): ToastPayload {
  const { verdict, approval } = args;
  const engineCopy = verdict === "accept" ? approval.acceptToast : approval.declineToast;
  if (engineCopy && engineCopy.length > 0) {
    return { title: engineCopy };
  }
  const fallback = FALLBACK[approval.kind];
  return { title: verdict === "accept" ? fallback.accept : fallback.decline };
}
```

- [ ] **Step 4: Run the tests and verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-toast
```

Expected: all green (4 + 22 it.each = 26 cases).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/riley/riley-toast.ts \
        apps/dashboard/src/lib/cockpit/riley/__tests__/riley-toast.test.ts
git commit -m "feat(cockpit): rileyToast voice helper + per-kind fallback table (B.3)"
```

---

### Task 9: Wire `RileyCockpitPage` — accent + senderLabel + per-row resolution + Riley toast

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

**Why per-row not page-level for resolution wiring:** B.1's acceptance criterion #3 (slicing spec §B.1) requires approval cards to stack with `urgency` ordering. `useRecommendationAction(id)` is keyed by recommendation id, so a single hook call at page level can resolve only one fixed id per render. Multi-card scenarios — including the signal-health grouped card alongside a campaign-level card — would resolve the wrong recommendation if the page bound a single hook to `approvals[0].id`. The plan ships per-row resolution from the start to keep the multi-card invariant honest.

The pattern: introduce a tiny `<RileyApprovalRow>` wrapper inside `riley-cockpit-page.tsx` that takes a single `RileyApprovalView` and renders one `<ApprovalCard>`. The wrapper owns its own `useRecommendationAction(approval.id)` and `useToast()`-bound `onResolve`. `<ApprovalBlock>` is bypassed for Riley — Riley page maps `approvals` directly to a list of `<RileyApprovalRow>` instances inside the same flex container `<ApprovalBlock>` provides (Alex continues to use `<ApprovalBlock>` unchanged with its existing default props).

**Three additional behaviors the wrapper enforces (each has a dedicated test in Step 2):**

1. **Success-only toast.** Resolution uses `promise.then(...)` not `promise.finally(...)`. A failed `primary()` / `dismiss()` must not show a success-sounding toast like "Paused Cold Interests" if the action actually failed. Errors surface through TanStack Query's `error` state on `useRecommendationAction`; B.3 does not add error toasts.

2. **External primary actions do not call `primary()` and do not fire an accept toast.** When `approval.primaryAction.kind === "external"`, the accept click opens `approval.primaryAction.url` in a new tab and stops. No mutation hook call, no toast — the new tab opening is the visible confirmation. This covers `review_budget`, `fix_signal_health`, `harden_capi_attribution`.

3. **Decline (dismiss) still fires for external cards.** The decline path is identical for internal and external action kinds: call `action.dismiss()` and fire `rileyToast({ verdict: "decline", approval })`. External-action cards still represent a queued recommendation, and dismissing one marks it acted-on.

- [ ] **Step 1: Read the current page to confirm region.**

```bash
sed -n '1,55p' apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
```

Confirm the B.1 stub at lines ~43–45 (`// B.1 stops at view assembly; resolution wires up at a future slice.`) is still present.

- [ ] **Step 2: Write the failing tests.**

Replace or extend `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`. Mocks of `useRecommendationAction` and `useToast`, plus a multi-card fixture to prove per-row binding:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const actionCalls: Array<{ id: string; verb: "primary" | "dismiss" }> = [];
const toast = vi.fn();
// Mutable config the hoisted mock reads. Lets a single test flip primary() to
// reject without re-mocking the module (vi.doMock + dynamic-import has subtle
// hoist interactions; this avoids them).
const mockConfig = { rejectPrimary: false };

vi.mock("@/hooks/use-recommendation-action", () => ({
  useRecommendationAction: (id: string) => ({
    primary: vi.fn(async () => {
      actionCalls.push({ id, verb: "primary" });
      if (mockConfig.rejectPrimary) throw new Error("network failed");
    }),
    dismiss: vi.fn(async () => {
      actionCalls.push({ id, verb: "dismiss" });
    }),
  }),
}));
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast }),
}));
vi.mock("@/hooks/use-riley-status", () => ({ useRileyStatus: () => "WAITING" }));
vi.mock("@/hooks/use-riley-activity", () => ({ useRileyActivity: () => ({ rows: [] }) }));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: () => {} }),
}));

const rec1 = {
  id: "rec-1",
  kind: "pause" as const,
  urgency: "immediate" as const,
  askedAt: "2m",
  title: "Pause Cold Interests",
  presentation: { primaryLabel: "Pause", dismissLabel: "Dismiss" },
  primary: "Pause",
  secondary: "Reduce 50%",
  campaign: { kind: "campaign" as const, name: "Cold Interests", id: "c-1" },
  confidence: 0.9,
  learningPhaseImpact: "no impact" as const,
  reversible: true,
  primaryAction: { kind: "internal" as const, intent: "recommendation.pause", parameters: {} },
  acceptToast: "Paused Cold Interests. Standing by.",
  declineToast: "Leaving Cold Interests running.",
};
const rec2 = {
  ...rec1,
  id: "rec-2",
  kind: "scale" as const,
  title: "Scale BR-Whitening",
  primary: "Scale 20%",
  secondary: "Hold",
  campaign: { kind: "campaign" as const, name: "BR-Whitening", id: "c-2" },
  primaryAction: { kind: "internal" as const, intent: "recommendation.scale", parameters: {} },
  acceptToast: undefined,
  declineToast: undefined,
};
// External-action card: review_budget opens Meta via primaryAction.url. Primary
// click must not call useRecommendationAction.primary() and must not fire an
// accept toast. Decline click still calls dismiss() + the decline toast.
const rec3 = {
  ...rec1,
  id: "rec-3",
  kind: "review_budget" as const,
  title: "Review Cold Interests budget",
  primary: "Review budget",
  secondary: "Hold",
  campaign: { kind: "campaign" as const, name: "Cold Interests", id: "c-1" },
  primaryAction: {
    kind: "external" as const,
    url: "https://business.facebook.com/adsmanager/manage/campaigns?act=123",
    service: "meta" as const,
  },
  acceptToast: "Opening Meta to review Cold Interests's budget.",
  declineToast: "Holding Cold Interests's budget where it is.",
};

vi.mock("@/hooks/use-riley-approvals", () => ({
  useRileyApprovals: () => ({ approvals: [rec1, rec2, rec3] }),
}));

beforeEach(() => {
  actionCalls.length = 0;
  toast.mockReset();
  mockConfig.rejectPrimary = false;
});

describe("RileyCockpitPage — B.3 voice + accent", () => {
  it("renders the Riley sender label on every approval card", async () => {
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    expect(screen.getAllByText("Riley needs you").length).toBe(3);
  });

  it("clicking accept on the first card calls primary() bound to rec-1 and fires its acceptToast", async () => {
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Pause")); // rec-1 primary button
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-1", verb: "primary" }]);
    expect(toast).toHaveBeenCalledWith({ title: "Paused Cold Interests. Standing by." });
  });

  it("clicking decline on the first card calls dismiss() bound to rec-1 and fires its declineToast", async () => {
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Reduce 50%")); // rec-1 secondary button → onResolve("decline")
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-1", verb: "dismiss" }]);
    expect(toast).toHaveBeenCalledWith({ title: "Leaving Cold Interests running." });
  });

  it("clicking accept on the second card calls primary() bound to rec-2 (per-row hook binding)", async () => {
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Scale 20%")); // rec-2 primary button
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-2", verb: "primary" }]);
  });

  it("falls back to per-kind rileyToast copy when engine omitted acceptToast / declineToast", async () => {
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Scale 20%")); // rec-2 has no acceptToast
    await Promise.resolve();
    expect(toast).toHaveBeenCalledWith({ title: "Scaling — back to scanning." });
  });

  it("external-action primary opens the Meta URL and does NOT call primary() or fire a toast", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    // rec-3 ("Review budget") is the external-action primary
    fireEvent.click(screen.getByText("Review budget"));
    await Promise.resolve();
    expect(openSpy).toHaveBeenCalledWith(
      "https://business.facebook.com/adsmanager/manage/campaigns?act=123",
      "_blank",
      "noopener,noreferrer",
    );
    expect(actionCalls).toEqual([]); // no mutation
    expect(toast).not.toHaveBeenCalled(); // no toast
    openSpy.mockRestore();
  });

  it("external-action decline still calls dismiss() and fires the decline toast", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    // rec-3's secondary label is "Hold" → onResolve("decline")
    // There are multiple "Hold" buttons (rec-2.secondary = "Hold" too); use the
    // last one which is rec-3 in DOM order.
    const holds = screen.getAllByText("Hold");
    fireEvent.click(holds[holds.length - 1]!);
    await Promise.resolve();
    expect(openSpy).not.toHaveBeenCalled();
    expect(actionCalls).toEqual([{ id: "rec-3", verb: "dismiss" }]);
    expect(toast).toHaveBeenCalledWith({ title: "Holding Cold Interests's budget where it is." });
    openSpy.mockRestore();
  });

  it("success-only toast — toast does not fire if the mutation rejects", async () => {
    mockConfig.rejectPrimary = true;
    const { RileyCockpitPage } = await import("../riley-cockpit-page");
    render(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Pause"));
    // Flush microtasks; the rejection settles next tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(actionCalls).toEqual([{ id: "rec-1", verb: "primary" }]);
    expect(toast).not.toHaveBeenCalled(); // success-only — failure suppresses the toast
  });
});
```

If the existing B.1 test file already mocks Riley hooks and asserts cold/steady/halted, preserve those cases and append the new `describe("RileyCockpitPage — B.3 voice + accent", …)` block alongside. The B.1 mocks at top-of-file remain; this block adds its own `vi.mock` for `useRecommendationAction` and `useToast`.

- [ ] **Step 3: Run the tests and verify they fail.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: 8 new test failures. The B.1 cold/steady/halted cases stay green.

- [ ] **Step 4: Wire the page with a per-row resolution wrapper.**

Replace `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` with the following. The `<RileyApprovalRow>` wrapper owns its `useRecommendationAction(approval.id)` and `useToast()`-bound `onResolve`, so each card resolves the correct recommendation. The B.1 no-op `onResolve` stub is gone.

```tsx
// apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
"use client";

import { useState } from "react";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalCard } from "./approval-card";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { ComposerPlaceholder } from "./composer-placeholder";
import {
  RILEY_ACCENT,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_MISSION_SUBTITLE,
  RILEY_TABS,
  statusColor,
  statusPulse,
} from "@/lib/cockpit/riley/riley-config";
import { rileyToast } from "@/lib/cockpit/riley/riley-toast";
import { useRileyApprovals } from "@/hooks/use-riley-approvals";
import { useRileyStatus } from "@/hooks/use-riley-status";
import { useRileyActivity } from "@/hooks/use-riley-activity";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { useToast } from "@/components/ui/use-toast";
import { useHalt } from "@/components/layout/halt/halt-context";
import type { ApprovalView, RileyApprovalView } from "./types";

const RILEY_APPROVAL_ACCENT = {
  base: RILEY_ACCENT.base,
  deep: RILEY_ACCENT.deep,
  soft: RILEY_ACCENT.soft,
  paper: RILEY_ACCENT.paper,
};

function RileyApprovalRow({
  approval,
  idx,
  total,
}: {
  approval: RileyApprovalView;
  idx: number;
  total: number;
}) {
  const action = useRecommendationAction(approval.id);
  const { toast } = useToast();
  const onResolve = (verdict: "accept" | "decline", _idx: number) => {
    // External-action accept: open the Meta URL in a new tab. No mutation
    // hook call; no toast (the new tab opening is the visible confirmation).
    if (verdict === "accept" && approval.primaryAction.kind === "external") {
      window.open(approval.primaryAction.url, "_blank", "noopener,noreferrer");
      return;
    }
    // Internal accept or any decline: dispatch through the action hook and
    // fire the Riley toast only on success (.then, not .finally — a failed
    // primary()/dismiss() must not show a success-sounding toast).
    const promise = verdict === "accept" ? action.primary() : action.dismiss();
    void promise.then(() => {
      toast(rileyToast({ verdict, approval }));
    });
  };
  return (
    <ApprovalCard
      data={approval as ApprovalView}
      idx={idx}
      total={total}
      onResolve={onResolve}
      accent={RILEY_APPROVAL_ACCENT}
      senderLabel="Riley needs you"
    />
  );
}

export function RileyCockpitPage() {
  const haltCtx = useHalt();
  const { approvals } = useRileyApprovals();
  const statusKey = useRileyStatus();
  const { rows: activityRows } = useRileyActivity();
  const [filter, setFilter] = useState<ActivityFilter>("all");

  return (
    <div
      style={{
        background: T.bg,
        color: T.ink,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Topbar paletteEnabled={false} compact tabs={RILEY_TABS} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Identity
          statusKey={statusKey}
          halted={haltCtx.halted}
          subtitle={RILEY_MISSION_SUBTITLE}
          line={null}
          onHaltToggle={haltCtx.toggleHalt}
          colorFor={statusColor}
          pulseFor={statusPulse}
        />
        {approvals.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              margin: "20px 28px 0",
            }}
          >
            {(approvals as RileyApprovalView[]).map((approval, idx) => (
              <RileyApprovalRow
                key={approval.id}
                approval={approval}
                idx={idx}
                total={approvals.length}
              />
            ))}
          </div>
        )}
        <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
      </div>
      <ComposerPlaceholder
        halted={haltCtx.halted}
        senderLabel="RILEY"
        placeholderCopy={RILEY_COMPOSER_PLACEHOLDER}
        accentColor={RILEY_ACCENT.deep}
      />
    </div>
  );
}
```

Note: the Riley page no longer imports `ApprovalBlock`. The flex container styles are inlined verbatim from `ApprovalBlock` (gap 14, margin `20px 28px 0`) to preserve the visual layout. Alex's page continues to use `<ApprovalBlock>` unchanged with its existing default props (no `accent` / `senderLabel` overrides today; Alex defaults render as before). The `<ApprovalBlock>` API is **not** extended in this slice — pass-through props for accent/senderLabel can be added later if Alex needs theming, but B.3 does not need them and the extra plumbing would be PR noise.

- [ ] **Step 5: Run the tests and verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: all green (existing + 8 new). The per-row binding test (`rec-2 primary`) demonstrates that hook keying is correct across cards. The two external-action tests prove that external primary opens a new tab without invoking the mutation hook or firing a toast, and that external decline still dismisses + toasts. The success-only test proves a failed mutation does not produce a misleading success toast.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "feat(riley-cockpit): wire accent + senderLabel + per-row onResolve + rileyToast on /riley (B.3)"
```

---

### Task 10: Audit `amberPaper|amberSoft|amberDeep` references that may have been Riley-specific

Some B.1 fixture/test code may have asserted Alex tokens on Riley-shaped fixtures (a B.1 oversight). Riley fixtures now render through the parameterized `ApprovalCard` with Riley accent. Audit:

- [ ] **Step 1: Grep for token references in Riley-specific tests.**

```bash
rg -n "amberPaper|amberSoft|amberDeep|T\.amber\b" \
   apps/dashboard/src/components/cockpit/__tests__ \
   apps/dashboard/src/lib/cockpit/riley/__tests__
```

Expected: matches only in tests that exercise the **default-render** path (Alex), not Riley fixtures. If a Riley fixture test asserts `T.amberDeep`, update that test to assert the Riley deep clay color (`"#7E4533"` or `"rgb(126, 69, 51)"`) instead.

- [ ] **Step 2: Fix any Riley assertions found.**

If any Riley test asserts Alex tokens, update the assertion to the Riley accent value. Re-run that file's tests:

```bash
pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: all green.

- [ ] **Step 3: If no changes were needed, note this in the PR description.**

If the grep returns only legitimate Alex-default-render matches, document this in the PR description as "no Riley-token assertions found in B.1 tests; default-render path covers Alex; Riley-render path covers Riley." Do not commit a no-op change.

- [ ] **Step 4: Commit (only if changes were made).**

```bash
git add apps/dashboard/src/components/cockpit/__tests__/ \
        apps/dashboard/src/lib/cockpit/riley/__tests__/
git commit -m "test(cockpit): align Riley fixture assertions with Riley accent (B.3)"
```

---

### Task 11: Adapter-boundary grep gate

- [ ] **Step 1: Run the gate.**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: identical match set to `main` baseline. The new `riley-toast.ts` lives outside `components/cockpit` (it is under `lib/cockpit/riley/**`); any import of `RileyApprovalView` from `@/components/cockpit/types` is a _type-only_ view-model import and is **not** what the rule guards against. If the grep returns new matches under `components/cockpit/**` or `hooks/use-riley-*.ts`, the boundary has leaked — fix before commit.

- [ ] **Step 2: Diff against baseline.**

```bash
git diff origin/main -- 'apps/dashboard/src/components/cockpit/**/*.{ts,tsx}' 'apps/dashboard/src/hooks/use-riley-*.ts' \
  | grep -E '^\+.*\b(Recommendation|AuditEntry|@switchboard/db|@prisma)\b' || echo "clean"
```

Expected: `clean`. (Any plus-line containing those identifiers under the guarded paths is a violation.)

---

### Task 12: Final verification — typecheck, lint, tests, dashboard `next build`

Per CLAUDE.md memory `feedback_dashboard_build_not_in_ci`, run `pnpm --filter @switchboard/dashboard build` locally before claiming done.

- [ ] **Step 1: Typecheck.**

```bash
pnpm typecheck
```

Expected: clean. If errors mention missing exports from `@switchboard/schemas` or `@switchboard/ad-optimizer`, run `pnpm reset` once (per CLAUDE.md) and re-run typecheck.

- [ ] **Step 2: Lint.**

```bash
pnpm lint
```

Expected: 0 new errors. Pre-existing `any` warnings in unrelated paths are acceptable.

- [ ] **Step 3: Filtered test runs.**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/ad-optimizer test -- --run recommendation-sink
pnpm --filter @switchboard/dashboard test -- --run cockpit
pnpm --filter @switchboard/dashboard test -- --run riley
```

Expected: all green. (Pre-existing flakes per CLAUDE.md memory: `prisma-work-trace-store-integrity`, `prisma-ledger-storage`, `prisma-greeting-signal-store` may flake unrelated to B.3 — verify the failure reproduces on `origin/main` before declaring a regression.)

- [ ] **Step 4: Dashboard `next build`.**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: clean build. Specifically the `/riley` route renders without TypeScript errors. If the build fails with a `.js` extension issue, audit any new relative import in `riley-cockpit-page.tsx` / `riley-toast.ts` and remove the extension per `feedback_dashboard_no_js_on_any_import`.

- [ ] **Step 5: Final commit if any verification fixes landed.**

If steps 1–4 surfaced typos or extension issues, commit fixes:

```bash
git add -p  # selectively stage verification fixes
git commit -m "fix(B.3): verification cleanup (typecheck/lint/build)"
```

---

## Self-Review (post-write)

This section is the writing-plans skill's required spec-coverage check.

**1. Spec coverage.**

| Slicing spec §B.3 requirement                                             | Plan task                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Riley accent applied uniformly                                            | Tasks 3 (StatusPill), 4 (Identity forward), 5 (ApprovalCard), 6 (ComposerPlaceholder), 9 (page wiring).                              |
| Command palette pre-populated with RILEY_COMMANDS                         | Task 7 ships catalog; **interactive palette deferred** to B.3-followup post-A.5 (documented in slice brief).                         |
| Composer constraint enforced                                              | Composer remains inert (placeholder visuals only). Interactive `Allowed-in-B.3` semantics deferred post-A.5.                         |
| `RecommendationPresentation.acceptToast` + `declineToast` optional fields | Task 1.                                                                                                                              |
| Engine populates them where context exists                                | Task 2 — every action in the labels table gets both.                                                                                 |
| Cockpit toasts use them with fallback to `rileyToast()`                   | Tasks 8 (rileyToast) + 9 (page wires it through `useToast`).                                                                         |
| External-action accept opens URL, does not fire toast                     | Task 9 — dedicated test asserts no `primary()` call and no `toast()` call when `primaryAction.kind === "external"`.                  |
| Success-only toast (failure does not show success copy)                   | Task 9 — `.then()` not `.finally()`, dedicated test asserts toast suppressed on rejection.                                           |
| Final empty/error copy reviewed for tone consistency with Alex            | Embedded in Tasks 6 (placeholder copy) + 8 (fallback table); reviewer checks the locked tables in this plan against Alex A.2's tone. |
| Type-check, lint, tests, dashboard `next build` clean                     | Task 12.                                                                                                                             |

Items deferred to B.3-followup are explicitly documented in the slice brief §What does NOT ship, with the A.5 dependency named.

**2. Placeholder scan.**

- No "TBD"/"TODO"/"fill in details" anywhere in the plan. The toast table in §Toast copy is fully locked (14 engine lines × 2 verdicts + 11 fallback kinds × 2 verdicts).
- Task 9 ships the per-row `<RileyApprovalRow>` wrapper from the start — the page test asserts the multi-card binding (`rec-2 primary` calls `rec-2`'s hook, not `rec-1`'s) before the implementation lands. No "lift later" caveat.

**3. Type consistency.**

- `RecommendationPresentation` is added in Task 1 (schemas) and consumed by Task 2 (engine) — the field names `acceptToast` / `declineToast` match.
- `ApprovalAccent` interface is defined in Task 5 and consumed by Task 9 (`RILEY_APPROVAL_ACCENT` in the Riley page).
- `RileyToastVerdict` is exported from `riley-toast.ts` in Task 8 but only used internally by the page in Task 9; no exported-but-unused concerns.
- `RileyApprovalView` is already declared in `types.ts` (B.1); the `acceptToast` / `declineToast` fields on `ApprovalViewBase` (lines 52–53 of `types.ts`) are pre-existing and consumed by Task 8.

**4. Scope check.** Plan delivers one focused slice: schema → engine → cockpit voice + accent. No KPI/ROI work, no palette interactive behavior, no Wave B doctrine, no Alex render diff. Ship size: ~14 tasks across 11 modified files and 2 new files; modest.

No issues found.

---

## What comes after B.3 merge

- **B.3-followup** (post-Alex-A.5): wire `RILEY_COMMANDS` into the shared `<CommandPalette>`; flip `Topbar.paletteEnabled` on `/riley`; hook composer NL parser to `Allowed-in-B.3` command semantics. Plan written when A.5 lands.
- **B.2b** (after Alex A.3): KPI strip + ROI bar + AgentRoster migration + `/metrics` extension. Riley accent on the ROI bar lands there, not in B.3.
- **Wave B**: doctrine workstream (WorkTrace mirror, PlatformIngress route, outcome attribution, learning memory) tracked in the parity spec. The `acceptToast` / `declineToast` schema extension shipped in B.3 is forward-compatible — toast copy travels with the `Recommendation` row regardless of which substrate the cockpit reads from.
