# Claude Design — Switchboard shared CORE block

> This is the reusable preamble for EVERY surface prompt in the customer-UX design pass.
> It is NOT fed to Claude Design on its own. Each surface prompt (`claude-design-prompt-<surface>.md`)
> inlines this block, then adds its surface-specific section. Keep this as the single source of truth;
> when a lock changes, change it here and re-propagate.

---

## What Switchboard is

"Switchboard" is a dashboard where a **non-technical medspa / aesthetic-clinic owner** manages a small team of **AI employees**. Build an interactive, **responsive** React prototype: a single self-contained artifact, mock data only, no backend. It must work as **one app that adapts from phone to desktop** (not two separate designs). The owner is "Dana" at an aesthetic clinic.

## North star (the rubric for every decision)

A busy aesthetic-clinic owner's **2-minute, phone-first check-in**. Their tech literacy ≈ Instagram + Square + WhatsApp. They actively punish complexity. If a glance doesn't tell them "all good" or "here's the one thing to decide," it has failed. **It must never feel like an analytics tool.** It should feel like checking in on a small team of real employees who work while you're busy.

## The team (3 AI employees — each a person with a name + voice)

- **Alex** (identity color **CORAL**) — inbound leads: replies to enquiries, books consultations, follows up on no-shows. The clinic's front-desk closer.
- **Riley** (identity color **TEAL**) — runs the ads: watches spend, shifts budget to what's working, flags when results dip. The growth engine.
- **Mira** (identity color **VIOLET**) — newest teammate (content / reactivation). **HONESTY RULE: only show Mira as active if her state is genuinely "on." She is NOT set up in this prototype — show "Not set up," never imply 3 working teammates when only 2 are live.** Mira's off-duty state is a deliberate trust signal, never a broken/error look.

Use realistic medspa data throughout: consultation leads, Botox/filler/laser/facial treatments, slow afternoon slots, ad spend & cost-per-lead, no-shows, reactivation.

## Information architecture (FROZEN — do not redesign, rename, move, or merge any surface)

Bottom tab bar on phone, top bar on desktop: **Home · Inbox · Results**, plus a notification **bell** and an **avatar menu** in the header. There is **NO "Team" tab** — agents are reached by tapping their chip (on Home), which opens a **slide-up panel** (a sheet over the page on mobile / a docked right-side panel on desktop, never its own page). Everything else is a drill-in or lives under the avatar menu (settings, integrations, autonomy, billing, legal).

## Visual direction: "Warm operational editorial"

- Warm cream canvas (~`#F7F4EE`), white cards, soft warm hairline borders. Feel: beauty brand, not tech tool. Calm and premium.
- Per-agent colors (Alex coral, Riley teal, Mira violet) are for **IDENTITY ONLY** — dots, names, small avatars, light tints/borders. **NEVER on a button.**
- **ONE amber action color for EVERY primary button** ("Approve", "Book", "Yes, raise budget") so the owner never confuses "this is Alex" with "this is the button to press." Three-layer hierarchy: **cream = base · agent color = orientation · amber = action.**
- Status colors are semantic & constant: green=working, grey=idle, plus standard positive / attention / critical.
- Type: one clean, distinctive sans for UI (NOT Inter/Roboto/Arial/system — pick something warm and characterful); one **serif** reserved for agent-voice editorial moments (agent reports, key-result numbers, the decision sentence) and nowhere else.
- Use real, distinctive Google Fonts. Use CSS variables for ALL tokens (color, radius, spacing) so they're easy to retarget. The shipped app exposes tokens like `--ink`, `--cream`, `--hairline`, `--serif`, `--mono`, `--font-sans` — mirror that idea.

## Vocabulary — the owner never learns internal language

Every visible label names an **OUTCOME, not a concept**. Never surface internal terms ("approval", "handoff", "recommendation", "escalation", "deployment", "governance"). The owner only ever sees plain language: what happened, who did it, what to decide.

## Decision contract — risk-tiered actions (the critical interaction, identical across surfaces)

Every decision carries an explicit **risk level (low / medium / high)** and **flags**: `externalEffect`, `financialEffect`, `clientFacing`, `requiresConfirmation`. The UI obeys the flags — it **never guesses risk from the wording**:

- **Swipe-to-SKIP / dismiss:** always allowed.
- **Swipe-to-APPROVE:** ONLY for `riskLevel: "low"` with NONE of {externalEffect, financialEffect, clientFacing} — e.g. dismiss a reminder, approve a draft message preview.
- **Budget moves, publishing, booking exceptions, anything client-facing:** swipe only OPENS the detail / primes the button — committing requires an explicit **button TAP**.
- **High-value / irreversible (`requiresConfirmation`):** add a **confirmation step**.
- **MISSING contract ⇒ UNSAFE:** if a decision has no risk contract, treat it as NOT swipe-approvable and requiring confirmation. (Never default-permissive.)

**Swipe is never the ONLY path.** Every card always shows a visible primary button (amber) and a visible skip; swipe is a discoverable accelerator layered on top, not a hidden gesture. After any commit, show a brief, prominent **Undo**. This is a non-technical user — don't rely on an undiscoverable gesture.

## Work Log rule

FACTUAL, timestamped actions only — never fake "thinking."
✅ "9:44 AM — Drafted 3 replies for your approval" ❌ "Thinking through pricing objections…"

## Responsive behavior (REQUIRED)

- **Mobile-first.** Design the phone layout first; show it in a phone frame by default.
- **Desktop** (≥ ~1024px): bottom tabs become a top bar (Home · Inbox · Results + bell + avatar). Content sits in a comfortable centered column (~640px) — do NOT stretch cards full-width. Use the extra width so the agent panel / detail opens as a **right-side docked panel** instead of a bottom sheet. Same components, same data, responsive layout.
- Light mode only. Generous spacing, large tap targets, gentle motion.

## Do NOT

- No "Team" tab; no full agent cockpit; no command palette.
- Never put an agent's color on an action button.
- Never fabricate metrics or invent internal/technical jargon — the owner only ever sees outcomes in plain language.
- Never give Mira fake activity.

## Build for handoff / wiring (IMPORTANT)

This design will be dropped into an existing codebase and wired to real data. So:

- Keep **all mock data in one clearly-labeled place** (top of the file), not scattered inline.
- Use the **real field names** given in each surface's "Data contract" section so wiring is a near rename-free swap.
- Drive every mutation through clear handler functions (`onApprove(id)`, `onSkip(id)`, `onConfirm(id)`, `onUndo(id)`, etc.) so they're trivial to replace with real mutations.
- Use plain React (hooks). A motion library is fine for animation. No backend, no external state libs.
