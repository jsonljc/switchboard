# Claude Design prompt — Switchboard **Inbox** (the decision queue)

Build an interactive, **responsive** React prototype for "Switchboard" — a dashboard where a non-technical medspa/clinic owner manages a small team of AI employees. Single self-contained artifact, mock data only, no backend. It must work as **one app that adapts from phone to desktop**. This prompt covers the **Inbox** surface (the full decision queue) and its **decision-detail drill-in**.

---

## PART 1 — Shared foundation (applies to every Switchboard surface)

### North star (the rubric for every decision)

A busy aesthetic-clinic owner's **2-minute, phone-first check-in**. Tech literacy ≈ Instagram + Square + WhatsApp. They punish complexity. **Never an analytics tool** — it should feel like checking in on real employees who work while you're busy. Owner is "Dana" at an aesthetic clinic.

### The team (3 AI employees — each a person with a name + voice)

- **Alex** (identity color **CORAL**) — inbound leads: replies, books consultations, follows up no-shows.
- **Riley** (identity color **TEAL**) — runs the ads: watches spend, shifts budget, flags dips.
- **Mira** (identity color **VIOLET**) — newest teammate (content / reactivation). **HONESTY RULE: Mira is NOT set up — never imply she's working.** (Mira rarely appears in the Inbox; if she has no items, she simply isn't in the queue or filter.)

Use realistic medspa data: consultation leads, Botox/filler/laser/facial, slow afternoon slots, ad spend & cost-per-lead, no-shows, reactivation.

### Information architecture (FROZEN — do not redesign, rename, move, or merge)

Bottom tab bar on phone, top bar on desktop: **Home · Inbox · Results**, plus a notification **bell** and an **avatar menu**. **NO "Team" tab.** Agents are reached by tapping their chip → a slide-up panel (sheet on mobile / docked right panel on desktop), never its own page. **You are building the Inbox tab; render a working nav with Home and Results present but lighter.**

### Visual direction: "Warm operational editorial"

- Warm cream canvas (~`#F7F4EE`), white cards, soft warm hairline borders. Beauty brand, not tech tool. Calm and premium.
- Per-agent colors (Alex coral, Riley teal, Mira violet) are **IDENTITY ONLY** — dots, names, small avatars, light tints/borders. **NEVER on a button.**
- **ONE amber action color for EVERY primary button.** Hierarchy: **cream = base · agent color = orientation · amber = action.**
- Status colors semantic & constant: green=working, grey=idle, + positive / attention / critical.
- Type: one warm, characterful sans for UI (NOT Inter/Roboto/Arial/system); one **serif** reserved for the agent-voice decision sentence and key numbers, nowhere else. Use real distinctive Google Fonts. All tokens via CSS variables (`--ink`, `--cream`, `--hairline`, `--serif`, `--mono`, `--font-sans` …).

### Vocabulary — the owner never learns internal language

Every visible label names an **OUTCOME, not a concept.** Never surface "approval", "handoff", "recommendation", "escalation", "governance". Plain language only.

### Decision contract — risk-tiered actions (the critical interaction)

Every decision carries `riskLevel` (low/medium/high) + flags `externalEffect`, `financialEffect`, `clientFacing`, `requiresConfirmation`. UI obeys the flags, **never guesses risk from wording**:

- **Swipe-to-SKIP / dismiss:** always allowed.
- **Swipe-to-APPROVE:** ONLY `riskLevel:"low"` with NONE of {externalEffect, financialEffect, clientFacing}.
- **Budget moves / publishing / booking exceptions / anything client-facing:** swipe only OPENS detail / primes the button; committing needs an explicit **button TAP**.
- **`requiresConfirmation`:** add a confirmation step.
- **MISSING contract ⇒ UNSAFE:** no swipe-approve, require confirmation.

**Swipe is never the ONLY path.** Every card shows a visible amber primary button + a visible skip; swipe is a discoverable accelerator. After any commit, show a brief, prominent **Undo**.

### Responsive behavior (REQUIRED)

