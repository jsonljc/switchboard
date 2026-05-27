# Switchboard — Customer UI/UX Overhaul (Blueprint Spec)

- **Date:** 2026-05-24
- **Status:** Design approved in brainstorm; ready for implementation planning
- **Scope:** The entire customer-facing experience — replaces the per-agent cockpit model with a single, mobile-first "Front Desk."
- **North star (the rubric for every decision):** a non-technical medspa/aesthetic-clinic **owner's 2-minute, phone-first check-in.** Daily-use efficiency over everything.

---

## 1. Summary

Today Switchboard presents itself as a governance console split across many surfaces and visual languages. This overhaul reduces the owner's world to **three places — Home · Inbox · Results** — with the AI agents (Alex, Riley, Mira) present everywhere as teammates but navigable nowhere as "dashboards." The owner opens the app, sees whether anything needs them, sees whether the business is okay, acts in one tap, and leaves. The look is **"Warm operational editorial"**: a calm cream interface, subtle per-agent identity colors, one shared amber action system.

This is one blueprint. The **build is phased** (§12); the first implementation plan covers the Foundation + Home.

---

## 2. Why now — audit verdict

A five-stream audit (2026-05-24) scored the current product:

| Dimension              | Score |
| ---------------------- | ----- |
| Visual coherence       | 4/10  |
| Daily-use efficiency   | 3/10  |
| First-run / continuity | 5/10  |

The findings that motivate a teardown rather than a polish:

- **The pause button is fake.** Halt/Pause (header, cockpit, ⌘H) only writes `localStorage`; it never calls the wired `/api/dashboard/governance/halt`. The owner believes they stopped the agents — they didn't. _(Correctness/safety, not just UX.)_
- **There is no authenticated front door.** Login and post-onboarding land on the public marketing page; the in-app "Home" link bounces back to marketing.
- **Double headers** on every cockpit (`/alex`, `/riley`) — two wordmarks, two avatars, two nav models.
- **Seven visual registers**, four "creams," ≥7 accent families; the defined "operator amber" is used **zero** times; the cockpits are ~175 inline-hex values that cannot theme.
- **No self-serve signup** — every CTA is a `mailto:` to sales (a registration API exists with no UI).
- **Three overlapping "what needs me" surfaces** (Live popover, Inbox drawer, in-cockpit feed) over **two approval backends** that can disagree; the cockpit "Open report →" is a dead button.

---

## 3. The user & the research basis

The owner is **non-technical, mobile-first, time-starved** — software literacy ≈ Instagram + Square + WhatsApp + Google reviews. They are fluent in: a snapshot-of-the-day home, tap-card→detail, swipe actions, a unified inbox, push→tap→act, color-coded status, **one-tap approve-the-draft** (they already do this for Google review replies), and opinionated defaults. They actively **punish complexity** ("too many clicks," "too many features" are the top Mindbody/Zenoti complaints) and reward "beauty, not tech" (Mangomint, GlossGenius).

Independent research into AI-agent products (Intercom Fin, Salesloft, Lindy, Relevance, Beam, Artisan, Reply.io) converged on the same spine this spec adopts: a prioritized **"needs you" queue** with a calm all-clear state, **decision-ready cards** (action + why + evidence + confidence → one tap), **confidence routing** so only the ambiguous middle reaches the human, **approve from messaging without opening the app**, and agents framed as **named teammates**.

---

## 4. Information architecture — **FROZEN**

The IA is locked. The visual pass (§9) is skin-only and may not move, rename, or merge any surface.

```
PRE-AUTH
  /                     Marketing landing — unify the seam (later phase)
  /login · /post-auth   Auth — restyled to one system, lands on Home
  /privacy · /terms     Legal

ONBOARDING
  /onboarding           Setup wizard + the Simulator (the "Try Alex" magic moment)

THE PRODUCT (authed)
 ┌ PRIMARY (the three places the owner can stand) ─────────
 │  /        →  HOME — the front door & daily check-in
 │               Team Pulse · Needs You · This Week ·
 │               While You Slept · Work in Progress · Permissions
 │               agent chips → light panels
 │  /inbox   →  INBOX — the full decision queue (list + detail)
 │  /results →  RESULTS — ROI / attribution, with period controls
 └─────────────────────────────────────────────────────────
 ┌ DRILL-INS (reached from a card/number/chip, not nav peers) ─
 │  /inbox/[id]      decision detail (Voice + "Why" + actions)
 │  /contacts/[id]   the lead / conversation thread ("see the lead")
 │  agent light panel  sheet over Home (status · key result · open
 │                     decisions · work log · one safety action)
 │  /activity        "view all" deep log (from While You Slept)
 │  /plays/[id]      a running multi-agent work-run
 └─────────────────────────────────────────────────────────
 ┌ TUCKED (under the avatar menu) ─────────────────────────
 │  /settings/*      minimal, modes-not-knobs; integrations,
 │                   autonomy modes, billing, legal
 └─────────────────────────────────────────────────────────
  /approve/[token]   public single-use push-to-approve (no app load)

❌ KILLED: /automations (→ settings) · standalone /activity as a nav peer ·
   /alex · /riley as full cockpits (→ light panels) · /operator (internal)
```

