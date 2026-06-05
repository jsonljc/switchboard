# Type voice: Fraunces display adoption and the no-italics sweep (design)

**Status:** Approved 2026-06-04 (autonomous session, operator delegated design approval).
**Parent direction:** the locked app aesthetic (PR #845 branch, `docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`), section 4 TYPE and section 8.
**Scope:** the authed product app (Home, Inbox, Results, agent panel, week-note, team poster). Marketing/landing, Mercury surfaces (`(mercury)` route group), onboarding, and pre-auth pages are OUT (own registers).

## 1. Problem (verified against main at `0198a3a2`)

The locked direction names Fraunces as the display face ("the load-bearing personality face", upright optical, no italics, self-hosted). None of that is built:

- `--font-display` (globals.css:115) names "Instrument Sans", which no `next/font` loader ever loads. It renders system sans, or Instrument Sans if the viewer happens to have it installed: a token lie flagged in the Wave-1 lessons.
- The authed app's real display voice is Newsreader via `--font-home-serif` (globals.css:277), consumed by the Home verdict, `.moduleH h2`, the week-note, the team poster names (deliberately riding the token as a stand-in per the hero-poster spec), the agent panel (aliases `--serif` to it), and Results.
- The Inbox carries a second token lie: `inbox-design-base.css:55` declares a local `--serif: "Newsreader", "Iowan Old Style", ...`, but `next/font` registers Newsreader only under its hashed family name. The inbox pagehead actually renders Iowan Old Style (macOS) or Georgia.
- The Home verdict, the single most important sentence in the app, violates two non-negotiables at once: the accent is italic (`home.module.css:104-115`) and the composed copy for 2+ decisions joins "N things need you" to "start with {name}" with an em-dash connector (`compose-verdict.ts:118`).
- The shared `.moduleH h2` heading is italic (`home.module.css:177`); the team band ships its own explicitly non-italic heading specifically to dodge it.
- 50 `font-style: italic` declarations remain across authed-app CSS (home 3, this-week 6, agent-panel 8, inbox 16, decisions 2, results 11, globals legacy editorial block 4), plus ~10 decorative `<em>` JSX sites that render browser-default italic.
- The shell fallback header carries its own copy em-dash, joining "Switchboard" to "temporarily unavailable" (`editorial-shell-boundary.tsx:26`). Fixed in this slice ("Switchboard is temporarily unavailable"), and the three shell copy surfaces (shell boundary, inbox drawer, live-signal popover) join the voice corpus alongside compose-verdict.
- Nothing guards any of this: `compose-verdict.ts` is not in the in-app voice corpus, and no drift guard bans italics.

## 2. Goals and non-goals

**Goals**

1. Fraunces becomes the authed app's display face, self-hosted, upright only.
2. Zero consumer churn: the face arrives by repointing existing tokens (the primitive-under-semantic keystone from Wave-1 token unification).
3. The verdict's em-dash and italics are gone, and structurally cannot return (voice corpus + drift guard).
4. No `font-style: italic` and no bare `<em>`/`<i>` anywhere in governed app sources.
5. Honest tokens: no font token names a family that is not loaded.

**Non-goals (named follow-ups, see section 8)**

- The body face (Geist). Display-only in this slice; the body swap has a much larger blast radius.
- Full application of the spec section 4 scale table (inbox title 30/700, sheet proposal 22/600, value numerics, greeting). Only weight/tracking on surfaces where the display face lands in this slice.
- `--font-display` consolidation. Its consumers are Mercury, landing, onboarding, and pre-auth pages: all out-of-scope registers.
- Mercury and landing typography of any kind.

## 3. Design

### 3.1 Load Fraunces (primitive)

In `apps/dashboard/src/app/layout.tsx`:

```ts
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal"], // upright only, locked direction
  axes: ["opsz"],    // optical sizing; variable wght comes with the variable font
  variable: "--font-fraunces",
  display: "swap",
});
```

- `next/font/google` downloads the font files at build time and serves them from the deployment's own origin (no runtime request to Google). This satisfies the spec's self-hosting requirement; no manual file hosting needed. Verified: Fraunces is present in Next 16.2.6's `font-data.json` with axes SOFT, WONK, opsz, wght.
- Per the existing layout.tsx comment pattern: a fixed `weight` array cannot be combined with `axes`, so the variable weight axis (100 to 900) covers every weight the scale needs.
- SOFT and WONK axes are not requested: they pin at their defaults (SOFT 0, WONK 0), which is the sharp, non-wonky cut appropriate for a calm app, and keeps the payload smaller.
- Italic styles are not loaded at all. A font-load failure falls back to a serif stack (below), so the character flattens gracefully rather than to system sans.
- `next/font`'s automatic fallback adjustment (`adjustFontFallback`, on by default) size-tunes the fallback to minimize layout shift; verified live at the screenshot gate (section 6).

### 3.2 Repoint the display tokens (semantic, zero churn)

1. `globals.css`: `--font-home-serif: var(--font-fraunces), "Fraunces", "Iowan Old Style", Georgia, serif;`
   Every current consumer upgrades for free: Home verdict, `.moduleH h2`, week-note, team poster names (the hero-poster spec explicitly deferred to this decision), agent-panel serif moments, Results serif prose and headings.
2. `inbox-design-base.css`: the local `--serif` gets the same Fraunces stack. The inbox pagehead and serif moments join the display voice, and the "Newsreader" lie dies.
3. `globals.css` `--font-display`: remove the never-loaded "Instrument Sans" head so the token honestly reads `ui-sans-serif, system-ui, sans-serif`. Zero rendered-pixel change for everyone without Instrument Sans installed locally, and it makes rendering deterministic for anyone who has it. The full "what should --font-display be" consolidation moves to the follow-up: its consumers (Mercury modules, landing nav/footer, onboarding shells, login/forgot/reset) are all out-of-scope registers.
4. `layout.tsx`: remove the Newsreader loader (orphaned once `--font-home-serif` repoints; no other `--font-newsreader` consumer exists). Hanken Grotesk, Inter, Source Serif 4, and the monos stay untouched.
5. `tokens.test.ts:69` (asserts `--font-home-serif: var(--font-newsreader)`) flips to assert the Fraunces wiring.

Alternatives considered and rejected:
- Flip `--font-display` to Fraunces globally (the spec section 4 end-state): restyles marketing, Mercury, onboarding, and pre-auth in one move; those registers are explicitly out of scope.
- Add a new `--font-display-app` semantic for authed shell headings (help overlay, inbox drawer title, settings identity): a real per-surface design change that belongs with the scale-table follow-up, not a token slice.

### 3.3 Fix the verdict (copy + style)

- `compose-verdict.ts`: the 2+ decisions ACTIVE shape becomes two sentences, mirroring the existing singular form ("One thing needs you. Alex has it ready."):
  `pre = "{Word} things need you. Start with "`, `em = name`, `post = "."`
  Rendered: "Three things need you. Start with Alex."
- `compose-verdict.ts` joins the in-app voice corpus (`in-app-voice.test.ts` CORPUS), whose AST scan bans em-dashes in copy spans forever.
- `home.module.css`: delete the dead `.line em, .lineEm` rule (no markup renders an `em` inside `.line`); strip `font-style: italic` from `.accent`. The accent keeps its agent-identity ink (inline `hsl(var(--agent-X))`) and gains weight 700 against the line's 600 (spec scale: verdict hero 600, the who at 700), so emphasis survives the italic removal stronger than before.
- Verdict line metrics align to the spec's ratios where the face lands: weight 500 to 600, letter-spacing to -0.02em. Current responsive px sizes (36/48, calm 40/56) stay; Fraunces is visually denser than Newsreader, so final size/opsz tuning happens at the live screenshot gate, not in the dark.
- `compose-verdict.test.ts` string assertions update with the copy.

### 3.4 The no-italics sweep

- Strip every `font-style: italic` from authed-app CSS: `home.module.css` (3), `this-week.module.css` (6: avatar letter, body em, drop cap, signoff, signoff mark, PS), `agent-panel.module.css` (8), `inbox.css` (15) + `inbox-design-base.css` (1), `swipe-decision-card.module.css` (1), `decision-card.css` (1), `results.module.css` (11), and the globals.css legacy editorial block (4: `.dc-resolved-line`, `.tile-ctx`, `.empty-state`, `.freshness-note`; `.empty-state` is live in the inbox drawer and shell boundary).
- Replacement principle: the quiet/emphasis hierarchy already exists in color (`--ink-2`/`--ink-3`), face, and weight on every one of these; italic is never the sole differentiator except the verdict accent (handled above by weight). Where the live pass shows a surface lost its read, bump weight by one step rather than reintroducing slant.
- Swap the ~10 decorative `<em>` JSX sites in governed components to `<span>` (or drop the wrapper where it carries no class): identity-status verdict accent, key-result, this-week skeleton, live-signal-popover (3), editorial-shell-boundary, inbox-drawer (2 to 3). These are decorative italics, not genuine stress emphasis; the a11y semantics loss is nil.
- The `.moduleH h2` shared heading: upright, weight 600, letter-spacing -0.018em (spec's 22px display row), keeps its lowercase identity. The team band's defensive non-italic heading comment can then state the register rule instead of dodging it.
- Mercury (`(mercury)` route group) and landing keep their italics: own registers, out of scope.

### 3.5 Drift guards (extend `token-governance.test.ts`)

New describe block "type voice (TY2)":

1. **No italics in governed CSS:** sweep `collectGovernedFiles()` CSS for `/font-style:\s*italic/`, excluding `(mercury)` and `components/landing/` paths (mirroring the EL1 grandfather pattern). Zero allowlist: the sweep lands at zero in this slice.
2. **No `<em>`/`<i>` in governed TSX:** regex `/<(em|i)[\s>]/` over governed TSX, same exclusions. (CSS can't make a future bare `<em>` upright without a global reset that portals escape, so the guard bans the element instead.)
3. **Token honesty:** `--font-home-serif` must alias `var(--font-fraunces)`; globals.css must not mention "Instrument Sans" or "Newsreader"; `layout.tsx` must load Fraunces with `style: ["normal"]` only.
4. **Voice corpus:** `components/home/compose-verdict.ts`, `components/layout/editorial-shell-boundary.tsx`, `components/layout/inbox-drawer.tsx`, and `components/layout/live-signal-popover.tsx` added to CORPUS (this rides the existing in-app-voice AST guard rather than a new mechanism).

## 4. What this slice does NOT change visually

- Body text, buttons, labels, monos: untouched faces.
- Mercury reports/activity/contacts, landing, login, onboarding: untouched.
- All px font sizes stay as-is unless the live pass demands an opsz/size nudge on a display surface (recorded in the PR if so).

## 5. Surfaces that change rendered glyphs (screenshot matrix)

Every `--font-home-serif` and inbox `--serif` consumer changes face (Newsreader/Iowan to Fraunces) and loses italics:

| Surface | What to verify |
|---|---|
| Home verdict (ACTIVE + CALM) | new copy, upright accent in agent ink at 700, no clipping at 36/48px, no FOUT shift |
| Team poster names | Fraunces upright at 17px, AA on the poster wash (re-run the pixel-sampling probe) |
| Week-note (headline, body, drop cap, signoff, PS) | upright editorial still reads as a letter |
| `.moduleH h2` Home module headings | lowercase upright 600 |
| Inbox pagehead h1 + serif moments | Fraunces upright (was Iowan italic) |
| Agent panel (verdict text, key-result, work-log serifs) | upright, emphasis survives |
| Results serif prose + headings | upright Fraunces |
| Approval/handoff sheets, masthead | unchanged faces confirmed (negative check) |

Mobile (390px) and desktop (1280px+), before/after committed under `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-voice/`.

## 6. AA and FOUT verification

- AA proven two ways per the standing rule: the token-gate contrast assertions stay green, AND live pixel-sampling of rendered labels on real grounds (poster names on the grain wash are the known risk; the coral deep has the least headroom).
- FOUT/CLS: capture the verdict with fonts blocked (fallback serif) vs loaded; assert no layout jump that moves the needs-you stack. `next/font` fallback adjustment plus `display: swap` is the mechanism; the screenshot is the proof.

## 7. Testing

- Flipped: `tokens.test.ts` (Fraunces wiring), `compose-verdict.test.ts` (new copy strings).
- New: the TY2 drift-guard block (italics CSS sweep, em/i TSX sweep, token honesty), compose-verdict in the voice corpus.
- Existing suites must stay green: verdict tests, team-band tests, in-app-voice guard, token governance (grain, shadows, contrast).
- jsdom is css:false: structural contracts only; all glyph/contrast claims are proven live.

## 8. Named follow-ups (not this slice)

1. Body face: Geist for `--font-body` and the app sans consolidation.
2. Scale table application: inbox title 30/700, sheet proposal 22/600, value numerics 26/600 tabular, greeting 18/500, meta/label tracking.
3. `--font-display` consolidation across shell headings (help overlay, inbox drawer, settings identity) and the marketing/Mercury register split.
4. Mercury italic retirement happens when Mercury retires (harvest-and-fold decision pending).

## 9. Risks

- Fraunces is denser and higher-contrast than Newsreader at display sizes: mitigated by the live screenshot gate with per-surface opsz/size tuning allowed.
- Variable-font payload: one family, latin subset, normal style only; Newsreader is removed in the same slice, so net font payload should not grow materially.
- The em/i guard could annoy future genuine emphasis: acceptable, the register bans italics; bold or ink emphasis are the sanctioned tools.
