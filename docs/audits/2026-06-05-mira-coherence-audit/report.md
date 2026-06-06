# Mira UI/UX Coherence Audit (2026-06-05)

**Method:** 5 parallel audit subagents (tokens/materials, typography/voice, identity/components, UX flows, canonical-pattern inventory) + adversarial verification of every critical/high finding + a live visual pass (dev stack booted, 9 screenshots + computed-style probes). Raw structured findings: `findings-raw.json`. Screenshots in this directory.

**Canon ground truth:** the locked warm-newsprint aesthetic spec (PR #845 branch `docs/app-aesthetic-direction`, not yet on main), `globals.css` token source, `token-governance.test.ts` guards, `docs/voice/in-app-voice.md`, and the shipped Home/Inbox/Results surfaces.

## Verdict

Mira's surfaces are functionally honest (no fake data, honest-idle status, friction on Continue/Stop) but they wear the retired 2026-05-31 cockpit register inside the 2026-06-03+ warm-newsprint app. The split is precise: **everywhere another surface hosts Mira she is coherent** (Home TeamBand poster, Inbox avatar chips, Results peer card, the agent-panel sheet header). **Every surface Mira owns is the old register** (Director's Desk, review feed, creative detail, the panel body).

Nearly everything needed to fix it already exists: her `maker` sprite, `PrintedPortraitAvatar`, the Fraunces/Geist/mono tokens, the shadow ladder, the inbox commit-moment pattern. This is adoption work, not new design work.

| Dimension | Grade | One-liner |
|---|---|---|
| Tokens, color, materials | C | Colors ride migrated `T` aliases, but radius-8 flat cards, raw `#000/#fff` feed literals, violet-as-action |
| Typography & voice | D | Zero Fraunces on Mira surfaces; raw `"JetBrains Mono"` string + faux-bold 700; em-dashes in core greeting |
| Identity & components | D | Violet letter-"M" monogram on every owned surface; sprite never renders where she lives; panel is a stub |
| UX flows & IA | C | Keep/Pass breaks the commit-moment canon; Pass is irreversible yet zero-friction; dark feed is the loudest surface |
| Canon itself (reference) | B+ | Internally consistent; 5 minor internal drifts cataloged (E1-E5), incl. the one sanctioned violet CTA |

## What is already coherent (do not redo)

- Geist body + cream canvas + grain apply on ALL `/mira` routes (live-probed: `.app-header` present, `bodyFont: Geist`, `bodyBg: rgb(244,241,236)`)
- Amber is the committing-action color on Continue/Review CTAs (via `T.amber` = `hsl(var(--action))`)
- Honest copy throughout ("Draft only. Not published. Nothing goes live without you."), no `generate` verbs
- Desk uses `QueryStates`/`ConnectionTrouble` (the feed and detail do not)
- TeamBand, Inbox avatar, Results card, panel sheet-header all render Mira canonically
- Un-keep exists on the kept shelf (reversible Keep, per spec)

## Theme 1: identity. Retire the violet "M" (highest leverage)

Verified findings A3, A4, C1-C4, D3. `PrintedPortraitAvatar` already wires `mira: { bundle: MIRA_VARIANTS, variant: "maker" }` (`printed-portrait-avatar.tsx:25`) and is imported NOWHERE under `components/cockpit/mira/` or `app/(auth)/mira/`.

- Desk header: `mira-desk-page.tsx:44` passes no `bundle` to cockpit `Identity` so `SpriteFrame` falls back to the letter "M" (`identity.tsx:62,72-79`; `sprite-frame.tsx:45-52`)
- Feed header: same at `mira-feed-page.tsx:42`
- Panel body: bespoke CSS "M" disc `mira-panel.tsx:19` AND `:35` (both branches), directly contradicting its own sheet header 2 lines up (`agent-panel.tsx:93` renders her real sprite)
- Her draft-state animation (mint viewfinder + REC dot, `mira-variants.ts:78`) is dead code on her own surfaces; only fires where TeamBand-style status wiring exists
- `MIRA_ACCENT.soft` 30%-alpha violet ground is off-canon vs the opaque `--mira-ground` printed-portrait treatment

## Theme 2: typography. Zero display face + a mono lie

Verified findings B1, B2 (corrected to line 24), B4, B5, A5.

