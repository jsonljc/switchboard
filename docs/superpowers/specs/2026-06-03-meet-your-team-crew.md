# Meet your team: Mira's sprite and the Home crew band

**Status:** Locked 2026-06-03. A sub-design under the locked app aesthetic direction (`docs/superpowers/specs/2026-06-03-app-aesthetic-direction/design.md`). It delivers two of that spec's named open deliverables: Mira's real 24x24 sprite (section 6) and the "your team today" hero band with live status on Home (section 5).

**One line:** bring the agent crew onstage at hero scale, with Mira finally drawn as a true peer.

This slice consumes the `PrintedPortraitAvatar` component shipped on the unmerged branch `worktree-app-aesthetic-direction` (PR #844). It adds no new design tokens and no raw hex outside the sprite's internal palette.

---

## 1. How we got here

The 2026-06-02 feel audit named "soul offstage" as a core gap: the agents are hardcoded to a static idle and never appear at emotional scale. PR #844 built the printed-portrait avatar frame and routed Home, Inbox, and the agent panel through it, but left two deliverables open: Mira still renders an in-frame letter "M" (no sprite), and Home shows only a 30px presence ribbon, never the crew at hero scale.

This design was pressure-tested before any code: three audit subagents verified the data, composition, and sprite wiring against the live tree, and two independent adversarial reviews (a skeptical refuter and Codex) challenged the plan. Their findings are folded in below, most consequentially the decision to drop a cumulative value strip (no honest data source exists yet) and to attribute live status per agent rather than with a global flag.

---

## 2. Part 1: Mira's 24x24 sprite

Mira is the creative and UGC agent. Her sprite must read as a clear peer of Alex and Riley (same head and shoulder proportions, the same single-pixel outline discipline, the same warm skin), yet be instantly distinct in silhouette and identity.

**Character:** a short violet bob with blunt bangs (the silhouette differentiator: Alex has a side part and a headset, Riley has long hair, glasses, and a ponytail). No glasses, so her eyes are open and expressive. A violet creative top over a cream collar, and a small camera worn at her chest: her maker's tool, the equivalent of Riley's pearl. Her internal sprite palette is violet-forward (hair, top) so she harmonizes with her `--agent-mira` violet portrait ground.

**States** (matching the Alex and Riley family rhythm, so she animates like a sibling):

- **idle:** a calm blink cycle (long hold, short blink, repeat).
- **draft (creating):** her signature. Mint viewfinder brackets frame her face, a small recording dot blinks, and her mouth moves. She is composing a shot. This is distinct from Alex's talking mouth and Riley's scanning visor, and it reads the creative job at a glance.
- **sleep:** closed eyes and drifting "Z" marks (family-consistent), used when the workspace is halted.
- **won:** a grin, white sparkle eyes, small celebratory stars, and the camera lens flares bright. She just captured something great.

One variant, keyed `maker`, exported as `DEFAULT_MIRA_VARIANT`. The frames were authored and visually verified in a render canvas at chip scale (30px) and hero scale (104px) inside the real printed-portrait frame, next to the real Alex and Riley sprites, to confirm the peer read at both scales. The locked frame data is the source of truth for `mira-variants.ts`.

**Wiring (verified against the live branch):**

- Create `apps/dashboard/src/components/cockpit/sprite/mira-variants.ts` exporting `MIRA_VARIANTS: VariantBundle` (mirrors `riley-variants.ts`: a local 24-char row guard, `mergeSprite` deltas, one variant with `idle`, `draft`, `sleep`, `won`).
- In `apps/dashboard/src/lib/cockpit/mira/mira-config.ts`, add `export const DEFAULT_MIRA_VARIANT = "maker"` and re-export `MIRA_VARIANTS` (mirrors `riley-config.ts`).
- In `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`, import from `mira-config` and change the `SPRITES` map entry from `mira: { bundle: null }` to `mira: { bundle: MIRA_VARIANTS, variant: DEFAULT_MIRA_VARIANT }`. Leave `AGENT_LETTER` intact (the `Record<AgentKey,string>` type requires the entry; it simply stops being reached for Mira). Update the now-stale comments.
- Three test assertions flip from letter to svg: two in `printed-portrait-avatar.test.tsx` (the "falls back to a letter for mira" and "keeps Mira's letter even when working" blocks) and one in `inbox-agent-avatar.test.tsx` ("falls back to an initial disc for mira"). Rewrite them to assert Mira now renders a sprite, mirroring the existing Alex and Riley assertions.
- Add a `MIRA_VARIANTS bundle shape` block to `build-sprite.test.ts` (the shared `validateBundle` helper checks the key set, 24x24 row lengths, all four states present and non-empty, positive durations, and that every palette key resolves). Add `apps/dashboard/src/lib/cockpit/mira/__tests__/mira-config.test.ts` (mirrors `riley-config.test.ts`) asserting the accent tokens and copy constants, plus a guard that `MIRA_VARIANTS[DEFAULT_MIRA_VARIANT]` is defined (this directly protects the avatar wiring: a typo in `DEFAULT_MIRA_VARIANT` would silently fall back to the letter).

**The `/mira` cockpit desk (a separate, Mira-only avatar path), out of scope:** the Mira cockpit desk and feed render a different `Identity` avatar component, not `PrintedPortraitAvatar`. Verified against the live branch: `Identity` is used by Mira's desk and feed only; there is no Alex or Riley cockpit using it, so the `/mira` desk is a Mira-only surface with no peer comparison. Leaving it as a monogram is therefore not a peer inconsistency (the "reads as a peer" goal is about the printed-portrait surfaces where Alex and Riley have sprites: Home, Inbox, the agent panel). Wiring the sprite into the cockpit would also need a static, reduced-motion-safe contract, because the cockpit `SpriteFrame` does not honor reduced motion today. For both reasons we defer it: unifying the cockpit onto the printed-portrait sprite (with a reduced-motion-safe `SpriteFrame`) is a separate plan. This keeps the slice focused and the motion budget intact.

---

## 3. Part 2: the "meet your team" band on Home

Promote the small 30px `TeamPulse` chip ribbon into a hero-scale crew band that celebrates Alex, Riley, and Mira as printed portraits with live status. The band is a strict superset of the ribbon (same tap-to-open-panel behavior) plus the hero scale and honest status the spec calls for.

**Layout:**

- Each agent is a printed portrait at a single stable size of 96px, on its identity ground, with the agent's name and one honest live status line below.
- 96px is used at every breakpoint. It is celebrated (more than three times the 30px chip) and it fits everywhere: a three-up grid at 96px fits a 360px mobile viewport, and it fits the desktop bento main column (about 340px wide at the 1024px breakpoint, where 112px would overflow). A larger desktop hero (up to the spec's 112px) is a clean follow-on once the band can claim more width than the bento main column allows; it is deliberately deferred to avoid a layout-fit bug and avatar-size hydration shift.
- The band replaces `TeamPulse` in its existing composition slot, swapping only the rendered node and keeping the module key, the `HomeModuleBoundary` wrapper, the modules array, and the bento split untouched. It inherits `TeamPulse`'s position in both the ACTIVE and CALM Home layouts.

**Honest live status (the most important correctness rule):**

- Status comes from `useAgentState()`, whose entries are keyed by `agentRole`, not by `agentKey`. Status must be attributed per agent through the role-to-key mapping the agent panel already uses (`responder` maps to Alex, `optimizer` maps to Riley). Mira has no role row in that endpoint and must never be inferred "working" from it. We will not use the existing global "any role is working" flag for per-agent status, because applying one agent's working state to all three is a false claim on a prominent surface.
- Mira's setup state comes from `useMiraEnabled()`. While that probe is unresolved (`enabled === undefined`), the band shows a neutral checking state or omits the status line. It never flashes "Not set up" during loading, because that is a false claim until the probe resolves.
- Status copy is honest and high level: a clear word or short phrase for working, ready, asleep (halted), or not set up. No fabricated specifics (no invented client names or counts), because no honest per-agent specific is on the wire here.

**Motion budget:** at most one breathing avatar in the viewport. Exactly one band tile animates: the first agent that is genuinely working (correctly attributed). Reduced motion strips it (the avatar reads the media query internally). The agent panel overlay's avatar is identity-only and static, and Home imports no other motion, so the budget holds across the viewport.

**No value strip in this slice (a deliberate honesty call):** the spec proposes a cumulative "since you hired your team" value strip. There is no honest data source for it today. The per-agent metrics endpoint serves only the current week; the lifetime window (`window=all`) returns HTTP 400 at the proxy, the API, and core. There is no "money saved" or "value created" field anywhere (only real ad spend, which is a cost, and operator target estimates). A strip captioned "since you hired your team" populated with seven-day counts would be a timeframe fabrication that the small per-cell eyebrow cannot rescue, and it would duplicate the adjacent `ThisWeek` weekly-numbers section. The honest answer is real-or-absent: the cumulative strip is absent until a real cumulative source exists, and it ships in the future PR that adds the lifetime metrics window. This is documented, not silently dropped. The band's honest content is the crew, their names, and their live status, which is real-time and useful.

**Accessibility:** each tile is a button that opens the agent panel. The decorative pixel avatar stays `aria-hidden`; the button carries an accessible name that conveys it opens a panel (for example "Open Alex"). Keyboard order is Alex, Riley, Mira. Agent hues stay identity-only: they color the portrait ground and the status accent, never a tile border-as-control, focus ring, hover background, or any action surface (the one amber rule and identity-only rule both hold).

**Voice and style:** the band heading is explicitly not italic (the shared `.moduleH` heading style is italic, which the no-italics non-negotiable forbids; the band uses a non-italic heading). No em-dashes in any band copy.

**Cleanup:** delete `team-pulse.tsx` and its test, and remove the orphaned `.pulseRibbon` and `.agentChip*` rules from `home.module.css` (it is a CSS Module, and vitest runs with `css: false`, so no test asserts class names and class churn is safe). Update every `agent-chip-{key}` test-id assertion site in `home-page.test.tsx` to the band's test-ids, preserving the module-order and panel-open assertions.

---

## 4. Non-negotiables honored

- One amber action color; agent hues identity-only (portrait grounds and status accents only).
- Honest voice, real-or-absent: no fabricated numbers, no cumulative value strip until a real source exists, no false "Not set up" during loading, correct per-agent status attribution.
- No em-dashes, no italics.
- Mobile-first with a working desktop composition; reduced motion strips animation and holds the one-breathing-avatar budget.
- Shipped `hsl(var(--x))` tokens only; the sprite's internal hex palette is the established exception (Alex and Riley sprites use the same pattern).

---

## 5. Decisions and rejected alternatives

- **Drop the value strip (vs ship it scope-bound).** Rejected shipping it because every framing available today is either dishonest (lifetime caption over weekly data) or redundant (a second weekly-numbers block beside `ThisWeek`). Both adversarial reviews independently reached this conclusion.
- **Keep the band permanent at hero scale (vs first-run only).** Rejected first-run-only because the mission and the parent spec want the crew permanently onstage (the soul-offstage fix). Daily-fatigue and real-estate concerns are mitigated by placing the band after the critical decision surfaces, keeping it calm (one breathing avatar, honest status, no numeric strip), and making the status live and useful so it earns its place.
- **One stable 96px (vs responsive 96/112 via a JS hook).** Rejected the hook because 112px overflows the 1024px desktop bento main column, and a mount-time size change causes a layout shift. 96px fits everywhere with no hook and no shift. The sprite is a vector SVG, so it stays crisp at any size; a larger desktop hero is a clean container-query follow-on.
- **One implementation PR with separable commits (vs two stacked impl PRs).** The sprite and band are separable concerns, but stacking two impl PRs on the unmerged #844 base doubles the squash-divergence and CI-retrigger hazard for near-zero isolation. We keep them as cleanly separable commits in one impl PR on #844, with screenshots of both surfaces. If #844 merges to main before this work finishes, we split into two non-stacked PRs off main.

---

## 6. Open items and follow-ons (named so they are not lost)

- The cumulative "since you hired your team" value strip ships when the lifetime metrics window (`window=all`) lands.
- A larger desktop hero scale (up to 112px) via a container query or a fluid-sizing avatar mode, once the band can claim more than the bento main column's width.
- Unifying the `/mira` cockpit desk (and the Alex and Riley cockpits) onto the printed-portrait sprite, with a reduced-motion-safe `SpriteFrame`.
- A known pre-existing no-italics violation in the agent panel's activation copy (`key-result.tsx` uses an emphasis element) is outside this slice and noted for the voice-guard pass.

---

## 7. Test plan summary

- Sprite: bundle-shape validation (24x24 rows, four states, positive durations, palette keys resolve) and a `MIRA_VARIANTS[DEFAULT_MIRA_VARIANT]` guard; the three letter-to-svg assertions flip.
- Band: renders all three names; Mira's honest not-set-up and loading states; tiles are buttons firing `onOpenAgent` for all three including Mira; exactly one tile has `data-playing` true (motion budget) and reduced motion zeroes it; correct per-agent status attribution using role-keyed `DerivedAgentStateEntry` fixtures (responder working, optimizer working, operator working, halted, Mira loading, Mira disabled); empty agent list renders no tiles.
- Home: all `agent-chip` test-id sites updated to band test-ids with order and panel-open assertions preserved.
- Gates: full dashboard vitest, typecheck, `next build`, and `format:check`, plus live screenshots of Home (and the cockpit if wired) when the dev environment boots.
