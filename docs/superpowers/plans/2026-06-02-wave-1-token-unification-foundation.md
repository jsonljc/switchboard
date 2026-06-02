# Wave 1 — Token Unification & Foundational Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (chosen — inline, because the token slices are tightly coupled and need live screenshot + drift-guard verification per slice). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Collapse four disagreeing token systems onto one `--palette-*` primitive tier consumed through stable semantic names, enforced by a CI drift-guard + contrast gate; then land the structural type/elevation/spacing/query-state/voice foundations.

**Architecture:** Primitive-under-semantic indirection (spec §2): add `--palette-*` primitives in `globals.css`; repoint semantic tokens (`--action`, `--agent-*`, …) to `var(--palette-*)`; the other three systems (cockpit `T`, inbox scoped hex, Mercury) consume `hsl(var(--semantic))`. Consumers (`hsl(var(--action))`) are untouched. `.dark` later overrides *primitives* so all semantics follow (Wave 3 — not now).

**Tech Stack:** Next 14, CSS custom properties, Tailwind, Vitest, playwright-core + system Chrome for live screenshots.

**Spec:** `docs/superpowers/specs/2026-06-02-wave-1-token-unification-foundation-design.md` (governance contract in §3).

---

## Pre-flight (once, before Task T1)

- [ ] **Base decision:** Build off `origin/main` (Wave 0 #814–#827 all OPEN). T1's amber consolidation includes the `30 58% 41%` AA value — it *overlaps #824*'s globals.css hunk. Document in the PR; operator resolves merge order at review (spec §8). Do NOT merge Wave 0 autonomously.
- [ ] **Env:** From the worktree root run `pnpm worktree:init`. Handle the known gotcha (`feedback_worktree_env_sync_corruption`): after it runs, check `apps/dashboard/.env.local` — fix any concatenated `DATABASE_URL` line and uncomment `DEV_BYPASS_AUTH=true`. If Postgres is down, run `pnpm install` + hand-verify; screenshots need the dev server, tests do not.
- [ ] **Verification harness:** dev server detached via `child_process.spawn(..., {detached:true}).unref()` (tracked/nohup'd ones get reaped — `reference_dashboard_visual_verification`): API `node --env-file=.env --import tsx apps/api/src/server.ts` (:3000) + `pnpm --filter @switchboard/dashboard dev` (:3002). Screenshot via playwright-core + system Chrome.
- [ ] **Branch:** keystone work on `feat/wave-1-token-unification` off `origin/main`. Each slice below = one commit with its governance invariant in the message; the keystone lands as one reviewable PR with granular commits (pragmatic deviation from per-slice-PR: stacked PRs here have documented hazards, and the operator reviews holistically; structural items get their own branch/PR).

---

## Phase A — The token keystone

### Task T1: Primitive + semantic layer + amber 3→1 + guard scaffold

**Invariant:** *All amber action affordances resolve to one primitive; no literal amber lives in the action path.*
**Acceptance (spec §7):** NO Home/Inbox/Results consumer edits — only `globals.css` token definitions + new tests.

**Files:**
- Modify: `apps/dashboard/src/app/globals.css` (`:root` ~12-229, `.dark` ~231+)
- Create: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (the drift guard — grows across T1→TG)
- Create: `apps/dashboard/src/lib/tokens/contrast.ts` + `contrast.test.ts` (WCAG ratio util for the gate)

- [ ] **Step 1 — Write failing drift-guard test (amber path).** In `token-governance.test.ts`: read `globals.css` via `fs.readFileSync`. Assert: (a) `--palette-action:` is defined and equals `30 58% 41%`; (b) `--action:`, `--action-hover:`, `--operator:` each resolve to `var(--palette-action*)` (regex: value matches `var(--palette-`), NOT a raw `\d+ \d+% \d+%` triplet; (c) `--char-accent:` is `hsl(var(--action))`. 
- [ ] **Step 2 — Run, verify FAIL** (`pnpm --filter @switchboard/dashboard test token-governance` → fails: `--palette-action` absent, `--action` still a literal triplet).
- [ ] **Step 3 — Implement in `globals.css`:** add a `/* ─── Tier 1: primitives (single source — edit colors ONLY here) ─── */` block at the top of `:root`:
  - `--palette-action: 30 58% 41%;` (AA amber, ≥4.5:1 white) · `--palette-action-hover: 30 58% 35%;` · `--palette-action-bright: 30 55% 46%;` (`/* fills/stripes only — spec §4.5 */`) · `--palette-action-subtle: 32 45% 94%;` · `--palette-action-tint: 38 52% 90%;`
  - `--palette-coral: 14 70% 58%; --palette-coral-deep: 14 50% 45%; --palette-coral-tint: 24 60% 95%;` (alex) · teal `180 33% 40% / 178 53% 26% / 172 34% 93%` · violet `270 45% 58% / 256 31% 45% / 255 33% 95%`.
  - Repoint semantics (value-only; names unchanged): `--action: var(--palette-action);` `--action-hover: var(--palette-action-hover);` `--operator: var(--palette-action);` `--char-accent: hsl(var(--action));` `--agent-alex: var(--palette-coral);` (+ `-deep`/`-tint`) and same for riley/mira. Add `--action-subtle: var(--palette-action-subtle);` `--action-tint: var(--palette-action-tint);`.
  - In `.dark`: override the primitive so dark follows automatically (parked, toggle stays hidden): `--palette-action: 30 50% 52%;` (mirrors existing `--operator` dark). Leave the rest of dark for Wave 3.
- [ ] **Step 4 — contrast util:** `contrast.ts` exports `contrastRatio(hslTripleFg, hslTripleBg): number` (WCAG relative luminance). `contrast.test.ts`: assert `contrastRatio("0 0% 98%", "30 58% 41%") >= 4.5` and `< 4.5` for the old `30 55% 46%` (locks the AA fix).
- [ ] **Step 5 — extend drift guard with contrast gate:** in `token-governance.test.ts` assert `contrastRatio(actionForeground, paletteAction) >= 4.5` (parse both from globals.css).
- [ ] **Step 6 — Run all → PASS.** `pnpm --filter @switchboard/dashboard test token-governance contrast`.
- [ ] **Step 7 — No-churn check:** `git -C <wt> diff --name-only` shows ONLY `globals.css` + the 3 test files. If any `*.module.css`/`*.tsx` consumer appears, revert it (indirection should make it unnecessary).
- [ ] **Step 8 — Live screenshot diff:** Home verdict button, Inbox approve button, the approval sheet primary action, a cockpit Halt/commit button — confirm the amber shift (brighter→AA) reads correctly, not muddy. Save to `/tmp/sbshot/t1-*.png`.
- [ ] **Step 9 — typecheck + commit.** `pnpm --filter @switchboard/dashboard typecheck`; `git add` the 4 files; commit `feat(dashboard): unify action amber under one --palette-* primitive (T1)`.

### Task TY1: One tabular metric-number face (pulled forward — early visible win)

**Invariant:** *Every metric number uses one tabular face; no glyph-width jitter.*

**Files:**
- Modify: `apps/dashboard/src/app/globals.css` (add `.num` utility / fix `[data-tabular]`)
- Inspect first: `git grep -n "data-tabular\|tabular-nums\|tabular" apps/dashboard/src` to find the no-op + current consumers (Results KPI numbers, Home hero, cockpit kpi-tile).

- [ ] **Step 1 — Write failing test** `token-governance.test.ts` (or a new `type-tokens.test.ts`): assert globals.css defines a rule applying `font-variant-numeric: tabular-nums` to `[data-tabular]` (today it's a no-op — assert presence of the declaration).
- [ ] **Step 2 — Verify FAIL.**
- [ ] **Step 3 — Implement:** add to globals.css `[data-tabular], .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }` and ensure the metric face is the instrument mono (`font-family: var(--mono)`) for the big-number `.num` variant used by Results/Home/cockpit. Verify the existing `data-tabular` consumers now get real tabular figures.
- [ ] **Step 4 — Verify PASS.**
- [ ] **Step 5 — Live screenshot:** Results KPI numbers + Home hero numeral — confirm digits no longer jitter (compare a 111 vs 999 width by eye / overlay).
- [ ] **Step 6 — Commit** `feat(dashboard): one tabular metric-number treatment (TY1)`.

### Task T2: Cockpit `T` → hsl(var()); delete dead cockpit family; configs → vars

**Invariant:** *Cockpit color is themeable — `T` holds zero literals; dead cockpit code is gone.*

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/tokens.ts` (the `T` object)
- Modify: `apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts` (rewrite: assert var() not hex)
- Modify: `apps/dashboard/src/lib/cockpit/alex-config.ts` + `…/riley/riley-config.ts` (hex accents → `hsl(var(--agent-*))`) + their `*.test.ts`
- Relocate: `ALEX_APPROVAL_ACCENT` (live, imported by `components/inbox/inbox-agent-avatar.tsx:11`) out of `approval-card.tsx` into `lib/cockpit/alex-config.ts` (or a new `lib/cockpit/accents.ts`), values migrated to action vars.
- Delete: `components/cockpit/kpi-strip.tsx` (+test), `components/cockpit/roi-bar.tsx` (+test), the `ApprovalCard` **component** in `approval-card.tsx` (+ its test) — KEEP the relocated accent. *(Verify dead first.)*

- [ ] **Step 1 — Re-verify dead-code graph** (don't trust the map): `git grep -n "KPIStrip\|kpi-strip\|ROIBar\|roi-bar\|ApprovalCard\|approval-card" apps/dashboard/src | grep -v __tests__ | grep -v "\.test\."`. Confirm: only the relocated `ALEX_APPROVAL_ACCENT` import is live; `KPIStrip`/`ROIBar`/`ApprovalCard` have no live importer. If any live importer exists, STOP and adjust scope.
- [ ] **Step 2 — Rewrite `tokens.test.ts` (failing):** replace hex assertions with: every value of `T` matches `/^hsl\(var\(--[a-z-]+\)\)$/` OR `/^rgba?\(var\(/` (for `hair`); zero raw hex in the file.
- [ ] **Step 3 — Verify FAIL** (T still hex).
- [ ] **Step 4 — Migrate `T`:** `bg→hsl(var(--canvas))`, `paper→hsl(var(--surface))`, `ink→hsl(var(--ink))`, `ink2→hsl(var(--ink-2))`, `ink3→hsl(var(--ink-3))`, `ink4→hsl(var(--ink-4))`, `ink5→hsl(var(--ink-4))` *(map to the faintest existing tier; T5 finalizes the 5-step ramp — mark `/* token-debt: ink5→ink-4 until T5 5-step ramp — T5 */`)*, `hair→hsl(var(--hair))`, `hairSoft→hsl(var(--hair-soft))`, `amber→hsl(var(--action))`, `amberDeep→hsl(var(--action-hover))`, `amberSoft→hsl(var(--action-subtle))`, `amberPaper→hsl(var(--action-tint))`, `green→hsl(var(--positive))`, `red→hsl(var(--destructive))`, `blue→` delete (unused — confirm `git grep "T.blue"`).
- [ ] **Step 5 — Relocate `ALEX_APPROVAL_ACCENT`** to `alex-config.ts`, values: `{ base: "hsl(var(--action))", deep: "hsl(var(--action-hover))", soft: "hsl(var(--action-subtle))", paper: "hsl(var(--action-tint))" }`. Update the import in `inbox-agent-avatar.tsx`. Migrate `ALEX_CONFIG.accent` + `RILEY_ACCENT` hexes → `hsl(var(--agent-alex*))` / `hsl(var(--agent-riley*))`. Update `alex-config.test.ts`/`riley-config.test.ts` to expect the var() strings.
- [ ] **Step 6 — Delete** the three dead modules + their tests; fix any now-broken imports (`git grep` after).
- [ ] **Step 7 — Verify PASS + typecheck + build** (`pnpm --filter @switchboard/dashboard typecheck` then `next build` to catch dead-file/`.js`-extension breaks — `feedback_build_typechecks_dead_files`).
- [ ] **Step 8 — Live screenshot:** Alex cockpit (identity, status pill, mission popover), Mira desk (all `T`-styled surfaces), inbox agent avatar — confirm colors match pre-migration (green/red/amber/ink). `T.green→--positive` (152 28% 32% vs old #3F7A36) and `T.red→--destructive` (0 38% 40% vs #A03A2E) are small shifts — confirm acceptable; if a surface degrades, add a `--palette-*` for it rather than forcing.
- [ ] **Step 9 — Commit** `feat(dashboard): migrate cockpit T tokens to hsl(var()); drop dead cockpit family (T2)`.

### Task T3: Inbox hues + avatar `#4A3A66` + inbox `--amber`; remove `.ds-pending` if dead

**Invariant:** *Each agent hue has exactly one definition in the inbox/avatar path.*

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox-design-base.css` (`--coral/teal/violet*`, `--amber*`)
- Modify: `apps/dashboard/src/components/inbox/inbox-agent-avatar.tsx:~24-26` (`#4A3A66`)
- Modify: `apps/dashboard/src/components/inbox/inbox.css` (remove `.ds-pending*` IF dead; also `#3d9258`→`var(--good)`, other stray hex)

- [ ] **Step 1 — Extend drift guard (failing):** in `token-governance.test.ts` assert `inbox-design-base.css` `--coral`/`--teal`/`--violet` (+`-deep`/`-tint`) and `--amber`(+`-deep`/`-tint`) resolve to `hsl(var(--agent-*))`/`hsl(var(--action*))`, not hex; assert `inbox-agent-avatar.tsx` contains no `#4A3A66`.
- [ ] **Step 2 — Verify FAIL.**
- [ ] **Step 3 — Repoint** inbox-design-base.css: `--coral: hsl(var(--agent-alex)); --coral-deep: hsl(var(--agent-alex-deep)); --coral-tint: hsl(var(--agent-alex-tint));` (+ teal→riley, violet→mira), `--amber: hsl(var(--action)); --amber-deep: hsl(var(--action-hover)); --amber-tint: hsl(var(--action-tint));`. Fix `inbox-agent-avatar.tsx` `#4A3A66` → `hsl(var(--agent-mira-deep))`. Fix `inbox.css:224` `#3d9258`→`hsl(var(--positive))` and other stray hex found by `git grep -n "#[0-9a-fA-F]" inbox.css` (mark any genuinely-temporary with `token-debt`).
- [ ] **Step 4 — `.ds-pending` verification** (`feedback_build_typechecks_dead_files` + memory dispute): `git grep -n "ds-pending" apps/dashboard/src --include=*.tsx`. If ZERO `.tsx` references (markup deleted in #821), remove the `.ds-pending*` rule block from inbox.css. If ANY reference, leave it and note. 
- [ ] **Step 5 — Verify PASS + build.**
- [ ] **Step 6 — Live screenshot:** Inbox decision cards (coral/teal/violet identity), the approve button (amber), the agent avatar disc — confirm one consistent hue per agent across Home/Inbox.
- [ ] **Step 7 — Commit** `feat(dashboard): collapse inbox agent hues + amber onto canonical tokens (T3)`.

### Task T4: Mercury light-touch

**Invariant:** *Mercury's shared colors derive from primitives — they can't drift independently.*

**Files:** Modify: `apps/dashboard/src/app/globals.css` Mercury block (lines ~109-120).

- [ ] **Step 1 — Test (failing):** assert `--mercury-accent`/`-soft`, `--mercury-pos`, `--mercury-neg`, `--mercury-ink*` reference a primitive/semantic (`var(--...)`/`hsl(var(--...))`), not a standalone `hsl(literal)`. (`--mercury-cream` already aliases `--canvas` — keep.)
- [ ] **Step 2 — Verify FAIL.**
- [ ] **Step 3 — Repoint** the shared ones: `--mercury-pos: hsl(var(--positive)); --mercury-neg: hsl(var(--destructive)); --mercury-ink: hsl(var(--ink)); --mercury-ink-2: hsl(var(--ink-2)); --mercury-ink-3: hsl(var(--ink-3)); --mercury-ink-4: hsl(var(--ink-4));`. Leave `--mercury-accent` (the bright editorial orange `20 90% 55%`, distinct from action amber by design — `token_namespaces_not_binary`) as a primitive: add `--palette-editorial-accent: 20 90% 55%` and point `--mercury-accent`/`--editorial-accent` at it. Do NOT restructure per-surface module aliases.
- [ ] **Step 4 — Verify PASS + build.**
- [ ] **Step 5 — Live screenshot:** /reports + /activity (pos/neg figures, ink tiers, accent) — confirm unchanged.
- [ ] **Step 6 — Commit** `feat(dashboard): derive Mercury shared colors from primitives (T4)`.

### Task TG: Drift-guard + contrast-gate finalization (decoupled from T5)

**Invariant:** *Color drift and sub-AA action contrast are CI failures, not review catches.*

**Files:** Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (the complete guard).

- [ ] **Step 1 — Finalize the guard** as the full spec-§3.4 contract over the governed paths (spec §3.2): 
  (1) no literal hex/`rgb`/raw-HSL on **action** or **agent** tokens outside the `--palette-*` block (scan globals.css + cockpit/tokens.ts + inbox-design-base.css + lib/cockpit configs); 
  (2) each agent hue (`alex/riley/mira` + `-deep`/`-tint`) resolves to exactly one value app-wide (collect all definitions across governed paths, assert set size 1 per hue); 
  (3) cockpit `T` is var()-only (re-assert); 
  (4) `--palette-action-bright` never appears in a `color:`/text/`fill:` context — `git grep` consumers, assert none in foreground positions; 
  (5) contrast: action fg/bg ≥ 4.5:1; 
  (6) only `/* token-debt: … expires … */`-marked literals are exempt (parse markers; FAIL on expired or unmarked).
- [ ] **Step 2 — Run; fix any real violations** the finalized guard surfaces (this is its job).
- [ ] **Step 3 — Verify PASS + full `pnpm --filter @switchboard/dashboard test`.**
- [ ] **Step 4 — Commit** `test(dashboard): finalize token drift-guard + contrast gate (TG)`.

### Task T5: Neutral ink ramp 3→1 — by role, not similarity (deferrable)

**Invariant:** *One warm-neutral ramp by role; no surface forks its own inks.*

**Files:** Modify: `globals.css` (`--ink*` → primitives), `inbox-design-base.css` (`--ink-1..4`), cockpit `tokens.ts` (ink5 token-debt → resolved).

- [ ] **Step 1 — Map by ROLE** (spec §4.3): tabulate the three ramps' values against their hierarchy job (primary/secondary/tertiary/faint/hairline). Define `--palette-ink-900..300` primitives. **If two values do genuinely different contrast jobs, keep both** — do not force-merge.
- [ ] **Step 2 — Test (failing):** assert `--ink`/`--ink-2/3/4` and inbox `--ink-1..4` and cockpit ink tokens all resolve to `--palette-ink-*`.
- [ ] **Step 3 — Implement** the ramp + repoints; resolve the T2 `ink5` token-debt marker.
- [ ] **Step 4 — Verify PASS + build.**
- [ ] **Step 5 — Live screenshot EVERY ink-bearing surface** (Home, Inbox, Results, all cockpits, Mercury) — this is the riskiest slice; if any text hierarchy reads worse, keep that surface's value as a distinct primitive and re-run.
- [ ] **Step 6 — Commit** `feat(dashboard): unify warm-neutral ink ramp by role (T5)`.

---

## Phase B — Structural foundations (independent; interleave/parallelize)

### Task TY2: Tracking tokens + kill the font lie

**Invariant:** *Letter-spacing is a closed named set; no font-stack lies.*
- Inspect: `git grep -n "letter-spacing" apps/dashboard/src` (≈9 ad-hoc values).
- [ ] Test: assert globals.css defines `--track-label`/`--track-eyebrow`/`--track-tight` and `--font-display` no longer names `"Instrument Sans"`.
- [ ] Verify FAIL → Implement: add `--track-label: 0.08em; --track-eyebrow: 0.12em; --track-tight: -0.01em;`; replace the ≈9 ad-hoc `letter-spacing` values across modules with these; delete `--font-display: "Instrument Sans"` (set to the real loaded stack — DM Sans/`--font-sans`, confirm via layout.tsx `git grep -n "Instrument\|DM Sans\|font-display"`).
- [ ] Verify PASS + build → screenshot eyebrows/labels → Commit `feat(dashboard): named tracking tokens; remove dead font-display (TY2)`.

### Task EL1: 5-level warm shadow ladder

**Invariant:** *Elevation is a 5-step ladder; no ad-hoc shadows.*
- Inspect: `git grep -n "box-shadow\|--shadow" apps/dashboard/src` (≈35 ad-hoc, 4 base colors).
- [ ] Test: assert globals.css defines `--shadow-1..5` (one warm base `rgba(40,30,20,…)`, increasing) and z-index map comment.
- [ ] Verify FAIL → Implement `--shadow-1: …; … --shadow-5: …;` (card-rest→hover→dropdown→sheet→modal); map existing `--shadow-card/lift/sheet` to the ladder; replace ad-hoc `box-shadow` literals in the highest-traffic modules (Inbox card first as benchmark).
- [ ] Verify PASS + build → screenshot card rest/hover, sheet, dropdown → Commit `feat(dashboard): 5-level warm shadow ladder (EL1)`.

### Task SP1: 4pt spacing scale via Tailwind

**Invariant:** *Spacing is a 4pt scale; `--space-*` are live, not dead.*
- Inspect: `apps/dashboard/tailwind.config.ts` spacing; `git grep` free-hand `7px|9px|11px|14px|18px|22px`.
- [ ] Test: assert tailwind config exposes a 4pt scale and `--space-*` map to it; (CSS-side) Inbox card uses scale tokens.
- [ ] Verify FAIL → Implement: define the 4/8/12/16/24/32/48/64 scale in tailwind.config, wire `--space-*`; convert the Inbox card module to the scale (benchmark).
- [ ] Verify PASS + build → screenshot Inbox card density → Commit `feat(dashboard): 4pt spacing scale via Tailwind; Inbox card benchmark (SP1)`.

### Task QS1: `<QueryStates>` perceived-performance primitive

**Invariant:** *Every feed renders loading/error/empty/data through one gate.*
- Inspect: `components/agent-panel/key-result.tsx`, `open-decisions.tsx`, `mira-desk-page.tsx:34` (the `!data && !error` pattern to extract).
- Create: `apps/dashboard/src/components/ui/query-states.tsx` + `query-states.test.tsx` (and/or `useQueryGate`).
- [ ] Test (failing): `useQueryGate({data,error,isError})` returns `'loading'` when `!data && !error` (keys-pending-safe), `'error'`, `'empty'` (data present but empty), `'data'`. Component renders the matching branch.
- [ ] Verify FAIL → Implement primitive; route AgentPanel + Inbox + Mira feeds through it (replace ad-hoc gates). Keep three-states-never-collapse invariant (`feedback_react_query_enabled_false_isloading`).
- [ ] Verify PASS + build → screenshot loading/empty/error states → Commit `feat(dashboard): shared QueryStates perceived-performance primitive (QS1)`.

### Task QS2: `(auth)/loading.tsx` route shells

**Invariant:** *Every daily route has a layout-matched shell.*
- Create: `apps/dashboard/src/app/(auth)/.../loading.tsx` for Home, Inbox, Results, Mira (layout-matched skeletons).
- [ ] Test: each route exports a default loading component rendering a skeleton matching the route's masthead/columns.
- [ ] Verify FAIL → Implement the four shells (mirror existing `(public)/loading.tsx` quality); map the audit §5 failure matrix onto the QueryStates `error`/`empty` vocabulary.
- [ ] Verify PASS + build → screenshot each route cold-start → Commit `feat(dashboard): loading.tsx shells for the four daily routes (QS2)`.

### Task V1: Voice spec + extend no-banned-claims into the app

**Invariant:** *Banned over-claims fail CI in-app, not just on marketing.*
- Create (docs): `docs/superpowers/specs/2026-06-02-app-voice-spec.md` (numbers ≤ten in prose / tabular in display; verbs handled/attributed/assisted/booked not "generated"; omit-not-placeholder; first-person never-blaming).
- Inspect: `components/landing/v6/__tests__/no-banned-claims.test.ts` (the pattern to extend).
- [ ] Test (failing): a new in-app `no-banned-claims` test scanning app copy modules for the banned ~40 over-claims + "generated".
- [ ] Verify FAIL (find/fix any real in-app violations) → Implement the guard over app copy; commit voice spec.
- [ ] Verify PASS → Commit `test(dashboard): extend no-banned-claims guard into the app + voice spec (V1)`.

---

## Delivery

- [ ] Keystone PR: `feat/wave-1-token-unification` → `main`, body lists each slice's invariant + the #824 overlap note + screenshot evidence.
- [ ] Structural PR(s): TY2/EL1/SP1/QS1/QS2/V1 (group as one "wave-1 structural foundations" PR or split if large).
- [ ] Spec/plan docs PR: the already-committed `docs/wave-1-token-unification-spec` branch.
- [ ] **Request code review** (superpowers:requesting-code-review and/or `/code-review`) on the diff.

---

## Self-review (against spec)

**Coverage:** spec §3 governance → TG guard + per-slice tests ✓; §4.1 amber → T1 ✓; §4.2 agent hues → T2(configs)+T3(inbox/avatar) ✓; §4.3 neutral ramp → T5 ✓; §4.4 cockpit T → T2 ✓; §4.5 `-bright` → T1 primitive + TG rule 4 ✓; §4.6 contrast → contrast.ts + TG rule 5 ✓; §4.7 Mercury → T4 ✓; §5.1 type → TY1+TY2 ✓; §5.2 elevation → EL1 ✓; §5.3 spacing → SP1 ✓; §5.4 QueryStates → QS1+QS2 ✓; §5.5 voice → V1 ✓.
**Ordering:** TG before/independent of T5 ✓; TY1 pulled forward ✓; T1 no-churn acceptance ✓.
**Risks tracked:** neutral ramp deferrable (T5 last in Phase A) ✓; cockpit green/red/ink mapping screenshot-gated (T2 step 8) ✓; `.ds-pending` verified before delete (T3 step 4) ✓; ink5 token-debt marker carried T2→T5 ✓.
