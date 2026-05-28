# Claude Design Prompt — Agent panel (read-mostly drill-in)

Generated 2026-05-26. Backend-verified against the live wire shapes:

- `packages/schemas/src/agents.ts` (`AGENT_REGISTRY` — name, role, launchTier per `alex`/`riley`/`mira`)
- `apps/dashboard/src/app/globals.css` + `lib/cockpit/riley/riley-config.ts` (warm-editorial tokens; **Riley identity is teal `--agent-riley 180 33% 40%`** in the dashboard layer — do NOT use the stale clay `hsl(15 45% 50%)` still in the schemas registry)
- `apps/dashboard/src/hooks/use-agent-greeting.ts` → `GET /api/dashboard/agents/:agentKey/greeting` (`apps/api/src/routes/greeting.ts`) — agent-voice verdict line
- `apps/dashboard/src/hooks/use-agent-metrics.ts` → `GET /api/dashboard/agents/:agentKey/metrics?window=week` (`apps/api/src/routes/agent-home/metrics.ts`) — returns the whole `MetricsViewModel` as `{ vm }`; shape in `apps/dashboard/src/lib/cockpit/metrics-types.ts` (`HeroMetric`, `targets`, `spendCents`)
- `apps/dashboard/src/hooks/use-decision-feed.ts` → `GET /api/dashboard/agents/:agentKey/decisions` (`apps/api/src/routes/decisions.ts`) — per-agent open decisions (`Decision` shape in `lib/decisions/types.ts`)
- `apps/dashboard/src/hooks/use-agent-activity-cockpit.ts` → `GET /api/dashboard/agents/:agentKey/activity` (`apps/api/src/routes/agent-home/activity.ts`) — work log; `ActivityRow` shape in `packages/schemas/src/cockpit-activity.ts`
- `apps/dashboard/src/hooks/use-agent-mission.ts` → `GET /api/dashboard/agents/:agentKey/mission` (`apps/api/src/routes/agent-home/mission.ts`) — `MissionAggregatorResponse`: `mission.channels[]` + top-level `setup[]`
- `apps/dashboard/src/hooks/use-agents.ts` (`useAgentState` → proxy `GET /api/dashboard/agents/state`) — returns `{ states: AgentStateEntry[] }` (array for all agents); status derived from last-24h audit entries
- `apps/dashboard/src/hooks/use-governance.ts` + `components/layout/halt/halt-context.tsx` → `POST /api/dashboard/governance/halt` / `…/resume` — the safety action
- `apps/dashboard/src/lib/decisions/types.ts` + the existing decision-detail sheet (`docs/design-prompts/2026-05-25-inbox-detail.md`) — the drill-out target for the decisions row

If any of these schemas drift, regenerate this prompt rather than amending it.

