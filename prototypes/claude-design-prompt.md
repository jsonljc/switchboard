# Claude Design prompt — Switchboard morning check-in

Build an interactive, **responsive** React prototype for "Switchboard" — a dashboard where a non-technical medspa/clinic owner manages a small team of AI employees. Single self-contained artifact, mock data only, no backend. It must work as **one app that adapts from phone to desktop** (not two separate designs). I want to FEEL the daily-use experience.

## North star (the rubric for every decision)

A busy aesthetic-clinic owner's 2-minute, phone-first morning check-in. Their tech literacy ≈ Instagram + Square + WhatsApp. They actively punish complexity. If a glance doesn't tell them "all good" or "here's the one thing to decide," it has failed.

## The feeling (read this first)

**The Home page must NOT feel like a dashboard.** It should feel like a morning operator check-in from a small AI team: **one verdict, at most two decisions, visible proof that the agents are alive, and honest disclosure when an agent is not yet working.** No chart walls, no KPI grids, no settings on the landing surface. If the owner could mistake this for an analytics tool, it's wrong.

## Module emphasis (where to spend your design effort)

Build all six modules, but they are NOT equal. Spend your craft top-to-bottom in this order:

1. **Greeting + verdict line** — THE product unlock. The hero must resolve the morning in one human sentence (see below). This is what earns the daily open.
2. **Needs You + honest calm state** — where the owner actually acts. ≤2 cards, visible buttons + Undo, swipe as accelerator only.
3. **Team Pulse incl. honest "Mira — Not set up"** — the 2-second "are my employees alive?" check; Mira's off-duty chip is a deliberate trust signal, not an apology.
4. **This Week** — warm, lightweight, secondary. Named employees reporting outcomes — NOT analytics tiles.
5. **While You Slept / Work in Progress** — keep deliberately QUIET. No live tickers, no progress bars, no manufactured busyness.
6. **Permissions** — a quiet one-line-per-agent trust note, NOT a full module and NOT editable controls here.

## Responsive behavior (REQUIRED)

- **Mobile-first.** Design the phone layout first; it is the primary experience. Show it in a phone frame by default.
- **Desktop** (≥ ~1024px): the bottom tab bar becomes a **top bar** (Home · Inbox · Results + bell + avatar). Content sits in a comfortable centered column (~640px) — do NOT stretch cards full-width. Optionally use the extra width so the **agent panel opens as a right-side docked panel** instead of a bottom sheet, and the calm-state hero can breathe more. Same components, same data, responsive layout.
- Light mode only. Generous spacing, large tap targets, gentle motion.

## The team (3 AI employees, each a person with a name + voice)

- **Alex** (identity color CORAL) — inbound leads: replies to enquiries, books consultations, follows up on no-shows. The clinic's front-desk closer.
- **Riley** (identity color TEAL) — runs the ads: watches spend, shifts budget to what's working, flags when results dip. The growth engine.
- **Mira** (identity color VIOLET) — newest teammate (content / reactivation work). **HONESTY RULE: only show Mira as active if her state is genuinely "on." She is NOT set up in this prototype — show "Not set up," never imply 3 working teammates when only 2 are live.**

Use realistic medspa data throughout: consultation leads, Botox/filler/laser/facial treatments, slow afternoon slots, ad spend & cost-per-lead, no-shows, reactivation. Owner is "Dana" at an aesthetic clinic.

## Information architecture (FROZEN — do not redesign)

Bottom tab bar on phone (top bar on desktop): **Home · Inbox · Results**, plus a notification bell and an avatar menu in the header. There is **NO "Team" tab** — agents are reached by tapping their chip on Home, which opens a slide-up panel (a sheet over Home on mobile / a docked side panel on desktop, never its own page). Build **Home fully**; Inbox and Results can be lighter but present and navigable.

## Home — six modules, top to bottom

Above the fold = greeting + Team Pulse + Needs You + the top of This Week. Nothing else.

