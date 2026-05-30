# Claude Design Prompt — Inbox + decision detail

Generated 2026-05-25. Backend-verified against the live wire shapes:

- `apps/dashboard/src/lib/decisions/types.ts` (the `Decision` the inbox already receives)
- `packages/core/src/decisions/adapters/recommendation-adapter.ts` + `handoff-adapter.ts` (what each `kind` actually carries)
- `apps/api/src/routes/escalations.ts:74-137` (`GET /api/escalations/:id` → escalation + full `conversationHistory`)
- `packages/schemas/src/handoff.ts` (`leadSnapshot`, `qualificationSnapshot`, `conversationSummary`, `reason`)
- `apps/api/src/routes/recommendations.ts:120-216` (`POST /api/recommendations/:id/act`)
- `apps/dashboard/src/lib/decisions/swipe-policy.ts` + `components/decisions/swipe-decision-card.tsx` (the P1-B risk-gated swipe/confirm contract this must preserve)
- `apps/dashboard/src/app/globals.css` (the current "warm operational editorial" token scale — NOT the stale `--sw-*` set in the 2026-05-13 prompts)

If any of these schemas drift, regenerate this prompt rather than amending it.

> **Honesty rule for this prompt (read first).** Two data ceilings are real and must be respected. **Handoff** detail is richly backed by a real endpoint. **Approval** detail can only show what the inbox-list `Decision` object already carries — there is *no* per-recommendation detail endpoint and confidence / dollars-at-risk / before→after are **not on the wire today**. Where this prompt asks for those richer approval fields, render them as a designed target but visibly mark them **`pending backend`** (a quiet caption or dashed affordance) so the build never fabricates a confidence bar or a dollar figure that isn't real.

---

Design the **Inbox** and the **decision detail sheet** for "Switchboard" — a governed, mobile-first front desk used by a non-technical medspa / clinic owner for a 2-minute, phone-first daily check-in. The owner reviews work their AI team (Alex, Riley, Mira) has queued. This is part of an existing product: the Home and the Inbox *list* already ship; this prompt adds (1) an editorial pass on the Inbox list and (2) the rich **detail** drill-in that does not exist yet.

## Mental model (do not break)

The owner is reviewing **employees' proposed work**, not operating a SaaS console. Every label names an OUTCOME, never an internal concept. Two kinds of item:

- **Approval** (`kind: "approval"`) — an agent proposes a mutating action and wants a yes/no (e.g. Riley wants to pause an underperforming ad set; Alex wants to send a drafted reply).
- **Handoff** (`kind: "handoff"`) — an agent hit something it shouldn't finish alone and is handing a live lead conversation to the human (e.g. a pricing objection, a booking failure).

## Domain — the `Decision` the inbox already has (real shape)

The list is fed by `GET /api/dashboard/decisions` → `Decision[]`:

```ts
interface Decision {
  id: string;                 // namespaced: "approval:..." | "handoff:..."
  kind: "approval" | "handoff";
  agentKey: "alex" | "riley" | "mira";
  humanSummary: string;       // the serif sentence — what the agent wants / why it handed off
  presentation: {
    primaryLabel: string;     // e.g. "Approve", "Send reply"
    secondaryLabel: string;   // e.g. "Edit", "Snooze"
    dismissLabel: string;     // e.g. "Skip", "Dismiss"
    dataLines: unknown[];     // free-form human-readable impact / evidence lines (may be empty)
  };
  urgencyScore: number;       // 0..100 — list sort order
  createdAt: string;          // ISO
  threadHref: string | null;  // "View conversation →" target, when a contact thread exists
  sourceRef: { kind; sourceId };
  meta: {
    contactName?: string;
    slaDeadlineAt?: string;   // handoff only — countdown
    undoableUntil?: string;   // approval only — undo window
    riskContract?: {          // ABSENT on legacy rows → treat as UNSAFE (needs confirm, no swipe-approve)
      riskLevel: "low" | "medium" | "high";
      externalEffect: boolean;
      financialEffect: boolean;
      clientFacing: boolean;
      requiresConfirmation: boolean;
    };
  };
}
```

**This `Decision` is the entire data ceiling for approval detail.** Handoff detail fetches more (below).

## Domain — handoff detail (real, bankable: `GET /api/escalations/:id`)

When a handoff row is opened, fetch `{ escalation, conversationHistory }`:

