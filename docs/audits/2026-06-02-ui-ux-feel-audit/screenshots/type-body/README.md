# TY4 body face (Geist): live evidence

Spec: `docs/superpowers/specs/2026-06-05-type-body-geist-design.md`. Captured 2026-06-05 on the dev stack (dashboard :3077 from the slice worktree, API :3000 shared, Postgres shared). BEFORE = origin/main `85f5ac12`; AFTER = `feat/ty4-body-geist` rebased onto the same commit, so the pair differs by exactly this slice. Both states served by a freshly restarted dev server (`.next` removed between checkouts; no hot-reload trust for a root-layout font change).

## Verdicts

1. **The register face landed.** Computed-font census, exact 1:1 conversion: Home 27 Inter + 2 Hanken to 29 Geist; Inbox 16 to 16; Results 14 + 4 to 18; /mira 36 to 36; settings 96 to 96. Serif (Fraunces) and mono (JetBrains) counts identical before/after on every route: the display and instrument families never moved.
2. **Zero pixels outside the register.** All twelve negative pairs (reports, activity, contacts, automations, welcome, onboarding at 390 and 1280) diffed at exactly 0 px (pixelmatch threshold .1). The full measurement log (committed artifacts are the representative 1280 after-set; the before-sets and 390 widths were measured live and logged here verbatim):

```
neg-reports-390 0 px 0.000%      neg-reports-1280 0 px 0.000%
neg-activity-390 0 px 0.000%     neg-activity-1280 0 px 0.000%
neg-contacts-390 0 px 0.000%     neg-contacts-1280 0 px 0.000%
neg-automations-390 0 px 0.000%  neg-automations-1280 0 px 0.000%
neg-welcome-390 0 px 0.000%      neg-welcome-1280 0 px 0.000%
neg-onboarding-390 0 px 0.000%   neg-onboarding-1280 0 px 0.000%
```

Census family sets AND counts byte-identical on every legacy route, including the pre-existing stray `ui-sans-serif: 1` on activity. 3. **Portals carry the face** (the scoping mechanism's load-bearing claim): approval sheet datalines Geist 450/-.006em, inbox drawer Geist ("3 pending across your team."), live-signal popover Geist, agent panel Geist 6 + Fraunces 2. All portal-mounted, all inside the body-level rule. 4. **Enumerated metrics exact** (computed-style table): every card-body class at weight 450 with letter-spacing -0.006em; `.ds-action`, home `.btn` at 600/-0.01em; `.ds-summary` serif control untouched at Fraunces 600/28px/-0.018em (TY3 metrics intact). 5. **FOUT line-count gate: clean.** Fonts-blocked vs loaded at 390px: identical wrap counts on every probed element except ONE settings paragraph (2 lines fallback vs 1 loaded). Before vs after: the same single delta (Inter took 2 lines, Geist takes 1; an improving line-level wrap, no layout break). The TY2 "FOUT residual = line-count" class, one paragraph, recorded. 6. **AA on real grounds** (4.5:1 floors, normal-text tier): `.decision-contact-quiet` 9.12, `.ds-datalines li` 8.52, `.quietText` 12.56. The amber `.ds-action-primary` measured 3.44 (branch) vs 3.51 (main): PRE-EXISTING, identical either side; the gloss material lightens the real fill below the token amber's 4.51 token-level pass. Recorded for the backlog (the live-ground-vs-token lesson again), not chased in a type slice.

## Files

- `before/` and `after/`: the matrix at 390 + 1280 (home, weeknote scroll, inbox, sheet, results, mira, settings-identity) plus after-only overlay captures (sheet-datalines, drawer, popover, agent-panel).
- `negative/`: the six legacy routes at 1280 (after state; pixelmatch proved 0 px vs before at both widths).
- `fontmap-before.json` / `fontmap-after.json`: the census (visible text nodes per computed family head, per labeled route).
- `computed-style-table.json`: enumerated TY4 selectors + overlay probes (family/weight/size/letter-spacing-em).
- `fout-before-loaded.json` / `fout-after-loaded.json` / `fout-after-blocked.json`: wrap counts.
- `aa-report.json`: pixel-sampled contrast with per-target tier and the amber pre-existing verdict.

## Recorded limitations

- `/login` redirects to Home under DEV_BYPASS_AUTH (census row `preauth-login` equals `home-authed` by redirect). The login negative is carried structurally (top-level route, no `.app-header`, rule cannot match) plus the welcome/onboarding pixel proofs.
- `.ds-confirm-note` renders only mid-approve (a mutating flow on the shared dev DB): not exercised live; its face is guard-asserted statically (`--sans` alias chain).
- Undo toast not exercised (mutating approve); the portal-face proof rides the four captured overlay classes, which share the same body-level mechanism.
- In `fout-after-blocked.json` the `fam` field reports the REQUESTED computed family (Geist), not the rendered fallback; getComputedStyle cannot name the fallback actually drawn. The wrap-line counts are the gate; the fam label in the blocked file proves nothing (adversarial review finding, recorded).
- The shell error-boundary fallback renders `.app-header` without the mercury marker, so a CRASHED Mercury route's fallback wears the app register face (and already wears the app cream today, which has no mercury exclusion). Deliberate: the crash screen is shell chrome, not Mercury content; "Mercury keeps Inter end to end" is a claim about Mercury CONTENT.
- The census counts visible text nodes' computed family: pseudo-element content, hover-only text, and unopened Mercury drawer states are covered by inheritance reasoning plus the 0px pixel diffs, not by census rows.
- The two Home `.pill` buttons ("Take this one"/"Snooze") and `.windowBtn`/`.recomputeBtn` (Results) keep their tuned 500 weights by design: face-only via token, outside the enumerated voice set.