1. **Greeting + hero line + VERDICT.** Time-aware ("Good morning, Dana") with the "your team is on shift" warmth — but the hero's real job is to carry **one verdict line that resolves the whole morning in a single human sentence**, like Square's "next transfer" number. Two shapes:
   - **Calm:** tie it to PROOF, not absence — _"All good. Alex booked 3 consults overnight and Riley held your budget."_ (not a bare "nothing to do").
   - **Action:** name the single thing — _"One thing needs you: Riley wants to raise the Botox budget."_
     The owner should be able to read this line and decide whether to put the phone away in 5 seconds. Everything below the hero is subordinate to this line. (If the underlying number is missing, fall back to plain warm copy — never fabricate a count.)
2. **Team Pulse** — a thin ribbon of agent chips (avatar + name + status dot: green=working, grey=idle). Tapping a chip opens that agent's panel. **Mira's "Not set up" chip is a deliberately designed, calm state — treat it as a trust signal ("Mira joins when you're ready"), never a broken/error look.** The honest off-duty teammate is what makes Alex's and Riley's green dots believable; do not hide it and do not give it fake activity.
3. **Needs You** — at MOST 2 decision cards (hard cap — if there are more, the system failed to triage; never show 5). If more exist, a "See all in Inbox →" link. Each card is decision-ready: who/what/why in plain language, with clear actions. **Every card has a visible primary button (amber) and a visible skip — swipe is an accelerator, NEVER the only way to act.** Provide a brief, prominent **Undo** after any approve/skip. **CALM STATE IS FIRST-CLASS:** when nothing needs the owner, show "Nothing needs you. Your team's running clean." (tie it to proof where possible) and **PROMOTE This Week to the hero of the screen.** Include a visible **prototype toggle** (placed outside/above the device chrome) to flip between "2 decisions waiting" and the calm state.
4. **This Week** — the week's results in the agent's own voice, as a warm, lightweight editorial moment. **Make it feel like a named employee reporting an outcome to their boss — NOT analytics tiles or a KPI card.** This is the ONE place to use a serif font. Current week only, NO period switcher here (that lives in Results). Keep voice warmest here (low stakes); make it sound proud-but-plain, not hype. Never invent numbers — if data's missing, show a tasteful skeleton/empty state, not fake metrics.
5. **While You Slept** — what happened overnight, glanceable, timestamped, **kept deliberately quiet: 3 lines max, outcome-phrased.** It's a reassurance look-back, not a feed. Label honestly (don't claim "overnight" precision you don't have). No timeline, no expandable log on Home.
6. **Work in Progress** — what the team is actively doing, phrased as OUTCOMES, e.g. "Alex is following up with 8 consultation leads" / "Riley shifted $120 to the Botox campaign." **The QUIETEST module on the page — low-contrast, 1–2 lines, NO live tickers / progress bars / spinners / manufactured busyness.** It must not invite the owner to supervise in-flight work. Where a real multi-step handoff exists, show the chain (e.g. Riley → Alex); otherwise keep it simple — never overclaim orchestration. (Mira is not set up, so do NOT put her in any chain.)
7. **Permissions** — a QUIET trust note, **not a full module and not editable controls.** One plain-English line per agent of "what each agent can do without asking you," e.g. "Riley adjusts ad budget up to $300, then asks you" / "Alex books consultations and sends reminders." Read-only; expandable on tap at most; all real tuning lives in Settings (link only). This line exists to BOUND the named-employee trust — keep it small.

## Agent panel (the slide-up sheet / desktop side panel)

A READ-MOSTLY panel: status · ONE key result · their open decisions · a recent Work Log · and ONE safety action: **Pause/Resume**. Anything deeper (settings, charts, history) is explicitly OUT — show a "Manage in Settings →" link instead. This shallowness is intentional; do not let it grow into a full cockpit. For Mira, the panel shows a "Not set up" empty state with a "Set up Mira" CTA and zero fake activity.

## Decision cards — risk-tiered actions (the critical interaction)

Every decision carries an explicit **risk level (low / medium / high)** and **flags**: `externalEffect`, `financialEffect`, `clientFacing`, `requiresConfirmation`. The UI obeys the flags — it never guesses risk from the wording:

