# Console as Home — One-Page Dashboard Direction

**Status:** Draft
**Date:** 2026-04-30
**Scope:** `apps/dashboard` — the authed `/dashboard` (Home) route, the bottom-tab IA, and the consolidation of `Decide` / `Escalations` into the unified queue.
**Supersedes:** [`2026-04-29-dashboard-v6-redesign-design.md`](./2026-04-29-dashboard-v6-redesign-design.md). The five-zone "home page made operational" layout (PhoneFrame for Alex, full Nova table panel, Mira pipeline cards, voiced frame headline, floating dispatch dock) is **not** the dashboard. Per-agent module pages reachable via the agent strip's `view →` links carry that fuller surface.

## Background

After the 2026-04-29 v6 redesign spec was drafted, a tighter alternative was iterated on (`switchboard/project/dashboard/Console.html` in the design handoff bundle, 2026-04-30). The Console drops the marketing-derived per-agent surfaces in favor of a denser **operating console** form: one expanded panel at a time, mono-heavy data lines, hairline-only chrome, coral reserved for actions.

Both directions share the same palette (warm ivory `hsl(28 30% 92%)` + coral `hsl(14 75% 55%)` + General Sans / JetBrains Mono) and the same agent vocabulary (Alex / Nova / Mira). They differ on what a dashboard surface is **for**.

The Console is closer to right for a single-owner SMB persona who opens the app on their phone between meetings and either intervenes or closes it. The v6 spec is closer to right for a marketing-driven first-impression surface that echoes the home page's beats. For the authed dashboard, **the Console wins**.

## Goal

Ship `/dashboard` as a single page that:

- Surfaces _what needs the owner_ first (the queue) — research-backed task-centric hierarchy.
- Provides at-a-glance business context above the queue (5-cell numbers strip).
- Shows agent status + one expanded agent panel inline.
- Carries an audit trail (activity) at the bottom.
- Reduces the bottom-tab count from 5 → 3 by absorbing `Decide` and `Escalations` into the queue.
- Stays calm: hairlines only, mono labels, coral on actions.

## Non-goals

- Redesigning `/conversations`, `/me`, `/settings`, `/modules/*`, `/onboarding`, `/setup`, `/login`. Those keep their current layouts; only the bottom-tab nav changes.
- Building per-agent deeper-look surfaces. Those stay at `/modules/{ad-optimizer,creative,...}` and remain reachable via the agent strip's `view →` links.
- Designing the inactive-agent (Hire X) surfaces. Deferred to the wiring phase (option B) — a follow-on once the schema knows which modules are enabled.
- Migrating shadcn/Radix primitives.
- Changing the home page (`(public)/page.tsx`). It stays as the v6 marketing surface.

## Why this direction

Backed by 2026 UX research:

- **3-5 tabs is the consensus range** for mobile bottom nav (Designstudiouiux, NN/G _Tabs Used Right_, Medium 2026 best-practices). 3 tabs sits at the lower edge but stays clear; 5 with overlapping job descriptions (Decide + Escalations both duplicating the queue) violates cognitive-load research.
- **Task-centric hierarchy is the operator pattern.** GlitchLabs admin-dashboard 2026: _"Each view should answer: what needs my attention, what action should I take, and what context do I need to decide?"_ The Console's Queue → Agents → Activity hierarchy literally answers this.
- **Single-screen at-a-glance is what SMB owners want.** Thryv SMB research: _"Business dashboards enable you to see the entire status of your business at one glance."_
- **3-5 KPIs is the right metric count.** UX Planet 2026: _"Choose 3-5 metrics that truly move the business."_ The numbers strip sits at exactly 5.
- **F-shaped scanning pattern** (NN/G, 232-user eye-tracking) — left-aligned headlines + right-aligned timers/CTAs match this. Already correct in the Console layout.

## The model