**Nav model:** mobile bottom-tabs `Home · Inbox · Results` + a notification bell & avatar; desktop mirrors it in one top bar. **"Team" is deliberately NOT a tab** — a Team destination would quietly reopen the per-agent-cockpit sprawl. Agents are _presence_ (the Team Pulse ribbon), a _filter_ (in Inbox), and a _drill-in_ (the light panel) — never a place you navigate to. **Home remains the product.**

---

## 5. Vocabulary, voice & copy rules

**Hard rule: the owner never learns internal language. Every visible label names an outcome, not a concept.**

| Internal (product/eng)       | Visible to the owner                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| The Floor                    | **Home** — hero: _"Your team is on shift."_                                            |
| Agents                       | **Team Pulse** (ribbon) → Alex · Riley · Mira                                          |
| Today's Score                | **This Week** (Home module = current week, no toggle; period controls live in Results) |
| Active Plays                 | **Work in Progress** — outcome-phrased cards                                           |
| Live narration / Notepad     | **Work Log** — clean, factual, timestamped                                             |
| Thinking Panel _(in a card)_ | **"Why Alex recommends this"**                                                         |
| Trust tier                   | **Permissions** — "what each agent can do without you"                                 |
| Decisions / queue            | **Needs You** (Home) · **Inbox** (full queue)                                          |

- **Work Log guardrail:** factual timestamped actions, **never introspection.** ✅ `9:44a — Drafted replies for your approval` ❌ `Thinking through pricing objections…`
- **Agent voice:** first-person, warm, specific, no AI self-reference, no exclamation/emoji, past tense for done / present for active / conditional for proposals. The serif voice paragraph (This Week) is the _one_ editorial flourish; everything else is clean sans.

---

## 6. Surfaces (approved wireframes)

Mobile is the source of truth; desktop is the same modules, widened. (Agent shown: Riley = ad/lead; Alex = bookings; Mira = content.)

### 6.1 Home — active state (2 decisions waiting)

```
┌───────────────────────────────────┐
│ Good morning, Dana          🔔• ◯ │  greeting · bell(unread) · avatar
│ Glow Aesthetics                   │  org, small
├───────────────────────────────────┤
│ ● Alex   ● Riley   ● Mira  on shift│  TEAM PULSE — live dots, tappable
╞═══════════════════════════════════╡  (tap a chip → light panel)
│ NEEDS YOU                      2  │  ← first. amber when >0
│ ┌───────────────────────────────┐ │
│ │ ◐ Riley · ad budget           │ │  Voice Block: avatar + name
│ │ Move $300 from the slow ad to │ │  plain-language ask
│ │ the one booking consults at   │ │
│ │ $14 each?                     │ │
│ │ ⌄ Why Riley recommends this   │ │  collapsed by default
│ │ │ Approve │  Edit  │  Skip │   │ │  one-tap; big targets
│ └───────────────────────────────┘ │
│ ┌───────────────────────────────┐ │
│ │ ◐ Alex · after-hours request  │ │
│ │ Sarah wants Sunday — offer    │ │
│ │ Saturday 10am instead?        │ │
│ │ │ Offer Sat │ Allow Sun │Skip│ │ │  contextual actions
│ └───────────────────────────────┘ │
│           See all in Inbox →      │
│ ╌╌╌╌╌╌╌╌╌╌╌╌ fold ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ │  above = action + glance only
│ THIS WEEK                         │
│   $18,400                         │  the "is it working?" answer
│   revenue booked                  │
│   ↑ vs your usual $11,200         │  baseline always present
│   24 consults · $1,240 spend ·    │
│   4.1× return                     │
│   "Alex booked 24 consults and    │  agent-voice paragraph (serif);
│   saved you ~12 hrs. Riley held   │  tap any number → Results
│   CPL at $14. Mira shipped 3."    │
╞═══════════════════════════════════╡
│ WHILE YOU SLEPT                5→ │
│ ✓ 2:14a Riley paused the $87 ad   │  factual work-log lines
│ ✓ 1:32a Alex booked 2 consults    │
│ ✓ 11:48p Mira finished a reel     │
╞═══════════════════════════════════╡
│ WORK IN PROGRESS                  │  (internally: Active Plays)
│ Slow-slot recovery                │  honest default — the agent
│ Offer drafted · 8 leads queued    │  chain shows ONLY when a real
│ for Alex                    View →│  typed-handoff trace exists
╞═══════════════════════════════════╡
│ PERMISSIONS    what they do w/o you│
│ Alex  · books consults · asks     │  plain autonomy boundaries
│         before unusual requests   │
│ Riley · adjusts ad budget ≤ $300  │
│ Mira  · drafts only · needs you   │
│                          Adjust → │
├───────────────────────────────────┤
│   ▌Home▐      Inbox •2    Results │  bottom-tab nav
└───────────────────────────────────┘
```

