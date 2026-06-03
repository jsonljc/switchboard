# EL1: Elevation / shadow ladder (design)

Status: proposed
Date: 2026-06-03
Audit source: `docs/audits/2026-06-02-ui-ux-feel-audit/direction.md` section 6 "Depth / elevation", section 7 Wave 1 item 3 "Elevation + spacing ladders"
Related memory: `project_ui_ux_feel_audit_2026_06_02` (the Wave-1 keystone hub)

## 1. Summary

Collapse the dashboard's ad-hoc box-shadows (today scattered across four base colors and several hand-tuned values) onto ONE warm shadow base expressed as a five-level semantic elevation ladder (`--shadow-1` through `--shadow-5`), z-index-mapped to roles: card-rest, hover, dropdown/popover, sheet, modal. Repoint the existing semantic shadow tokens (`--shadow-card`, `--shadow-lift`, `--shadow-sheet`) at ladder levels so their consumers never change (the proven primitive-under-semantic keystone pattern), migrate the remaining inline and hardcoded box-shadows to the ladder, and add a CI drift guard (a vitest that reads the CSS) so the ladder stays the single source even though raw CSS is not lint-gated.

Structure the tokens so a future `.dark` block can swap shadow for tonal surface steps without touching any consumer. The dark toggle stays hidden (Wave 3); this PR only makes the tokens dark-ready.

Scope is EL1 only. SP1 (the 4pt spacing scale), TY2 (type/font), the dark palette authoring and toggle-enable, and the warm-newsprint re-skin are explicitly out of scope.

## 2. The inventory (verified against fresh origin/main)

