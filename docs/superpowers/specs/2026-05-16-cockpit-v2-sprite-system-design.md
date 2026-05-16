# Cockpit v2 Sprite System — Design Spec

**Date:** 2026-05-16
**Owner:** TBD (next implementation session)
**Baseline:** `origin/main` (HEAD `96a3ca77`; carries PR #599, PR #600, PR #603)
**Audit reference:** `docs/superpowers/audits/2026-05-16-cockpit-v2-audit.md`
**Status:** approved for implementation pending the next plan-writing pass

---

## 1. Goal

Close the remaining visible-design gap between the agent-home-v3 design package (`docs/design-prompts/locked/switchboard/project/agent-home-v3/`) and the cockpit implementation on main. PR #603 already shipped 9 alignment items from that package. The dominant unshipped item is the **pixel-sprite avatar system** — every place the cockpit currently renders a letter monogram (`A`, `R`) the design renders an animated 24×24 pixel-art sprite with per-state animation (`idle / draft / sleep / won`). Three Group B polish items ride along because they are XS pure-add and design-aligned: `ApprovalCard.tertiaryLabel` button, `ApprovalCard.campaign` line, and the Riley page passing `today` to `ActivityStream`.

Result: `/alex` and `/riley` ship a distinctive pixel-art avatar without changing runtime behavior, plus three tightening fixes. Frontend-only.

## 2. Scope — In

- **Sprite system foundation:** port `sprite.jsx` building blocks and the full Alex + Riley variant data into a new `apps/dashboard/src/components/cockpit/sprite/` module.
- **Sprite consumers:** replace the letter-monogram renders in `identity.tsx` (48–64px frame), `empty-state.tsx` (48px frame), and `approval-card.tsx` (22px inline chip) with sprite components. Wire the existing `animState(statusKey, halted)` selectors from `alex-config.ts` / `riley-config.ts`.
- **`ApprovalCard.tertiaryLabel` button** — the `tertiaryLabel?: string` slot already exists on `ApprovalViewBase` (`types.ts:46`); no UI consumes it. Add a transparent tertiary button alongside primary/decline when the prop is set.
- **`ApprovalCard.campaign` rendering** — `RileyApprovalView.campaign?: string` already exists (`types.ts:73-77`); no UI consumes it. Add a mono-font campaign-name line under the title when the prop is set. Riley benefits immediately; Alex's adapter doesn't emit `campaign` today, so Alex render is unchanged.
- **Riley `today` prop** — `riley-cockpit-page.tsx` does not pass `today` to `<ActivityStream>`. Add `today={formatToday(now)}` to match Alex (eyebrow reads "Today · Mon May 12" instead of legacy "Activity").

## 3. Scope — Out (explicit)

Each of these is deferred. The plan must not silently expand into them.

- **Critical #3 — approval-kind classifier producer wire.** Architecturally unresolved per project memory `[[alex-cockpit-a7-shipped]]` (4 prior PRs failed). Needs a separate brainstorm.
- **OAuth → Connection dual-write.** OAuth callbacks write `DeploymentConnection`; cockpit reads `Connection`. Tracked as runbook follow-up.
- **Env-flag flips** (`NEXT_PUBLIC_APPROVALS_LIVE`, `RILEY_OUTCOME_ATTRIBUTION_ENABLED`). Operational.
- **`metaDone` strict-semantic alignment.** Runbook follow-up #2.
- **`SERVICE_IDS` constants module.** Tracked.
- **Riley `body` slot, Alex accent backport.** YAGNI per runbook follow-ups.
- **Cockpit-inline `<Toast>` component.** Switching from the global Radix toaster regresses the locked single-owner-toast doctrine (`[[project_alex_cockpit_a5_shipped]]`).
- **Client-side `approvalResolved` Set.** Current `AlexApprovalRow` + `useRecommendationAction` optimistic-dismiss architecture is the locked pattern.
- **Day-1 narrator "book tours" copy.** Adopting design copy verbatim violates the medspa vertical lock (`[[project_alex_vertical_medspa]]`).
- **Sprite variant runtime picker / Settings UI.** Variants are hardcoded per agent (see §6.1); a Settings affordance is post-launch.
- **`compact` mode propagation** beyond what already exists. The dashboard has no `mode='mobile'` responsive layer; design's `compact` is canvas-prop only.
- **`liveCount` inline counter** next to status pill, **per-agent `ActivityFilter` set widening**, and **Riley EmptyState parity** — deferred by user scope decision.
- **`won` sprite state trigger.** State data ships (see §5) but no producer event fires it. Test only as data validity.

## 4. Architecture

Frontend-only. Zero backend changes. Zero Prisma changes. Zero env-var changes. Zero new dependencies.

```
apps/dashboard/src/components/cockpit/sprite/                (new)
├── types.ts                           — SpriteVariant, SpriteState, Frame, Palette, VariantBundle
├── build-sprite.ts                    — buildSprite + mergeSprite (port of sprite.jsx:14-93)
├── pixel-sprite.tsx                   — PixelSprite SVG renderer (port of sprite.jsx:96-132)
├── use-frame-cycle.ts                 — frame-swap hook (port of sprite.jsx:136-145)
├── animated-sprite.tsx                — AnimatedSprite wrapper (port of sprite.jsx:147-153)
├── sprite-frame.tsx                   — NEW: rounded 48–64px frame wrapper with letter fallback
├── sprite-chip.tsx                    — NEW: 22px inline chip wrapper with letter fallback
├── alex-variants.ts                   — port of sprites.jsx (4 variants × 4 states)
├── riley-variants.ts                  — port of riley-sprites.jsx (3 variants × 4 states)
└── __tests__/
    ├── build-sprite.test.ts
    ├── pixel-sprite.test.tsx
    ├── use-frame-cycle.test.ts
    ├── sprite-frame.test.tsx
    └── sprite-chip.test.tsx
```

**Modified files (no new):**

- `apps/dashboard/src/components/cockpit/identity.tsx` — `AvatarFrame` body swapped to `<SpriteFrame>`.
- `apps/dashboard/src/components/cockpit/approval-card.tsx` — 22px letter chip swapped to `<SpriteChip>`; render `tertiaryLabel` button when set; render `campaign` line when set.
- `apps/dashboard/src/components/cockpit/empty-state.tsx` — 48px "A" letter swapped to `<SpriteFrame>`.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — pass `today={formatToday(now)}` to `<ActivityStream>`.
- Existing test files for those components extended with sprite + new-prop cases.

**Unchanged:** all API routes, all hooks, all adapters, all dispatchers, Topbar, Composer, KPIStrip, ROI bar, mission popover, command palette, status pill. The cockpit's behavioral surface is identical to main; only the avatar render path and three small UI affordances change.

## 5. The Sprite Foundation

### 5.1 Frame data model

A "frame" is a 24-row × 24-column grid of single-character palette keys (e.g., `K`, `H`, `S`, `M`, `G`, `R`, `Y`, `O`). Each variant ships a `Palette` mapping `{ K: "#1a1108", H: "#5a3418", ... }` and a `states: { idle: Frame[], draft: Frame[], sleep: Frame[], won: Frame[] }` map. Most states animate via 2-frame loops (mid-cycle blink, mouth move). The `sprite.jsx` builders (`buildSprite`, `mergeSprite`) authored the grids imperatively in the design; we copy the resulting grids verbatim into TS modules — no on-the-fly building at runtime.

**Why ship `buildSprite` / `mergeSprite` at all if frames are pre-built?** Test-only and future-author-only. The frames in `alex-variants.ts` / `riley-variants.ts` are static literals copied from the design package. `buildSprite` / `mergeSprite` exist for unit tests to assert grid construction is correct (so frame regressions are catchable by inspection if a future variant is added). They are NOT called from product code at runtime.

### 5.2 Palette key conventions

Single uppercase letter or `.` (transparent). Keys are arbitrary; each variant's palette defines its own mapping. The renderer treats unknown keys as transparent.

### 5.3 `useFrameCycle({ frames, dur, playing })` semantics (tightened)

- `frames.length === 0` → render nothing (`<></>`). No timer. (This deviates from the design where this case is undefined; we make it explicit.)
- `frames.length === 1` → render `frames[0]` statically. No timer.
- `frames.length >= 2` → cycle through frames every `dur` ms (default 600). Timer cleared on unmount.
- `playing === false` → render `frames[0]` statically regardless of frame count. No timer.

Tested explicitly: empty-array, single-frame, 2-frame animation, paused 2-frame, unmount-while-cycling.

### 5.4 `won` state data ships dormant

Every variant's `won` state has frames defined (grin + sparkle stars per `sprites.jsx:447-450`). `animState(statusKey, halted)` in `alex-config.ts` and `riley-config.ts` **does not return `"won"` today and will not in v2** — no producer event defines the trigger. The frames ship so a future trigger (post-launch: "first booked row in last 6s") becomes a 1-line `animState` patch, but v2 wires no trigger. Tests assert `won` frames are present and palette-valid; no runtime assertion that they render.

## 6. Components

### 6.1 `<SpriteFrame variant state size />` (replaces `AvatarFrame` in Identity, EmptyState)

Props:

```ts
type SpriteFrameProps = {
  variant: SpriteVariant; // "classic" | "operator" | "cozy" | "agent" | "analyst" | "terminal"
  state: SpriteState; // "idle" | "draft" | "sleep" | "won"
  size: number; // 48 or 64 by current call sites
  accentSoft: string; // background color (e.g., T.amberSoft for Alex)
  fallbackLetter: string; // "A" or "R" for the letter-monogram fallback path
};
```

Behavior:

- Looks up `bundles[variant]?.states[state]` from the agent's `VariantBundle` (Alex or Riley).
- If frames exist → render `<AnimatedSprite frames={...} palette={...} size={size - 6} />` inside a rounded frame.
- If lookup fails (typo'd variant, missing state) → render the existing letter-monogram path (current `AvatarFrame` body) using `fallbackLetter`. **No console.error, no throw.** Tests assert this path.

Frame style copied from `cockpit.jsx:112-120`: `borderRadius: round(size * 0.18)`, background `accentSoft`, `border: 1px solid T.hair`, subtle inset shadow, `overflow: hidden`.

### 6.2 `<SpriteChip variant state />` (replaces 22px letter chip in ApprovalCard)

Props:

```ts
type SpriteChipProps = {
  variant: SpriteVariant;
  state: SpriteState; // "draft" for approval cards (always)
  size?: number; // default 22
  accentSoft: string; // background color
  fallbackLetter: string;
};
```

Behavior: same as `SpriteFrame` but smaller frame (4px corner radius, no inset shadow), inline alignment (`display: inline-grid`, `verticalAlign: middle`).

### 6.3 Sprite variant defaults — INTENTIONAL hardcoding (locked decision)

Variants are NOT a runtime preference, NOT a Settings affordance, NOT a URL param. They are hardcoded per agent:

- **Alex defaults to `"classic"`** — the sales-pro-with-headset variant from `sprites.jsx`. Matches Alex's SDR role.
- **Riley defaults to `"analyst"`** — the data-analyst variant from `riley-sprites.jsx`. Matches Riley's ad-optimizer role.

Source of truth: a new `DEFAULT_ALEX_VARIANT: SpriteVariant = "classic"` constant in `alex-config.ts` (and matching `DEFAULT_RILEY_VARIANT` in `riley-config.ts`). Pages pass it down via `variant={DEFAULT_ALEX_VARIANT}`.

**This is deliberate, not a missing feature.** Operators do not pick their avatar variant in v2. A future Settings affordance (per-operator preference) is a post-launch decision contingent on operator demand. The spec calls this out explicitly so a future reader does not mistake the hardcode for an incomplete plumbing.

### 6.4 `<ApprovalCard tertiaryLabel onTertiary campaign />` additions

`ApprovalViewBase.tertiaryLabel?: string` and `RileyApprovalView.campaign?: string` already exist in `types.ts`. ApprovalCard currently ignores both. v2 wires them:

- `tertiaryLabel` button — when set, renders alongside `primary` and `secondary` (decline). Click handler is a new optional `onTertiary?: () => void` prop. Style: transparent button matching the `btnGhost` style at `cockpit.jsx:181-185`.
- `campaign` — when set, renders a small mono-font line `· {campaign}` directly under the card title (per `cockpit.jsx:558-567`). No-op when absent (Alex's adapter doesn't emit `campaign` today; Alex render is unchanged).

### 6.5 Identity wiring

`identity.tsx` already receives `data.statusKey` and `halted`. Compute `state = animState(data.statusKey, halted)` (the function already lives in `alex-config.ts:35` / `riley-config.ts`) and pass it to `<SpriteFrame state={state} variant={defaultVariant} size={compact ? 52 : 64} ... />`.

### 6.6 EmptyState wiring

`empty-state.tsx` always renders calm cold state. Pass `state="idle"` constant to `<SpriteFrame>`. Variant from default constant.

### 6.7 ApprovalCard chip wiring

Approval cards always represent active operator interaction. Pass `state="draft"` constant to `<SpriteChip>`. Variant from default constant.

## 7. Data flow

```
DEFAULT_ALEX_VARIANT (alex-config.ts)
     ↓
cockpit-page.tsx — passes variant={DEFAULT_ALEX_VARIANT} to:
     ├── <Identity variant={...} animState={animState(statusKey, halted)} />
     ├── <ApprovalCard variant={...} state="draft" />  (per row)
     └── <EmptyState variant={...} state="idle" />

DEFAULT_RILEY_VARIANT (riley-config.ts)
     ↓
riley-cockpit-page.tsx — passes variant={DEFAULT_RILEY_VARIANT} to:
     ├── <Identity variant={...} animState={animState(statusKey, halted)} />
     └── <ApprovalCard variant={...} state="draft" />  (per row; Riley uses RileyApprovalRow)

Note: Riley has no EmptyState (uses fake-activity-row cold state instead, per scope decision).
```

No session state, no localStorage, no env var, no API call. Variant resolution is pure module constants. Animation state is a pure function of `(statusKey, halted)` already computed.

## 8. Error handling

Sprite stack is best-effort. Failures fall back; nothing throws to the UI.

- `SpriteFrame` / `SpriteChip` — variant lookup miss → letter-monogram fallback (existing render path).
- `useFrameCycle` — empty frames → render nothing; single frame → static; multi-frame → cycle.
- `buildSprite` / `mergeSprite` — invalid command throws (dev-time only; never called from product code paths).
- `PixelSprite` — unknown palette keys render as transparent (no error).

Logging: no warns, no errors. Sprite degradation is silent because the fallback is functional and the only failure modes are typos in static module data (caught in tests).

## 9. Testing strategy

Coverage target for new module: **70%+ branches** (above dashboard threshold of 35% per `feedback_dashboard_coverage_threshold` memory). Test files co-located under `__tests__/`.

| Test file                                                | Covers                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `sprite/__tests__/build-sprite.test.ts`                  | `buildSprite` + `mergeSprite` happy paths + invalid command throws; snapshot one frame per variant (Alex×4 + Riley×3 = 7 snapshots)        |
| `sprite/__tests__/pixel-sprite.test.tsx`                 | Rect count for a tiny 4×4 frame; fill colors match palette; unknown key → transparent                                                      |
| `sprite/__tests__/use-frame-cycle.test.ts`               | Empty-array case; single-frame case; 2-frame fake-timer cycle; `playing=false` static; unmount clears timer                                |
| `sprite/__tests__/sprite-frame.test.tsx`                 | Renders sprite when variant + state valid; renders letter fallback when variant missing; renders letter fallback when state frames missing |
| `sprite/__tests__/sprite-chip.test.tsx`                  | Same as SpriteFrame, smaller size                                                                                                          |
| `cockpit/__tests__/identity.test.tsx` (extend)           | Sprite-render case for Alex (classic, idle) + Riley (analyst, idle) + fallback case (bad variant prop)                                     |
| `cockpit/__tests__/approval-card.test.tsx` (extend)      | `tertiaryLabel` rendered + onTertiary click fires; `campaign` line rendered when present; sprite chip rendered                             |
| `cockpit/__tests__/empty-state.test.tsx` (extend)        | Sprite-render case + fallback case                                                                                                         |
| `cockpit/__tests__/riley-cockpit-page.test.tsx` (extend) | Assert `<ActivityStream>` receives `today` prop                                                                                            |
| `sprite/__tests__/won-state-data.test.ts` (new)          | `won` state is present on every variant; palette keys resolve; frame grid is well-formed. No runtime trigger assertion.                    |

The `won-state-data` test is the only test that touches won-state. There is intentionally no test that exercises a `won` render in product code, because no product code path emits `"won"` in v2.

## 10. Commit sequence (revised per user feedback)

Six commits in one PR. The reorder (per user feedback) groups foundation + variant data into commit #1 — they are both pre-component-logic and ship together so the consumer-facing SpriteFrame/SpriteChip in commit #2 sees a complete foundation. Frame data stays out of component-logic commits so reviewer snapshot noise is isolated to commit #1.

1. **`feat(cockpit): add sprite foundation — types, builders, renderer, frame cycle, variants, animated sprite`** — types + buildSprite/mergeSprite + PixelSprite + useFrameCycle + AnimatedSprite + Alex/Riley variant data files. Tests cover builders + renderer + cycle hook + per-variant frame snapshots. ~1200 LOC, ~85% pure data; reviewers can collapse `alex-variants.ts` / `riley-variants.ts` to skim.
2. **`feat(cockpit): add SpriteFrame + SpriteChip with letter fallback`** — consumer-facing API. Tests cover happy path + both fallback branches (missing variant, missing state). No product consumers yet. ~120 LOC + tests.
3. **`feat(cockpit): wire sprite avatar to Identity row for /alex + /riley`** — first user-visible commit. Identity now consumes `<SpriteFrame>` with hardcoded default variant + derived `animState`. ~30 LOC + extended test.
4. **`feat(cockpit): wire sprite to EmptyState narrator (Alex day-1 cold state)`** — second consumer; Riley has no EmptyState by scope decision. ~20 LOC + extended test.
5. **`feat(cockpit): wire sprite chip + tertiaryLabel + campaign field to ApprovalCard`** — third consumer + two pure-add ApprovalCard props in one commit (all touch the same file). ~50 LOC + extended test.
6. **`feat(cockpit): pass today eyebrow to Riley ActivityStream`** — Riley alignment polish. ~5 LOC + extended test.

Total: ~1500 LOC, ~80% data. Each commit independently revertible. Each commit's tests pass on its own.

## 11. PR strategy

Two PRs to `main`, in order:

1. **Docs-only PR** — `docs(audit, spec): cockpit v2 audit + sprite-system design`. Lands `docs/superpowers/audits/2026-05-16-cockpit-v2-audit.md` + `docs/superpowers/specs/2026-05-16-cockpit-v2-sprite-system-design.md` on main. Per CLAUDE.md branch doctrine "Specs and plans land on main via focused PRs." Unblocks the implementation worktree to consume specs that already exist on main.

2. **Implementation PR** — `feat(cockpit): v2 sprite system + ApprovalCard tertiary/campaign + Riley today eyebrow`. Branched off latest origin/main. Contains the 7 commits from §10. Description references both docs from PR #1.

Implementation worktree per `superpowers:using-git-worktrees`: `git worktree add .claude/worktrees/cockpit-v2-sprite -b feat/cockpit-v2-sprite-system origin/main`, then `pnpm worktree:init` per CLAUDE.md branch doctrine.

## 12. Verification gates (Done criteria)

Before requesting code review on the implementation PR:

- [ ] `pnpm --filter @switchboard/dashboard test` green (new + extended tests pass; coverage ≥ 40/35/40/40 dashboard threshold, sprite module 70%+ on its own).
- [ ] `pnpm --filter @switchboard/api test` green (no API changes; sanity gate).
- [ ] `pnpm --filter @switchboard/dashboard build` green (CI does not run this; local check is mandatory per `feedback_dashboard_build_not_in_ci`).
- [ ] `pnpm typecheck` and `pnpm lint` green.
- [ ] `pnpm format:check` green (CI runs prettier per `feedback_ci_prettier_not_in_local_lint`).
- [ ] Manual smoke on `http://localhost:3002/alex` and `/riley` after `pnpm dev`:
  - Identity row renders pixel sprite (Alex classic, Riley analyst), animates state changes when status changes (e.g., trigger halt → sprite sleeps).
  - EmptyState renders pixel sprite for /alex day-1 cold state.
  - ApprovalCard renders pixel chip in 22px slot (when approvals present).
  - ApprovalCard renders `tertiaryLabel` button + `campaign` line when a row has those fields.
  - Riley `/riley` activity feed shows "Today · <date>" eyebrow not "Activity".
- [ ] PR description references this spec + the audit doc.

## 13. Risks + mitigations

- **Snapshot noise from frame data.** Mitigated by keeping frame data inside the foundation commit (#1) and outside every consumer-logic commit — reviewers can collapse `alex-variants.ts` / `riley-variants.ts` when scanning commit #1.
- **Sprite render perf.** SVG `<rect>` element count per frame is ~200–300 visible pixels, animated at 600ms. Negligible on modern browsers but the v2 plan should call this out. If perf regresses (>16ms paint), fall back to single `idle` frame (no cycling) — a 1-line `playing=false` flip. Not expected.
- **Variant typo regression.** Letter-monogram fallback covers this. A future contributor adding a fifth Alex variant with a typo would see the letter render, not a crash.
- **Sprite a11y.** Sprites are decorative. Aria-hide the SVG (`aria-hidden="true"`) and keep the existing letter monogram (or agent name) as the accessible label on the parent container. Tested in component tests.
- **Frame data drift from design.** The frames are copied verbatim from `sprites.jsx` / `riley-sprites.jsx`. If the design ever updates, we re-copy. No automated sync.

## 14. Open items (none for v2 — for future post-launch reference)

These are intentionally not included in v2 and not part of any pre-implementation question. Listed only for future-reader context:

- Per-operator variant preference in Settings.
- Backend-driven sprite variant (different variants per org).
- `won` state trigger (e.g., recent-booked-row detection).
- `compact` mode for a future mobile responsive layer.
- `liveCount` next to status pill.
- Per-agent activity filter set (Riley wants `["all", "approvals", "changes"]`).
- Riley EmptyState parity (Riley currently uses fake-activity-row cold state).
- Sprite cross-fade transitions between state changes (currently a hard swap).

---

**End of spec.** Implementation plan (file-by-file TDD steps) lives in a separate doc per the writing-plans skill: `docs/superpowers/plans/2026-05-16-cockpit-v2-sprite-system-plan.md` (to be written next session).
