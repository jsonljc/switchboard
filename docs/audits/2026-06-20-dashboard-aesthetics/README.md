# Switchboard Dashboard: Populated-State Aesthetic Audit

**Date:** 2026-06-20
**Scope:** `apps/dashboard` (Next.js) judged against a rich, seeded demo state (not empty states).
**Mode:** Read-only. Nothing was merged. Every recommendation is framed as a candidate slice for the in-flight aesthetic-rehaul `/loop`.
**Method:** Seeded `org_dev` with realistic medspa activity, captured high-DPI headless-Chrome screenshots of every main view, then ran four parallel design-critique passes (composition, color/accessibility, typography, dark/responsive/motion) under the `frontend-design` lens and synthesized them. Claims are cited to `file:line` and verified against the running app and the live database.

---

## TL;DR

The warm-editorial register holds up under real data and produces a genuinely handsome Results page and a confident Home verdict. But the populated state exposes seams the empty state hid, and the system has drifted toward the most common AI-default look (warm cream + high-contrast serif + terracotta accent) without yet earning a distinctive identity.

The five highest-leverage moves, in order:

1. **Gate the reachable dark toggle** (Critical, tiny). A live Light/Dark/System picker in Settings flips the whole app into an admittedly-unfinished dark register where elevation disappears. Fix already in flight as PR #826 but unmerged.
2. **Fix microlabel contrast** (High, tiny). The mono caps and section labels sit at 2.7:1 to 3.6:1 on cream, below WCAG AA. One token swap to `--ink-3` clears them all.
3. **Collapse the type system to three faces** (High, small). Seven font families load; two serifs co-occur on the same screens. Fraunces + Geist + JetBrains Mono is the intended canon; everything else is legacy drift and the loudest "templated" tell.
4. **Restructure the Home bento** (High, medium). The populated layout collapses to a thin left column beside dead canvas, with a permanently-empty "work in progress" module. Make the Verdict a spanning hero, promote the team band to full width, drop the dead module.
5. **Commit to the retro identity** (Medium, medium). The pixel-portrait + riso-registration frame is the only element here that a templated warm-editorial dashboard would not also produce. Make it the signature rather than a lonely mascot; do not replace it with vector portraits.

---

## The populated state this audit judged

The prior session saw the empty states ("All quiet overnight", "No active handoffs", "still being tallied"). This audit seeded `org_dev` (the `DEV_BYPASS_AUTH` org, `apps/dashboard/src/lib/dev-auth.ts:7`) so every surface renders real activity. The idempotent seed lives at `scripts/demo-seed-rich-dashboard.ts` in this branch.

What is now populated (verified through the live API):

| Surface | State after seeding |
| --- | --- |
| Home Verdict / Needs You | 7 decisions (5 approval recommendations across Alex and Riley, 2 human handoffs). ACTIVE layout. |
| Home This Week | 6 consults booked, 8 new leads (this-week window). |
| Home While You Slept | 4 agent-attributed activity rows ("Maya Lim confirmed lip filler review", etc). |
| Home Team Band | Alex working, Riley analyzing, Mira enabled; all three "set up". |
| Inbox | 8 decision cards. |
| Results | S$14,720 attributed pipeline, attribution split across Riley and Alex, held-rate and receipts. |
| Mira | Creative desk with review shelf, in-production, and kept drafts. |

**Two things could not be made non-empty, and that is a product fact rather than a seeding gap:**

- **Home "work in progress" is hard-coded empty.** `home-page.tsx:208` sets `workInProgressItems = []` ("no real typed-handoff trace source in P1-A"). It always renders "No active handoffs right now." This is a finding, not a missing fixture.
- **Meta-sourced numbers (spend, funnel, campaigns, cost-per-lead) come from a live external API**, not the database, so they stay empty without real Meta credentials. Booking and revenue figures are real; ad-platform figures are not seedable.

Reproduction steps are in the Appendix.

---

## Screenshots

All captured at 2x device scale. Full-resolution PNGs are in [`./screenshots/`](./screenshots/).