> **Honesty rules for this prompt (read first).** This panel reports on agents that spend real money and message real clients, so a panel that *looks* reassuring while data is missing is the cardinal failure (the product's worst-ever bug was a "pause" that was a safety illusion). Four ceilings are non-negotiable:
> 1. **Three states never collapse into each other:** *loading* (skeleton), *error/unavailable* ("Couldn't load…"), and *genuinely zero* ("Nothing yet" / "$0"). A failed fetch must NEVER render as a confident `0`, empty, or positive verdict. `null ≠ 0`.
> 2. **Status is a report of observed actions, not a liveness claim.** `AgentStateEntry.activityStatus` (enum `idle | working | analyzing | waiting_approval | error`) is *derived from the last 24h of audit entries* — never render a bare "Working." Render with provenance + recency from `lastActionAt` / `lastActionSummary` ("Active — last action 2h ago" / "No activity in 24h"). **"Paused" is NOT in that enum** — it comes from the deployment/governance layer (the halt context), and when set it overrides any derived activity label.
> 3. **Pause is ORG-GLOBAL.** There is no per-agent halt. The safety action must say so (see §Actions). Never label it with one agent's name.
> 4. **Bankable for `alex` + `riley` only.** Every data endpoint 404s/400s for `mira` (she is launch-tier `day-thirty`, genuinely not set up). Mira gets an honest "Not set up" panel — never a zero-filled Alex-shaped shell.
> 5. **Money fields are CENTS.** `spendCents`, `targets.targetCpbCents`, `targets.avgValueCents` are integer cents — format to dollars for display (`÷100`), never render the raw value, never assume dollars. (Same trap the Results prompt flags.)

---

> **v1 design lives in [`docs/superpowers/specs/2026-05-26-agent-panel-design.md`](../superpowers/specs/2026-05-26-agent-panel-design.md)** and is authoritative for *what the panel is*. It **supersedes** this prompt's **§5 (ONE safety action)**, the **§2 v1.1 cumulative note**, the **Deferred** list, and the **Pause/Resume** references in **State coverage** and **Deliverable** — i.e. the panel is **read-only** (no pause on the panel; it lives at the workspace level), the status line gains a forward health read, slot ② promotes the cumulative "since you hired" hero (with a week fallback), and there is no trust line. This prompt remains the **backend-contract + honesty-rules + wire-shape** reference.

---

Design the **agent panel** for "Switchboard" — a governed, mobile-first front desk used by a non-technical medspa / clinic owner for a 2-minute, phone-first daily check-in. The owner's AI team is **Alex** (lead-to-speed responder), **Riley** (ad optimizer), and **Mira** (creative, not yet live). The panel is the read-mostly drill-in the owner opens by tapping an agent — from the Team Pulse ribbon on Home **and from an agent chip/avatar anywhere in the app** (Inbox, Results). It does not exist yet.

## Mental model (do not break)

The owner tapped an agent to answer one human question: **"Is my employee doing their job, and do they need anything from me?"** Everything on the panel answers *"doing their job?"* or *"need anything?"* — or it gets cut. This is a manager glancing at one employee, **not** an operator opening a console. Every label names an OUTCOME, never an internal concept.

This panel is a **sheet/drawer over the current screen — NEVER a route**, and **read-mostly**: the only mutating control is the one safety action. Anything deeper (settings, charts, knobs, playbooks, full history, permissions tuning) routes OUT to Settings or Results. That routing-out is the structural fuse that stops this panel re-becoming the bloated per-agent "cockpit" a prior phase deleted (it scored Visual 4/10, Daily-use 3/10). If you find yourself adding a second metric or a chart, stop.

## Panel contents — vertical order (the locked 5-slot budget)

A phone-height slide-up sheet. Grab handle, close (✕). For a **set-up agent** (Alex, Riley), top-to-bottom:

### 1. Identity + agent-voice status

- Agent color dot/initial + name + role ("Alex · Lead response"). Identity color is **orientation only** (see tokens) — Alex coral, Riley **teal**, Mira violet.
- Status line — select the tapped agent's entry from `useAgentState`'s `states[]` and render `activityStatus` with provenance from `lastActionAt`/`lastActionSummary`: **"On shift — last action 12m ago"** / **"Quiet — no activity in 24h."** Never a bare "Working." If the agent's deployment is paused (from the halt context, not this hook), "Paused" wins over any derived label.
- The agent-voice **verdict line** from `useAgentGreeting(agentKey)` → `GreetingViewModel { variant, segments: ProseSegment[], signal: { inboxCount, oldestOpenItemAgeHours }, freshness }` (per-agent; `alex`/`riley`, 400 for `mira`). Render `segments` as one warm first-person sentence: *"Steady morning — answered every lead under 2 minutes."* On missing data → **"Nothing to report yet,"** never a synthesized positive.

### 2. ONE key result (this week)

From `useAgentMetrics` — render `vm.hero.value` + `vm.hero.comparator` as the single headline. `hero.kind` is a discriminated union `tours-booked | ad-leads | creatives-shipped | revenue-attributed`:
- **Alex:** hero kind is `tours-booked` — a *count* of consults booked this week. (The wire label says "tours" but the vertical is medspa — **render it as "consults booked,"** never "tours.") Show the value + its comparator beat.
- **Riley:** hero kind is `ad-leads` — a *count* of leads this week. Cost-per-lead-vs-target is **not** in `hero`; if you show it as the comparator beat, compose it from `vm.targets.targetCpbCents` + `vm.spendCents` — **both CENTS, format to dollars** (honesty rule #5).

**Exactly one number.** A second tile rebuilds the cockpit KPI grid — depth lives in Results. Distinguish *unknown* from *zero*: 503/missing → **"Not enough data yet"** (skeleton), a true zero → "$0 this week" / "0 booked." Never coerce `null → 0`.

> *(v1.1 enhancement — see §Deferred. The strongest version of this slot is a cumulative "Since you hired Alex: 214 leads answered, 38 consults booked" headline with the week figure as a supporting beat. It is NOT live today and must not be faked; design the slot so a cumulative headline can sit above the week beat later.)*

### 3. Open decisions (this agent's queue) → routes OUT

From `useDecisionFeed(agentKey)`: the count + a one-line gist per item ("2 things need you"). Each row is **tappable and opens the existing decision-detail sheet** (`2026-05-25-inbox-detail.md`) — the panel surfaces, the Inbox owns the actual approve/handoff. **Do NOT put approve/reject controls inside this panel.** On fetch error show "Couldn't load decisions" — never "0 / nothing needs you." The count must read from the same `Decision` source as the Inbox, or it manufactures a contradiction the owner will catch.

### 4. Recent work log (presence)

From `useAgentActivityCockpit(agentKey)`: **3–5** factual, timestamped rows, hard-capped, with a **"since you last looked"** header ("Alex handled 4 things since this morning"). Each `ActivityRow` carries `{ id, time, kind, head, body?, who?, contactId?, preview?, tag? }` where `kind` is an enum (`replied | booked | qualified | sent | escalated | …`) — it does **NOT** carry a ready-made sentence. **Compose the first-person, outcome-framed voice client-side** from `kind` + `head` + `who` — *"I replied to Sarah K. — she asked about Botox pricing · 14m ago"* — not a raw system-event log. This is the highest-frequency content the owner sees and where the "AI employee" feeling actually compounds (presence proven on every line). A quiet "See all in Results →" absorbs anyone wanting more — never an infinite/paginated feed in the panel. Empty due to error → "Work log unavailable"; genuinely empty → "No actions in the last 24 hours."

### 5. ONE safety action — honest org-global Pause

The only mutating control. It is the existing **org-global** halt, surfaced truthfully — **never** scoped to or labeled with one agent's name:

- Button: **"Pause all agents."** Helper beneath: *"This stops Alex, Riley, and Mira together — Switchboard pauses your whole workspace, not one agent."*
- Confirm step (required — real-money stop, no one-tap): title **"Pause all agents?"**, body *"Alex stops replying to leads, Riley stops adjusting ad budgets, and Mira stops too. Conversations already waiting will sit unanswered until you resume."* Confirm **"Pause everything"** / Cancel **"Keep running."**
- After pausing, the control flips to **"Resume agents."** **Resume-asymmetry honesty (verified backend bug):** resume currently restores only Alex — Riley/Mira can stay paused. Until the backend is fixed, do NOT imply one-tap resume restores all three: show a **per-agent "Paused" badge** in the identity header of any agent still down, and use truthful resume copy ("Resuming brings Alex back; Riley and Mira may need a separate restart"). *(Flagged separately as a backend correctness fix — see §Deferred.)*

## Activation state — under-configured agents (same slot, mutually exclusive with proof)

When `useAgentMission` shows incomplete setup, the **key-result slot (§2) is replaced by an activation block** — no separate module, no clutter. In `MissionAggregatorResponse`, channels are `mission.channels[]` (`status: "ok" | "warn" | "off"`) and the checklist is the **top-level** `setup[]` (`{ key: "meta" | "inbox" | "cal" | "rules", done }`); trigger activation when a required `setup` row is `done: false` or a channel `status === "off"`, and map the `key` to the right CTA. One agent-voiced, value-framed CTA: *"Riley can't optimize yet — connect Meta and Riley starts watching your ad spend today."* (`agentKey` is typed `alex | riley` only — never render a mission block for Mira.) Once connected, the same slot flips to the proof hero. This transformation (empty promise → live employee) is the strongest trial-conversion moment in the product.

## Mira — honest "Not set up" panel

Mira is in the roster and tappable, but every data endpoint returns 404/400 (launch-tier `day-thirty`, not seeded — this is intentional, not a failure). Tapping Mira opens a panel whose **entire body is the truth**: **"Mira isn't set up yet."** Sub: *"Mira handles creative and content. She becomes available as your workspace grows."* At most ONE informational forward action ("Learn what Mira does") — **no "Set up Mira" CTA that dead-ends.** Never hide her (the owner was told they have three agents; a vanished agent reads as broken), never zero-fill her 404s into "$0 / 0 decisions / idle" (that lies that she's working-but-unproductive). The "Pause all agents" confirm copy still names Mira.

## Design system — current "warm operational editorial" tokens (verified in globals.css)

CSS vars; colors are HSL triples consumed as `hsl(var(--x))`.

- Canvas: `hsl(var(--canvas))` warm cream `40 25% 94%`; card `--surface`; raised `--surface-raised`; inset `--canvas-2`; sheet handle / divider `--canvas-3`.
- Ink: `--ink` (12% near-black), `--ink-2`, `--ink-3` (muted), `--ink-4` (faint).
- **Action amber — the ONE action color:** `hsl(var(--action))` `30 55% 46%`, hover `--action-hover`, text `--action-foreground`. The Pause/confirm primary is amber.
- **Agent identity (orientation only, NEVER on an action button):** `--agent-alex` coral `14 70% 58%`, `--agent-riley` teal `180 33% 40%`, `--agent-mira` violet `270 45% 58%`; tint/border variants `--agent-{name}-{deep,tint}`.
- State dots: `--agent-active` (calm green), `--agent-idle`, `--agent-attention`, `--agent-locked`.
- Sheet elevation `--shadow-sheet`; card lift `--shadow-lift`.
- Fonts: **Newsreader** `var(--font-home-serif)` for the verdict line + work-log prose; **Hanken Grotesk** `var(--font-home-sans)` for labels/body/buttons; mono for IDs only.

Three-layer hierarchy, strict: **cream = base · agent color = orientation · amber = action.**

`globals.css` is shared with the parallel Inbox/Results worktrees — **consume these `:root` tokens, do not redefine them**; alias at component scope if needed. The panel must **ride the same sheet/drawer primitive as the decision-detail sheet** (`2026-05-25-inbox-detail.md`), not a second, differently-styled sheet — the decisions row in §3 opens that exact sheet.

## State coverage

- Loading the panel: skeleton blocks per slot, no spinner.
- Any slot's fetch error: that slot reads "Couldn't load…" inline; the rest of the panel still renders. One failing slot never blanks the sheet.
- **Required:** a single "as of 3:42pm" freshness line at the panel foot — the panel's whole thesis is provenance over liveness, so every derived/aggregated figure must self-disclose its recency.
- **Pause confirm presentation:** the confirm step is an **in-sheet bottom-anchored block** within the panel (or a second nested sheet), **never a centered modal** — the body dims behind it. Primary "Pause everything" is amber; "Keep running" is a quiet ghost.
- **Paused badge:** a small uppercase-caps text chip beside the identity dot using `--agent-locked` — **never a red pill**. Shown per-agent on any agent still down after a global halt (the resume-asymmetry case).
- **Activation vs proof are the same slot, visually distinct:** the proof hero is a large quiet number; the activation block is a single agent-voiced line + one amber CTA in a tinted (`--agent-{key}-tint`) call-out — so the owner reads "not hired yet" vs "working," not "two different metrics."

## Anti-patterns (generic SaaS aesthetics are the default failure mode — avoid)

- **No second metric, no KPI grid, no charts/trend lines/funnels** — one hero number; depth is the Results tab.
- **No per-agent settings, sliders, knobs, thresholds, or model config** — routes OUT to Settings.
- **Not a route, not a centered modal** — a slide-up sheet over the current screen.
- **No write actions except the one safety action** — decisions route OUT to the Inbox sheet (which owns the P1-B risk-gated approve); no inline approve/reject here.
- **No "Pause Alex"** over an org-global halt; **no implied full resume** while resume only restores Alex.
- **No fabricated numbers** — no cumulative figure, no confidence %, no attributed dollars the wire doesn't carry; `null` renders as "not enough data," never `0`.
- No red/yellow/green traffic lights; status and sentiment are plain words + the locked identity/amber system.
- No infinite work-log feed; hard cap + "See all in Results →".
- No raw WorkTrace / debug detail — that's the internal operator console, below this owner's literacy.

## Deferred (document, do not build in this prototype)

- **Cumulative "since you hired" proof headline (v1.1).** Backend-verified **CHEAP, not greenfield:** the metrics stores already accept arbitrary date ranges and `AgentDeployment.createdAt` is the "hired" anchor; it needs only a `window=all` enum value in `metrics.ts:10` + a `from = deployment.createdAt` branch + generalizing the week-bound viewmodel. Until that ships, §2 uses the live week hero.
- **Permissions / autonomy "ratchet" line (v1.1).** "Riley adjusts budget up to $300, asks above — this limit rises as Riley earns your trust." The data exists per-deployment (`spendApprovalThreshold`, `trustLevel` observe→supervised→guided→autonomous, score ceilings 29/54/55) but **no API exposes it.** A hardcoded version is a *forbidden* scope-guarantee illusion — build the read-only endpoint (and confirm the threshold is actually *enforced*, not just stored) or omit the line entirely. The dashboard already ships a home-level `Permissions` line pattern to reuse. Place it as one quiet line under the safety action.
- **Backend correctness fix (separate issue):** resume hardcodes `skillSlug:"alex"` (`apps/api/src/routes/governance.ts:~315`) while `haltAll` is org-wide — so resume silently leaves Riley/Mira paused. De-hardcode resume to restore every halted deployment. The honest UI mitigation above is a stopgap, not the fix.

## Deliverable

A single React + Tailwind (or CSS-module) prototype for the clinic **"Aurora Aesthetics"** (match the Inbox/Results fixtures), rendering the agent panel in **four states** so every branch is shown:

1. **Set-up agent (Alex), active** — identity + "On shift — last action 9m ago" + verdict line; `tours-booked` hero rendered as **"7 consults booked this week"** (+ comparator); **2 open-decision rows** with real gists ("Reply drafted for Priya — asking about lip filler aftercare"; "Sarah K. wants to move her Botox consult to Friday") that tap → open the decision-detail sheet; **4 first-person work-log lines** with a "since you last looked" header — e.g. *"I replied to Maya R. about Morpheus8 pricing · 14m ago"*, *"I booked Jen T.'s consult for Thu 2pm · 1h ago"*, *"I qualified a new lead from Instagram · 2h ago"*, *"I sent a reminder to 3 no-shows · 3h ago"*; "Pause all agents" → its in-sheet confirm step.
2. **Activation agent (Riley), Meta not connected** — same shell; the key-result slot is the tinted "connect Meta so Riley can start" activation call-out (driven by a `setup` row `{ key: "meta", done: false }`).
3. **Not-set-up agent (Mira)** — the honest "Mira isn't set up yet" panel with the single informational action.
4. **Resume-asymmetry edge (Riley), paused** — after a global halt: Riley's identity header shows the `--agent-locked` "Paused" badge and the work-log/hero read their genuine-empty (not error) states; demonstrates the honest paused treatment.

Use the canonical `agentKey` / `Decision` / `GreetingViewModel` / `ActivityRow` shapes. Phone layout first; the panel is a full-height slide-up sheet on phone.