```
┌──────────────────────────────────────────────────────────────┐
│  Operating strip (sticky)                                    │
│  Switchboard · {Org} · {time}              ● Live    Halt    │
├──────────────────────────────────────────────────────────────┤
│  Numbers strip (5 cells, hairlines between)                  │
│  REVENUE TODAY  LEADS TODAY  APPOINTMENTS  SPEND  REPLY TIME │
│  $1,240         7            3 today       $842   12s avg    │
│  +18% vs avg    ↑ 2 vs yest  next: 11:00   24% cap ↓ from 18s│
├──────────────────────────────────────────────────────────────┤
│  QUEUE — N pending                                           │
│  Card A: Escalation · Alex   ┃ 2px coral left rule           │
│  Card B: Recommendation · Nova                               │
│  Card C: Approval Gate · Mira                                │
│  (HEALTH rows added at wiring time when module status known) │
├──────────────────────────────────────────────────────────────┤
│  AGENTS                                                      │
│  ALEX             │  NOVA (active)        │  MIRA            │
│  14 replied today │  $842 spent today  ●  │  3 in flight     │
│  view conv →      │  view ad actions →    │  view creative → │
│  ───────────────────────coral underline────                  │
│  NOVA · AD ACTIONS panel                                     │
│  table (5 ad-set rows) + pinned cross-link to queue card     │
├──────────────────────────────────────────────────────────────┤
│  ACTIVITY (240px scroll, +N more today)                      │
│  10:42  NOVA  Draft pause created — Ad Set B   APPROVE       │
│  10:38  ALEX  Lead booked — Sarah · consult                  │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

## Information architecture

### Bottom-tab nav: `OwnerTabs` reduced to 3

| Tab   | Route            | What it carries                                       |
| ----- | ---------------- | ----------------------------------------------------- |
| Home  | `/dashboard`     | The Console + numbers strip — entire operator surface |
| Chats | `/conversations` | Existing conversations route                          |
| Me    | `/me`            | Existing identity / settings entry point              |

### Tabs that go away

- **`Decide`** — its function (approvals) lives in the Queue (Recommendation + Approval Gate cards). The `/decide` route stays as a deep-link destination from queue cards (`Open in detail →`) for cases where the operator wants the fuller per-item view, but the tab is removed.
- **`Escalations`** — same. The Queue's Escalation card type carries this. The `/escalations` route stays as deep-link destination.

This is a **consolidation**, not a rebuild — the underlying routes don't disappear, they just stop being top-level navigation.

## Layout — section detail

### Operating strip

- Sticky, full-bleed at the top.
- `Switchboard · {Org} · {time}` left in mono, `--c-text-3`.
- Right: pulsing coral `Live` indicator (or graphite `Halted`), then **Halt** as a discoverable ghost button — permanent visible home.
- Replaces both `DashboardHeader` and the existing in-body `EmergencyHaltButton` block.

### Numbers strip (new — research-driven addition)

5 cells, hairline-divided, between the operating strip and queue.

| Cell               | Source                                             | Backend status                                                                              |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Revenue today      | summed bookings/payments today                     | not in `DashboardOverview` (today's revenue is folded into 7d) — **needs schema extension** |
| Leads today        | `useDashboardOverview.stats.newInquiriesToday`     | exists                                                                                      |
| Appointments today | `useDashboardOverview.bookings` filtered to today  | exists; "next: 11:00 · Sarah" sub-line derives from same array                              |
| Spend today        | aggregated across enabled ad-optimizer deployments | not in `DashboardOverview` — **needs schema extension**                                     |
| Reply time         | median Alex first-response                         | not in `DashboardOverview` — **needs schema extension**                                     |

Each cell: mono uppercase label / large General Sans value / mono delta line. Tone variants (`good` / `coral` / `neutral`) tint the delta line. Responsive: 5 cols ≥ 880px, 2 cols below.

### Queue (Zone 2)

Three card types, sorted globally by urgency:

- **Escalation** — 2px coral left rule, full card height. From `useEscalations()`. Carries: contact name, channel, issue prose with bold spans, primary outcome (coral), secondary, self-handle.
- **Recommendation** — no border. From an aggregated "agent drafts" feed (Nova + Mira). Carries: action headline, mono data lines (spend / metrics / savings estimate), graphite primary, ghost edit, dismiss.
- **Approval Gate** — no border. From `useDashboardOverview.approvals` filtered to creative-pipeline gates. Carries: job name, stage progress (`Stage 2 of 5`), gate countdown, graphite primary, stop-campaign side action.
- **HEALTH (added at wiring time)** — for module connection issues (`Meta token expired`, `WhatsApp not verified`). From `useModuleStatus`. CTA resolves to the relevant connection page.

### Agents strip + expanded panel (Zone 3)

3-column strip, 70px tall, hairline-divided. Each cell:

- Mono uppercase agent name
- Primary stat (large General Sans medium)
- Secondary stat (mono small) + optional coral pending dot
- `view → ` link to the per-agent module detail page

Active agent (Nova by default in the prototype; computed from "agent with the most recent draft" in production) gets a coral underline + expanded panel below.

The expanded panel for Nova carries the 5-row ad-set table, the cross-link draft note ("approve in queue above ↑"), and a graphite-pill `View full ad actions →` footer. Alex / Mira expanded panels follow the same shape — subbed for `view conversations →` (Alex) and `view creative →` (Mira) deep-links plus agent-appropriate inline data.

### Activity (Zone 4)

240px scrollable mono trail. Each row: time / agent / message (with optional bold spans) / CTA-or-arrow. Coral CTAs only on actionable events (`Approve`, `Review`). Hover-revealed `→` on non-actionable rows.

Source: `useAudit().entries` mapped to `ActivityRow` view-model. Agent attribution requires `actorId → agent name` mapping — **needs backend addition** (today the audit feed has no agent field).

## What gets removed

- `DashboardHeader` (replaced by operating strip)
- `StatCardGrid` + `StatCard` (replaced by numbers strip — different metrics, different layout)
- `ModuleCards` + `module-card.tsx` (cross-agent module status collapses into HEALTH rows in the queue)
- `RecommendationBar` (becomes Recommendation cards in the queue)
- `SynergyStrip` (cut)
- `FunnelStrip` (deferred to a future `/dashboard/ops` view if needed)
- `RevenueSummary` card (cell 1 of numbers strip carries today's total; weekly revenue defers)
- `OwnerTaskList` (folded — owner tasks become Suggestion-type queue rows when added later)
- `BookingPreview` card (cell 3 of numbers strip carries the next appointment inline)
- `EmergencyHaltButton` body block (button promotes to operating strip)
- `DispatchToggle` body block (the operating strip's `Live` indicator is the dispatch state; the toggle moves there or to settings)
- `Decide` and `Escalations` from `OwnerTabs` (routes preserved as deep-links)

## What stays

- `ActivityFeed` source (audit hook), reformatted to mono Activity rows.
- `FirstRunBanner` — repurposed inside the queue's first-run state.
- `EmailVerificationBanner` — kept above the operating strip.
- `OperatorChatWidget` — currently hidden on `/console`; once Console replaces `/dashboard`, decide whether to keep it on Home (small floating button can coexist) or move it to a settings entry. **Open question.**

## Phasing

### Option A — Preview (DONE, 2026-04-30)

`/console` ships behind chrome-hidden mode with static fixtures.

- Route: `apps/dashboard/src/app/(auth)/console/page.tsx`
- View-model types: `apps/dashboard/src/components/console/console-data.ts` (`ConsoleData` + discriminated `QueueCard` union + `RichText` + `NumbersStrip` + `AdSetRow` + `ActivityRow`)
- Single swap-point hook: `apps/dashboard/src/components/console/use-console-data.ts`
- Pure renderer: `apps/dashboard/src/components/console/console-view.tsx`
- Scoped CSS: `apps/dashboard/src/components/console/console.css` (`[data-v6-console]` gate)
- Chrome hidden on `/console` (app shell + operator chat widget)

**Acceptance:** typecheck passes, all dashboard tests pass, `/console` renders pixel-matched to `Console.html` plus the 5-cell numbers strip.

### Option B — Wire what backend exposes today

Replace fixture in `use-console-data.ts` with composition over real hooks:

| Field                                      | Source                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `opStrip.orgName`                          | `useOrgConfig().config.name`                                                      |
| `opStrip.now`                              | client clock                                                                      |
| `opStrip.dispatch`                         | `useOrgConfig().config.dispatch` (or `useDispatchStatus`)                         |
| `numbers.cells.{leadsToday, appointments}` | `useDashboardOverview.{stats, bookings}`                                          |
| `queue` Escalation rows                    | `useEscalations()`                                                                |
| `queue` Approval Gate rows                 | `useDashboardOverview.approvals` filtered to `riskCategory === 'creative'`        |
| `agents` (partial)                         | `useModuleStatus` for active/inactive; primary stats may stay synthesized until C |
| `activity`                                 | `useAudit().entries` mapped (agent attribution may stay synthesized until C)      |

**Acceptance:** queue + agents strip + activity render real data; numbers strip shows the 2 cells the backend can fully serve and gracefully marks the other 3 as `—` until C; `/console` becomes feature-parity with the existing `/dashboard` for the data it has.

### Option C — Schema extensions

Extend `DashboardOverview` (and `packages/schemas`) for the 7 fields the backend doesn't expose:

```ts
type DashboardOverview = {
  // existing
  ...
  // new
  revenueToday: { amount: number; currency: string; deltaPctVsAvg: number };
  spendToday: { amount: number; capPct: number };
  replyTime: { medianSeconds: number; previousSeconds: number };

  alexStats: { repliedToday: number; qualifiedToday: number; bookedToday: number };
  novaStats: { spendToday: number; draftsPending: number };
  miraStats: { inFlight: number; winningHook: string | null };

  novaAdSets: AdSetRow[];                  // aggregated cross-deployment
  approvalGates: ApprovalGateProgress[];   // stage / total / closesAt per pending gate
  recommendationConfidence: Map<string, { confidence: number; savingsEstimate: number }>;

  activity: Array<{
    ...existing fields...
    agent: AgentKey | null;                // nullable for system events
  }>;
};
```

**Acceptance:** all 5 numbers cells render real data; recommendation cards render real confidence + savings; approval-gate cards render real stage progress + countdown; activity rows show real agent attribution.

### Option D — Replace `/dashboard` with Console + remove tabs

The terminal cutover. Once B is solid:

1. Point `(auth)/dashboard/page.tsx` at `<ConsoleView data={useConsoleData()} />`.
2. Restore app shell chrome on `/dashboard` (and remove `/console` from chrome-hidden — or remove the `/console` route entirely and let Home be `/dashboard`).
3. Reduce `OwnerTabs` to `Home / Chats / Me`. Keep `/decide` and `/escalations` routes reachable as deep-links from queue cards.
4. Delete the components in _What gets removed_.
5. Update `(auth)/layout.tsx` accordingly.

**Acceptance:** all of B's acceptance + cleanup; `/decide` and `/escalations` no longer appear in nav but still serve when reached by URL or queue deep-link; existing per-route tests pass.

## Failure & loading

- **Loading:** skeletons in the Console aesthetic — mono micro-labels visible immediately, table cells/queue cards as `--c-hair-soft` placeholder rows. No spinners.
- **API error:** the operating strip shows `Couldn't load — check API server` in coral, with a `Retry` ghost button. Other zones render their inactive states with a small mono `unavailable` footer. Page never blanks.
- **Per-zone error:** if `nova` panel data fails but the queue succeeds, the queue renders normally and the Nova panel shows `Nova data unavailable · retry →`. Standard React Query per-key error handling.

