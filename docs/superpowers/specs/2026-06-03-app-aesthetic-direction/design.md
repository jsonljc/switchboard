# Switchboard app aesthetic direction (LOCKED)

**Status:** Locked 2026-06-03. This is the canonical visual direction for the authed product app (Home, Inbox, Results, agent cockpits). It supersedes the "aesthetics paused" note and the earlier liquid-glass lean.

**One line:** the calm of Linear, printed like a warm riso zine, starring a pixel crew you love.

---

## 1. How we got here

1. The 2026-06-02 UI/UX feel audit (`docs/audits/2026-06-02-ui-ux-feel-audit/`) shipped Wave 0 and named Wave 1 token unification as the keystone. It also left the visual re-skin paused on one open question: does the look work with the 8-bit pixel avatars.
2. The user committed to 8-bit avatars for Alex, Riley, and Mira, and asked to re-explore the aesthetic "avatars-first."
3. A six-way parallel design fan-out built fully-resolved, comparable mockups of six directions (Broadsheet, Liquid Warmth, Operator Console, Your Team, Quiet Modern, Warm Risograph), each using the real Alex and Riley sprites.
4. The user liked three: Your Team, Quiet Modern, Warm Risograph, and chose a **balanced** fusion.
5. The fusion was built, reviewed, and cleaned (scaffolding removed, all em-dashes removed, no italics). Locked here.

Full record: the six alternatives plus the chosen fusion are preserved in this folder (`mockups/`, `shots/`, `gallery.html`).

---

## 2. The direction

A clear three-layer hierarchy, each ingredient assigned to one job so they never fight:

| Layer | Source | Job |
|---|---|---|
| **Structure and all money / decision surfaces** | Quiet Modern | Restraint wins. Warm off-white, hairline calm, generous whitespace, clean grotesk, tabular numerics. The approval screen, inbox cards, and "what this changes" panel are the calmest, most legible surfaces. No grain, no ink-offset, no cushions here. Trust lives here. |
| **Emotional peaks (hero, "meet your team", Home team band)** | Your Team | Character wins. The crew is celebrated large (96 to 120px) on identity-hue grounds with a live status. Agents stay small and serious inside the money flow. |
| **Identity and texture through-line** | Warm Risograph | The ownable signature, used with restraint: a subtle paper grain on the canvas only, and the "printed portrait" avatar frame (pixel face on an identity-ink chip with a 1px ink-offset halo) so the pixels feel struck in the same press. |

What ties it together: one amber action color, one grain layer (canvas only), one printed-portrait avatar frame.

---

## 3. Non-negotiables

- **One action color.** Operator-amber backs every commit, approve, and primary button. Nothing else is an action color, ever.
- **Agent identity hues are identity only.** Alex amber-coral, Riley plum-indigo, Mira violet. They never back an action button.
- **Honest voice, no placeholders.** Where money or a client is involved, show real values or omit cleanly. Never a placeholder. Use "handled, booked, answered, attributed," never "generated." Agents speak first person and never blame.
- **AA legibility at the money moment.** Approve and spend text and buttons hit WCAG AA (4.5:1 or better) on their real background. Glass, grain, and texture never sit behind dense money data.
- **Calm motion budget.** At most one continuously-animated avatar per viewport. Reduced motion strips all animation and the grain.
- **Mobile-first, with a real desktop composition.**
- **No em-dashes** in any copy. Use commas, periods, colons, parentheses, or restructure. (See `feedback_no_em_dashes` in memory.)
- **No italics.** Fraunces is used upright-optical only.

---

## 4. Canonical tokens (hand to engineering)

These define the single source of truth that Wave 1 token unification builds. Values are the locked mockup's tokens.