- No Fraunces anywhere in cockpit/mira (grep-confirmed). Name 22px Geist (`identity.tsx:84`), detail h1 20px Geist (`creative-detail-page.tsx:41`), brief h2 15px (`mira-brief-box.tsx:88`, also below display scale entirely), hero numeral 36px Geist (`mira-ready-to-review.tsx:36`)
- Raw `fontFamily: "JetBrains Mono"` string at 8 sites (ready-to-review:24, in-production-tray:40+84, kept-shelf:26, identity.tsx:105, creative-detail-page:105/238/313): matches only a system-installed face, and `fontWeight: 700` is synthetic (loader cut = 400/500/600). Guards are CSS-only so this passes CI
- Canon: agent name = Fraunces + deep ink (`inbox.css:586-596`), numerals = `.num` mono tabular (`globals.css:1404`), eyebrows = `var(--mono)` 500

## Theme 3: commit moment. Keep/Pass breaks the canon

Verified findings D1, D2.

- Keep/Pass fire-and-dismiss with no optimistic toast, no Undo, no 409 already-handled reconciliation (`mira-clip-actions.tsx:140`); inbox canon = optimistic + branded Undo + silent-409 (`inbox-decision-item.tsx:42-52`, `use-recommendation-action.ts:25`). The reverse mutation already exists (`mira-kept-shelf.tsx:82`, `decision: null`)
- Friction inversion: Pass is the most irreversible gesture (no un-pass) yet the only zero-friction one; reversible Keep and cost-gated Continue both confirm
- `use-review-decision.ts:22` throws on 409 instead of swallowing as silent success

## Theme 4: the dark feed needs a register decision

Findings A1 (verified), D5, D8 + live screenshots (`mira-feed.png`, `mira-feed-mobile.png`).

- Feed paints raw `#000/#fff/#777/#bbb/#555/rgba(...)` across 5 files; globals sanctions NO pure-black authed material (the only dark = warm charcoal `30 8% 8%`; spec dark variant = `#16140E`, grain off, never pure black)
- At desktop it renders as a black void inside the cream shell (sidebar + masthead + light identity band remain); the loudest surface in the app on a decision screen
- Autoplay + scroll-snap with no `prefers-reduced-motion` branch (canon avatar reads the OS preference, `printed-portrait-avatar.tsx:44-58`)
- Two coherent exits: (a) keep immersive but re-skin to a sanctioned, tokenized warm-charcoal "night register" (scoped token set like `inbox-design-base.css:16-73`), or (b) move review onto the warm ground as a printed contact-sheet. Operator call.

## Theme 5: surface material + identity-as-action

Findings A2, A6, A7, A8 + E4.

- Desk cards: flat hairline boxes radius 8, no shadow step (canon: radius 18-20 + `var(--shadow-card)` + `--hair-soft`; `agent-panel.module.css:284`, `home.module.css:214`)
- Violet backs interactive fills: feed Keep button (`mira-clip-actions.tsx:145`), brief-box selection chips (`mira-brief-box.tsx:62-64`), panel `miraOpenCta` (`agent-panel.module.css:807`, the ONE identity-on-action edge in the canon itself; E4 says re-classify or amber it). Spec non-negotiable: identity hues never back an action
- `#F6ECEC` stop wash hardcoded (`creative-detail-page.tsx:305`); spec risk tint is `--risk-tint #F5E8E3` (or add a `token-debt:` expiry marker)
- Raw `"#fff"` button text at 7 sites instead of `--action-foreground` (breaks future dark toggle)

## Theme 6: panel parity

Findings C5, D4 (verified) + live `mira-panel.png`.

- Enabled org with 3 reviewable drafts still sees a static "Mira is set up" stub + violet CTA; Alex/Riley get IdentityStatus/KeyResult/OpenDecisions/WorkLog
- Slots are type-fenced `Exclude<PanelAgentKey, "mira">` (`key-result.tsx:18`, `work-log.tsx:13`)
- `useMiraDesk` already exposes `readyToReviewCount` for a KeyResult-shaped hero

## Theme 7: states, motion, IA, copy polish

- Feed hand-rolls error/empty (plain gray divs, no `role=alert`); desk already uses `QueryStates` (C6)
- Clip-actions + detail re-implement confirm overlays with bespoke rgba boxes instead of `.ds-action`/ConfirmInline (C7, C8)
- Halt inconsistency: brief box + feed honor halt; desk hero CTA + detail Continue/Stop ignore it (D10)
- Loading skeleton = 3 gray blocks vs Home's structured shell (D9)
- IA: desktop sidebar has Mira (with sprite icon); the masthead/mobile primary nav (Home/Inbox/Results) buries her in Tools overflow; she is the only agent with a route and the only one whose route is buried (D6). Decide: panel-first like Alex/Riley, or promote the route
- Em-dashes in core-side greeting copy render live on the desk (`packages/core/src/agent-home/greeting.ts:156,211,218,222` + detail `page.tsx:5` metadata); dashboard voice guard cannot see packages/core (B6)
- 5 copy-bearing mira files missing from the voice corpus (B7): clip-card, feed-page, ready-to-review, kept-shelf, in-production-tray