## Accessibility

- Mono micro-labels (`Queue`, `Agents`, `Activity`) are real `<h2>` elements with the visible text.
- Live indicator has `role="status"` with a textual fallback.
- Color is never the sole signal — coral flags include text labels and structural cues (left rule on Escalation card, status pill on pause-pending row).
- Focus states use a coral outline (`focus-visible:outline-2 focus-visible:outline-coral`) on queue cards, agent strip cells, panel CTAs, and number cells.

## Testing

Per CLAUDE.md, every new module includes co-located `*.test.tsx`. Coverage targets: dashboard package (55/50/52/55).

- `console-view.test.tsx` — renders all four zones from a `ConsoleData` fixture; renders each `QueueCard.kind` correctly; renders the 5-cell numbers strip; renders Nova panel rows with pause-pending cross-link.
- `use-console-data.test.ts` — fixture mode returns the literal; later, mapper tests cover `useDashboardOverview → ConsoleData` projection per phase.
- `console-rich-text.test.tsx` — `RichTextSpan` renders strings, `{bold}`, `{coral}` segments correctly.
- Existing `operator-chat-widget.test.tsx` — covers the `/console` hidden state via `usePathname` mock; passes.
- The home page `landing/v6/__tests__/*` — must continue to pass; this spec touches no marketing components.

