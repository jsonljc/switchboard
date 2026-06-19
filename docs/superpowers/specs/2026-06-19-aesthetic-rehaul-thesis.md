# Aesthetic Rehaul Thesis: "The Operator's Statement"

Date: 2026-06-19
Status: active
Scope: apps/dashboard (authed app). Public marketing (`/welcome`, `/privacy`, `/terms`) is a separate register and out of scope except where it leaks into the app.

## North star

Commit fully to ONE warm-editorial register and let `/reports` be the literal style guide for the entire app, not an outlier. The product should read like a confident, hand-set editorial broadsheet printed on warm riso paper: Source Serif display with a mono eyebrow on every page header, Geist body, a single editorial type scale, one signature card (crisp corners and a hairline ring on warm paper), amber as the ONLY action color with agent hues reserved strictly for identity, and flatness as the calm default with elevation spent rarely on the one decisional moment that matters.

This beats generic-AI-dashboard defaults through restraint plus a distinctive paper-and-ink voice that signals "a real team thought about your day" — precisely the trust a revenue/governance pilot is buying.

Direction derived by audit (the user delegated: "let the audit decide"). It elevates the system that already exists; it is not a rebrand.

## Canonical register decisions

- Canvas: warm cream + riso paper grain (light only; dark stays hidden until Wave 3).
- Type: Source Serif display (`--serif`, the face `/reports` and the shared `PageTitle` use) + JetBrains mono eyebrow on every authed page header; Geist body (`--font-body-app`). Fraunces (`--font-display-app`) is wired but is not the canonical reports voice; reconcile to a single display face in the type-scale work. ONE editorial type scale exposed via `tailwind.config.ts` `fontSize` (currently undefined) replacing 280+ ad-hoc `text-[NNpx]` brackets.
- Color: amber (`--action`) is the ONLY action color. Agent hues (coral=Alex, teal=Riley, violet=Mira) are identity-only, never on action buttons. Resolve the two near-identical warm oranges (action amber vs editorial accent) so the action signal is unambiguous.
- Surface: ONE signature card primitive (warm surface + hairline ring, flat by default). The shared `Card` now uses a crisp 6px (`rounded-sm`) radius for content cards; `/reports` keeps its sharper 2px for bespoke editorial cards. Migrate the four uncoordinated card radii (2/6/8/16px) toward one scale.
- Accessibility: all text meets WCAG AA on cream. Fix `--ink-3` (~4.11:1) and `--sw-text-muted` (~2.85:1). Keyboard focus is never stripped without replacement.

## Audit ledger (59 findings: 4 blocker / 22 high / 26 medium / 7 low)

Captured from a 6-dimension screenshot+code audit (full findings in the run output). Master defect: register fracture (4-5 coexisting token/font namespaces) means the shared primitives speak the wrong legacy dialect, so "premium" requires bypassing the primitive, which spawned ~3.4k lines of duplicated module CSS.

Blockers:

- B1 (global): shared UI primitives (Button/Card/Badge/Input/Tabs/Select/Dialog/Sheet/Skeleton) wired only to legacy shadcn tokens, not the editorial register.
- B2/B4 (global): hero number renders `$$14,720` (hand-built `.sgd` superscript in attribution.tsx / cost-vs-value.tsx, not `fmtSGD`). Money formatting is fragmented (`$` vs `S$`, double-applied symbols).
- B3 (local): `/mira` renders a generic 404 while sitting in nav as a hero agent (Alex/Riley were retired gracefully via 307 to Home `?agent=`).

Dominant themes: voice inconsistency vs the reports high-water mark (most-agreed finding); the empty/error/loading path is the LEAST polished yet is exactly what the API-quiet pilot demo hits first; reports/results are near-duplicates; dev/build artifacts leak onto customer screens.

## Plan

Pass 1 — foundation (compounds across all surfaces, one reviewable PR):

1. Editorial type scale tokens in `tailwind.config.ts` `fontSize` (additive).
2. Re-point shared primitives at the editorial register: add an amber `action` Button variant; ship the signature Card; align Badge/Input/Skeleton.
3. Shared `PageTitle` (mono eyebrow + Fraunces serif) applied to every authed header (settings/operator/results/home), killing the sans-vs-serif voice break.
4. Shared `StatePanel` (icon + explanation + action, `role=alert`, action-colored retry, never a raw status code) + token-correct Skeleton in `query-states`.
5. Single locale-aware Money formatter used everywhere; fix the `$$` hero bug; render test pinning the hero to `S$14,720`.
6. Fix `/mira` (redirect like alex/riley); strip dev artifacts (Turbopack bar, DEV pill) from customer screens; AA contrast fixes.

Pass 2 — raise hero surfaces beyond reports:

- Home: Stripe-style hero KPI strip (week's attributed dollars + bookings + awaiting-approval, with deltas/sparklines) so the #1 surface proves value in 5 seconds.
- Operator: canonical evidence-first review-item anatomy (proposed action + evidence-above-recommendation + dollar-at-stake + signal chips + reason-on-override).
- Resolve reports vs results into one canonical statement + an at-a-glance KPI twin in the same voice.
- Intentional, branded empty/error states on every live surface.

## Guardrails + verification

- Never break wiring, routes, tests, or governance/trust semantics. Boldness serves clarity + trust.
- Verify every changed surface with before/after screenshots (headless-Chrome harness, 32 baselines in `/tmp/sw-shots`) plus `pnpm typecheck`, dashboard `vitest`, `pnpm format:check`, and a real `next build`. Dashboard coverage floor is 40/35/40/40.
- Stage only rehaul files; the working tree's untracked `.claude/` + `docs/` notes are not mine to commit. Reviewable, focused commits. Conventional Commits, lowercase subject. No em-dashes.