```css
/* ============ COLOR ============ */
--paper:        #F7F4EE;   /* app canvas (warm off-white) */
--paper-sunk:   #F1EDE4;   /* recessed wells */
--card:         #FFFFFF;   /* money / decision surfaces */
--card-2:       #FCFBF7;   /* second-level card */
/* ink ramp (warm, never pure black) */
--ink:   #1C1A16;  --ink-2: #544F47;  --ink-3: #877F71;  --ink-4: #B0A795;
/* hairlines */
--line:  #E6E0D5;  --line-soft: #EEE9DF;  --line-strong: #DAD3C5;

/* THE ONE ACTION COLOR (operator amber) */
--amber:        #985905;   /* label / icon amber, 6.1:1 on #FFF (AA) */
--amber-btn:    #A25C00;   /* button fill, white text 5.5:1 (AA) */
--amber-btn-hi: #B56A07;   /* hover */
--amber-press:  #8A5200;   /* active */
--amber-wash:   #FBF0E0;   /* faint field */
--amber-edge:   #EFD8B4;   /* amber hairline */

/* AGENT IDENTITY INKS (identity only, never an action). text / ground / halo / edge */
--alex:  #A4571F;  --alex-ground:  #F6E6D6;  --alex-halo:  #8A4517;  --alex-edge:  #EAD4BF; /* text 4.9:1 */
--riley: #5A53B4;  --riley-ground: #E8E5F6;  --riley-halo: #443D96;  --riley-edge: #D9D4EF; /* text 5.2:1 */
--mira:  #6E4FB8;  --mira-ground:  #E9E1F6;  --mira-halo:  #553A9C;  --mira-edge:  #DCD0F0; /* text 5.0:1 */

/* SEMANTIC (calm) */
--risk: #A2493A;  --risk-tint: #F5E8E3;  --risk-edge: #ECCFC6;   /* high-risk = dusty terracotta, not alarm red */
--good: #3C7A52;  --good-tint: #E6F0E7;  --good-edge: #D2E3D6;   /* booked = calm green */

/* ============ TYPE ============ */
--font-display: "Fraunces", ui-serif, Georgia, serif;     /* upright optical, NO italics */
--font-body:    "Geist", ui-sans-serif, system-ui, sans-serif;
--font-mono:    "Geist Mono", ui-monospace, monospace;
/* numeric: font-variant-numeric: tabular-nums; "tnum" on ALL money / counts */
/* SCALE (px / weight / tracking)
   verdict hero   32 / 600 (who 700) / -.02em      [display]
   poster title   34 / 700 / -.025em               [display]
   inbox title    30 / 700 / -.025em               [display]
   sheet proposal 22 / 600 / -.018em               [display]
   value numerics 26 / 600 / -.02em                [display, tabular]
   greeting       18 / 500 / -.01em                [display]
   card body    14.5 / 450 / -.006em               [body]
   button         14 / 600 / -.01em                [body]
   meta / label 10.5 to 12 / 600 / .08 to .16em UPPER  [body] */

/* ============ SPACING ============ */
/* 4, 6, 8, 9, 12, 14, 17, 18, 22, 30 (px). card pad 17; body gutter 22; section gap 30 */

/* ============ RADII ============ */
--r-xs:8; --r-sm:11; --r-md:14; --r-lg:18; --r-xl:24; --r-pill:999;
/* hero portrait chip 20 / small portrait chip 8 */

/* ============ ELEVATION LADDER (barely there) ============ */
--sh-1: 0 1px 2px rgba(28,26,22,.04), 0 1px 1px rgba(28,26,22,.03);                          /* cards at rest */
--sh-2: 0 1px 2px rgba(28,26,22,.04), 0 4px 12px rgba(28,26,22,.05);                         /* card hover */
--sh-3: 0 2px 4px rgba(28,26,22,.04), 0 10px 30px rgba(28,26,22,.08), 0 2px 8px rgba(28,26,22,.04); /* lifted */
--sh-amber: 0 1px 2px rgba(120,72,8,.10), 0 6px 18px rgba(120,72,8,.16);                     /* primary button */

/* ============ AVATAR printed-portrait frame ============ */
/* wrapper .pp:  background = identity GROUND; inset box-shadow 1px = identity EDGE; padding 2px (7px at hero) */
/* halo .pp::before: identity HALO ink, translate(1px,1px) [2px at hero], z-index -1, opacity .85 */
/* plate: overflow hidden, place-items end center; sprite SVG fills 100%, image-rendering pixelated */
/* radius: 8px chip / 6px plate  (20px chip / 14px plate at hero) */
/* sizes: byline and chips 24 to 28px; roster 46px; sheet 18 to 30px; hero poster 104 to 112px */

/* ============ GRAIN ============ */
/* SVG feTurbulence baseFrequency .88, numOctaves 2, stitchTiles stitch, seed 7;
   feColorMatrix to a warm dark ink, alpha .85; full-bleed rect, opacity .42, mix-blend-mode multiply.
   CANVAS ONLY, never on cards / buttons / money; poster hero uses opacity .34.
   OFF in dark variant and under prefers-reduced-motion. */

/* ============ MOTION ============ */
--ease: cubic-bezier(.22,.61,.36,1);  --ease-soft: cubic-bezier(.33,.1,.25,1);
/* pulse 2.6s; breathe 2.8s; card hover .25s; button press .12s; Undo ring drain 12s.
   Budget: one breathing avatar dot per viewport; reduced-motion strips all animation and grain. */

/* ============ DARK variant ============ */
/* .dk override: canvas #16140E, amber #E5A24A, agent inks lifted; grain disabled. */
```

