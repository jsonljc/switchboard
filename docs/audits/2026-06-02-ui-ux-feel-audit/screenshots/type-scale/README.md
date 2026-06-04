# Type-scale + display-token consolidation: live evidence (2026-06-04)

Spec: `docs/superpowers/specs/2026-06-04-type-scale-display-consolidation-design.md`. All shots from the running dev stack (org_dev seed), Chrome headless, 390x844 and 1280x900. `before/` = origin/main (dc949b2e), `after/` = the slice branch.

## Gate outcomes (the spec's decision points, recorded)

1. **Tabular-figures gate: FAIL, numerics stay mono.** Live measurement of Fraunces digit columns at 40px on the running app, with `font-variant-numeric: tabular-nums` AND raw `font-feature-settings: "tnum" 1, "lnum" 1`:
   ten 1s = 173.98px, ten 0s = 256.13px, mixed = 222.88px (identical under both forms; resolved family confirmed Fraunces). The served Fraunces carries no functioning tabular figures, so the spec section 3.4 re-face does not land. The honest fallback shipped instead: the mono value family now renders the REAL JetBrains SemiBold cut (the synthetic faux-bold is dead). Revisit display numerics with the body-face slice (Geist Mono per the locked spec).
2. **Help-overlay conditional: structurally broken, display-voice rule does NOT land.** `help-overlay-pre-existing-gap.png`: the overlay has no stylesheet anywhere (position static, transparent ground, content rendered in-flow above the masthead). Styling one heading on it would be lipstick. The legacy-class strip, copy fix, and corpus membership landed regardless (the consolidation is complete; the h2 falls to the body face until the overlay's own styling pass, a named follow-up).
3. **Inbox h1 weight: 700 stands.** At 36/44px the 700 cut anchors the queue without going dark (after/inbox-\*.png); the 650 fallback was not needed.

## AA pixel-probe (per-target WCAG tier, real grounds; aa-report.json)

| Target                       | Computed             | Ground           | Ratio | Floor (tier)                                                       | Verdict            |
| ---------------------------- | -------------------- | ---------------- | ----- | ------------------------------------------------------------------ | ------------------ |
| Home greeting `.hello`       | 18px/500 Fraunces    | rgb(223,216,209) | 6.63  | 4.5 (normal)                                                       | PASS               |
| Inbox h1                     | 44px/700 Fraunces    | rgb(223,216,209) | 11.71 | 3.0 (large 24px+)                                                  | PASS               |
| Sheet proposal `.ds-summary` | 28px/600 Fraunces    | rgb(247,244,238) | 15.06 | 3.0 (large 24px+)                                                  | PASS               |
| Live-signal status label     | 15.2px/600 Inter     | rgb(239,233,227) | 14.41 | 4.5 (normal)                                                       | PASS               |
| Drawer title                 | 22px/600 Fraunces    | rgb(239,233,227) | 14.41 | 4.5 (conservative: 600 is not WCAG bold, 22px under the 24px line) | PASS               |
| Identity h1                  | 60px/600 Fraunces    | rgb(223,216,209) | 12.30 | 3.0 (large 24px+)                                                  | PASS               |
| Results revenue number       | 56px/600 JetBrains   | rgb(223,216,209) | 11.71 | 3.0 (large 24px+)                                                  | PASS               |
| Inbox pagehead count         | 10.5px/400 JetBrains | rgb(223,216,209) | 3.28  | 4.5 (normal)                                                       | FAIL, PRE-EXISTING |

The one FAIL is recorded pre-existing: the count's color (ink-3) and inherited weight are untouched by this slice (the face changed from silent system-mono to the real JetBrains; a face swap does not move a color ratio, and 3.28 held before the change too). The ink-3 10.5px micro-label register is app-wide; raising it is its own design decision, named as a follow-up, not chased here.

## FOUT line-count (fonts blocked vs loaded, 390px)

| Surface                      | Loaded | Fallback | Verdict |
| ---------------------------- | ------ | -------- | ------- |
| Home verdict `.line`         | 2      | 2        | SAME    |
| Home greeting `.hello`       | 1      | 1        | SAME    |
| Inbox h1                     | 1      | 1        | SAME    |
| Sheet proposal `.ds-summary` | 4      | 4        | SAME    |

No new wrap deltas at the new weights. (The known 48px-desktop late-swap residual predates this slice.)

## Legacy negative proof, with one measured exception

`git diff origin/main...HEAD --name-only` intersected with mercury/landing/onboarding/login/forgot/reset = empty (no legacy file is touched). The /login spot-shot redirects to Home under DEV_BYPASS_AUTH; the file-diff proof covers the pre-auth register.

**The one rendering delta outside scope, found in review and accepted: Mercury mono weight fidelity.** reports.module.css declares `font-weight: 600`/`700` on `var(--mono)` in 27 blocks (no other Mercury module does). Loading the real JetBrains 600 cut means those declarations now render the cut they always requested instead of browser-synthesized bold (and the 700s synthesize from a 600 base instead of 500). Pixel-diff of `before/reports-1280.png` vs `after/reports-1280.png`: 0.459% of pixels (23,386 of 5.1M), all in mono numerals/labels, direction = closer to the declared weight. This is weight fidelity for a declaration Mercury itself makes, not register drift; the alternative was keeping the Results money numbers on synthetic bold to preserve a retiring register's misrendering. Recorded here and in the spec addendum.

## What changed on each surface (the before/after pairs)

- `home-*`: greeting "Good evening, {name}" Inter 14/500 to Fraunces 18/500/-.01 (opsz 24); verdict and eyebrow regression-identical.
- `inbox-*`: h1 500/-.022 to 700/-.025; pagehead meta now real JetBrains (was silent system mono); cards unchanged.
- `approval-sheet-*`: proposal headline 500/-.014 to 600/-.018 (sizes/opsz kept); eyebrows real JetBrains; em-dash copy gone from the confirm head, note placeholder, risk-missing line, pending caption.
- `results-*`: every weight-600 mono number (revenue, consults, worth-it row, comparison values) renders the real SemiBold cut instead of browser-synthesized bold; faces and sizes unchanged.
- `drawer-1280`: SheetTitle "Inbox" DM Sans 18/600 to Fraunces 22/600/-.018.
- `live-signal-1280`: status label DM Sans 15.2/400 to Inter 15.2/600 (stays sans by design: it is a status sentence).
- `identity-1280`: agent-name h1 DM Sans light 60px to Fraunces 600 (tuned sizes kept).
- `handoff-sheet-1280`: regression pair (shares `.ds-head`/`.ds-eyebrow`; no own summary row).