### 6.2 Home — calm / all-clear state (first-class)

```
╞═══════════════════════════════════╡
│ ✓ Nothing needs you.              │  Needs You collapses to one line
│   Your team's running clean.      │
╞═══════════════════════════════════╡
│ THIS WEEK                         │  ← now the hero of the page
│   $18,400  revenue booked …       │
```

### 6.3 Inbox — list + detail

```
   LIST                                DETAIL (tap a row)
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│ Inbox · 4 decisions waiting       │ │ ← Inbox                        ⋯  │
│ ⦿All  ○Alex  ○Riley  ○Mira       │ │ ◐ Riley                           │
│ ◐ Riley · ad budget        12m  › │ │ Move $300 from the slow Facebook  │
│   Move $300 to the consult ad     │ │ ad to the one booking consults    │
│   $300 at stake                   │ │ at $14 each?                      │
│ ◐ Alex · after-hours        1h  › │ │ WHY RILEY RECOMMENDS THIS         │
│ ◐ Mira · content            3h  › │ │ The slow ad spent $300 in 6 days  │
│ ◐ Alex · pricing            4h  › │ │ and booked nothing; the other is  │
│ ✓ That's everything.              │ │ booking consults at $14…          │
│  Home    ▌Inbox•4▐   Results      │ │ • $300 spent, 0 booked            │
└───────────────────────────────────┘ │ • $14 per consult                 │
 swipe → = Approve* · swipe ← = Skip   │ • Confident — seen this 4×        │
 (*risk-tiered, see §8)                │ You've approved 23 of Riley's 25  │
                                       │ ┌───────────────────────────────┐ │
                                       │ │     Approve & move $300       │ │
                                       │ └───────────────────────────────┘ │
                                       │   Edit              Skip          │
                                       └───────────────────────────────────┘
```

The detail expands **"Why"** by default (you came here to decide), carries a quiet **trust-context line** ("23 of last 25"), a full-width amber primary action, and Edit/Skip secondary. This is decision infrastructure, not a ticket queue.

### 6.4 Agent light panel — sheet over Home (tap a Team Pulse chip)

```
┌───────────────────────────────────┐
│ ←                              ⋯  │  a sheet/drawer, NOT a route
│ ◐ Riley · your ad & lead agent    │
│ ● Working · adjusts ad budget ≤$300│  status + its own permission
│ KEY RESULT                        │
│ $14  cost per consult lead        │  the ONE number for this agent
│ ↓ from $31 last month             │
│ NEEDS YOU                      1  │
│ ◐ Move $300 to the consult ad   › │  its open decisions
│ WORK LOG                          │
│ 9:12a Paused the $87 ad           │  factual timestamped log
│ 8:40a Shifted $120 to the reel ad │
│            View all →             │
│ ┌───────────────────────────────┐ │
│ │          Pause Riley          │ │  ONE safety action — REAL halt
│ └───────────────────────────────┘ │
└───────────────────────────────────┘
```

### 6.5 Results — minimum viable (must ship with the nav)

Results is a primary tab, so it **cannot ship empty** even though its full design is a later pass. Minimum viable Results: a **period toggle** (week / month / quarter), **revenue booked**, **consults booked**, **ad spend**, **return**, a **per-agent contribution summary**, and **tap-through to the underlying evidence**. The This Week numbers on Home deep-link here.