## New live bugs (from the visual pass, not in the static audit)

1. **Hydration mismatch on `/mira` + `/mira/review`**: cockpit `Identity` subtitle renders plain text on server vs a mission-edit `<button>` on client (distinct from the known shell tools-overflow warning)
2. **Greeting line "You've got 1 drafts"** renders live on desk + feed headers: wrong count (3 ready) AND broken pluralization (known `useAgentGreeting`-era bug, still live)
3. **CSP blocks demo media**: `default-src 'self'` with no `media-src` for `storage.googleapis.com` so feed/detail/shelf videos and posters fail in dev (kept-shelf shows a broken-image glyph)
4. **Floating "Continue draft" button collides with the DEV badge** (feed desktop, bottom-right)
5. **Duplicate Halt affordances** on mobile desk: masthead `Halt` + identity `HALT` pill simultaneously
6. **Mono subtitle wraps to 3 lines** on mobile desk header
7. Blue operator-chat widget + dev "1 Issue" pill collide with content on mobile (pre-existing; Wave-0 #825 unmerged, not Mira-specific)

## Recommended slicing

**PR-0 quick-wins (hours, no design decisions):** panel avatar swap both branches (C4) · `T.actionFg` + replace 7 raw `#fff` (A8) · `T.mono` + replace 8 raw mono strings + drop 700 to 600 (B2) · hero numeral to mono tabular (B4) · `--risk-tint` or token-debt marker (A7) · voice-corpus ratchet +5 files (B7) · de-em-dash greeting.ts (B6) · skeleton parity (D9) · CSP `media-src` for dev.

**PR-1 "Mira joins the crew" (the visible reskin):** desk + feed headers to `PrintedPortraitAvatar` + Fraunces name in deep ink + status wiring so the draft animation can fire (C1/C2/C3, B1) · desk card anatomy to radius-lg + shadow-card (A2) · detail h1 + brief h2 to display face (B5) · desk shell onto the canvas wrapper · violet fills per the Keep decision (A6) · hydration fix + greeting count/plural fix · halt on hero CTA + detail (D10).

**PR-2 commit-moment parity:** Keep/Pass optimistic + branded Undo + silent-409 + Pass recovery (D1/D2) · confirms onto `.ds-action`/ConfirmInline (C7/C8) · feed states onto QueryStates (C6).

**PR-3 the feed register (after the operator decision):** tokenized warm-charcoal night register OR warm contact-sheet; reduced-motion path either way (A1/D5/D8).

**PR-4 panel parity (scope with M1 backlog):** lift type fences, IdentityStatus + KeyResult(readyToReviewCount) + route-out (C5/D4).

**Guard PR (so it cannot drift back):** extend token-governance sweeps to inline TSX styles (raw font families, non-token radii, neutral surface literals); consider a core-side copy lint for agent-voice strings.

## Operator decisions (LOCKED 2026-06-05)

1. **Dark feed: warm-charcoal night register.** Keep the immersive full-bleed triage; re-skin to a sanctioned, tokenized warm charcoal (`#16140E` family per spec dark variant, amber preserved, grain off). Define a scoped feed token set (model: `inbox-design-base.css:16-73`) and add a reduced-motion path.
2. **Keep = amber commit.** Keep fills with `--action` like every other commit; Pass becomes the quiet ghost. Violet returns to identity-only (avatar, tints, edges). Brief-box selection chips also drop the violet fill.
3. **IA: keep the route + mobile parity.** The desk is a real workspace, so the per-agent asymmetry is honest. `/mira` joins the mobile primary nav (today it is desktop-sidebar-only and buried in Tools overflow on mobile).
4. **Panel: minimal now, full later.** PR-0/1 swap the avatar (both branches) and add a live drafts-ready count line via `useMiraDesk().readyToReviewCount`; full 4-slot parity lands with the M1 enablement backlog.

## Canon-side findings worth fixing independently (E1-E5)

- `inbox.css` white literals at 213/906/1163/1360/1404 should use `--action-foreground` (E1)
- Raw rgba agent-hue edges `inbox.css:628-630` should ride `--agent-*` tokens (E2)
- `miraOpenCta` violet fill is the canon's one identity-on-action contradiction (E4)
- Radius divergence is real inside the canon: Home/Inbox 20 vs Results 6; pick deliberately before re-skinning Mira to either (E openQuestions)