```ts
escalation: {
  reason: "human_requested" | "max_turns_exceeded" | "complex_objection"
        | "negative_sentiment" | "compliance_concern" | "booking_failure"
        | "escalation_timeout" | "missing_knowledge" | "outside_whatsapp_window";
  leadSnapshot: { name?; phone?; email?; serviceInterest?; channel: string; source? };
  qualificationSnapshot: { qualificationStage: string; leadScore?: number;
                           signalsCaptured: Record<string, unknown> };
  conversationSummary: { turnCount: number; keyTopics: string[];
                         objectionHistory: string[]; sentiment: string;
                         suggestedOpening?: string };
  slaDeadlineAt: string; acknowledgedAt: string | null;
  resolvedAt: string | null; resolutionNote: string | null;
}
conversationHistory: Array<{ role; content; timestamp }>  // the real thread
```

All of the above is **BANKABLE** (DB-backed). Render it richly.

## Actions (real endpoints)

- **Approval** → `POST /api/recommendations/:id/act` with `{ action: "primary" | "secondary" | "dismiss" | "confirm" | "undo", note? }`. (`id` = `sourceRef.sourceId`.) **There is no edit/patch endpoint** — do not design an edit-the-parameters flow; `secondaryLabel` is whatever alternative the agent defined, not a generic editor.
- **Handoff** → `POST /api/escalations/:id/reply` (`{ message }` — owner types a reply, releases the lead back to the AI) and `POST /api/escalations/:id/resolve` (`{ resolutionNote? }`). No undo (terminal).

## Design system — current "warm operational editorial" tokens (verified in globals.css)

Use these CSS vars. Colors are HSL triples consumed as `hsl(var(--x))`.

- Canvas: `hsl(var(--canvas))` warm cream `40 25% 94%`; white card `hsl(var(--surface))`; raised `--surface-raised`; inset zone `--canvas-2`; deep divider / sheet handle `--canvas-3`.
- Ink scale: `--ink` (12% near-black), `--ink-2`, `--ink-3` (muted), `--ink-4` (faint).
- **Action amber — the ONE action color**: `hsl(var(--action))` `30 55% 46%`, hover `--action-hover`, text `--action-foreground`. Every primary CTA is amber.
- **Agent identity (orientation only, NEVER on an action button)**: `--agent-alex` coral `14 70% 58%`, `--agent-riley` teal `180 33% 40%`, `--agent-mira` violet `270 45% 58%`. Tint/border variants `--agent-{alex,riley,mira}-{deep,tint}`.
- Agent state dots: `--agent-active` (calm green), `--agent-idle`, `--agent-attention`, `--agent-locked`.
- Sheet elevation: `--shadow-sheet`; card lift `--shadow-lift`.
- Fonts: **Newsreader** `var(--font-home-serif)` for `humanSummary` + section prose; **Hanken Grotesk** `var(--font-home-sans)` for labels/body/buttons; mono for IDs only.

Three-layer hierarchy, strict: **cream = base · agent color = orientation · amber = action.**

## Part 1 — Inbox list (editorial pass on the existing list)

A vertical list (mobile-first single column). Each row:

- Agent-identity lead: small dot/initial in the agent's color + agent name + `kind` word ("Riley · approval", "Alex · handoff").
- `humanSummary` in serif, 1–2 lines.
- Risk pill from `riskContract.riskLevel` (low/medium/high); when `riskContract` is absent → "needs review". Hairline-weight treatment, **not** a traffic light.
- Right meta: approval → "4m ago"; handoff → SLA "due in 47m" (urgent under ~15m gets a quiet escalation in weight, never a red fill).
- Sort by `urgencyScore` desc. Optional light grouping ("Needs you now" vs "Can wait").

**Swipe carries over unchanged from P1-B — do not redesign it:** swipe-left = Skip (always). Swipe-right commits Approve ONLY when the risk contract allows (`riskLevel: "low"` AND none of external/financial/client-facing); otherwise it rubber-bands, primes the button, and opens detail — it never commits. Tapping a row opens the detail sheet.

States: loading = skeleton rows (no spinner); error = inline banner (never a full-page replace; the list shell stays); empty = calm "That's everything." with last-cleared time.

## Part 2 — Decision detail sheet

A **full-screen slide-up sheet** over the inbox (mobile-native; rides the existing right-drawer/sheet infrastructure — **not** a route, **not** a centered modal). Grab handle at top, close (✕). Content branches on `kind`.

### 2a — Approval detail (data ceiling = the `Decision`)

