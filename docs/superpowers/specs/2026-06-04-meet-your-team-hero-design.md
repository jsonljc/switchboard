# Meet your team at hero scale: the team-band poster

**Status:** Design, 2026-06-04. Implements the "meet your team" emotional peak of the locked app aesthetic direction (`docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`, sections 4 AVATAR and GRAIN, 5, and 6), the last clause of the locked one-liner: "the calm of Linear, printed like a warm riso zine, starring a pixel crew you love."

**One line:** the Home team band becomes a printed poster: the crew at hero scale on their identity grounds, under the lighter poster grain, alive with honest status.

---

## 1. Why, and what already exists (verified against the live tree)

The calm (Quiet Modern tokens), the canvas grain (#863, `background-blend-mode` on the body), the one-amber Wave-1 tokens, the printed-portrait avatar frame, and all three sprites (including Mira's) are on main. The prior slice (`2026-06-03-meet-your-team-crew.md`, merged) put the crew onstage on Home: `TeamBand` renders three 88px `PrintedPortraitAvatar`s with names and honest live status.

What does not exist anywhere (verified by grep and by reading `team-band.tsx`, `home.module.css`, and `printed-portrait-avatar.module.css`):

- The poster treatment itself. Today each agent sits on a plain cream tile (`--canvas-2`, hairline, shadow). There is no identity-hue ground at tile scale, no display-face name, no role line, no hero frame geometry (the halo is 1px at every size; the spec calls for 2px at hero), and no poster grain. The locked mockup's "MEET YOUR TEAM" poster (`mockups/fused/index.html`, section E) is unbuilt.
- The spec's poster grain at the lighter opacity (section 4: "poster hero uses opacity .34"). The paper-grain slice explicitly scoped it out because no opaque gradient-grounded hero surface existed yet. This slice builds that surface, so the grain comes with it.
- Hero scale. The spec's size table separates "roster 46px" from "hero poster 104 to 112px"; the shipped band sits between them at a fixed 88px, constrained by 320px mobile fit.

What this slice reuses unchanged: the band's entire data flow (role-keyed `statusForAgent`, mission-derived `setUp`, the `useMiraEnabled` probe, the governance halt, the one-breathing-focal-agent budget) and its tap-to-open-panel contract including the `team-mate-{key}` test ids.

## 2. Where the hero lives (the surface decision)

**The Home team band is the hero surface.** It is the daily, permanent, live-status surface, and the prior merged spec already decided the crew stays permanently onstage there. This slice gives it the celebrated treatment it was always meant to have.

Two alternatives were rejected:

- **The full poster ceremony copy on Home** (the mockup's kick, 34px headline, sub-line, and footer). The Verdict module owns the screen's one sentence; a second display-face statement would compete with it every day. The mockup itself stages the ceremony as a standalone "meet" artifact, not part of the Home briefing. The poster treatment (grounds, scale, grain, type) carries the emotion; the ceremony copy does not survive daily repetition.
- **An onboarding "you have hired your team" moment.** Today's onboarding launches Alex alone ("Launch Alex", alex-scoped readiness checks), so a "team hired" poster there would be a false claim. The flow also lives in the retiring Mercury register (`--sw-*` tokens), and a one-shot surface celebrates the crew once, not daily. Named follow-up: when onboarding joins the app register and launches more than Alex, the poster component built here can be reused for that moment.

## 3. The poster surface

One unified printed surface replaces the three separate cream tiles. The band keeps its module heading ("Your team", non-italic, existing rhythm) and becomes:

- **Chrome:** border-radius 18px, 1px `var(--hair-soft)` border, `var(--shadow-card)`, `overflow: hidden`, padding tuned so the featured lift never clips (top padding accommodates the lift).
- **Ground (background-image stack, bottom to top):** a linear wash from `hsl(var(--surface))` down to `hsl(var(--canvas))`, then three radial identity tints, one per agent column (`hsl(var(--agent-alex-tint))` centered near the top at 16% x, riley at 50%, mira at 84%, each fading to transparent by roughly 45%), then the grain layer on top. All existing tokens; no new color tokens, no raw hex.
- **Grain (the spec's poster .34, calibrated):** the same data-URI `feTurbulence` recipe as the shipped canvas grain (baseFrequency 0.88, numOctaves 2, stitchTiles stitch, seed 7, warm ink channels 0.16 0.13 0.09), baked at a lighter alpha, starting point 0.19, calibrated live within 0.16 to 0.22. Mechanism: the grain is the first `background-image` layer on the poster element with `background-blend-mode: multiply, normal, normal, normal, normal`, blending only into the poster's own background layers. This is the same proven approach as the canvas (never a stacked layer; `background-blend-mode` cannot touch child content, so portraits and text are AA-safe by construction) scoped to one opaque component. The canvas grain rule on `body:has(.app-header)` is not touched.
- **Grain off rules:** the grain layer lives in a file-local custom property (`--_grain`) so the gradient stack is declared once. `.dark` and `prefers-reduced-motion: reduce` set `--_grain: none` (the `none` layer keeps the blend-mode list aligned). This mirrors the canvas pattern: dark and reduced motion strip grain, the ground stays.

Spec relationship preserved and guarded: poster grain is lighter than canvas grain (spec .34 vs .42 maps to baked alpha below the canvas's 0.24).

## 4. The portraits (hero scale via a fluid avatar)

Fixed hero pixels cannot fit a padded poster at 320px mobile (three 96px portraits plus gaps overflow), and a JS resize hook would cause a hydration shift. The sprite is a pure vector SVG with a viewBox, so the honest fix is fluid sizing, which also delivers the prior slice's named follow-on ("a fluid-sizing avatar mode"):

- **`PixelSprite` and `AnimatedSprite`:** `size` widens from `number` to `number | "fill"`. With `"fill"` the SVG renders `width="100%" height="100%"` (the viewBox keeps the 24x24 grid; `shape-rendering: crispEdges` plus `image-rendering: pixelated` keep pixels crisp at any size). The number path is byte-identical.
- **`PrintedPortraitAvatar`:** `size` accepts `number | "fill"`. With `"fill"` the wrapper is `width: 100%; aspect-ratio: 1` and the sprite sits in an inner 82%-width box anchored bottom-center (same geometry ratio as the number path). New orthogonal `hero` prop applies the spec's hero frame weights: halo offset 2px (today 1px) and inset edge 1.5px, radius stays the shipped proportional 22%. The status pip is capped at hero scale (the 28% pip that reads correctly at 22 to 44px is oversized at 112px; the hero pip uses a smaller percentage, locked by live screenshots). Default-size consumers (Inbox 22px, bylines, panel) are untouched.
- **Poster columns:** `grid-template-columns: repeat(3, minmax(0, 116px)); justify-content: center` with a clamped gap. Resulting portrait widths: about 81px at a 320px viewport (rare floor, slightly under today's 88), about 100 to 112px at mainstream phone widths (375 to 430), capped 112px on desktop (the bento main column is roughly 600 to 820px wide, so the row sits centered with generous air). No layout-shift, no JS.

Each column is one button (existing contract: `data-agent`, `data-disabled`, `data-testid="team-mate-{key}"`, `aria-label` "Open {name}, {status}"), transparent chrome on the poster ground, amber `:focus-visible` outline. Under the portrait:

- **Name:** `var(--font-home-serif)` (the loaded Newsreader, echoing the Verdict's display voice; Fraunces adoption is the deferred TY2 font decision and does not enter through a styling slice), 17 to 18px, weight 650, `font-style: normal` declared explicitly (no italics), color `hsl(var(--agent-{key}-deep))`.
- **Role:** 11px, weight 600, uppercase, letter-spacing 0.05em, full-opacity `hsl(var(--agent-{key}-deep))` (opacity-faded identity ink would dip below AA). Copy from the locked mockup, honest job descriptions for the medspa vertical: Alex "Front desk", Riley "Ad analyst", Mira "The maker". These live in a presentation map in `team-band.tsx` (the registry's `role` field is a machine slug, not display copy).
- **Status:** the existing honest `teamStatusLabel` output, 12px, upgraded from `--ink-3` (4.1:1, below AA) to `--ink-2` (8.3:1).

Text sits in the poster's lower zone where the ground has faded to near-white; the identity tints peak behind the portraits.

## 5. Motion (within the locked budget)

- The one-breathing-avatar budget is unchanged: the existing focal logic (first genuinely working agent) drives `allowMotion`.
- The focal working agent's portrait additionally gets a featured lift (`translateY(-6px)`, transform only, no reflow). Nobody working means nobody lifted: positive evidence only.
- Hover lifts a portrait `translateY(-3px)` with the existing ease token.
- Reduced motion: transitions and breathing strip (existing avatar-internal media query plus CSS), and the poster grain strips via `--_grain: none`. The lift becomes a static offset (position, not motion).

## 6. Dark variant

Dark strips the poster grain (mirroring the canvas rule). The identity tints and deeps are not yet dark-overridden (the Wave 3 dark palette completes the primitives; the dark toggle is hidden today), so the poster inherits whatever Wave 3 gives those primitives with no further work here. A dark screenshot is captured for the record; finishing dark is explicitly Wave 3.

## 7. AA legibility (proven two ways)

- **Computed gate:** extend the drift-guard contrast assertions (`token-governance.test.ts`, which already has a `contrastRatio` helper over the globals tokens): each `--agent-*-deep` at or above 4.5:1 against both `--surface` (the poster's text zone) and its own `--agent-*-tint` (worst-case ground), and the status ink (`--ink-2` ramp value) at or above 4.5:1 on `--surface`.
- **Live proof:** pixel-sample the rendered poster behind each name, role, and status label from real screenshots and compute contrast against the actual grained, tinted ground (not a model). The grain multiplies (darkens) the ground, which only helps dark text, but this is measured, not assumed.

## 8. Files touched

- `apps/dashboard/src/components/cockpit/sprite/pixel-sprite.tsx` (+ test): `size: number | "fill"`.
- `apps/dashboard/src/components/cockpit/sprite/animated-sprite.tsx`: pass-through type widening.
- `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx` (+ module CSS + test): `size="fill"` mode, `hero` prop (2px halo, 1.5px edge, hero pip cap).
- `apps/dashboard/src/components/home/team-band.tsx` (+ test): poster markup, role map, featured lift wiring. Copy surface added to the in-app voice corpus.
- New `apps/dashboard/src/components/home/team-band.module.css`: poster ground, grain layer and off rules, columns, type. The `.teamBand*` block moves out of `home.module.css` (proactive split; `home.module.css` is past the 400-line warn threshold).
- `apps/dashboard/src/app/__tests__/token-governance.test.ts`: poster-grain governance block (data-URI shape, alpha lighter than canvas and within the subtle band, multiply blend, dark and reduced-motion off rules) and the new contrast assertions.
- `apps/dashboard/src/__tests__/in-app-voice.test.ts`: add `components/home/team-band.tsx` to the corpus.

Not touched: `home-page.tsx` (data flow and module composition unchanged), the canvas grain rule, `globals.css` (no new tokens needed), all other avatar consumers.

## 9. Out of scope (named follow-ups)

- The onboarding "you have hired your team" moment (blocked on onboarding honesty and register; the poster component is reusable for it).
- Unifying the agent panel `IdentityStatus` and Mira's desk onto `PrintedPortraitAvatar`.
- The Home verdict's pre-existing em-dash and italic styling (separately flagged task).
- Fraunces adoption (TY2 font decision) and the Wave 3 dark palette.
- The cumulative "since you hired" value strip (still blocked on a real lifetime data source).

## 10. Risks

- **Grain or tints read heavy on the lighter poster ground.** Calibrated from real screenshots within a guarded band; the floor is every label staying AA (measured).
- **Hero pip scale.** The 28% pip is right at chip scale and oversized at 112px; the hero cap is locked from live shots.
- **Serif names at 17px.** Newsreader optical sizing is tuned visually (the Verdict already uses the face at 36 to 48px; small sizes need `opsz` care).
- **320px floor.** Portraits compress to about 81px inside the poster at the rarest width (vs 88 today, flush tiles). Accepted: every mainstream width gets 100 to 112px. Overflow is asserted live at 320, 360, 375, and 390 (scrollWidth vs clientWidth), not eyeballed.
- **Featured lift clipping.** The poster's top padding reserves the lift distance; verified in shots with a working agent.

## 11. Test plan summary

- Sprite: `"fill"` renders percentage dimensions (new assertions in `pixel-sprite.test.tsx`); number path unchanged.
- Avatar: fill wrapper contract (100% width, aspect-ratio 1), hero class and frame weights, pip cap, defaults byte-identical.
- Band: names, roles, statuses render; tiles stay buttons firing `onOpenAgent` (all three including Mira); exactly one `data-playing` tile; featured data attribute only on the focal working tile and absent when nobody works; disabled and halted states preserved; no em-dash and no "generated" in band copy (voice corpus).
- Governance: poster grain shape and off rules; alpha lighter than canvas; contrast gate for deep inks and status ink; no raw hex (existing recursive sweep covers the new CSS file automatically).
- Gates: full dashboard vitest, typecheck, `next build`, `format:check`, `arch:check`, then live screenshots at 320/360/375/390/430/1024/1280 plus dark and reduced-motion, with pixel-sampled contrast on every label and a canvas-grain regression shot (Inbox sheet still above the masthead, grain still on the bare canvas only).