A read-only subagent enumerated every box-shadow, every `--shadow*` token, and the cockpit family on the worktree source. Headline numbers (the audit's "~35 across four base colors" was a reasonable estimate; the real counts):

- 49 `box-shadow` / `boxShadow` occurrences in `apps/dashboard`. No `filter: drop-shadow(` anywhere.
- The genuine ELEVATION subset is roughly 21 declarations. The rest are: the amber primary-button gloss (3 near-duplicate copies), focus rings and status-dot halos and animated pulse rings (all shaped `0 0 0 Npx`), inset decorations, and the login input focus rings.
- Three existing semantic shadow tokens, all on a warm `rgba(40, 30, 20, a)` base, defined in `globals.css` AND redefined (scoped to `.inbox-page, .sheet`) in `inbox-design-base.css`. The `--shadow-card` redef has a value DRIFT (second layer alpha `0.04` in inbox vs `0.05` in globals).
- The four distinct elevation base colors are real: (1) `rgba(40, 30, 20)` (the token base), (2) `rgba(14, 12, 10)` (Mercury activity menu and contacts toast), (3) `rgb(0 0 0)` (the results window-toggle AND every shadcn primitive: dialog, sheet, popover, dropdown-menu, select, toast all use Tailwind `shadow-*` utilities, which resolve to the stock Tailwind cool-black ramp because `tailwind.config.ts` has no `boxShadow` override), (4) `hsl(20 10% 12%)` (the globals status pill at line 1329).
- The cockpit contributes almost nothing: the `T` token object defines no shadow (PR #832 already converted `T` to `hsl(var())`), only one inline inset on the sprite frame and one Tailwind `shadow-lg` on `mission-popover`.

The most consequential finding: the dropdown / sheet / modal roles (the exact roles the ladder z-maps to) are the shadcn primitives, and they currently ride Tailwind's COOL-BLACK ramp, not any warm token. Unifying them onto the warm ladder is the core of "one warm base," not an afterthought.

## 3. Design

### 3.1 One warm base

```css
/* primitive: ONE warm shadow base, derived from the warm near-black ink.
   Raw HSL triple so it is consumed hsl(var(--shadow-color) / alpha) and is
   dark-overridable by a single .dark override. */
--shadow-color: 24 16% 11%;
```

Derived from the editorial ink (`--palette-ink-900` is `20 10% 12%`), nudged a touch warmer and darker so a shadow reads as absence-of-light, not a brown tint. The exact triple is tuned against the existing card shadow and verified with before/after screenshots (the warm-vs-cool difference must be felt, not jarring).

### 3.2 Five downward elevation levels (the ladder)

```css
/* Elevation ladder — ONE warm base at incrementing offset/blur/opacity.
   Role / z-tier: 1 card-rest, 2 hover/raised, 3 dropdown/popover/menu/toast,
   4 sheet/drawer, 5 modal/dialog. Consumed bare: box-shadow: var(--shadow-3). */
--shadow-1: 0 1px 0 hsl(var(--shadow-color) / 0.04), 0 1px 2px hsl(var(--shadow-color) / 0.05);
--shadow-2: 0 1px 2px hsl(var(--shadow-color) / 0.05), 0 4px 8px hsl(var(--shadow-color) / 0.06);
--shadow-3: 0 2px 6px hsl(var(--shadow-color) / 0.05), 0 10px 26px hsl(var(--shadow-color) / 0.09);
--shadow-4: 0 4px 10px hsl(var(--shadow-color) / 0.07), 0 18px 44px hsl(var(--shadow-color) / 0.12);
--shadow-5: 0 8px 18px hsl(var(--shadow-color) / 0.10), 0 30px 64px hsl(var(--shadow-color) / 0.16);
```

A calm, felt ramp: primary-layer blur grows 2, 8, 26, 44, 64; primary alpha grows 0.05, 0.06, 0.09, 0.12, 0.16; a tight close-contact layer anchors each level. Level 1 keeps the existing card shadow's `0 1px 0 / 0 1px 2px` shape so cards are visually unchanged except for the base-color normalization. Principle VI ("calm has a motion/elevation budget") governs the values: each step up is a deliberate, perceptible lift, never noisy.

Every level uses ONLY `hsl(var(--shadow-color) / a)`, no literal color. That is what makes the ladder dark-overridable from a single base swap.

### 3.3 Directional docked-surface variant

Bottom-docked sheets cast their shadow UPWARD onto the content above them, so they cannot use the downward ladder. Keep `--shadow-sheet` as a directional sibling at level-4 weight, rebased onto the shared base:

```css
/* Directional: bottom-docked sheets cast upward; level-4 weight, shared base. */
--shadow-sheet: 0 -10px 30px hsl(var(--shadow-color) / 0.08), 0 -1px 2px hsl(var(--shadow-color) / 0.04);
```

The one right-side drawer variant (a leftward shadow at `inbox-design-base.css`) is rebased inline onto the same base (`hsl(var(--shadow-color) / 0.10)`); it is a single consumer, so it does not earn its own token.

### 3.4 Repoint the existing semantic tokens (zero-churn keystone)

```css
--shadow-card: var(--shadow-1);   /* card at rest */
--shadow-lift: var(--shadow-3);   /* lifted floating surface (toast, popover) */
/* --shadow-sheet stays a directional token, see 3.3 */
```

Consumers that already write `box-shadow: var(--shadow-card)` (11 sites), `var(--shadow-lift)` (1 site), and `var(--shadow-sheet)` (5 sites) do not change. The scoped redefinitions in `inbox-design-base.css` are DELETED so those surfaces inherit the global ladder, which also resolves the `--shadow-card` alpha drift.

### 3.5 The amber action-button gloss is NOT elevation

The primary "approve / spend" button carries a hand-tuned amber gloss (inset highlight plus amber glow), duplicated nearly verbatim in three files (Home, swipe card, inbox). This is brand material, not elevation, so it does not belong on the neutral ladder. Collapse the three copies onto one semantic token (its own amber palette, the single source):

```css
/* Brand material for the ONE amber action button. Not elevation. */
--shadow-action-gloss:
  inset 0 1px 0 rgba(255, 255, 255, 0.18),
  inset 0 -1px 0 rgba(80, 40, 0, 0.2),
  0 2px 4px rgba(168, 101, 15, 0.25),
  0 6px 16px rgba(201, 123, 26, 0.18);
```

The three buttons consume `var(--shadow-action-gloss)`. The inbox copy differs slightly today; normalizing all three to one canonical gloss is a deliberate, beneficial de-duplication (verified by screenshot).

### 3.6 Role to level mapping

| Level | Role | Token / class | Migrated consumers |
|---|---|---|---|
| 1 | card at rest | `--shadow-1` (via `--shadow-card`) | `.card`, `.decision`, `.agentChip`, agent-panel cards, this-week, results window-toggle (was `rgb(0 0 0)`) |
| 2 | hover / raised | `--shadow-2` | contacts `.card:hover` (was `rgba(14,12,10)`) |
| 3 | dropdown / popover / menu / toast | `--shadow-3` (via `--shadow-lift`) and `shadow-[var(--shadow-3)]` | shadcn popover, select, dropdown-menu, toast; activity menu and stale pill; contacts toast; cockpit mission-popover; globals status pill; inbox `.toast` |
| 4 | sheet / drawer | `--shadow-4` and `--shadow-sheet` (directional) | shadcn sheet; `.sheet` / `.confirm` / `.panel`; right-drawer |
| 5 | modal / dialog | `--shadow-5` via `shadow-[var(--shadow-5)]` | shadcn dialog |

The shadcn overlay primitives are migrated by replacing their named Tailwind class (`shadow-lg`, `shadow-md`) with an arbitrary `shadow-[var(--shadow-N)]` at the role-correct level. This warm-skins the dropdown / sheet / modal surfaces with no `tailwind.config.ts` change and composes cleanly with Tailwind's ring vars (same `--tw-shadow` slot the named class used).

### 3.7 Dark-readiness (toggle stays hidden)

Because every level is `hsl(var(--shadow-color) / a)`, the existing `.dark` block needs ONE override:

```css
.dark {
  /* Elevation: dark swaps the warm base for near-black. Wave 3 will replace
     shadow-based elevation with tonal surface steps (audit section 6). The
     dark toggle remains hidden until then. */
  --shadow-color: 0 0% 0%;
}
```

This is the dark-overridable hook. Wave 3 may instead override `--shadow-1..5` directly to tonal/surface-step values; the structure already allows it. The token-governance drift guard strips the `.dark` block before scanning (dark VALUES are Wave-3 deferred), so these dark values are not part of the light-mode contract.

## 4. The drift guard (the durable CI backstop)

Extend `apps/dashboard/src/app/__tests__/token-governance.test.ts` with an `elevation ladder single-source (EL1)` describe block, mirroring the existing recursive governed-source sweep and the voice/token drift guards. Raw CSS is not lint-gated (dashboard ESLint is stubbed, CI format:check is `*.ts` only), so this test IS the enforcement.

### 4.1 Contract

1. The base `--shadow-color` is defined in `globals.css` and is a raw HSL triple (dark-overridable).
2. `--shadow-1` through `--shadow-5` are defined in `globals.css` and contain NO literal color (only `hsl(var(--shadow-color) / a)`).
3. The semantic tokens repoint at the ladder: `--shadow-card` equals `var(--shadow-1)`, `--shadow-lift` equals `var(--shadow-3)`; `--shadow-sheet` references `var(--shadow-color)` (no literal rgba).
4. Single source: no `--shadow*` custom property is DEFINED outside `globals.css`.
5. Governed-source sweep: every `box-shadow:` (CSS) and `boxShadow:` / `boxShadow =` (JSX prop or imperative assignment, in quotes or backticks) USAGE in governed source (the existing `collectGovernedFiles()` roots: `src/app`, `src/components`, `src/lib`, `src/styles`; tests, `-variants.ts`, and the stripped `.dark` block excluded) has NO literal color in its value.
6. Tailwind shadow utilities: no governed `.tsx`/`.ts` outside a documented residual allowlist uses a built-in `shadow-{sm,md,lg,xl,2xl}` or an arbitrary `shadow-[...]` carrying a literal color. Only `shadow-none` and `shadow-[var(--shadow-N)]` are allowed on in-scope surfaces. This closes the Tailwind-class literal-color vector the CSS sweep cannot see.

### 4.2 What counts as a violation

A box-shadow USAGE value containing a literal color: `rgba?(` followed by a digit, or `hsl(` followed by a digit (a literal hsl, NOT `hsl(var(...))`), or a `#hex`. The ladder token definitions are exempt because they are custom-property definitions, not `box-shadow:` usages, and they carry no literal color anyway.

### 4.3 Exemptions (deliberate, low false-positive)

- `none`, `inherit`, `unset`, and any value that is only `var(...)` references.
- Spread-only rings: a single-shadow value shaped `0 0 0 Npx <color>`. These are focus rings, status-dot halos, and pulse keyframes, which are NOT elevation (Principle: focus rings are not shadows; the global `:focus-visible` outline stays). This structural exemption covers the login input focus rings and the home status-dot halos without an allowlist.
- The Tailwind built-in residual allowlist (marketing `landing/`, the flag-hidden `operator-chat/` widget [#825], `settings/` [#826], the dev-only `dev/` panel, and the small non-overlay `ui/switch.tsx` + `ui/tabs.tsx`). These keep their built-in Tailwind shadows as a documented EL1 residual; new authed surfaces must use the ladder.

There is no `shadow-allow` escape hatch: the one animated one-off (the amber `armPulse` keyframe) is composed from a token (`--shadow-arm-base`) plus a var ring, so it carries no literal color and needs no bypass.

CSS `/* ... */` comments are stripped before scanning so commented-out shadows never false-positive.

## 5. Migration map (per file)

In scope (migrated this PR):

- `globals.css`: add base + ladder + gloss + `--shadow-arm-base` tokens; repoint `--shadow-card`/`--shadow-lift`; rebase `--shadow-sheet`; migrate the status-pill inline shadow to `var(--shadow-3)`; add the `.dark` base override.
- `inbox-design-base.css`: delete the three scoped `--shadow*` redefs; rebase the right-drawer leftward shadow onto `hsl(var(--shadow-color) / 0.10)`.
- `home.module.css`, `swipe-decision-card.module.css`, `inbox.css`: point the amber primary button at `var(--shadow-action-gloss)`.
- `swipe-decision-card.module.css`: compose the `armPulse` keyframe from `var(--shadow-arm-base)` plus the var ring (no literal color, no allowlist).
- `results.module.css`: window-toggle `rgba(0,0,0)` to `var(--shadow-1)`.
- `activity.module.css`: stale pill and menu to `var(--shadow-3)`.
- `contacts/pipeline.module.css`: `.card:hover` to `var(--shadow-2)`, toast to `var(--shadow-3)`; the drag-over inset ring uses `var(--mercury-accent)` already (a var color, not flagged), left as-is.
- `tools-overflow.module.css`: the inset active-tab underline `hsl(30 55% 46%)` to `hsl(var(--action))` (it is the action amber).
- `cockpit/sprite/sprite-frame.tsx`: inset color to `hsl(var(--shadow-color) / 0.04)`.
- `cockpit/mission-popover.tsx`: `shadow-lg` to `shadow-[var(--shadow-3)]`.
- shadcn `ui/dialog.tsx` (level 5), `ui/sheet.tsx` (4), `ui/popover.tsx` (3), `ui/dropdown-menu.tsx` (3), `ui/select.tsx` (3), `ui/toast.tsx` (3): named Tailwind shadow class to `shadow-[var(--shadow-N)]`.

Out of scope (documented residual, NOT migrated):

- Small / non-overlay Tailwind `shadow-sm` / `shadow-lg` on the switch thumb, tabs active state, settings selected tiles, onboarding pills, and the dev-only panel. These are not elevation-role surfaces; their cool-black at small size is negligible, and changing them risks unrelated visual regressions. The drift guard grandfathers these specific files in a documented allowlist (so they pass) while failing any NEW built-in Tailwind shadow on an in-scope surface. A follow-up may fold them onto the ladder.
- The marketing landing (`landing-v6.css` and `components/landing/v6/*`) uses hand-tuned arbitrary `shadow-[...]` values; out of the authed-app EL1 scope.
- The login input focus rings (exempt as `0 0 0` rings; login uses the public stone design system; leave untouched to avoid auth-page risk).
- The green "live" pulse keyframes in `tailwind.config.ts` (outside the governed-source roots; not elevation).
- z-index token unification (a sibling concern, not EL1).

## 6. Wave-0 coordination

The Wave-0 stack (#814 through #827) is still open. The collision check (`gh pr diff --name-only`) found one head-on collision: #824 edits `globals.css` (it darkens the action amber to AA and adds a global focus ring). The keystone already merged the AA amber and the `--palette-*` layer to main, so #824 will reconcile against main regardless; my shadow additions live in a different region of `globals.css` (the elevation block, not the amber/focus lines), so they do not collide head-on. Two incidental collisions (#825 operator-chat widget, #826 settings account page) only touch files with non-token Tailwind `shadow-*` classes that I am leaving as residual, so there is no overlap. No shadow-bearing file I migrate is touched by an open Wave-0 PR except `globals.css` (#824, different region).

## 7. Testing and verification

- TDD: the drift guard test is written to fail first (red on the un-migrated tree), then the migration makes it green.
- Full dashboard vitest suite stays green (the existing `tokens.test.ts` asserts the three shadow token NAMES exist; they still do, repointed). Typecheck, build, and format:check stay green.
- Because shadows are a visual change and CSS is not CI-lint-gated, capture before/after live screenshots on the trust-critical surfaces: Home cards, the approval/decision sheet, a dropdown/popover, and a modal. Verify the warm normalization reads as calm, not jarring, and that the dropdown/sheet/modal cool-to-warm shift looks intentional.

## 8. Risks and mitigations

- Visual regression on shared shadcn primitives (broad surface). Mitigation: shadow-only change (no layout/behavior), role-correct level mapping, and mandatory before/after screenshots on the named surfaces.
- The warm base differs from cards' current value. Mitigation: level 1 preserves the existing shape; the base triple is tuned to match; screenshots confirm.
- Guard false positives. Mitigation: the literal-color rule allows `var()` and `0 0 0` rings; CSS comments stripped; a documented `shadow-allow` escape hatch for genuine one-offs. The guard is the explicit target of an adversarial review pass.
- Dark shadows will be faint with a pure-black base at these alphas. Accepted: dark is Wave-3 (tonal surface steps); this PR only provides the dark-overridable hook, the toggle stays hidden.

## 9. Out of scope (restated)

SP1 spacing scale, TY2 type/font, dark palette authoring and toggle-enable, the warm-newsprint re-skin. EL1 ships the elevation ladder, the migration, the drift guard, and before/after screenshots only.