| View | Image |
| --- | --- |
| Home (desktop, populated) | [`home-desktop.png`](./screenshots/home-desktop.png) |
| Home (mobile, 430px) | [`home-mobile.png`](./screenshots/home-mobile.png) |
| Inbox | [`inbox-desktop.png`](./screenshots/inbox-desktop.png) |
| Results | [`results-desktop.png`](./screenshots/results-desktop.png) |
| Mira | [`mira-desktop.png`](./screenshots/mira-desktop.png) |
| Settings | [`settings-desktop.png`](./screenshots/settings-desktop.png) |
| Agent panel: Alex | [`home-alex-panel.png`](./screenshots/home-alex-panel.png) |
| Agent panel: Riley | [`home-riley-panel.png`](./screenshots/home-riley-panel.png) |

---

## The central tension

The `frontend-design` calibration names three looks that current AI design clusters around. Look number one is "warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta accent." This dashboard's tokens are `--cream: hsl(40 25% 94%)` (about #F1ECE3), Fraunces and Source Serif 4 display faces, and an action amber that reads terracotta. It is sitting inside the default cluster.

That is not automatically wrong. The brief asked for warm editorial, and the execution is competent: the paper-grain canvas, the elevation ladder, the editorial Results prose. But "competent execution of the default" is not the same as a distinctive identity, and the populated state makes the gap visible. The signature is currently diffuse: grain, serif verdict, and pixel sprite are three half-signatures at medium intensity, which sums to "tasteful warm-editorial template."

The one asset on these eight screens that a templated warm-editorial dashboard would not also produce is the **pixel-portrait agent identity inside its riso-registration frame**. The recommendation that threads through this audit: spend the boldness there, and quiet the serif-and-cream layer into a supporting stage. Do not resolve the retro tension by re-rendering the agents as illustrated or vector portraits, because soft editorial illustration is itself a 2025-26 default and would surrender the only non-default element the product owns.

---

## Findings

Severity key: **Critical** (fix first, breaks the experience or compliance), **High** (clear defect or identity dilution, widely visible), **Medium** (real polish with leverage), **Low** (small, opportunistic).

### Critical

#### C1. A reachable Dark/System toggle paints the unfinished dark register app-wide
The codebase comments treat dark mode as hidden until a future "Wave 3" (`globals.css:376`). It is not hidden. `app/(auth)/settings/account/page.tsx:185` renders a live Light / Dark / System picker wired to `use-theme.ts`, whose `applyTheme` does `document.documentElement.classList.toggle("dark", ...)` on the root (`use-theme.ts:17`) and defaults to `"system"` (`use-theme.ts:25`). A user on OS dark who opens Settings flips the entire authed shell into the incomplete `.dark` block, and the choice persists in `localStorage`. In that register, elevation collapses (see H-then-Medium D2) and the grain identity drops.

Mitigating detail: `useTheme` is only mounted in the Settings page, so a system-dark user does not get `.dark` on cold load; the breakage triggers once they visit Settings. That is a latent trap, not a benign stub.