---

## 5. Surface-by-surface intent

- **Home (evening briefing):** masthead, Fraunces verdict hero with the lead agent's name in their identity ink, humanized sub-line (never raw minutes), a "needs you" stack (handoff and approval cards), a "your team today" band with the three printed-portrait characters and live status, the cumulative "since you hired your team" value strip, and Alex's signed week-note (the love-worthy editorial moment), signed simply "Alex".
- **Inbox (the queue):** calm decision cards, agent byline with a small printed-portrait, plain-English risk pills (high-risk in dusty terracotta), clear "tap to review" and "swipe" affordances.
- **The commit moment (approval detail):** the most finished surface. Pure Quiet Modern calm: Fraunces proposal headline, a clean facts table (offer, reason, channel, recipient), plain-English risk chips, a "what this changes" panel that lists only known facts and states what does not change, an AA amber "Approve offer" button, and a branded Undo with a real countdown. No grain or texture on this surface.
- **Meet your team (hero):** the emotional peak. The crew at hero scale as printed portraits on their identity grounds, with the distinct Mira sprite.
- **Desktop:** sidebar nav with a mini printed-portrait roster, centered briefing, right rail for the value strip and Alex's note.
- **Dark variant:** warm charcoal canvas, lifted agent inks, amber preserved, grain off.

---

## 6. The avatar system

- **One frame everywhere: the printed portrait.** The crisp pixel face sits on an identity-ink ground chip with a 1px ink-offset halo. Small and serious in money flows (24 to 28px), large and celebrated at the hero (104 to 112px). Pixels stay crisp (image-rendering pixelated, never blurred or scaled-soft). This single treatment replaces the current fragmented avatar systems (the flat letter-discs on Home, the sprite faces in Inbox, the violet "M" square for Mira).
- **Mira needs a real sprite.** The mockup proposes a distinct Mira (short violet bob, blunt bangs, a viewfinder accent on a violet creative top), clearly not a Riley recolor. This is a proposal. Drawing Mira's real 24x24 sprite (same grid and palette discipline as `alex-variants.ts` / `riley-variants.ts`) is an open deliverable.

---

## 7. Implementation mapping (this is the Wave-1 token foundation)

- The tokens above are the single source of truth that Wave 1 token unification collapses the four existing systems onto. In particular, `apps/dashboard/src/components/cockpit/tokens.ts` (currently 18 literal hex values) is rewritten to `hsl(var(--...))` / these variables, and the per-agent hue duplicates (`#E07A53`, the hand-rolled `#4A3A66` Mira, the v6 coral) collapse to the single `--alex` / `--riley` / `--mira` definitions in `globals.css`.
- The printed-portrait frame becomes one shared avatar component used on Home, Inbox rows, the agent panel, and Mira's desk, fed by real agent status (working, watching, asleep). This also closes the "soul offstage" gap (agents hardcoded to `state="idle"`).
- Money surfaces adopt the Quiet Modern restraint and the honest "what this changes" pattern. The grain and the printed-portrait offset are scoped off money surfaces.
- Verify everything live, not only via CI: the dashboard ESLint lint is stubbed and CI format:check is `*.ts` only, so CSS and `.tsx` complexity are not CI-gated. Check contrast and the cascade against the running app.

---

## 8. Open items and risks

- Mira's real sprite (above).
- Fraunces is the load-bearing personality face. Self-host it in production so a font-load failure does not flatten the character.
- Keep the grain subtle (the single texture) and off money surfaces, or the "calm" promise breaks.
- Identity inks are tuned to AA on the warm `--paper`. Re-verify if the canvas value ever shifts.

---

## 9. Reference artifacts (in this folder)

- `mockups/fused/index.html` is the locked direction (self-contained, opens offline).
- `gallery.html` compares the locked direction against the six explored directions.
- `mockups/<slug>/index.html` are the six alternatives (your-team, quiet-modern, warm-riso, broadsheet, liquid-warmth, operator-console).
- `shots/*.png` are full-page screenshots of each.
- `BRIEF.md` is the brief every direction was built against. `AVATARS.md` documents the sprite renderer.