- **Swipe-to-SKIP / dismiss:** always allowed.
- **Swipe-to-APPROVE:** ONLY for low-risk with NONE of {externalEffect, financialEffect, clientFacing} — e.g. dismiss a reminder, approve a draft message preview.
- **Budget moves, publishing, booking exceptions, anything client-facing:** swipe only OPENS the detail / primes the button — committing requires an explicit **button TAP**.
- **High-value / irreversible:** add a **confirmation step**.

**Swipe is never the ONLY path.** Every card always shows a visible primary button (amber) and a visible skip; swipe is a discoverable accelerator layered on top, not a hidden gesture. After any commit, show a brief, prominent **Undo** (especially on swipe-approve). This is a non-technical user — don't rely on an undiscoverable gesture.

Make this real and physically distinct in the prototype:

- A low-risk **"approve Alex's drafted reply"** card → swipeable: swipe right approves & sends (flies off, toast with Undo), swipe left skips. The amber Approve button does the same thing for anyone who doesn't swipe.
- A **"Riley wants to raise the Botox budget by $400"** card (flags: financial + external) → swiping right must NOT commit; it should rubber-band / reveal a lock hint and _prime_ the amber button. Committing requires a button tap, which opens a confirmation sheet showing the numbers; only the confirm button commits.
  I should feel the difference between the two.

## Work Log rule

FACTUAL, timestamped actions only — never fake "thinking."
✅ "9:44 AM — Drafted 3 replies for your approval" ❌ "Thinking through pricing objections…"

## Visual direction: "Warm operational editorial"

- Warm cream canvas (~#F7F4EE), white cards, soft warm hairline borders. Feel: beauty brand, not tech tool. Calm and premium.
- Per-agent colors (Alex coral, Riley teal, Mira violet) are for **IDENTITY ONLY** — dots, names, small avatars, light tints/borders. **NEVER on a button.**
- **ONE amber action color for EVERY primary button** ("Approve", "Book", "Yes, raise budget") so the owner never confuses "this is Alex" with "this is the button to press."
- Status colors are semantic & constant: green=working, grey=idle, plus standard positive/attention/critical.
- Type: one clean, distinctive sans for UI (NOT Inter/Roboto/Arial/system — pick something warm and characterful); one serif reserved for agent-voice editorial moments (This Week, key-result numbers, agent reports) and nowhere else.
- Use real, distinctive Google Fonts. Use CSS variables for all tokens (color, radius, spacing) so they're easy to retarget.

## Do NOT

- No "Team" tab; no full agent cockpit; no command palette.
- Never put an agent's color on an action button.
- Never fabricate metrics or invent internal/technical jargon — the owner only ever sees outcomes in plain language.

## Build for handoff / wiring (IMPORTANT)

This design will be dropped into an existing codebase and wired to real data. So:

- Keep **all mock data in one clearly-labeled place** (top of the file), not scattered inline.
- Model decisions as an array of objects shaped roughly like:
  `{ id, agentKey: "alex"|"riley"|"mira", riskLevel: "low"|"medium"|"high", flags: { externalEffect, financialEffect, clientFacing, requiresConfirmation }, title, why, preview?, detail? }`
  so the swipe-vs-tap rules derive from `riskLevel` + `flags`, not from copy. (These field names match the real `Decision`/governance contract in the codebase, so wiring is a near rename-free swap.)
- Keep agents in a single `agents` map keyed by `agentKey` (`alex`/`riley`/`mira`), each with `{ name, color, working, statusLine, keyResult, workLog[] }`.
- Drive approve / skip / pause through clear handler functions (`onApprove(id)`, `onSkip(id)`, `onConfirmHigh(id)`, `onTogglePause(id)`) so they're trivial to replace with real mutations.
- Use plain React (hooks). Motion library is fine for animation. No backend, no external state libs.

## Deliver

A single interactive, responsive React artifact with: a working nav (Home · Inbox · Results) that's a bottom bar on phone and a top bar on desktop; a fully built Home with all six modules and the calm⇄active toggle; tappable agent chips that open the agent panel; and at least one swipeable low-risk decision and one tap-only high-risk decision wired up. Populate everything with believable medspa content. Make it feel like a real product I'd open every morning.