1. **Header** — agent identity (color dot + name) + "needs your okay"; risk pill; meta line "proposed 4m ago · undoable for 23h" (from `undoableUntil`).
2. **Proposal** — `humanSummary` in Newsreader, prominent. Then `presentation.dataLines` as plain human-readable impact/evidence lines (skip the block entirely if empty — never show an empty container).
3. **What this changes** *(designed target — mark `pending backend`)* — a quiet before→after / confidence / dollars-at-risk panel. These fields are **NOT on the wire today**; render the layout but with a dashed/ghosted treatment and a small "preview not yet wired" caption, so the visual target exists for a future backend slice without faking live numbers.
4. **Risk** — render the contract booleans honestly as plain-English chips ("Affects your ad spend", "Goes out to a client", "Changes something outside Switchboard", "Needs your explicit okay"). The UI **reads** these flags; it never infers risk from the wording of the summary. Absent contract → a single "Needs review before this can run" line.
5. **Actions** — amber primary (`primaryLabel`), ghost secondary (`secondaryLabel`), quiet dismiss (`dismissLabel`). If `requiresConfirmation` (or contract absent), primary opens a small confirm step ("Yes, {action}" / "Not now") before committing. After a primary commit, show an **Undo** toast while `undoableUntil` is live.
6. **View conversation →** if `threadHref` is set.

### 2b — Handoff detail (rich, bankable)

1. **Header** — "Alex is handing this to you"; reason as a plain chip (map `reason` → human phrasing, e.g. `complex_objection` → "Tricky objection", `booking_failure` → "Booking didn't go through"); SLA countdown from `slaDeadlineAt`.
2. **The lead** — `leadSnapshot`: name, channel (WhatsApp/etc.), `serviceInterest`, phone/email; `qualificationSnapshot.qualificationStage` + `leadScore` as a quiet qualification line. "View full contact →".
3. **Where it stands** — from `conversationSummary`: sentiment (plain word, not a colored gauge), key topics as small tags, objection history, and — featured — `suggestedOpening` as a one-tap "Start with this" that prefills the reply box.
4. **Conversation** — the real `conversationHistory` thread (lead vs agent turns, timestamps), most-recent visible, expandable to full.
5. **Actions** — a reply composer (prefilled by `suggestedOpening` if present): amber "Send & hand back to {agent}" → `/reply`; quiet "Mark resolved" → `/resolve` (optional note). No edit, no undo.

## State coverage (both layouts)

- Loading the detail: skeleton blocks within the sheet, no spinner.
- Fetch error (handoff detail): inline retry inside the sheet, list untouched behind it.
- Approval already acted / expired while open: actions disable, show "Already handled" / "Expired 12s ago".
- Handoff past SLA: countdown reads "overdue", weight increases, still actionable.
- Legacy approval with no `riskContract`: treated as unsafe — no swipe-approve, confirm step required, "Needs review" line.

## Anti-patterns (generic SaaS aesthetics are the default failure mode — avoid)

- **No fabricated metrics on approvals.** No confidence %, no charts, no dollar figures unless tagged `pending backend` — the live wire does not carry them.
- No red/yellow/green traffic lights for risk or sentiment. Risk = hairline weight + the locked agent-identity/amber system; sentiment = a plain word.
- Agent identity color NEVER fills an action button. Amber is the only "do this" color.
- Not a route, not a centered modal — a slide-up sheet over the inbox.
- No "approve all". Each decision is one judgment.
- No invented edit-the-parameters flow on approvals (no endpoint exists).
- Don't reopen the per-agent-cockpit pattern — the sheet is read-mostly + the listed actions, nothing deeper.

## Deliverable

A single React + Tailwind (or CSS-module) prototype rendering: the Inbox list, and the detail sheet in BOTH `kind` variants. Realistic fixtures:

- 8–10 inbox rows mixing both kinds, all three agents, a spread of `riskLevel`, one legacy row with `riskContract` absent, one handoff within 15 min of SLA.
- One worked **approval** (e.g. Riley wants to pause a campaign, `riskLevel: "low"`, `financialEffect: true` → not swipe-approvable, confirm required) with 2–3 `dataLines`.
- One worked **handoff** (e.g. Alex, `complex_objection`, frustrated sentiment) with a full `leadSnapshot`, `qualificationSnapshot`, `conversationSummary` including a `suggestedOpening`, and a 6–8 turn `conversationHistory`.

Phone layout first; the sheet is full-screen on phone.