## Acceptance criteria (overall)

The direction lands when:

1. `/console` (option A) renders the four-zone Console + 5-cell numbers strip pixel-matched to `Console.html`, with all data flowing from typed `ConsoleData`. ✅ DONE 2026-04-30.
2. `use-console-data.ts` is the only file that changes when wiring lands (B → C). View, types, and route are stable.
3. Bottom-tab nav reduces to 3 (`Home / Chats / Me`) when option D ships; `/decide` and `/escalations` remain reachable as deep-links.
4. All Console types map cleanly to either current backend hooks (B) or extended `DashboardOverview` fields (C).
5. The 2026-04-29 v6 redesign spec is marked **Superseded** with a pointer to this spec.
6. `pnpm typecheck`, `pnpm test` pass at every phase.

## Sequencing

Specs and plans land on `main` via focused PRs (per CLAUDE.md). This spec is its own PR. Subsequent phases (B, C, D) get their own implementation plans via the writing-plans skill.

The `/console` preview implementation (option A) lives on `spec/dashboard-v6-redesign` while this spec is reviewed; once the spec lands on main, the preview implementation either lands as a separate PR or rolls into option D's PR — to be decided when the wiring plan is written.

## Open questions

- **Which agent expanded by default?** Prototype pins Nova active. Production rule TBD: most-recent-draft? most-recent-action? operator preference? Default in this spec: **most-recent draft**, fallback to Nova if all agents are quiet.
- **Operator chat widget on Home.** Currently hidden on `/console`. Once Console becomes Home, decide whether the floating button stays (small, doesn't break the design) or moves to a settings entry.
- **Halt button confirmation flow.** Today's `EmergencyHaltButton` has a confirm step. Console renders it as a one-click ghost — implementation should retain confirmation but with the Console's mono/coral aesthetic.
- **Numbers strip on small phones.** The `< 880px` 2-col fallback works but is dense; consider hiding the lowest-priority cell (Reply time?) on `< 480px`. Revisit at wiring time with real device testing.
- **First-run state.** A 2026-04-30 fresh-install operator opens `/dashboard` with zero queue, zero activity, all panels empty. Need a single cold-start card replacing the queue — copied from the v6 spec's pattern. Out of scope for option A; required for option D.
- **HEALTH row source.** The v6 spec proposed extending `useModuleStatus`; this spec inherits that idea but defers the schema work to phase C.