- **Evidence:** `settings/account/page.tsx:182-200`, `hooks/use-theme.ts:14-25`. Fix already scoped as the open branch `feat/hide-dark-toggle` (PR #826), not yet merged.
- **Slice (P0, tiny):** Land PR #826, or gate the toggle behind the same flag the rest of the system assumes, shipping Light-only until the dark register is real.

### High

#### H1. Mono microlabels and section labels fail WCAG AA on the cream ground
Two undersaturated label tones, both at 10 to 11px, both below the 4.5:1 normal-text bar:

| Token | Used by | Estimated ratio on cream | Verdict |
| --- | --- | --- | --- |
| `hsl(20 10% 12% / 0.55)` | `.folio` (`globals.css:848`), `.win-folio` (`:997`), `.stat-label` (`:1123`) | about 3.64:1 | Fail |
| `--tertiary-foreground` (30 5% 58%) via `.section-label` (`:509`, used `:62`) | "Profile", "Open decisions", "Revenue events", "Specialists", "Attribution coverage" | about 2.67:1 | Fail hard |

These are visible as the `RESULTS / THIS WEEK`, `NO 47 / VS 122` mono caps in `results-desktop.png` and the `NEEDS YOU / 2 OPEN` folios in `home-desktop.png`. The riso grain (`background-blend-mode: multiply`, `globals.css:598`) lowers the effective local ratio further, and alpha text over a textured ground is the worst case. The fix already exists in the system: `--ink-3` (`--palette-ink-500`, 20 6% 40%) computes about 5.13:1 on cream and is documented "darkened to clear WCAG AA."

- **Slice (P0, tiny):** Replace the three `hsl(20 10% 12% / 0.55)` literals and repoint `--tertiary-foreground` / `.section-label` to `--ink-3`. One token swap, no layout change, clears every failing microlabel at once. Keep the alpha pattern only for sizes at or above 18px where 3:1 applies. These ratios are computed estimates; confirm with live pixel-sampling on the rendered app, since the grain ground defeats token-level AA checks.

#### H2. Font-family sprawl, and two serifs co-occur on the same surfaces
`layout.tsx:2-10` loads seven families: Inter, DM Sans, Space Mono, Source Serif 4, JetBrains Mono, Fraunces, Geist. Worse than the count is the overlap. Source Serif 4 (`--serif`) and Fraunces (`--font-display-app`) both land on Results (`results.module.css:1664` title is Source Serif 4; the verdict and narrative are Fraunces), and on the inbox and decision surfaces. Two high-contrast serifs sharing a screen dilute exactly the identity the serif is meant to carry. There are also 25 raw `--font-display` (DM Sans) consumers still in the authed tree.

The intended canon is legible from the token comments: display is Fraunces (`globals.css:304`, "the ONE authed display semantic"), body is Geist (`:296`), data is JetBrains Mono. That trio is good. Everything else is legacy drift from the merge-pragmatic aliases (`--font-home-serif`, `--mercury-*`) that have calcified.

- **Slice (P1, small):** Adopt Fraunces (display) + Geist (body) + JetBrains Mono (data) as the authed canon. Repoint `--serif` to Fraunces inside the authed register so Results, inbox, and decision cards stop pulling a second serif; keep Source Serif 4 only under `[data-register="mercury"]` until Mercury retires. Migrate the 25 raw `--font-display` authed consumers to `--font-display-app`. Drop Space Mono. Net: seven loaded families down to three in the authed app.

#### H3. The populated Home bento collapses to a thin column beside dead canvas, and ships a permanently-empty module
On `home-desktop.png` the content occupies the left portion and ends about 40% down a tall viewport; the right side and lower half are empty cream. The Verdict is lifted out of the grid (`home-page.tsx:297`) and renders full-bleed-left above a two-column grid whose left column has no max-width and whose right rail (320px, `home.module.css:39`) bottoms out early. The result is an L-shaped emptiness in the most valuable lower-right pixels.

Inside that thin rail sits the **WorkInProgress** module, which is structurally incapable of data (`home-page.tsx:208`, hard-coded `[]`) and always renders "No active handoffs right now." In the richest seeded state the operator's eye lands on a titled section that can never fill.

- **Evidence:** `home-page.tsx:276-309`, `home.module.css:28-50`, `work-in-progress.tsx:26-37`, `home-desktop.png`.
- **Slice (P1, medium):** Restructure the bento so the Verdict spans a true hero row and the team band goes full-width above a balanced main-plus-rail block; cap the main column measure (about 640 to 720px) so cards do not stretch. Remove `workInProgressNode` from the `modules` arrays until a real WorkTrace-backed handoff source exists. This single slice fixes the lopsided emptiness, removes the dead slot, and gives the team band room to read as the intended peak.

#### H4. The pixel sprites read as a fidelity mismatch, not a signature
The agent identity is a 24x24 pixel grid drawn one `<rect>` per pixel with `crispEdges` and `image-rendering: pixelated` (`pixel-sprite.tsx:24,32`). It renders at two different fidelities depending on surface: about 4x in the team band (`team-band.module.css:76`), but under 2x in the agent-panel header (`agent-panel.tsx:95`, size 44 over a 24px grid), where the same art just looks aliased. Against Fraunces at 48px, hairlines, and the elevation ladder, three small low-fi chips read as orphaned tokens rather than a committed pixel-art system. The riso-registration frame around them (the 1px and 2px ink-offset halo, `printed-portrait-avatar.module.css:30,92`) is genuinely nice and is doing the heavy lifting while the thing inside it is the lowest-resolution element on the page.

- **Slice (P2, medium):** Make the retro a register, not a mascot. Lock integer sprite scales (4x in the band; bump the panel chip from 44 to 48px so it is a clean 2x, never aliased). Extend the pixel vocabulary into two or three non-portrait spots (a pixel status pip, a pixel corner tick on the team poster, pixel eyebrows) so the sprite has company. This is the load-bearing identity move; see the central-tension section.

### Medium

#### M1. The top banner uses raw Tailwind amber instead of the system caution token
`verify-email-banner.tsx:56` and `data-mode-banner.tsx:24` are byte-identical: `bg-amber-100 ... text-amber-900 ring-1 ring-amber-200`. This strip sits at the very top of every screenshot. Tailwind `amber-100` is a cooler, higher-chroma yellow than the warm cream and reads as pasted-in system chrome. The system already ships the correct semantic: `--caution` (38 42% 38%) with `--caution-subtle` (38 35% 94%) and a dark variant. The defect is palette discipline, not text contrast.

- **Slice (P1, small):** Introduce a shared `NoticeBar tone="caution"` consuming the caution tokens and convert both banners. This also gives the banners dark-mode behavior for free. Pairs naturally with H2.

#### M2. Raw amber and yellow sprawl beyond the banners
The primitives block claims raw color lives only there (`globals.css:13`), but the authed app has roughly six more raw status colors: `whatsapp-management.tsx:37,53,134`, `channel-management.tsx:194`, `attribution-coverage.tsx:37`, `activity-item.tsx:19`, plus `text-yellow-600` in billing, go-live, and the connections callback. Each is a warning tone that should be `--caution` or `--agent-attention`.

- **Slice (P2, small):** Sweep authed status colors onto the semantic tokens and add an ESLint `no-restricted-syntax` rule banning `bg-amber-*`, `bg-yellow-*`, `text-yellow-*` in `apps/dashboard/src` (excluding the separate `landing/v6` marketing register) to keep the leak closed.

#### M3. The team-band poster floats; its grouping is too quiet to read as a crew
The three portraits sit on a near-invisible tinted ground (radial tints fade to transparent by 45%, `team-band.module.css:41-43`) with a 1px hairline and a tiny uppercase label. On the cream canvas the poster edges nearly disappear, so the avatars read as three loose icons rather than one printed card, and they lose to the decision cards' crisp 20px-radius surfaces nearby.

- **Slice (P2, small):** Deepen the surface-to-canvas wash floor, add a soft inner top edge, and give the poster a real shadow step so the crew reads as one object. Keep identity tints on the ground only (that constraint is correct).

#### M4. Above-the-fold operational density is low for a power operator
The Verdict says "7 things need you. Start with Alex." then shows about two of them before the fold. Computed from the real layout: header (68px) plus column top padding (32px) plus the verdict block (eyebrow, salutation, a 48px serif line wrapping to about two lines, proof) puts the first decision card roughly 300px down. For an operator clearing a queue, the headline writes a check the fold does not cash. Note: the verdict type itself is correctly sized at 48px (`home.module.css:87-105`); the 60px and 140px figures from `globals.css` are not used on Home (they belong to Results). The problem is the stacked chrome around the headline, not the headline.

- **Slice (P2, small):** Fold the salutation into the eyebrow row, tighten verdict vertical padding, and reduce decision-card padding so three or four decisions clear the fold. Use the Inbox card density (the best-balanced surface) as the target.

#### M5. The dark register is a stub: shadow-based elevation collapses on near-black
Separate from C1's reachability. `.dark` only remaps color tokens; elevation across the app is shadow-based (`--shadow-1..5`, `globals.css:280-285`) driven by `--shadow-color`, which `.dark` sets to `0 0% 0%` (`:379`). Black shadows on a near-black surface are invisible, so cards, sheets, and popovers lose all separation. The grain signature is also dropped in dark (`:605-607`). The in-code comment already admits this is unfinished. The separate "night register" for Mira's review feed (`--palette-night-*`, `:33-42`) is a sanctioned single-surface inversion and is the correct tonal-surface model to generalize.

- **Slice (P1 build, after C1):** Build a real dark register on tonal surface steps (canvas to surface to raised to overlay, climbing a few percent lightness each) plus hairline top-highlight borders for elevation, keeping shadows only as faint ambient occlusion. Reintroduce a dark-tuned grain rather than dropping it. Substantial and correctly deferred, but C1 must land first so users cannot reach the stub meanwhile.

#### M6. Always-on ambient animation reads as AI theater
Three simultaneous idle loops compete on Home: `character-float 6s infinite` and `aura-breathe 6s infinite` on the operator character (`operator-character.tsx:114,128`), plus `pulse-ring 2s infinite` on the live pip (`globals.css:725-742`). On a calm editorial console that is one accessory too many. The arm-pulse on the amber action button is justified (it signals "armed, will fire") and should stay.

- **Slice (P2, small):** Cut `aura-breathe` and keep the gentle float; make `pulse-ring` fire once on connect rather than looping (a steady dot already reads as live). Also close the reduced-motion gap: `inbox.css` guards only skeleton loaders (`:256-262`), leaving `armed-pulse` (`:530-542`) unguarded, unlike the swipe-card twin that handles it correctly.

#### M7. Per-surface populated quality: two surfaces look unpopulated even when populated
- **Agent panel, Riley (`home-riley-panel.png`):** a single "8 / leads" then one calendar line then a large empty panel. In a rich demo the money panel looks broken-empty. Alex's panel (`home-alex-panel.png`) is denser but buries its hero number under a long quiet list.
- **Mira (`mira-desktop.png`):** for a content-maker surface there is zero visual content; "kept drafts" is a flat list of text links with no previews.
- **Results (`results-desktop.png`):** the strongest surface, but the hero strands upper-left and a fixed 160px terminal pad (`globals.css:818-820`) adds more dead space below.

- **Slice (P2, medium):** Give the agent panel a fixed hero-stat band plus a denser activity group, and a non-empty Riley layout. Give Mira's kept drafts a contact-sheet treatment with creative previews. On Results, use the right gutter for the secondary read and trim the terminal pad.

#### M8. Accent sprawl: four warm reds compete where the register promises one
The premise is "single warm-red plus amber action," but four hues in the warm-red band are live at once: action amber (`--action`, 30 58% 41%), editorial-accent orange (20 90% 55%, doing the most visible work, including the coral word "Alex" in the Home headline and the figures on Results), destructive red (0 38% 40%), and Alex's coral identity (14 70% 58%). On the Home hero, the word "Alex" (editorial-accent) and the Alex avatar (coral) are two different warm-reds for the same agent. Editorial-accent as text is about 2.69:1 on cream, fine for the large hero numerals but failing AA below 24px (the inline links).

- **Slice (P3, small):** Pick one warm-red as the editorial highlight and make it agent-neutral, or formally scope `--editorial-accent` to large display numerals only and lint against small-text use. Map the "Alex" headline word to Alex's own coral so name color equals agent color.

### Low

- **L1. Hero-figure language is inconsistent.** "The big number" is serif at 140px in one place (`globals.css:1041`), JetBrains Mono at 56px on Results, and Fraunces at 56px in the panel. Pick one gesture (recommended: JetBrains Mono tabular, since the figures are the literal product proof) and demote the 140px serif. (`results.module.css:55-68`, `agent-panel.module.css:288`).
- **L2. Mobile nav clearance is fragile.** The fixed bottom nav is cleared only by `.section:last-of-type { padding-bottom: 160px }` (`globals.css:818`), keyed to a class the Home modules do not use, and a flat 160px at all breakpoints. Move clearance to the scroll container, gated to mobile, sized `calc(64px + env(safe-area-inset-bottom))`. Mobile type and layout otherwise scale well (`home-mobile.png`).
- **L3. Halt state is color-only.** `.folio-link.is-halt` signals halt purely via red (`globals.css:768-770`). Add a non-color cue (icon or a "HALTED" micro-label).
- **L4. Action button contrast is razor-thin.** White on amber computes about 4.52:1, just over AA. Add a guard test pinning `--action` luminance so future tweaks cannot tip it under (`button.tsx`, `--shadow-action-gloss`).
- **L5. Settings opening screen is sparse** (three cards upper-left of an empty page, `settings-desktop.png`). Folds into the global density and bento work; no standalone slice.

What is working and should be preserved: the Inbox card rhythm (the best-balanced surface, use as the density reference), the editorial Results prose voice, the riso-registration portrait frame, the `:focus-visible` baseline (`globals.css:407`, semantic ring, correctly placed in `@layer base`), the badge tones (positive 6.35:1, caution 4.92:1, negative 7.2:1, all token-sourced), and the rule that agent identity hues never color action controls.

---

## Prioritized punch list

Ordered for the rehaul `/loop`. Effort is rough.

| # | Slice | Severity | Effort | Primary files |
| --- | --- | --- | --- | --- |
| 1 | Gate or remove the reachable Dark/System toggle (land PR #826) | Critical | Tiny | `settings/account/page.tsx:182-200`, `hooks/use-theme.ts` |
| 2 | Repoint failing microlabels and section labels to `--ink-3` | High | Tiny | `globals.css:62,509,848,997,1123` |
| 3 | Retone the top banners to `--caution` via a shared NoticeBar | Medium | Small | `verify-email-banner.tsx:56`, `data-mode-banner.tsx:24` |
| 4 | Collapse authed type to Fraunces + Geist + JetBrains; stop two serifs co-occurring; drop Space Mono | High | Small | `layout.tsx:2-10`, `globals.css:134-310`, `results.module.css:1664` |
| 5 | Restructure Home bento (spanning Verdict hero, full-width team band, drop dead WorkInProgress, cap main measure) | High | Medium | `home-page.tsx:276-309`, `home.module.css:28-50` |
| 6 | Commit the retro: integer sprite scales, extend the riso/registration motif, make the pixel-portrait the signature | Medium | Medium | `printed-portrait-avatar.*`, `team-band.module.css`, `agent-panel.tsx:95` |
| 7 | Cut `aura-breathe`, make `pulse-ring` fire-once, close the inbox reduced-motion gap | Medium | Small | `globals.css:522-564,725-742`, `operator-character.tsx`, `inbox.css:530-542` |
| 8 | Sweep raw amber/yellow onto tokens + add a lint rule | Medium | Small | `whatsapp-management.tsx`, `channel-management.tsx`, `attribution-coverage.tsx`, others |
| 9 | Per-surface populated quality: Riley panel, Mira contact-sheet, Results right gutter | Medium | Medium | `agent-panel.module.css`, `mira-desk.module.css`, `results.module.css` |
| 10 | Build the real dark register on tonal surface steps (after #1) | Medium | Large | `globals.css:317-380` |
| 11 | Tighten above-the-fold density on Home | Medium | Small | `home.module.css:59,79-124` |
| 12 | Accent discipline, hero-figure unification, halt cue, action-contrast guard, mobile nav clearance | Low | Small each | various (see L1 to L5) |

---

## Per-surface scorecard

| Surface | Populated verdict |
| --- | --- |
| Home | Confident verdict and warm character, but the bento collapses to a thin column beside dead canvas with a permanently-empty module. Highest-leverage surface to fix. |
| Inbox | The best-balanced surface. Clean vertical queue, correct density and rhythm. Use as the reference. |
| Results | The most handsome surface. Editorial prose over big figures earns the register. Strands its hero upper-left and runs dead below. |
| Mira | Functional but visually thin for a content-maker. No creative previews; kept drafts read as a link list. |
| Settings | Sparse three-card landing, consistent with the app-wide top-left-anchor pattern. Low traffic, low priority. |
| Agent panel | Alex is dense but buries the hero number; Riley looks broken-empty even when populated. Needs a defined hero-stat zone. |

---

## Appendix: reproduction

1. **Stack:** API on :3000, chat on :3001, dashboard on :3002, Postgres on :5432. The dashboard renders without login because `DEV_BYPASS_AUTH=true` (`apps/dashboard/.env.local`). If the API is down, build the two reset-skipped packages first: `pnpm --filter @switchboard/creative-pipeline --filter @switchboard/ad-optimizer build`, then launch the API with the root env loaded: `cd apps/api && ../../node_modules/.bin/tsx watch --env-file=/Users/jasonli/switchboard/.env src/server.ts`, and `pnpm dev` for dashboard plus chat.
2. **Seed:** `node_modules/.bin/tsx --env-file=/Users/jasonli/switchboard/.env .claude/worktrees/audit-dashboard-aesthetics/scripts/demo-seed-rich-dashboard.ts` (idempotent; `demo_*` ids; medspa copy; dated relative to now). The DB is shared and the dashboard fetches live via React Query, so a reload shows fresh data with no rebuild.
3. **Screenshots:** headless Chrome, for example `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --user-data-dir="$(mktemp -d)" --window-size=1440,2600 --virtual-time-budget=14000 --screenshot=out.png "http://localhost:3002/"`. Routes under `(auth)`: `/`, `/inbox`, `/results`, `/mira`, `/settings`; `/alex` and `/riley` redirect to `/?agent=` and open the agent panel.

### Limitations

- Contrast ratios are computed estimates. Confirm with live pixel-sampling on the rendered app, since the grain ground defeats token-level AA checks.
- Dark mode was audited from source (the register is unfinished and the toggle should be gated), not screenshotted, because capturing the class-based theme cleanly via headless Chrome requires interaction.
- Meta-sourced figures (spend, funnel, campaigns) are external-API-backed and were not populated, so the Results funnel and campaign tiles show their no-data state.
