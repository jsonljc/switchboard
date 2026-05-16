# Phase E1 closeout polish — design

**Status:** spec
**Date:** 2026-05-11
**Owner:** marketing surface
**Roadmap ref:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` §Phase E (line 148)

## Goal

Close out Phase E1 (public marketing-site three-wedge redesign) with two targeted copy edits and a roadmap update. After this lands, mark Phase E1 complete.

## Context

Phase E1 was originally framed in the roadmap as _"Public marketing site three-wedge redesign (Alex + Riley + Mira instead of Alex-only)"_. By 2026-05-11 the literal three-wedge structure already shipped:

- The v6 home renders `V6BeatAlex` + `V6BeatRiley` + `V6BeatMira` with a synergy section, agent toggle, hero crossfade, and pricing.
- PR #426 (E1a) renamed Nova → Riley across the marketing surface.
- PR #430 (marketing truth-up) removed `/agents`, `/pricing`, `/signup`, `/get-started`, `/how-it-works`, fixed broken footer links, and added drift guards.

A doubly-sure editorial review of the live home page identified exactly two remaining issues that genuinely need fixing. Items considered and rejected:

- Forcing cross-agent references inside each beat artifact — would clutter artifacts whose job is showcasing one agent. Synergy section is already concrete.
- Per-agent voice differentiation on the marketing site — voice profiles target the in-product prose generator (greetings/wins narrated _by_ the agent), not marketing narrated _about_ them.
- Three identical "Start with X" CTAs — reinforces "hire one" framing from the hero. Consistency is intentional.
- Narrative arc — already correctly ordered (hero → synergy → three beats → pricing).

## Non-goals

- Phase E2 (onboarding reframe) — remains a separate track.
- Structural rebuild of the home or any beat.
- New components, new routes, or new data.
- Test additions (these are copy edits in components with no existing snapshot tests).

## Changes

### 1. Riley body bullets — replace verb-led list with outcome bullets

**File:** `apps/dashboard/src/components/landing/v6/beat-riley.tsx`
**Target:** the `BULLETS` constant (~line 72) and its render in the `<ul>` further down (~line 356).

**Current:** six entries, verb-led, rendered as `[head, tail]` tuples with a bolded leading word.

```ts
const BULLETS = [
  ["Plans", " campaigns from a brief — objective, audience, budget, structure"],
  ["Reads", " spend, CPL, CPA, ROAS by ad set"],
  ["Finds", " budget leaks before they become habits"],
  ["Drafts", " pauses, reallocations, audience swaps, and launch plans"],
  ["Compares", " what changed against what happened"],
  ["Reports", " the next move in plain English"],
];
```

**Replace with:** four outcome bullets, plain strings, no bolded leading word — matching Alex's bullet pattern exactly.

```ts
const BULLETS = [
  "Builds the plan, ships the ad sets",
  "Watches spend before it leaks",
  "Drafts the next move for approval",
  "Reports in plain English",
];
```

The render block changes from `BULLETS.map(([head, tail]) => …)` to `BULLETS.map((b) => …)`, returning the same `<li>` structure used by Alex (`apps/dashboard/src/components/landing/v6/beat-alex.tsx`) lines 86–98. After this edit Riley matches Alex's pattern exactly; Mira keeps its existing `[a, b]` tuple pattern (one bullet still leads with a bolded _"Hook generation"_), which is intentional and not in scope here.

**Why this is the only Riley change:** the dashboard artifact, headline, body paragraph, "Start with Riley" CTA, and section labels all read correctly. The bullets were the only Riley element out of step with Alex/Mira.

### 2. Synergy headline — replace cliche with mechanism

**File:** `apps/dashboard/src/components/landing/v6/synergy.tsx`
**Target:** the `<Reveal as="h2">` block (~line 43–53).

**Current:**

```tsx
They&rsquo;re better{" "}
<em className="v6-synergy-accent relative inline-block font-semibold not-italic text-v6-coral">
  together
</em>
.
```

**Replace with:**

```tsx
One desk, three voices,{" "}
<em className="v6-synergy-accent relative inline-block font-semibold not-italic text-v6-coral">
  one signal
</em>
.
```

The coral accent moves from `together` to `one signal`. Preserving the accent keeps visual warmth in the synergy section consistent with the rest of the page. The new line names the mechanism (shared signal) that the flow list immediately below (Alex tells Riley → Riley tells Mira → Mira tells Alex) demonstrates, replacing the cliche-adjacent "better together" framing.

The `v6-synergy-accent` CSS class continues to apply — no stylesheet edits required.

### 3. Roadmap — mark Phase E1 complete

**File:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md`
**Target:** Phase E section, line 148.

**Current:**

```
- **E1.** Public marketing site three-wedge redesign (Alex + Riley + Mira instead of Alex-only)
```

**Replace with:**

```
- **E1.** ✅ Public marketing site three-wedge redesign — shipped via PR #426 (Nova→Riley), PR #430 (marketing truth-up), and a final copy polish PR (this work).
```

Phase E2 (onboarding reframe) line remains unchanged.

## Validation

- Run `pnpm --filter @switchboard/dashboard dev` and visit `http://localhost:3002/`.
- Scroll past the synergy section: headline reads _One desk, three voices, one signal._ with coral accent on `one signal`.
- Scroll to the Riley beat: bullet list shows four outcome bullets, visually flush with Alex's and Mira's bullet groupings.
- Confirm responsive layout at `< 900px` (the `max-[900px]` breakpoints in each component) renders unchanged.
- `pnpm --filter @switchboard/dashboard build` succeeds locally — required because `next build` is not in CI (memory: `feedback_dashboard_build_not_in_ci.md`).
- `pnpm lint` and `pnpm typecheck` pass.

## PR shape

Single PR, single commit, three files touched.

```
apps/dashboard/src/components/landing/v6/beat-riley.tsx     | ~10 lines
apps/dashboard/src/components/landing/v6/synergy.tsx        | ~3 lines
docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md | 1 line
```

Conventional-commit title: `chore(dashboard): close phase E1 — riley bullets + synergy headline polish`.

## Risks

- **Headline taste call.** The new synergy headline is a subjective judgement. If it doesn't land in preview, reverting to the current line is one diff revert. No downstream code depends on the wording.
- **Bullet trim from 6 → 4.** Drops two pieces of capability information ("Compares what changed against what happened" and one of plan/read). Mitigated by: the dashboard artifact and Riley's draft note already substantiate both points visually; the body paragraph still says Riley _"plans campaigns, reads performance, spots budget leaks, prepares changes."_

## Out of scope (deferred)

- Phase E2 (onboarding reframe).
- Any structural change to the home page.
- Adding cross-agent references inside beat artifacts.
- Per-agent voice differentiation on the marketing surface.
