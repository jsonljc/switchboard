# Type body: Geist as the authed app's body face (TY4, design)

**Status:** Approved 2026-06-05 (autonomous session, operator delegated design approval; check-in #1 happens with the docs PR open).
**Parent direction:** the locked app aesthetic (PR #845 branch, `docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`), section 4 TYPE: `--font-body: "Geist"`, card body 14.5/450/-.006em, button 14/600/-.01em.
**Predecessors:** the type-voice slice (TY2, `2026-06-04-type-voice-fraunces-design.md`, #875/#881) and the type-scale slice (TY3, `2026-06-04-type-scale-display-consolidation-design.md`, #888/#893). This slice is their inherited follow-up 1: the body face, "the biggest blast radius" both specs deferred.
**Scope:** the authed product app register (Home, Inbox, approval/handoff sheets, Results, agent panel, settings, /mira, authed shell chrome, and every portal those surfaces spawn). Mercury (`(mercury)` route group), the `(public)` marketing pages (/welcome, /privacy, /terms), login/forgot-password/reset-password, onboarding, and /operator are OUT: own registers, zero pixel change there is the bar.

**Route register inventory (the explicit map; `/` is always the authed Home, never the landing, which lives at /welcome):**

| Register           | Routes                                                                 | Body face | Mechanism                                 |
| ------------------ | ---------------------------------------------------------------------- | --------- | ----------------------------------------- |
| Authed app (Geist) | `/`, /inbox, /results, /mira, /settings/\*, /alex + /riley (redirects) | Geist     | shell renders `.app-header`; rule matches |
| Mercury (excluded) | /reports, /activity, /contacts, /automations                           | Inter     | marker in `(mercury)/layout.tsx`          |
| Chrome-free authed | /onboarding/_, /operator/_                                             | Inter     | no `.app-header` rendered                 |
| Pre-auth top-level | /login, /forgot-password, /reset-password, /post-auth                  | Inter     | outside `(auth)`, no shell                |
| Public marketing   | /welcome, /privacy, /terms                                             | Inter     | `(public)` group, no shell                |

## 1. Problem (verified against main at `3dc12252`)

The locked direction names Geist as the [body] face. None of that is built, and the current body face is bound in a way that makes a naive swap a register violation by construction:

- `layout.tsx:96` puts `inter.className` DIRECTLY on `<body>`, and `inter.variable` binds `--font-sans` on `<html>`. Inter is therefore the body face of EVERY route: the authed app, but also login, landing, Mercury, onboarding, and /operator.
- The authed app's sans reading text largely INHERITS this body face. Verified inventory: 23 inbox classes declare a font-size with no font-family (`.ds-datalines li`, `.ds-lead-interest`, `.decision-contact-quiet`, `.ds-banner`, `.ds-action`, the toast pair, and others), Home has `.quietText`/`.permsline*`, settings is Tailwind-utility text inheriting body, and the /mira cockpit's sans text uses `fontFamily: "inherit"`. shadcn primitives (Button, inputs) inherit via the Tailwind preflight reset.
- A second sans is loaded for one corner of the register: Hanken Grotesk rides `--font-home-sans` (globals.css:276) into 32 declarations across exactly four app-register files (agent-panel.module.css 27, home.module.css `.btn`, swipe-decision-card.module.css 2, results.module.css 2). The locked direction has ONE body face.
- Radix portals (the approval sheet, inbox drawer, popovers, toasts: the commit moment itself) mount under `document.body`, OUTSIDE any shell wrapper element. Any scoping mechanism that hangs the face on a wrapper div misses the most important body-text surfaces in the app.
- The register boundary inside the DOM is real but subtle: `(mercury)`, `onboarding`, and `operator` all live inside the `(auth)` route group. Onboarding and /operator are chrome-free (AppShell renders no `.app-header` there). Mercury renders INSIDE the editorial shell, so "inside the shell" alone is not the register boundary.
- Mercury's own protection, verified per page root: `.reportsPage` pins an explicit Inter stack with its own size/leading; `.activityPage`, `.contactDetailPage`, and `.automationsPage` pin `font-family: var(--sans)` where `--sans` is a module-local Inter alias. Mercury content is therefore pinned against a body-face change, but Mercury-SPAWNED portals (date-range popovers, selects, drawers) inherit `body` and are not.
- Zero "Geist" references exist anywhere in `apps/dashboard/src` today, and Hanken is referenced only by the four app-register files plus loader/token/test sites. The TY3 lesson (shared font primitives leak across registers: the JetBrains 600 cut re-rendered Mercury) was audited up front: adding the Geist primitive can leak nowhere, and removing Hanken touches only app-register declarations.

## 2. Goals and non-goals

**Goals**

1. Geist becomes the authed app register's body face, self-hosted, loaded as a variable font (the 450 weight must be real, not synthetic).
2. The face arrives by inheritance at the register boundary, not by per-surface adoption: new authed surfaces get Geist by default, and portals are covered.
3. Zero pixel change outside the register is the intent bar; the PROOF is stated honestly (review finding, 2026-06-05): no typography-family change on any enumerated legacy route, proven by a computed-font census over every Mercury route (/reports, /activity, /contacts, /automations: the complete `(mercury)` group), the pre-auth pages, /onboarding, and the `(public)` landing at /welcome, plus pixel-identical static negatives where the page is static; static guards ban raw Hanken/Geist outside the token site. "Zero pixels anywhere" without route enumeration would be a claim the evidence cannot carry.
4. ONE body sans: Hanken retires; `--font-home-sans` consumers re-voice to Geist through the token, zero churn.
5. The locked section 4 [body] metric voice lands where it was designed to land: card reading text (450/-.006em) and the money action buttons (tracking -.01em), sizes preserved per the TY2/TY3 precedent.
6. Drift guards make the register boundary and the loader honesty structural (new TY4 block; TY2/TY3 guards extended, never weakened).

**Non-goals (named follow-ups)**

- Geist Mono (`--font-mono` row of the locked spec). JetBrains Mono just got its honest 600 cut (TY3); re-facing value numerics requires a rendered tabular-figures proof and is its own slice. Space Mono (`--font-mono` Tailwind token) also untouched.
- shadcn Button weight (500 today vs the spec's 600): the Button cva is a shared primitive consumed by Mercury, login, and onboarding; a weight bump there leaks across registers. Buttons inherit the FACE this slice; the weight convergence lands when Mercury retires or the primitive gets register-split.
- The help-overlay styling pass (recorded structurally broken in the TY3 evidence; needs its own design) and the app-wide ink-3 10.5px micro-label AA call (3.28:1 pre-existing, needs a register-level color decision): both stay named follow-ups. A body-face slice should not carry a color-system call.
- The five `var(--font-sans)` declarations in globals.css legacy editorial classes (`.win-foot`, `.win-undo`, `.see-all`, `.tile-ctx`, `.setup-link`): no live product renderer references these classes (verified; only test mocks share the strings). Dead weight, untouched, recorded here so nobody migrates them without checking renderers first.
- Mercury, landing, login, onboarding typography of any kind. Inter stays loaded: it IS the legacy registers' body face.

## 3. Design

### 3.1 Load Geist (primitive)

In `apps/dashboard/src/app/layout.tsx`:

```ts
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});
```

- Verified in the installed Next 16.2.6 `font-data.json`: Geist ships variable wght 100 to 900, style normal only, latin subset. `next/font/google` downloads at build time and serves from the deployment origin (self-hosting, the Fraunces pattern from TY2).
- NO `weight` array: omitting it loads the variable font, which is what makes weight 450 a real instance rather than a faux interpolation of static cuts. This is load-bearing and guarded (section 4).
- No `style` array needed: Geist has no italic to exclude. No `axes` needed: wght is the only axis and comes with the variable font.
- `geist.variable` joins the `<html>` className list. `inter.className` STAYS on `<body>`: it is the legacy registers' body face, and removing it would change the cascade for every out-of-scope register for zero user-visible gain.

### 3.2 The token and the register rule (the scoping mechanism)

globals.css gains the canonical body semantic next to its display sibling:

```css
--font-body-app: var(--font-geist), "Geist", ui-sans-serif, system-ui, sans-serif;
```

and ONE register rule, deliberately UNLAYERED:

```css
/* The authed app register's body face. UNLAYERED on purpose: next/font's
   inter.className on <body> is an unlayered (0,1,0) rule, and any @layer rule
   loses to it for font-family regardless of specificity. This selector is
   unlayered (0,2,1): it beats the Inter binding deterministically, order
   independent. body-level (not a shell wrapper) so Radix portals (sheets,
   drawers, popovers, toasts) inherit the register face. */
body:has(.app-header):not(:has([data-register="mercury"])) {
  font-family: var(--font-body-app);
}
```

Why this shape, pressure-tested:

- **`body:has(.app-header)`** is the established register hook on main: the cream canvas and the paper grain already ride exactly this selector (globals.css:546). `.app-header` has exactly two DOM producers, both register-correct: `editorial-auth-shell.tsx:29` (the shell) and `editorial-shell-boundary.tsx:24` (the shell's error fallback, which already inherits the cream the same way and now inherits the face: consistent). Chrome-free routes (onboarding, /operator), pre-auth pages, and landing never render it, so they keep Inter by construction.
- **body-level, not wrapper-level**: the shell has no single root element (header and app-body are siblings under providers), and portals escape any wrapper. The body element is the only node whose font-family reaches the approval sheet, the inbox drawer, popovers, and toasts. This is the difference between re-facing the app and re-facing the app except its commit moment.
- **The Mercury exclusion** rides a route-group-owned marker (3.3), not a pathname list in AppShell: route classification stays with the routing structure, and a future Mercury page is excluded automatically.

Rejected alternatives:

- **Wrapper-scoped `--font-body-app` + font-family at the authed shell wrapper:** misses every portal (the commit moment renders Inter while the page renders Geist), and the shell has no single wrapper element to begin with.
- **body className split (client effect toggling a body class by pathname):** the root layout is a server component that cannot read the pathname, so the class lands after hydration: a visible body-face flash on every cold load. Rejected on flash alone.
- **Per-surface adoption (explicit font-family in each app module):** wrong default (a new authed surface starts Inter and drifts), misses everything that inherits (settings is entirely Tailwind-utility text), and means dozens of files instead of one rule.

### 3.3 The Mercury marker (route-group-owned exclusion)

New file `apps/dashboard/src/app/(auth)/(mercury)/layout.tsx`:

```tsx
export default function MercuryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-register="mercury" hidden />
      {children}
    </>
  );
}
```

- A hidden SIBLING, not a wrapper: zero layout impact, no new ancestor for Mercury selectors, `:has()` matches hidden elements.
- Server-rendered: the marker is in the initial HTML, so the exclusion holds on first paint (no flash).
- Consequence, recorded deliberately: on Mercury routes the WHOLE body keeps Inter, including the shared shell chrome and any portal spawned there (the inbox drawer over /reports renders today's Inter pixels; the same drawer over /inbox renders Geist). This is the conservative reading of the zero-pixel bar: every Mercury ROUTE is pixel-identical end to end, which is also the strongest contract the negative screenshots can verify. Route-internal coherence beats cross-route chrome consistency for a retiring register.
- Mercury page content is additionally pinned by its own module roots (section 1), so protection is two-deep: the marker covers portals and any text outside the pinned roots.

### 3.4 Hanken retires (one body face)

- `--font-home-sans: var(--font-body-app);` (the zero-churn primitive-under-semantic keystone): all 32 declarations across agent-panel, home `.btn`, swipe-decision-card, and results re-face to Geist with no consumer edits. The raw "Hanken Grotesk" fallback head leaves the token.
- The `Hanken_Grotesk` loader and `hanken.variable` leave layout.tsx. Payload: minus four static Hanken cuts, plus one Geist variable file.
- Home's tuned sans moments and the agent panel re-voice: intended (the locked direction has ONE body face), and the re-voice is live-verified at the screenshot gate rather than assumed (Hanken is a warmer humanist grotesk; Geist is cooler and more neo-grotesk; the FOUT wrap gate and the before/after shots carry the proof).
- `--font-home-sans` survives as an alias (zero churn today); new code should reference `--font-body-app` directly. Recorded so the alias can collapse in a later cleanup.

### 3.5 Metric voice: card body and buttons (sizes preserved)

The TY2/TY3 precedent holds: keep each surface's tuned px sizes, land the spec's weight/tracking voice, tune at the live gate. Geist variable makes 450 a real weight (3.1).

**Card-body voice (450, -.006em)** lands on the enumerated card reading-text set, all verified as inheriting sans with tuned sizes that stay:

| Class                                  | File            | Today                        | Becomes      |
| -------------------------------------- | --------------- | ---------------------------- | ------------ |
| `.ds-datalines li`                     | inbox.css       | 14px, inherit 400, -.003em   | 450, -.006em |
| `.ds-lead-interest`, `.ds-lead-source` | inbox.css       | 13.5px, inherit 400          | 450, -.006em |
| `.ds-lead-contact`                     | inbox.css       | 13.5px, inherit 400          | 450, -.006em |
| `.ds-qual-line`                        | inbox.css       | 13px, inherit 400            | 450, -.006em |
| `.decision-contact-quiet`              | inbox.css       | 12.5px, inherit 400, -.003em | 450, -.006em |
| `.ds-contact-strip`                    | inbox.css       | 13.5px, inherit 400          | 450, -.006em |
| `.ds-turn-bubble`                      | inbox.css       | 14px, inherit 400, -.003em   | 450, -.006em |
| `.quietText`                           | home.module.css | 14px, inherit 400, -.003em   | 450, -.006em |

NOT in the set, deliberately: status/error/empty banners (`.ds-banner`, `.inbox-error-banner`, `.inbox-empty`: status voice, not card body), chips/tags/links/pills (own tuned weights), `.toast` (overlay status), `.ds-head-needs` (tuned 500), and ALL settings/shadcn Tailwind text (face by inheritance only; utility metrics are their own system).

**Button voice (tracking to -.01em)** lands on the money action buttons that already carry the spec's 14/600: `.ds-action` (inbox.css, -.005em today) and `.btn` (home.module.css, -.005em today). The swipe-card action button block (swipe-decision-card.module.css:239 area) is checked at implementation: if it declares the same 14/600/-.005 voice it joins, otherwise it is left tuned. `.toast-undo` (12.5px) and `.permslineLink` (12.5px) stay tuned: not 14px buttons.

**No register-wide weight or tracking default changes.** Body-level letter-spacing would inherit into mono and serif descendants that do not declare their own (retightening numerics and Fraunces prose); body-level 450 would re-weight every utility-classed paragraph. The face inherits; the voice is enumerated.

### 3.6 What re-faces for free (inheritance inventory, verified)

For the record and for the screenshot matrix: the body rule re-faces, with zero file edits, the inbox card + sheet sans text (23 classes), Home sans moments, ALL settings text, the /mira cockpit's `fontFamily: "inherit"` sans (consistent with the cockpit's app-token re-skin arc #776/#779; its inline raw `"JetBrains Mono"` mono strings are a pre-existing token lie OUTSIDE this slice, recorded as a known issue), shadcn primitives (buttons, inputs, selects, dialogs, toasts) on app routes, the shell header/nav/sidebar, and the editorial empty states (`.empty-state` etc.) where they render on app routes. Serif (`--font-display-app` chain) and mono (`--font-mono-editorial` chain) surfaces are UNTOUCHED: their families are declared, not inherited.

## 4. Drift guards (new TY4 block in token-governance.test.ts)

All proven to bite (red against a deliberate violation first), mirroring the TY2/TY3 mechanics:

1. **Loader honesty:** layout.tsx loads `Geist(` with `variable: "--font-geist"` and NO `weight:` array inside the Geist block (the variable font is what makes 450 real). Mirrors the Fraunces upright guard's block-slicing approach.
2. **Token honesty chain:** globals.css declares `--font-body-app: var(--font-geist)` and `--font-home-sans: var(--font-body-app)`.
3. **The register rule, both halves in one selector:** globals.css contains `body:has(.app-header)` with `:not(:has([data-register="mercury"]))` setting `font-family: var(--font-body-app)`. A rule without the exclusion or an exclusion without the rule both fail.
4. **Producer/consumer pairing, BOTH hooks** (the safety-gate-needs-producer lesson): `src/app/(auth)/(mercury)/layout.tsx` exists and renders `data-register="mercury"`, AND `editorial-auth-shell.tsx` renders `className="app-header"` (review finding, 2026-06-05: the register rule hangs on a class name; a shell refactor renaming `.app-header` would leave the rule inert while the guard that only checks globals.css stays green). The CSS side is inert without either producer; the guard fails if any side drifts. Register membership is architectural, not enumerated: a future authed route joins the register by rendering inside the shell, and a route that opts out of the shell (chrome-free) opts out of the face. That invariant is this slice's contract, recorded here.
5. **No raw family heads:** raw "Geist" is allowed at exactly ONE site, the canonical `--font-body-app` declaration in globals.css (the fallback head, the --font-display-app pattern); every other governed CSS file must ride `var(--font-body-app)`. "Hanken" appears nowhere in globals.css or layout.tsx once retired, and a repo-wide grep for hanken/Hanken at the gate confirms zero source references (comments included).
6. **tokens.test.ts:** the `--font-home-sans: var(--font-hanken)` assertion flips to the body-app chain; `--font-body-app` joins the declared-stacks test; the token-honesty not-match list gains `/Hanken/` alongside Instrument Sans and Newsreader.
7. TY2/TY3 blocks, `LEGACY_ALLOWED`, and `TYPE_VOICE_EXEMPT` are untouched. arch-check excludes `*.test.ts`, so extending token-governance.test.ts (~750 lines) stays safe.

## 5. What changes visually (screenshot matrix, 390px and 1280px)

| Surface                                                                                       | What to verify                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home                                                                                          | quietText voice, buttons (Hanken to Geist), greeting/verdict/week-note serif UNCHANGED, eyebrows mono unchanged                                                                                        |
| Inbox list                                                                                    | card sans text re-faced + 450 voice, serif titles unchanged, mono meta unchanged                                                                                                                       |
| Approval sheet (real HIGH-RISK item)                                                          | datalines/lead facts at 450/-.006em, `.ds-action` tracking, Fraunces summary unchanged: the commit moment in the new face                                                                              |
| Handoff sheet                                                                                 | shared `.ds-*` regression                                                                                                                                                                              |
| Results                                                                                       | sans moments re-faced (incl. the 2 ex-Hanken declarations), mono value numerics UNCHANGED                                                                                                              |
| Agent panel open                                                                              | the 27 ex-Hanken declarations re-voiced to Geist                                                                                                                                                       |
| /mira desk                                                                                    | cockpit sans inherits Geist                                                                                                                                                                            |
| Settings (identity + one panel)                                                               | Tailwind text re-faced by inheritance, identity h1 Fraunces unchanged                                                                                                                                  |
| Inbox drawer + live-signal popover + toast (undo)                                             | PORTALS carry the register face: the load-bearing scoping proof                                                                                                                                        |
| /reports, /activity, /contacts, /automations                                                  | NEGATIVE: computed-font census identical + pixel review (marker + module pins; census beats pixel-diff on live-data routes)                                                                            |
| /login + /welcome + one onboarding step                                                       | NEGATIVE: census identical AND pixel-identical (static pages, no `.app-header`; the landing is /welcome in `(public)`, never `/`)                                                                      |
| Open-overlay census (approval sheet, handoff sheet, drawer, popover, undo toast, agent panel) | computed font-family INSIDE each portal resolves Geist on an app route: the portal-coverage proof as data, not just shots                                                                              |
| Enumerated TY4 selectors                                                                      | computed-style table: font-family resolves Geist, fontWeight 450/600 as specced, letter-spacing/font-size ratio within 0.0005em of -0.006/-0.01 (computed tracking returns px; normalize by font-size) |

## 6. AA and FOUT verification

- **FOUT line-count gate (the load-bearing check this slice):** a body swap rewraps every paragraph. Fonts-blocked vs fonts-loaded wrap counts at 390px (and 1280 spot checks) on: inbox cards + open approval sheet datalines (`.ds-datalines li`, `.ds-lead-interest`), the metric-edited buttons (`.ds-action`, home and swipe `.btn`), settings panel text, Home quietText, agent panel body (the Hanken-to-Geist fallback change), and week-note prose as the serif control (must not move). Probes cover the enumerated TY4 selectors, not just convenient ones (review finding, 2026-06-05). next/font's size-adjusted fallback does the work; the wrap-count table is the committed proof.
- **AA, two ways, correct tier per target:** face/weight changes do not move color ratios, but the standing rule is pixel-sampling real grounds: card-body 450 inks on the card surface (12.5 to 14px: 4.5:1 floor), `.ds-action` white-on-amber at 14/600 (4.5:1), home `.btn` (4.5:1), one settings text sample (4.5:1). 600 under 24px takes the conservative 4.5 floor (not WCAG bold large-text). Tier stated per target in the committed report; pre-existing failures (ink-3 micro-labels) recorded as pre-existing, not chased.
- Token gates stay green throughout (necessary, not sufficient).

## 7. Testing

- New: TY4 guard block (section 4), co-located test for the new (mercury)/layout.tsx (renders the marker + children).
- Flipped: tokens.test.ts font-stack assertions (4.6).
- jsdom is css:false: structural contracts only; every glyph/wrap/contrast claim is proven on the live render.
- Full dashboard suite + `pnpm --filter @switchboard/dashboard build` + typecheck green before PR; `pnpm format:check` as the last gate.

## 8. Risks

- **Geist renders wider/narrower than Inter at equal px:** wrap deltas on dense card text. The FOUT gate measures wrap counts both ways (blocked AND loaded); sizes are preserved so deltas should be line-level, not layout-level. If a surface breaks its layout at 390px, the surface keeps Inter-era metrics via a recorded size nudge and the spec gains an addendum.
- **450 reads too heavy/too light against Inter-400 memory:** the live before/after decides; the weight is one token edit per class to settle (Geist variable allows any value). Default is the spec's 450.
- **Hanken-to-Geist re-voice reads as a character loss on Home/agent-panel:** judged at the live gate with before/after pairs; if a surface genuinely loses its read, the recorded fallback is keeping `--font-home-sans` aliased to Geist anyway (one face) and re-tuning that surface's weight, not resurrecting Hanken.
- **`:has()` support:** already load-bearing on main for the canvas itself (cream + grain ride `body:has(.app-header)` since the grain slice); no new compatibility surface.
- **Mercury portals were Inter-on-body before and stay Inter (marker):** zero change. But a Mercury page rendered OUTSIDE `(mercury)` would dodge the marker; the guard pairs the rule with the route group, and no such page exists (verified).
- **Parallel sessions move main:** re-verify touched files (layout.tsx, globals.css, inbox.css, home.module.css, tokens tests, token-governance) at execution start; rebase before PR.

## 9. Follow-ups this slice creates

1. Geist Mono + the value-numerics row revisit (the locked spec's mono), gated on a rendered tabular-figures proof.
2. shadcn Button weight convergence (500 to 600) when the primitive can be register-split or Mercury retires.
3. `--font-home-sans` alias collapse into `--font-body-app` once no consumer needs the legacy name.
4. Help-overlay styling pass; ink-3 micro-label AA register call (both pre-existing, both recorded in TY3's evidence too).
5. The cockpit's inline raw `"JetBrains Mono"` strings (render system mono today): fold into the cockpit's own cleanup when it next gets touched.

## 10. Execution addenda (recorded outcomes, 2026-06-05 impl PR)

1. **The census caught two in-register gaps the design inventory missed, both fixed and guarded.** (a) `inbox-design-base.css` declared a THIRD local token lie: `--sans: "Hanken Grotesk", ...` (a raw family no loader registers), so its five approval-sheet consumers (reason chip, confirm/resolve notes, suggested-use, composer textarea) silently rendered system sans; it now aliases `--font-body-app`, completing the inbox honesty set begun by TY2 (`--serif`) and TY3 (`--mono`). The design-time grep missed it through case sensitivity. (b) `decision-card.css` pinned `var(--font-sans)` on `.pill`/`.why-link`/`.thread-link`/`.dc-undo`, re-Intering the Home needs-you card inside the register; repointed to the token, and a new TY4 sweep guard bans module-CSS `--font-sans` pins (red on those four before the fix).
2. **Swipe-card button conditional (3.5): JOINED.** It declares the same 14/600/-.005 voice; tracking aligned to -.01em alongside `.ds-action` and home `.btn`.
3. **The guard file split at the eslint cap.** token-governance.test.ts crossed max-lines (605/600, a gate arch-check does not mirror for tests) when the TY4 block landed: shared mechanics extracted to `token-governance.lib.ts`, the TY4 suite moved to `type-body-governance.test.ts`, zero assertion changes.
4. **FOUT gate: one residual, recorded.** Blocked-vs-loaded and before-vs-after wrap counts identical on every probed element except one settings paragraph (Inter and the size-adjusted fallback take 2 lines at 390px; loaded Geist takes 1). The TY2 line-count residual class, accepted.
5. **Amber action button measured sub-AA on its REAL fill, pre-existing.** Center-inset pixel sampling of the enabled `.ds-action-primary`: white on rgb(179,129,77) = 3.44:1 on the branch, 3.51:1 on main (identical condition; the gloss material lightens the rendered fill below the token amber's 4.51 token-level pass). Out of scope for a type slice; recorded as a backlog finding in the evidence README (the live-ground-vs-token lesson, third occurrence).
6. **/login is unreachable under DEV_BYPASS_AUTH** (redirects to Home), so its negative is structural (top-level route, no `.app-header`) plus the welcome/onboarding pixel proofs; the census row records the redirect honestly.
7. **Negative proof exceeded the spec's bar:** all twelve legacy-route pairs (four Mercury routes, /welcome, /onboarding at 390 and 1280) diff at exactly 0 px; census family sets AND counts byte-identical.
8. **The evidence run had to survive parallel-session port contention** (another session's dev servers on :3000/:3002/:3012, plus Next 16's per-project single-instance lock holding a stale claim): the dashboard ran on :3077 with ownership-verified restarts between refs. Recorded for the next slice's runbook.
9. **db package integration tests failed locally** (advisory-lock/ledger/greeting class, shared-DB environment): the diff contains zero non-dashboard files, so the package is byte-identical to main; CI (mocked Prisma) is the arbiter.
