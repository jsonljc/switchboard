# Type scale on the money surfaces + display-token consolidation (design)

**Status:** Approved 2026-06-04 (autonomous session, operator delegated design approval; check-in #1 happens with the docs PR open).
**Parent direction:** the locked app aesthetic (PR #845 branch, `docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`), section 4 TYPE scale table and section 5.
**Predecessor:** the type-voice slice (`2026-06-04-type-voice-fraunces-design.md`, shipped as #875/#881). This slice is its named follow-ups 2 and 3: the scale table beyond Home, and the `--font-display` consolidation.
**Scope:** the authed product app (Inbox, approval/handoff sheets, Results, Home greeting, authed shell headings, settings/identity). Marketing/landing, Mercury (`(mercury)` route group), onboarding, and pre-auth pages are OUT (own registers, zero pixel change there is the bar).

## 1. Problem (verified against main at `3ada8c42`)

The type-voice slice shipped the display FACE (Fraunces, upright only, self-hosted) by repointing `--font-home-serif` and the inbox-local `--serif`. The locked direction's SCALE rows for surfaces beyond Home are not applied, and the display token is split across three systems:

- `layout.tsx:22-26` still loads DM Sans bound to `--font-display` on `<html>`. That binding wins the cascade over globals.css:115's honest `ui-sans-serif` value, so every `var(--font-display)` consumer renders DM Sans today: the authed shell headings (help-overlay h2, inbox-drawer SheetTitle, live-signal status-label, settings/identity h1, all via the `.font-display` utility at globals.css:468) plus the out-of-scope registers (Mercury activity/reports, landing nav/footer, onboarding, login/forgot/reset).
- The authed app therefore has TWO live display tokens (`--font-home-serif`, inbox `--serif`, both Fraunces) plus a third legacy one (`--font-display`, DM Sans) that four authed shell headings still ride.
- Scale reality vs the locked section 4 rows (all verified in the live tree):

| Spec row (px/weight/tracking)              | Current state                                                                         | Element                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| inbox title 30/700/-.025                   | Fraunces 36 to 44px / 500 / -.022 (opsz 48)                                           | `.inbox-pagehead h1` (inbox.css:26)                                                   |
| sheet proposal 22/600/-.018                | Fraunces 26 to 28px / 500 / -.014 (opsz 36)                                           | `.ds-summary` (inbox.css:659)                                                         |
| value numerics 26/600/-.02 display tabular | JetBrains MONO 40/28/18px, 600/500, tabular                                           | `.heroRevenueNum` `.heroStatNum` `.worthItNum` `.heroAdSpendNum` (results.module.css) |
| greeting 18/500/-.01 display               | Inter 14px/500/-.005                                                                  | `.hello` (home.module.css:80), the "Good evening, {name}" salutation                  |
| meta/label 10.5-12/600/.08-.16 UPPER       | mono 10.5/500/.08-.1 (eyebrows, pagehead count) + Inter 11/500/.07 (`.section-label`) | various                                                                               |
| verdict hero 32/600                        | DONE in the type-voice slice (36/48, 600)                                             | `.line`                                                                               |

Correction to the mission brief, verified twice: the approval sheet proposal headline does NOT render sans today. `.ds-summary` and `.ds-head-name` already wear Fraunces via the inbox-local `--serif` (the type-voice repoint upgraded them for free). The sheet work in this slice is metric alignment (weight/tracking), not a face change.

- The help overlay (`help-card`) has NO stylesheet anywhere in the dashboard: its h2 renders at preflight-inherit size in DM Sans. A pre-existing rough edge, relevant to one decision below.
- The approval sheet carries four live em-dash copy strings (ConfirmInline head, note placeholder, risk-missing line, pending caption) and is not in the voice corpus. The help overlay carries one more.
- Two mono honesty gaps, both verified live in the tree:
  - layout.tsx loads JetBrains Mono at weights 400 and 500 only, but twelve governed CSS blocks declare `font-weight: 600` on `var(--mono)` (results.module.css: `.heroRevenueNum`, `.heroStatNum`, `.worthItNum`, `.roasBarLabel`, `.campaignMobileSortActive`, `.campaignCardStatVal`, `.mcColEyebrow`, `.mcVal`, `.agentValue`, `.colophonBadge`, `.stateBannerCta`; this-week.module.css: `.weeknoteFromName`). Every Results money number renders browser-SYNTHESIZED faux-bold today.
  - The inbox-local `--mono` (inbox-design-base.css:57) names `"JetBrains Mono"` as a raw family with no `var(--font-mono-editorial)` head. next/font registers fonts under hashed family names, so the raw name never matches: inbox meta (eyebrows, pagehead count) silently renders the system mono fallback, not JetBrains. The same token-lie class the type-voice slice killed for `--serif`.
- `.section-label`, the only sans label utility, is consumed exclusively by legacy registers (Mercury contact pages, settings/team, the operator panel, onboarding attribution-coverage): verified by grep, relevant to the meta/label decision below.

## 2. Goals and non-goals

**Goals**

1. One canonical authed display token. Every authed display consumer resolves through a single semantic; the face is defined once.
2. The locked scale's voice (weight/tracking, and face where the row demands it) lands on the named money surfaces: inbox title, sheet proposal, value numerics, greeting, meta/labels.
3. The legacy `--font-display` (DM Sans) is demoted to an explicitly documented register token for Mercury/landing/onboarding/pre-auth, with zero pixel change in those registers.
4. Drift guards make the consolidation structural (new TY3 block; TY2 guards extended, never weakened).
5. AA proven two ways per the standing rule, with per-target WCAG tiers (3:1 for large-scale text at 24px+ or 18.66px+ bold, 4.5:1 otherwise), pixel-sampled on real grounds.

**Non-goals (named follow-ups)**

- Geist body face (biggest blast radius; named follow-up from the type-voice spec, still deferred).
- Any pixel change in Mercury, landing, onboarding, login/forgot/reset, or `attribution-coverage.tsx` (onboarding). They keep DM Sans via the legacy token.
- The `--font-display` NAME convergence to Fraunces (the locked section 4 literal). That rename happens free when Mercury/landing retire; doing it now means ~20 mechanical edits across registers slated for retirement, each a pixel risk in surfaces this slice does not screenshot.
- `.ds-head-name`, `.decision-title`, `.ds-head-needs`: tuned, no spec row demands change, restraint wins.
- The approval sheet's `.ds-pending` placeholder block ("preview not yet wired"): #821's deletion target, untouched here except one em-dash copy fix (see 3.6).
- Dark mode (Wave 3), poster-title row (team band heading is bespoke and shipped).

## 3. Design

### 3.1 One authed display semantic (the consolidation)

globals.css gains the canonical token, and the existing semantics alias it (the zero-churn primitive-under-semantic keystone):

```css
--font-display-app: var(--font-fraunces), "Fraunces", "Iowan Old Style", Georgia, serif;
--font-home-serif: var(--font-display-app);
```

inbox-design-base.css repoints its local alias the same way: `--serif: var(--font-display-app);`

Resolution chain: `--font-fraunces` (loaded primitive) < `--font-display-app` (canonical semantic) < `--font-home-serif` / inbox `--serif` (legacy aliases, kept so zero consumers churn). New consumers reference `--font-display-app` directly.

`--font-display` stays exactly as loaded (DM Sans bound in layout.tsx) and becomes the documented LEGACY register token: a comment block in globals.css names its consumers (Mercury, landing, onboarding, pre-auth) and its retirement condition (when those registers retire or re-skin). The `.font-display` utility (globals.css:468) stays for those consumers. Nothing outside the authed shell changes pixels, by construction.

Rejected alternative: repoint `--font-display` itself to Fraunces and hand DM Sans to a new `--font-display-legacy`. Reaches the locked section 4 name today, but requires touching every legacy consumer file in the same commit to hold pixels still; the semantic win is identical and the name convergence is free later.

### 3.2 Shell headings: who adopts the display voice

Decided per-surface, pressure-tested against what each heading IS:

| Surface                                                                 | Decision                   | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inbox-drawer SheetTitle "Inbox" (inbox-drawer.tsx:129)                  | ADOPT display              | Fraunces 22/600/-.018 (opsz 28) via a `drawer-title` class in inbox-drawer.css; drop `.font-display`. The drawer is the mini-inbox; its big sibling (the inbox h1) is already Fraunces.                                                                                                                                                                                                                                                                                                                                                                                 |
| help-overlay h2 "Quick reference" (help-overlay.tsx:68)                 | ADOPT display, CONDITIONAL | The legacy `.font-display` class strips, the copy em-dash dies, and the file joins the corpus UNCONDITIONALLY (the consolidation sweep guard and the voice rule are not gated on this overlay's pre-existing styling gap; the h2 falls to the body face meanwhile). The display-voice rule itself (22/600/-.018 via a new co-located help-overlay.css) lands only if the live render shows a usable card; if the overlay is structurally broken, styling one heading on it is lipstick, so the rule waits for the overlay's own follow-up and the shot records the gap. |
| settings/identity h1 (agent displayName, identity/page.tsx:285)         | ADOPT display              | The strongest claim in the app: an agent NAME at hero scale above the sprite is the printed-portrait poster pattern. Keep the tuned text-5xl/md:text-6xl sizes and tracking-tight; swap `font-display font-light` + inline DM Sans for `--font-display-app` at weight 600 (700 reads too heavy at 60px; 600 matches the poster names' register at hero scale).                                                                                                                                                                                                          |
| live-signal status-label "System {state}" (live-signal-popover.tsx:107) | STAYS SANS                 | It is a status sentence, not display copy (the mission's instinct, confirmed). Drop `.font-display`; it inherits the Inter body face and gains weight 600 in live-signal-popover.css so the popover head still leads. No uppercase (an uppercase "SYSTEM NORMAL" reads like an alarm; this surface is calm).                                                                                                                                                                                                                                                            |

After this, zero authed-shell consumers reference the legacy token.

### 3.3 Money-surface scale rows (sizes preserved, voice applied)

The type-voice precedent holds: keep each surface's tuned px sizes, apply the spec's weight/tracking voice, tune at the live gate. The spec's literal px values were tuned for the mockup's layout, not these shipped surfaces.

- `.inbox-pagehead h1`: weight 500 to 700, tracking -.022em to -.025em. Sizes stay 36/44, opsz stays 48. Fraunces is a variable font: if 700 reads too dark at 44px on the live shot, settle at 650 and record it.
- `.ds-summary` (sheet proposal, approval + shared sheet styles): weight 500 to 600, tracking -.014em to -.018em. Sizes stay 26/28, opsz stays 36. This is the commit moment's headline; the weight step is the spec's emphasis hierarchy landing on the most finished surface.
- `.hello` (Home greeting): Inter 14/500 becomes `var(--font-display-app)` 18/500/-.01em, opsz pinned 24 (the house pattern pins opsz at or above px size for display character at text sizes). One short line; no wrap risk at 390px (verified live).

### 3.4 Value numerics: display face for the hero value moments, gated on a tabular-figures proof

The spec row is `[display, tabular]`. Fraunces digits replace mono ONLY where all three hold:

1. **The tnum gate:** a live render proves `font-variant-numeric: tabular-nums` actually aligns Fraunces digit columns (the variable font ships the feature; the proof is a rendered digit-column screenshot, not a spec sheet). If Fraunces tabular figures do not hold, mono stays everywhere and this row is recorded as unbuildable-as-written.
2. **It is a hero value moment:** `.heroRevenueNum` (40px, 56px desktop), `.heroStatNum` (28px, 36px desktop), `.worthItNum` (28px, 36px desktop) adopt `var(--font-display-app)`, keeping current sizes, weight 600, tabular-nums, tracking -.02em. opsz pins follow the at-or-above-px house rule responsively: revenue 48 mobile and 64 desktop (56px would outgrow a flat 48); the 28/36px pair pin 36 flat. Side effect worth naming: these three declare weight 600 on a mono loaded at 400/500 today (section 1's synthetic-bold finding), so the re-face also ends their faux-bold; if the tnum gate fails and they stay mono, the 600 cut loaded in 3.5 fixes them there instead. Either path ends synthesized weight on the hero numbers.
3. **Dense and small numerics keep the mono instrument face:** `.heroAdSpendNum` (18px, muted), `.delta` badges, campaign-table numerics, eyebrow counts. Mono remains the precision register for dense data; the display face is for the few numbers that ARE the page's statement. This is the serene-money-screen line: re-facing tables would trade alignment-critical legibility for warmth.

Taste gate at the live screenshot step: if Fraunces money values read less trustworthy than mono on the real Results page (subjective, before/after side by side), revert the face, keep mono, and record the verdict in the PR and a spec addendum. Default is ADOPT when the tnum gate passes.

### 3.5 Meta/label row: honesty over weight bumps

Implementation-reality check, verified: every in-scope meta/label is MONO at 10.5-11px, weight 500 or inherited regular (home `.eyebrow`, `.inbox-pagehead-count` which declares no weight, `.ds-eyebrow`, and all eleven Results label classes). The one sans label utility, `.section-label`, belongs to legacy registers only (section 1), so bumping it would break the zero-pixel-outside-scope bar. The spec row therefore lands as mono-register honesty, not weight changes:

- **Mono micro-labels keep weight 500 by design.** The tracked-uppercase-mono label at 500 is already the precise register; their tracking already sits inside the spec band (.08 to .1em). Documented as the register rule: the [body] 600 in the spec's meta row applies to sans labels, and the authed app's meta voice is mono.
- **`.section-label` stays untouched** (legacy-register utility; recorded so nobody "fixes" it into the authed scale later without re-checking its consumers).
- **Load the real JetBrains Mono 600 cut** (layout.tsx `weight: ["400", "500", "600"]`): the twelve existing `font-weight: 600` mono declarations (section 1) stop synthesizing and render the true SemiBold cut. Zero CSS churn; every Results money number gets honestly-drawn weight. Real 600 is typically lighter and cleaner than synthetic bold: the live before/after on Results and the week-note signature records the delta.
- **Repoint the inbox-local `--mono`** to `var(--font-mono-editorial), "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace`: inbox meta joins the actually-loaded JetBrains (today it silently renders system mono). Subtle in-scope pixel change on inbox eyebrows/counts, screenshot-verified.
- The live-signal status-label is handled in 3.2 (sans 600, no uppercase).

### 3.6 Voice hygiene on touched surfaces (bounded)

- `approval-detail-sheet.tsx`: fix the four em-dash copy strings (ConfirmInline head at :55, note placeholder at :61, pending caption at :236, risk-missing line at :247) and ADD the file to the in-app voice corpus.
- The `.ds-datalines-bullet` no-data glyph stays, but its MARKUP must collapse to a single line. Verified mechanics: the corpus exemption (`isEmDashViolation`) allows a span whose text is EXACTLY the lone glyph; the bullet currently renders as a multi-line JSX text node (whitespace around the glyph), which is not an exact match and would red the guard the moment the file joins the corpus. The fix is markup-only (`>` glyph `<` on one line); the exemption itself is NOT widened (never weaken a guard to admit a consumer).
- The #821 overlap, stated precisely: #821 deletes the entire `.ds-pending` section, so the pending-caption fix produces a modify/delete conflict if #821 ever merges. Resolution is always "take the deletion"; the caption fix is ephemeral by design and exists only so the file is em-dash-free TODAY, which corpus membership requires. The other three fixes are outside the deleted block and survive.
- `help-overlay.tsx` (only if 3.2's conditional lands): fix its one copy em-dash (:77), add to the corpus.
- No other copy changes.

## 4. Drift guards (new TY3 block in token-governance.test.ts; TY2 untouched except the honesty chain)

1. `--font-display-app` aliases `var(--font-fraunces)` in globals.css.
2. `--font-home-serif` and the inbox `--serif` alias `var(--font-display-app)` (the TY2 honesty test updates from direct-Fraunces to the chain; it still proves Fraunces transitively).
3. The legacy display token is banned from governed authed TSX by SWEEP, with an explicit legacy allowlist (`app/login/`, `app/forgot-password/`, `app/reset-password/`, `components/onboarding/`; Mercury and landing are already register-exempt). A sweep beats the first draft's migrated-file list because the list only protects today's four files: a future authed component reaching for `.font-display` would drift past it unguarded. The allowlist is the explicit, reviewable statement of which registers may still hold the legacy token, and shrinks as they retire.
4. If 3.4 lands: the results numeric classes that adopt the display face keep `font-variant-numeric: tabular-nums` (per-class regex on results.module.css).
5. Mono honesty, two assertions: the inbox `--mono` aliases `var(--font-mono-editorial)`; and every `font-weight` declared inside a `var(--mono)` CSS block across governed sources is a weight the layout.tsx JetBrains loader actually loads (parse both sides, compare sets). The second is the structural form of the synthetic-bold finding: it bites any future declaration of an unloaded mono weight.
6. tokens.test.ts: the `--font-home-serif: var(--font-fraunces)` assertion updates to the chain; `--font-display-app` joins the declared-stacks test.
7. Corpus additions per 3.6 ride the existing in-app-voice AST guard.

`TYPE_VOICE_EXEMPT` (registers) and `BUILTIN_RESIDUALS` (shadows) are separate lists and stay separate. Every new guard is proven to bite (red first against a deliberate violation, then green).

arch-check note, verified: `scripts/arch-check.ts` excludes `*.test.ts` from the 600-line error, so extending token-governance.test.ts (638 lines today) is safe.

## 5. What changes visually (screenshot matrix, 390px and 1280px)

| Surface                                                 | What to verify                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inbox pagehead + cards                                  | h1 at 700/-.025 (or recorded 650); meta rows now real JetBrains (was system mono); cards otherwise UNCHANGED                                     |
| Approval sheet, real HIGH-RISK item                     | `.ds-summary` at 600/-.018; eyebrows real JetBrains; head line unchanged; risk chips unchanged                                                   |
| Handoff sheet                                           | regression only (shares `.ds-head`/`.ds-eyebrow`; no own summary)                                                                                |
| Results                                                 | hero numerics face (if 3.4 lands) + digit alignment; all mono 600s render the real SemiBold cut (synthetic-bold fix); labels otherwise unchanged |
| Home + week-note                                        | greeting at Fraunces 18/500; verdict/eyebrow regression; week-note signature name at real 600; FOUT line-count re-run                            |
| Inbox drawer open                                       | SheetTitle in Fraunces 22/600                                                                                                                    |
| Live-signal popover open                                | status-label sans 600, popover otherwise unchanged                                                                                               |
| Help overlay                                            | conditional decision evidence (usable card or pre-existing gap)                                                                                  |
| Settings/identity                                       | h1 in Fraunces 600 at tuned sizes                                                                                                                |
| Login + one onboarding step + Mercury reports + landing | NEGATIVE checks: pixel-identical (legacy token untouched)                                                                                        |

## 6. AA and FOUT verification

- Token gates stay green AND live pixel-sampling on real grounds (the standing rule: gates are necessary, not sufficient), with the CORRECT tier per target, stated in the committed report: inbox h1 (36-44/700: large, 3:1), `.ds-summary` (26/600: large by size at 24px+, 3:1), `.hello` (18/500: normal, 4.5:1), live-signal status-label (15.2/600: normal, 4.5:1), inbox meta on real JetBrains (10.5/500: 4.5:1), drawer/help titles (22/600: weight 600 is not WCAG bold and 22px is under the 24px line, so the conservative 4.5:1 floor applies), identity h1 (48-60: 3:1), numerics (28-56: 3:1). Weight and face changes do not move color ratios, but the probe proves the REAL ground under each changed element (gradient/grain lessons).
- If a pre-existing element fails its floor without my change having moved its color, record it as pre-existing; do not chase it in this slice.
- FOUT: the greeting joins the display-face set and two surfaces change weight (h1, summary). Re-run the line-count check (fonts blocked vs loaded) on Home, the inbox pagehead, and an open approval sheet; the fallback renders at the new weights, so wrap behavior is the thing to prove, not metric identity.

## 7. Testing

- Flipped: tokens.test.ts (chain), the TY2 honesty test (chain), and any structural test asserting `.font-display` on migrated components.
- New: TY3 guard block (section 4), corpus additions (approval sheet, conditionally help overlay).
- jsdom is css:false: structural contracts only; glyph/metric/contrast claims are proven live.
- Full dashboard suite + `pnpm --filter @switchboard/dashboard build` + typecheck green before PR.

## 8. Risks

- Fraunces 700 at 44px may overweight the inbox h1: variable wght allows 650; the live gate decides, the spec records.
- Fraunces tabular figures may not hold: gated before any numeric re-face; mono is the honest fallback.
- Real JetBrains 600 renders lighter than today's synthetic bold: intended (honest weight), but the Results before/after must confirm the numbers still lead the page. If they thin out badly, 600 to 700 is a one-line follow (the 700 cut would then also be loaded; same guard covers it).
- Inbox meta flips system mono to JetBrains at 10.5px: subtle width/feel shift on eyebrows and counts, screenshot-verified.
- Greeting 14 to 18px pushes the verdict down ~6px on Home: acceptable, verified against the fold at 390px.
- Parallel sessions move main under this slice (Riley/Mira/api): re-verify the touched files against main at execution start; inbox.css is the hottest shared file.
- The #821 one-line conflict (3.6): accepted, documented here.

## 8.1 Execution addenda (recorded outcomes, 2026-06-04 impl PR)

1. **Tabular-figures gate (3.4): FAIL.** Live digit-column measurement on the running app (ten 1s 173.98px vs ten 0s 256.13px at 40px, identical under `font-variant-numeric` and raw `font-feature-settings "tnum"`): the served Fraunces has no functioning tabular figures. The numerics re-face did not land; the mono value family renders the real SemiBold cut instead (3.5). Full numbers in the evidence README.
2. **Help overlay (3.2): structurally broken live** (no stylesheet exists; renders in-flow, unstyled). The class strip, copy fix, and corpus membership landed; the display-voice rule waits for the overlay's own styling pass.
3. **Inbox h1 weight: 700 stands** at 36/44px on the live shots; the 650 fallback was not needed.
4. **Mercury mono weight fidelity (3.5 side effect, found in review, accepted):** reports.module.css declares mono 600/700 in 27 blocks, and Mercury's `--font-mono-mercury` aliases the same JetBrains primitive, so the real 600 cut changes /reports rendering from synthesized bold to the declared cut (measured 0.459% pixel delta, direction = closer to declared intent; the 700s now synthesize from a 600 base). Accepted as weight fidelity for declarations Mercury itself makes, not register drift; recorded in the evidence README with the measured numbers.
5. **Lone-glyph bullet mechanics changed in flight:** prettier re-expands single-line JSX text on commit, so the bullet became a string-literal expression (`{"`&#8212;`"}`): the corpus scanner sees the exact glyph regardless of formatting, and the exemption itself is untouched.

## 9. Follow-ups this slice creates

1. Geist body face (inherited, still the biggest blast radius).
2. `--font-display` retirement: when Mercury/landing/onboarding re-register, collapse the legacy token and rename `--font-display-app` to `--font-display` (the locked section 4 literal).
3. Help overlay real styling pass (if the conditional records it broken).
4. If the numerics taste gate rejects: revisit value numerics with the body-face slice (Geist Mono is the locked spec's mono).
