# Paper grain canvas (warm-riso through-line)

**Status:** Design, 2026-06-04. Implements the last unbuilt through-line of the locked app aesthetic direction (`docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`, sections 4 GRAIN and 5).

**One line:** a subtle warm paper grain on the app canvas only, so the authed product feels printed like a warm riso zine, without ever sitting behind money or decision data.

---

## 1. Why

The locked direction is "the calm of Linear, printed like a warm riso zine, starring a pixel crew you love." The pixel crew (Mira sprite plus the Home team band, #855), the printed-portrait avatar frame, and the one-amber Wave-1 tokens are on main. The grain is the single ownable canvas texture that makes the app feel printed, and it is the only core through-line still missing. Verified absent: no `feTurbulence`, `paperGrain`, or `.grain` rule exists in `apps/dashboard/src` today.

## 2. The mechanism

The grain is part of the authed canvas's own background paint, not a separate stacked layer:

- **On the body background, via `background-blend-mode`.** The authed canvas is `body:has(.app-header)`, whose `background-color` is the warm cream (`var(--ambient-cream)`). We add a second background layer, the grain image, and set `background-blend-mode: multiply`. The browser multiplies the grain image into the cream as it paints the body background. Child content (cards, text, the masthead, the inbox sheet) paints on top and is never touched by `background-blend-mode` (it blends only the element's own background layers, never descendants). So the grain shows only on the bare cream and is occluded by every opaque surface, with zero change to stacking.
- **A data-URI SVG noise tile.** The grain image is an SVG `feTurbulence` baked into `background-image: url("data:image/svg+xml,...")` and tiled. Self-contained (no extra DOM, no binary asset, no live filter engine per frame), inspectable, theme-able. The filter matches the locked spec: `feTurbulence type="fractalNoise" baseFrequency="0.88" numOctaves="2" stitchTiles="stitch" seed="7"`, then `feColorMatrix` to a warm dark ink (channels 0.16 0.13 0.09). `stitchTiles="stitch"` makes the ~200px tile repeat seamlessly.

### Why background-blend-mode and not a separate layer

A separate behind-content grain layer cannot work in this DOM without breaking something. The inbox detail sheet (`z-index: 60`) renders inside `.app-body`. To paint a grain layer behind content you must either lift content above it (giving `.app-body` a stacking context, which traps the sheet below the sticky masthead at `z-index: 50`, or pushes content over the sticky header if lifted above 50), or drop the grain to a negative z-index. A negative-z layer either sits behind the opaque body background (invisible) or, if the body is isolated so it paints in front of the cream, blends against the isolated group's transparent backdrop and produces no visible multiply. Both were built and measured headless: the lift breaks the sheet, the negative-z layer renders no grain. `background-blend-mode` sidesteps all of it by blending into the body's own background paint, changing no stacking and touching no content.

### Why a data URI, not inline SVG or a generated PNG

- Inline `<svg><filter>` referenced by CSS runs the SVG filter engine live and is the form most prone to per-frame cost.
- A pre-rendered PNG bakes the warm ink and seed into a binary blob that cannot be diffed, and adds a committed asset.
- A data-URI SVG is text (diffable), carries no raw hex (the ink lives in `feColorMatrix` decimal channels, the `#filter` reference is URL-encoded to `%23`), rasterizes once per tile, and is the standard production technique for paper or riso grain.

## 3. Calibration (intensity is the baked alpha, tuned by real rendering)

The spec value is "opacity around .42." Empirical pixel-sampling of the exact spec grain over the live `--canvas` token (`hsl(40 25% 94%)`), rendered headless and measured against WCAG luminance, shows that the .42-strength grain darkens the canvas mean luminance from 0.881 to about 0.68, a roughly 20 percent drop that reads as a gray cast, and a 5x zoom confirms it looks dirty rather than warm. The spec's own non-negotiable ("keep the grain subtle, or the calm promise breaks") and the legibility floor outrank the literal .42.

With `background-blend-mode` there is no per-layer CSS opacity, so the grain's intensity is the `feColorMatrix` alpha channel baked into the data URI. Headless renders and 5x zooms across alpha 0.16 to 0.45 put the subtle warm-tooth sweet spot at alpha 0.22 to 0.28 (canvas mean luminance about 0.74 to 0.77, a gentle 12 to 16 percent drop that stays cream, not gray). The implementation bakes alpha 0.24 and the final value is locked from real-app screenshots, not asserted blind. The hard floor: the alpha must keep every currently-AA canvas text at WCAG AA.

### Contrast facts (measured, the live tokens)

On today's clean canvas, before any grain:

| token           | role                  | clean contrast on canvas | status                        |
| --------------- | --------------------- | ------------------------ | ----------------------------- |
| `--ink` (900)   | verdict hero, values  | 14.7                     | AA                            |
| `--ink-2` (700) | salutation, names     | 8.3                      | AA                            |
| `--ink-3` (500) | eyebrows, meta, proof | 4.1                      | already below AA (decorative) |
| `--ink-4` (400) | faint rank, disabled  | 2.4                      | already below AA (decorative) |

`--ink-3` and `--ink-4` are pre-existing sub-AA decorative labels in the shipped app; the grain does not introduce that, and fixing the app's label contrast is out of scope for this slice. The contract this slice holds:

- **The money moment is unaffected.** Approve, spend, and decision text is dark `--ink` / `--ink-2` on opaque cards and sheets, which occlude the grain entirely (`background-blend-mode` never touches child content). AA at the money moment is preserved by construction.
- **No currently-AA canvas text regresses below AA.** `--ink-2` is the lowest-contrast text that is AA today and also sits on the bare canvas (the Home salutation). At the calibrated alpha it stays comfortably AA (measured about 7.6 against the grained canvas at alpha 0.24). `--ink` stays above 11. This is proven by real pixel-sampling, not a model.

## 4. Off money and decision surfaces

The grain sits behind content; opaque surfaces occlude it. An audit of the money and decision surfaces confirms they are opaque and therefore grain-free by construction:

- Approval / commit detail sheet: background `--canvas` (opaque).
- Inbox decision cards and track: background `--surface` (opaque white).
- "What this changes" panel and its cells: opaque cream / white.
- Home cards, team-band tiles, value strip: opaque (`--surface` / `--canvas-2`).
- Reports money cards: opaque (`--paper-raised`).

The one leak: the Results page money cards `.campaignCard` and `.agentCard` are `background: transparent` while carrying dense money data (spend, revenue, ROAS, attributed value). A transparent money card on the canvas would let grain bleed behind trust-critical numbers, which the spec forbids ("never behind dense money data"). Fix: give those two cards a clean opaque ground (`var(--canvas-2)`), which both occludes the grain and aligns them with the locked direction's model that money lives on clean printed cards. The exact ground tone is confirmed by screenshot so it stays calm, not heavy.

## 5. Off in dark and under reduced motion

Both disable the grain by removing the grain background layer (`background-image: none` on `body:has(.app-header)`), which leaves the cream `background-color` intact:

- **Dark.** `.dark body:has(.app-header) { background-image: none }`. The dark variant carries warmth through amber and lifted inks, not grain (spec section 4).
- **Reduced motion.** `@media (prefers-reduced-motion: reduce) { body:has(.app-header) { background-image: none } }`. The existing reduced-motion block only neutralizes animation timings, so the static texture needs its own disable (verified, not assumed). Both off rules sit in the same `@layer components` as the base rule, after it, so they win by specificity (dark) and source order (reduced motion).

## 6. Tokens and governance

- No new token. `background-blend-mode` has no per-layer opacity, so the grain's intensity is the calibrated `feColorMatrix` alpha baked into the data URI (a single inspectable texture asset). Adding a `--grain-opacity` scalar that nothing could consume would be dead code.
- The grain ink is expressed only as `feColorMatrix` decimal channels inside the data URI. There is no raw hex anywhere; the `#filter` fragment is URL-encoded to `%23`.
- Extend `apps/dashboard/src/app/__tests__/token-governance.test.ts`: assert the `body:has(.app-header)` rule carries `background-blend-mode: multiply` and a `background-image: url("data:image/svg+xml,...")` containing `feTurbulence`, `feColorMatrix`, and the encoded `baseFrequency="0.88"`; assert the rule carries no raw hex; assert the dark and reduced-motion off rules set `background-image: none`. The existing generalized hex sweep already covers the new CSS; the data URI is decimal-only and stays clean.

## 7. Scope

In scope: the grain on the authed body background, the dark and reduced-motion off rules, grounding the two transparent Results money cards, the governance test extension, and live verification.

Out of scope: the spec's optional poster / hero .34 lighter-grain variant (there is no live surface with an opaque gradient ground that would occlude the canvas grain and need its own lighter layer; the team-band tiles are opaque cream and the gaps already show the canvas grain). Also out of scope: fixing the app's pre-existing `--ink-3` / `--ink-4` decorative label contrast.

## 8. Verification (this slice lives or dies on how it looks)

Real-app, not only CI:

1. Launch the dev server (DB is up, `DEV_BYPASS_AUTH=true`).
2. Screenshot Home, Inbox, and Results with the grain on. Confirm the canvas reads as warm printed paper, calm, not gray or dirty.
3. Screenshot the approval / commit sheet and inbox cards. Confirm no grain (opaque occlusion).
4. Screenshot dark mode. Confirm no grain.
5. Emulate `prefers-reduced-motion: reduce`. Confirm no grain.
6. Pixel-sample the grained bare canvas behind `--ink-2` text and compute the real contrast. Confirm it is at least 4.5:1. Lock the baked alpha from these shots.

## 9. Risks

- **Grain reads heavy.** Mitigated by the calibrated baked alpha plus real-app confirmation; the empirical floor keeps AA.
- **Mobile scroll repaint.** Lowest-risk form: the grain is a static background on the body, not an animated or compositor-promoted layer. Confirmed by watching the live app, not assumed.
- **Stacking or blend surprises.** The two failure modes (a behind-content layer trapping the sheet, and a negative-z or isolated layer rendering no grain) were both built and measured headless and rejected. `background-blend-mode` on the body changes no stacking and was confirmed to render the grain while leaving cards and the sheet untouched.
- **A missed transparent money surface.** Mitigated by the surface audit plus a grep sweep for `background: transparent` near money and decision components during implementation.