Mobile-first; show a phone frame by default. Desktop (≥~1024px): bottom tabs → top bar; content in a centered ~640px column (don't stretch cards full-width); the decision detail opens as a **right-side docked panel** instead of a bottom sheet. Light mode only; generous spacing, large tap targets, gentle motion.

### Do NOT

No "Team" tab; no full agent cockpit; no command palette. Never put an agent color on an action button. Never fabricate metrics or invent jargon. Never give Mira fake activity.

### Build for handoff / wiring

Keep **all mock data in one clearly-labeled place** at the top. Use the **real field names** in PART 3 so wiring is near rename-free. Drive every mutation through clear handler functions. Plain React hooks; a motion lib is fine; no backend, no external state libs.

---

## PART 2 — The Inbox surface (what to build)

**What the Inbox IS:** the owner's complete queue of everything that needs them — the full list behind Home's "Needs You" (which shows only the top ≤2 and links here via "See all in Inbox →"). This is "what do I need to deal with," sorted most-urgent-first. It is calm and finite, not a feed.

**The Inbox holds two kinds of item — rendered with the SAME plain-language card vocabulary** (the owner never sees the internal kind):

1. **Decisions the team wants you to OK** (internal `kind:"approval"`) — carry a `riskLevel` + risk flags. Example sentences: _"Alex drafted a reply to Maya about filler pricing — send it?"_, _"Riley wants to raise the Botox campaign budget by $400."_
2. **Leads being handed to you** (internal `kind:"handoff"`) — a lead the agent decided a human should take over. NO `riskLevel` → always client-facing → **explicit action only, never swipe-approve.** Carries an **SLA deadline** → show "Due in 2h" urgency. Static actions: **Take this one / Snooze / Mark resolved.** Example: _"Maya asked to talk to a human about her consultation."_

**Layout (mobile-first):**

- Header: "Inbox" + a live count ("4 things need you"). Honest, not alarming.
- A light **filter row**: **All** + per-agent chips (Alex coral · Riley teal). Tapping a chip filters the list to that agent (this maps to a real per-agent endpoint). Don't show Mira unless she has items.
- The **queue**: decision cards sorted most-urgent first. NO ≤2 cap here (that cap is Home's job). Each card is decision-ready: agent identity dot + name, the serif human sentence, a relative timestamp (or "Due in 2h" for handoffs), the risk-tiered actions, an optional **"Why?"** affordance, and **"View thread →"** when a thread exists.
- **Empty state:** calm and honest — _"That's everything."_ (NOT a celebration; just done.)
- **Error state:** _"Couldn't load your inbox. Try again."_ — error must render as ERROR, **never** as the empty state.

**Decision-detail drill-in (the new piece):** tapping a card opens a richer view of that ONE decision — a **bottom sheet on mobile, a docked right-side panel on desktop**. It shows: the agent identity, the full serif sentence, the "why" reasoning in plain language, contact name, the SLA (handoffs), the same risk-tiered action buttons (amber primary + skip), and a **"View thread →"** link when `threadHref` is set. **Compose the detail entirely from the decision object — there is no separate detail data source.** If you include a "conversation summary" area, mark it clearly as a placeholder (deeper context exists server-side but is out of v1 scope).

**Interactions to make real and physically distinct:**

- A **low-risk approval** ("Approve Alex's drafted reply") → swipeable: swipe right approves & sends (card flies off, toast with **Undo**); swipe left skips. The amber **Approve** button does the same for non-swipers.
- A **financial approval** ("Riley wants to raise the Botox budget by $400" — flags: financial + external) → swiping right must NOT commit; rubber-band / reveal a lock hint and _prime_ the amber button. Committing requires a tap → a **confirmation sheet** showing the numbers; only Confirm commits.
- A **handoff** ("Maya asked to talk to a human") → no swipe-approve; the amber **"Take this one"** opens the takeover (in this prototype, a simple reply composer); **Snooze** and **Mark resolved** are secondary.
  I should _feel_ the difference between swipe-OK and tap-required.

**Prototype toggles (place OUTSIDE the device chrome):** flip the Inbox between (a) a **full queue** of ~5–6 mixed items, (b) the **empty "That's everything"** state, and (c) the **error** state — so all three are visible.

---

## PART 3 — Data contract (REAL shapes — wire near rename-free)

**Feed:** `useDecisionFeed(agentKey | null)` → `GET /api/dashboard/decisions` (all) or `GET /api/dashboard/agents/:agentKey/decisions` (filtered by the chip). Polls every 60s. Returns:

```ts
{ decisions: Decision[]; counts: { total: number; approval: number; handoff: number } }
// decisions are pre-sorted by urgencyScore descending
```

**`Decision` (wire shape — model your mock data EXACTLY like this):**

```ts
{
  id: string;                       // namespaced: "approval:<uuid>" | "handoff:<uuid>" (use as React key)
  kind: "approval" | "handoff";     // INTERNAL — never render as a label
  agentKey: "alex" | "riley" | "mira";
  humanSummary: string;             // the serif sentence shown on the card
  presentation: {
    primaryLabel: string;           // e.g. "Approve & send" | "Take this one"
    secondaryLabel: string;         // e.g. "Skip" | "Snooze"
    dismissLabel: string;           // e.g. "Mark resolved"
    dataLines: unknown[];           // optional supporting detail lines
  };
  urgencyScore: number;             // 0..100 — SORT key only, never display the raw number
  createdAt: string;                // ISO timestamp
  threadHref: string | null;        // "View thread →" target; null = no thread
  sourceRef: { kind: "approval" | "handoff"; sourceId: string };  // used for action dispatch
  meta: {
    contactName?: string;
    slaDeadlineAt?: string;         // ISO — HANDOFFS only → render "Due in 2h"
    riskLevel?: "low" | "medium" | "high";  // APPROVALS only — handoffs have none
    undoableUntil?: string;         // ISO — APPROVALS only → Undo window
    // RISK FLAGS being added to the contract — include them so swipe-vs-tap derives from DATA, not copy:
    externalEffect?: boolean;
    financialEffect?: boolean;
    clientFacing?: boolean;
    requiresConfirmation?: boolean;
  };
}
```

A decision with no `riskLevel`/flags (e.g. every handoff) ⇒ **UNSAFE** ⇒ no swipe-approve, explicit action required.

**Mutations (your handler functions map 1:1 — keep these names so wiring is a swap):**

- **Approve / skip / dismiss / confirm / undo an approval** →
  `POST /api/dashboard/recommendations` body `{ recommendationId: sourceRef.sourceId, action: "primary" | "secondary" | "dismiss" | "confirm" | "undo", note?: string }`.
  (HTTP 409 = already resolved → treat as success.) → `onApprove(id)`, `onSkip(id)`, `onDismiss(id)`, `onConfirm(id)`, `onUndo(id)`
- **Take over / reply to a handoff** →
  `POST /api/dashboard/escalations/:sourceId/reply` body `{ message: string }`.
  (HTTP 502 = saved but channel delivery failed → show "Saved — delivery retrying".) → `onTakeOver(id, message)`
- **Resolve a handoff** →
  `POST /api/dashboard/escalations/:sourceId/resolve` body `{ resolutionNote?: string }`. → `onResolve(id, note?)`

**Match the existing app's components** (so the prototype drops in): the real app already has a `DecisionCard` (folio header + serif sentence + pill buttons + "Why?" tooltip + "View thread →"), a `mapToDecisionCard` mapper, an `InboxDrawer` (right-side `Sheet`), and `RightDrawerProvider`/`useRightDrawer` for the docked panel. Keep your structure compatible with these patterns.

---

## Deliver

A single interactive, responsive React artifact with: a working nav (Home · Inbox · Results — bottom bar on phone, top bar on desktop) with **Inbox fully built**; the filterable queue (All + per-agent), most-urgent-first; decision cards with risk-tiered swipe-vs-tap and visible amber buttons + Undo; a tappable card → decision-detail drill-in (bottom sheet on phone / docked right panel on desktop); at least one swipeable low-risk approval, one tap-only financial approval with a confirm sheet, and one handoff with "Take this one"; and the calm empty + error states behind a visible toggle. Populate with believable medspa content. Make it feel like the queue I'd clear in two minutes on my phone.