---

## 7. Components

- **Voice Block** — the unit of personification: agent avatar + name (agent color) + first-person message. Used in decision cards, While You Slept, This Week, agent panel.
- **Decision card** — Voice Block + collapsed **"Why X recommends this"** + risk-tiered actions. The atom of the product.
- **"Why X recommends this"** — plain rationale + evidence bullets + a confidence cue. Collapsed on Home, expanded in Inbox detail.
- **Work Log** — factual, timestamped agent actions (the renamed notepad). Lives in the agent panel and `/activity`.
- **Team Pulse** — thin presence ribbon; status dots (green=working, grey=idle); chips open agent panels.
- **This Week** — current-week headline number + baseline + supporting metrics + serif voice paragraph; numbers tap into Results.
- **While You Slept** — overnight digest of autonomous actions.
- **Work in Progress** — active cross-agent work, outcome-phrased. Default to the simple form (`Offer drafted · 8 leads queued for Alex`) or empty (`No active handoffs right now.`); render the multi-agent chain (`Riley → Mira → Alex`) **only where a real typed-handoff trace proves it.**
- **Permissions** — plain "what each agent can do without you," with "Adjust →" to autonomy modes.

---

## 8. Interaction rules (hard constraints)

1. **Home shows ≤ 2 decision cards.** It is where you _notice_ what matters; the rest lives in Inbox. Above the fold = greeting + Team Pulse + Needs You + top of This Week, nothing else.
2. **The calm/all-clear state is first-class** — promotes This Week to hero so a 10-second glance confirms "all good."
3. **Agent panels are sheets, never routes — and read-mostly:** status · one key result · open decisions · recent work log · one safety action (Pause). Anything deeper (settings, charts, playbooks, knowledge, permission tuning) routes OUT to Settings or Results. This is the structural fuse against cockpit re-growth.
4. **Swipe is risk-tiered.** Swipe-to-**Skip**: always allowed. Swipe-to-**Approve**: only low-risk (dismiss a reminder, approve a draft preview). Budget moves, publishing, booking exceptions, and anything client-facing → swipe only **opens/primes**; commit requires an explicit button tap. High-value/irreversible → a **confirm step**. _(Accidentally approving a budget move must be impossible via swipe.)_
5. **The IA is frozen.** The visual pass is skin-only.
6. **Every decision carries an explicit risk contract — the UI never guesses.** Each decision/approval object must include `riskLevel: "low" | "medium" | "high"`, `externalEffect: boolean`, `financialEffect: boolean`, `clientFacing: boolean`, `requiresConfirmation: boolean`. Swipe-to-approve is permitted **only** when `riskLevel === "low"` and none of `externalEffect | financialEffect | clientFacing` is true; budget, publishing, booking-exception, and client-facing actions require an explicit button tap; `requiresConfirmation` adds the confirm step. The UI reads these flags — it never infers risk from copy.
7. **Sequencing lock — real Pause before panels.** An agent panel exposes a Pause control, so the real server-backed halt (`/api/dashboard/governance/halt`) must ship **before** any agent panel ships. Never ship a panel whose Pause is the localStorage illusion.

---

## 9. Visual direction — "Warm operational editorial"

A single canonical token system replaces the seven registers. Three-layer color hierarchy:

- **Cream canvas = calm/premium base.** Warm cream surfaces (`~#F7F4EE` canvas, white cards, warm hairlines). "Beauty, not tech."
- **Per-agent color = identity/orientation ONLY.** Alex coral, Riley teal, Mira violet — used in dots, names, small avatars, light borders/tints. **Never on an action button.**
- **Amber = the one universal action system.** Every primary button is amber. The owner never wonders whether a colored button means "Alex" or "approve." (Resurrects the audit's defined-but-unused operator amber.)
- **Status colors are semantic and constant:** green = working, grey = idle, plus standard positive/attention/critical.
- **Type:** one clean sans for UI; one serif reserved for the agent-voice editorial moment (This Week, agent reports) — nowhere else.
- **Tokens** (spacing, radius, elevation, motion) consolidate from the prior "Full-Polish" spec into one system. Foundation values are **derived from these wireframes**, not chosen before them.
- **Dark mode: cut for v1** (the current half-implementation themes only ~40% of surfaces; one impeccable light theme beats a broken toggle).

---

## 10. v1 scope

**In:** 3 agents incl **Mira** (designed in from the start); Home modules above; one-tap decision cards; Work in Progress (Plays); Work Log; the unified decision model; real server-backed pause; `/approve/[token]` push.

**Mira honesty guardrail:** the UI must reflect Mira's _real_ state — she appears in Team Pulse only when her deployment state is known and active; otherwise she renders as "Not set up" (or is hidden behind setup). Never imply three working teammates when only two are functional; capability shown must equal capability that exists.

**Deferred:** ⌘K command palette (wrong behavior for this user); personas / multi-layout modes (ship the SMB-owner layout only); full agent cockpits; standalone `/activity` as a nav peer. The **Conversation Simulator moves to onboarding** (the best time-to-value moment the audit found).

---

## 11. Structural fixes folded into the overhaul

- **One app shell** — kill the double header; one brand mark, one avatar, one nav.
- **Real server-backed halt** — wire Pause to `/api/dashboard/governance/halt` (uses the existing unused `useEmergencyHalt`/`useResume` hooks).
- **A real front door** — login/post-auth/onboarding land on Home, not marketing.
- **One decision backend** — collapse the Live popover + Inbox drawer + cockpit feed and the two approval data paths into one source of truth.
- **Retire dead registers** — delete `--mercury-*`, move cockpit code off ~175 inline-hex onto the new tokens, re-skin the orphan blue chat widget.

---

## 12. Build phasing (input to writing-plans)

The blueprint ships in dependency order; each phase is its own implementation plan.

- **Phase 0 — Foundation:** single shell, one canonical token system (the §9 palette), kill the double header, real server-backed halt, front-door routing.
- **Phase 1 — Home + unified decision backend:** the Home surface (§6.1–6.2) and one source of truth for "Needs You."
- **Phase 2 — Propagate + Team panels:** the agent light panel (§6.4), Inbox (§6.3); migrate `/results`, `/activity`, `/contacts` onto the new tokens; retire dead registers/inline-hex.
- **Phase 3 — Push-to-approve + confidence routing:** `/approve/[token]` over the existing WhatsApp/Telegram/Slack channels; routing so the queue stays at 0–3.
- **Phase 4 — First-run & activation:** self-serve signup (wire the existing register API), marketing→app continuity, Simulator-in-onboarding, post-launch → Home.

**The first implementation plan covers Phase 0 + Phase 1, sliced into reviewable PRs (no mega-change):**

- **P0-A — Shell + routing:** authed `/` becomes Home; login/post-auth land on Home; kill the double header; bottom-nav shell `Home · Inbox · Results`. No Team tab, no agent routes.
- **P0-B — Tokens + visual system:** cream canvas, amber action token, agent identity tokens; remove inline-hex only from surfaces touched here.
- **P0-C — Real halt:** wire Pause to `/api/dashboard/governance/halt`; delete the localStorage-only fake pause; add regression tests.
- **P1-A — Home shell:** render the Home modules from existing mocked/derived data (no backend consolidation yet).
- **P1-B — Unified "Needs You" source:** one decision model powering Home's top-2 (and Inbox later).

**Build framing (for the implementer): do not redesign — implement the approved blueprint in dependency order, Phase 0/1 only.** Preserve the IA exactly (Home · Inbox · Results; no Team tab; no agent routes; agent panels are sheets only). Ship the shell, routing, and real halt before polishing Home — the fake pause and wrong front door are correctness bugs, not visual debt. Real Pause (P0-C) must land before any agent panel ships.

---

## 13. Out of scope / later

- Detailed marketing-site redesign (only the auth-seam continuity is in Phase 4).
- Detailed Results-tab design (its own design pass).
- Confidence-routing thresholds and push channel specifics (Phase 3 design).
- Operator/internal surfaces (`/operator`) — not customer-facing.

---

## 14. Open questions (resolve at build)

- Final tuning of the per-agent color hexes (coral/teal/violet shades) against the cream base for contrast/AA.
- Exact "high-value / irreversible" thresholds that trigger the confirm step (§8.4).
- Whether `/contacts/[id]` (lead thread) needs any new fields for the "see the lead" drill-in.

---

## 15. Success criteria

- A non-technical owner can answer "does anything need me?" and "is it working?" **above the fold, in one glance.**
- Any pending decision is resolvable in **one tap** (or one tap + confirm for high-value).
- **Pause actually pauses** the agents.
- The whole product reads as **one calm, coherent surface** — one canvas, one action color, agents legible by color.
- The core loop is **fully usable on a phone**, including push-to-approve.
