# Console Redesign — Phase 3 (Agents)

**Status:** Draft
**Date:** 2026-05-03
**Scope:** `apps/dashboard/src/components/console/` — wire the Agent strip to expand into per-agent panels (Nova, Alex, Mira). Replace the always-rendered Nova stub with a single mutually-exclusive panel slot below the strip. Wire per-agent stats to real metrics. Add the cross-link from Nova into queue approval-gate cards.
**Amends:** [`2026-05-02-console-frame-phase-1-design.md`](./2026-05-02-console-frame-phase-1-design.md) and [`2026-05-03-console-frame-phase-2-design.md`](./2026-05-03-console-frame-phase-2-design.md). Phase 1 deferred agent click-to-expand and per-agent today-stats; Phase 2 added the `id="q-${cardId}"` queue scroll targets that Phase 3's cross-link consumes.
**Defers:** Phase 4 (Activity filters + CTA-jump-to-queue + flash-on-new). Real Halt backend (own spec). Recommendation card backend (own spec). Full threaded transcript inside Nova rows.

## Background

After Phase 2 lands, `/console` renders OpStrip + WelcomeBanner + QueueZone + AgentStrip + NovaPanel (always-visible stub) + ActivityTrail. The AgentStrip is a static row of three cards; clicking does nothing. Alex and Mira have no equivalent panels. Per-agent stats are placeholders (em-dashes). Keyboard `1/2/3` are reserved by Phase 1 spec but unwired.

The original `claude.ai/design` chat-6 handoff bundle (`Console.html` + `console.css` + `console-app.jsx`) treats the Agents zone as a single click-to-expand surface: the strip is the chooser, and exactly one panel hangs below it at a time. The CSS scaffolding is already in tree (`.panel`, `.panel-head`, `.panel-foot`, `.panel-note`, `.pill-graphite`, `table.adset` with `.spark.up/.down`, `.action`, `.status`, `.pause-pending`). The behavior gap is the wiring.

The chat-6 transcript also references a Nova-to-Queue cross-link: _"Drafting pause on Whitening Ad Set B — approve in queue above ↑"_. Phase 2 added stable `id="q-${cardId}"` attributes on every queue card root specifically so Phase 3's Nova panel can scroll-to-card via these ids.

## Goal

After Phase 3 lands, an operator landing on `/console`:

1. Sees the Agent strip as before, with **real per-agent today-stats** in each card (Nova: spend + campaigns + recs pending; Alex: conversations today + ones needing the owner; Mira: creatives in flight + ones at a gate).
2. Sees **Nova's panel auto-expanded** below the strip on first visit (preserves continuity with today's always-rendered behavior). Clicking the Alex or Mira card collapses Nova and expands the chosen panel; a coral underline tracks the active card.
3. Can press **`1` / `2` / `3`** to toggle Nova / Alex / Mira from the keyboard, and **`Esc`** to collapse the open panel (with priority: help-overlay closes first if open).
4. In Nova, sees a **campaign-row table** populated from `useAdOptimizerAudit`. Recommendations with a `draftId` matching a pending approval-gate card link to `#q-${draftId}`; a `panel-note` appears when at least one such cross-link is live.
5. In Alex, sees the **eight most recent conversations** with status / channel / intent / relative time. Row click → `/conversations`.
6. In Mira, sees the **eight most recent creative jobs** with stage / last update / action. Stage pill is coral when at gate.
7. Reloads survive the expansion choice via `localStorage` (`sb_expanded_agent`).

## Non-goals (deferred to other specs)

- Real backend Halt — own spec.
- Recommendation card backend — own spec.
- Activity filters / CTA-jump-to-queue / flash-on-new — Phase 4.
- Full threaded transcript rendering inside Nova ad-set rows — explicitly out of scope per the user task description.
- ROI / ROAS / attributed-revenue columns in Nova — gated on the **post-lead attribution spec** (see § Coordination). Phase 3 ships Ads-Manager-pure metrics today; the column extension is a one-PR follow-up once attribution lands.
- A new ad-set–level API endpoint — Nova reads campaigns from the existing audit hook; ad-set granularity is not pursued.

## Architecture

### State ownership — `<ExpandedAgentProvider>`

Phase 3 introduces one new piece of UI state: which agent panel (if any) is expanded. State lives in a context provider that mirrors the Phase 2 `HaltProvider` shape verbatim.

```ts
type AgentKey = "nova" | "alex" | "mira";

type ExpandedAgentValue = {
  expanded: AgentKey | null;
  setExpanded: (next: AgentKey | null) => void;
  toggle: (key: AgentKey) => void;
};
```

Implementation (`apps/dashboard/src/components/console/expanded-agent-context.tsx`):

```tsx
const STORAGE_KEY = "sb_expanded_agent";
const VALID: ReadonlyArray<AgentKey> = ["nova", "alex", "mira"];

function readLocal(): AgentKey | null {
  if (typeof window === "undefined") return "nova"; // SSR: render Nova-open
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return "nova";              // first-time → Nova auto-open
    if (raw === "__null__") return null;          // explicit collapse persists
    return (VALID as readonly string[]).includes(raw) ? (raw as AgentKey) : "nova";
  } catch {
    return "nova";
  }
}

function writeLocal(v: AgentKey | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v === null ? "__null__" : v);
  } catch {
    // private mode / quota: fail silent
  }
}
```

The provider exposes the value via `useExpandedAgent()`. Throws if used outside the provider, matching `useHalt()`.

**Persistence semantics.**

- Missing key → default to `"nova"` (auto-expand on first visit).
- `"__null__"` sentinel persists an explicit collapse — a returning operator who pressed Esc last session lands on a fully-collapsed Agents zone.
- Anything unrecognized → fall back to `"nova"`.

**Why a provider, not lifted state.** Phase 1 used per-component `useState` for Halt and Phase 2 had to lift it because two consumers diverged on rapid toggles. The same race exists with `1/2/3` keyboard toggles + click toggles if state lives in two places. We start with a provider to avoid the lift later.

The provider is **state-only** — it must not call `useToast()` or fire side effects. The callers (AgentStrip click, keyboard handler) decide whether to fire toasts (Phase 3 doesn't fire any — expansion is silent).

### Provider tree in `<ConsoleView>`

```tsx
export function ConsoleView() {
  return (
    <ToastProvider>
      <HaltProvider>
        <ExpandedAgentProvider>
          <ConsoleViewInner />
        </ExpandedAgentProvider>
      </HaltProvider>
    </ToastProvider>
  );
}
```

`ToastProvider` outermost (Halt + ExpandedAgent both fire-side-effect-free at the provider level, but Halt's keyboard handler in `ConsoleViewInner` fires toasts via `useToast`, so `ToastProvider` must wrap them). `ExpandedAgent` does not depend on Toast or Halt, but is innermost for keyboard-handler convenience.

### Keyboard wiring

`use-keyboard-shortcuts.ts` extends to:

```ts
type Handlers = Partial<{
  help: () => void;
  halt: () => void;
  escape: () => void;
  agent1: () => void;   // new
  agent2: () => void;   // new
  agent3: () => void;   // new
}>;
```

Branches added inside the existing `keydown` handler (after `Escape`, before bail):

```ts
if (e.key === "1") { handlers.agent1?.(); return; }
if (e.key === "2") { handlers.agent2?.(); return; }
if (e.key === "3") { handlers.agent3?.(); return; }
```

The existing `isEditableTarget` bail-out (INPUT / TEXTAREA / contentEditable) already gates these — typing `1` in a reply textarea will not toggle Nova.

`ConsoleViewInner` registers the new handlers:

```ts
const { expanded, setExpanded, toggle } = useExpandedAgent();
useKeyboardShortcuts({
  help: () => setHelpOpen(v => !v),
  halt: () => toggleHaltWithToast({ halted, setHalted, toggleHalt, showToast }),
  escape: () => {
    if (helpOpen) { setHelpOpen(false); return; }
    if (expanded) { setExpanded(null); return; }
  },
  agent1: () => toggle("nova"),
  agent2: () => toggle("alex"),
  agent3: () => toggle("mira"),
});
```

The Esc priority chain (help > collapse > no-op) follows the standard nested-overlay pattern.

### Component tree change

`ConsoleViewInner`:

```tsx
<div data-v6-console>
  <OpStrip onHelpOpen={() => setHelpOpen(true)} />
  <main className="console-main">
    <WelcomeBanner />
    <QueueZone />
    <AgentsZone />
    <ActivityTrail />
  </main>
  {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
  <ToastShelf />
</div>
```

`<AgentsZone>` is a thin new component that wraps the strip and the panel slot. The previous direct render of `<AgentStrip />` + `<NovaPanel />` is replaced by `<AgentsZone />`. The `.zone3` section wrapper moves into `<AgentsZone>`, preserving the welcome-banner tour selector (`section.zone3`).

### File structure

```
apps/dashboard/src/components/console/
├── expanded-agent-context.tsx            # new
├── __tests__/expanded-agent-context.test.tsx  # new
├── zones/
│   ├── agent-strip.tsx                   # modified
│   ├── agents-zone.tsx                   # new
│   └── __tests__/agent-strip.test.tsx    # modified
│   └── __tests__/agents-zone.test.tsx    # new
└── panels/                                # new directory (replaces zones/nova-panel.*)
    ├── panel-chrome.tsx                   # PanelHead + PanelFoot, shared
    ├── nova-panel.tsx                     # moved + expanded
    ├── nova-campaign-table.tsx            # extracted body (keeps nova-panel.tsx <400 lines)
    ├── nova-recommendation-note.tsx       # the panel-note cross-link
    ├── alex-panel.tsx                     # new
    ├── mira-panel.tsx                     # new
    ├── agent-stats.ts                     # pure derivation helpers
    ├── scroll-to-card.ts                  # cross-link helper
    ├── format.ts                          # truncate / relativeTime / formatUSDCompact
    └── __tests__/
        ├── panel-chrome.test.tsx
        ├── nova-panel.test.tsx
        ├── nova-campaign-table.test.tsx
        ├── nova-recommendation-note.test.tsx
        ├── alex-panel.test.tsx
        ├── mira-panel.test.tsx
        ├── agent-stats.test.ts
        ├── scroll-to-card.test.ts
        └── format.test.ts
```

`zones/nova-panel.tsx` and `zones/__tests__/nova-panel.test.tsx` are deleted. The new home is `panels/`.

The per-kind file split is required for the same reason Phase 2 split `queue-cards.tsx`: each panel embeds its own data hooks, loading/error/empty branches, and row rendering. Keeping all three in one file would breach the 400-line CLAUDE.md soft warn.

## Components

### `<AgentsZone>` — single panel slot

```tsx
"use client";

import { AgentStrip } from "./agent-strip";
import { useExpandedAgent } from "../expanded-agent-context";
import { NovaPanel } from "../panels/nova-panel";
import { AlexPanel } from "../panels/alex-panel";
import { MiraPanel } from "../panels/mira-panel";

export function AgentsZone() {
  const { expanded } = useExpandedAgent();
  return (
    <section className="zone3" aria-label="Agents">
      <div className="zone-head">
        <span className="label">Agents</span>
      </div>
      <AgentStrip />
      {expanded === "nova" && <NovaPanel />}
      {expanded === "alex" && <AlexPanel />}
      {expanded === "mira" && <MiraPanel />}
    </section>
  );
}
```

Conditional render (not `display: none`) — collapsed panels do not subscribe to their data hooks, so Alex's `useConversations` and Mira's `useCreativeJobs` don't fire until first open. Same trade-off Phase 2 made on transcripts. Re-opening is instant because React Query caches by org-scoped key.

### `<AgentStrip>` — click + keyboard wired

```tsx
export function AgentStrip() {
  const { expanded, toggle } = useExpandedAgent();
  const stats = useAgentStripStats();

  // existing roster/state/modules loading + error branches stay unchanged

  return (
    <div className="agent-strip">
      {AGENTS.map((a) => (
        <button
          key={a.key}
          id={`agent-card-${a.key}`}
          className={`agent-col${expanded === a.key ? " active" : ""}`}
          type="button"
          aria-pressed={expanded === a.key}
          aria-controls={`agent-panel-${a.key}`}
          aria-label={expanded === a.key ? `${a.name} panel open` : `Open ${a.name} panel`}
          onClick={() => toggle(a.key)}
        >
          <span className="a-name">{a.name}</span>
          <span className="a-stat">{stats[a.key].primary}</span>
          <span className="a-sub muted">{stats[a.key].secondary}</span>
        </button>
      ))}
    </div>
  );
}
```

Changes from the current strip:

- `onClick={() => toggle(a.key)}` (was no-op).
- `aria-pressed` + `aria-controls` reflect the expanded state. `aria-controls` always references `agent-panel-${a.key}`; the panel exists in the DOM only when expanded (conditional render). Browsers + screen readers tolerate the dangling reference when collapsed.
- The previous `<section className="zone3">` wrapper + `.zone-head` move out of `<AgentStrip>` and into `<AgentsZone>` (so `<AgentStrip>` renders only the strip's `<div className="agent-strip">`). The welcome-banner tour selector `.zone3` still resolves to the right element.
- The nested `<Link>` "view conversations →" inside the `<button>` is **removed**. The strip becomes a clean toggle surface; per-agent deep links move into each panel's `<PanelFoot>`. (Nesting an interactive link inside a button is an a11y soft issue today; click-to-toggle makes it strict.)
- `enabledMap` / `activeKey` derivation (current lines 47–56) is removed. The "live agent for the current org" decoration was a stub; `.active` now means "expanded panel".
- Stats render real metrics from `useAgentStripStats()`.

Loading and error branches stay (skeleton on initial fetch; `<ZoneError onRetry>` on failure with all three refetches).

### `agent-stats.ts` — pure derivation, one shape

```ts
export type AgentStats = { primary: string; secondary: string };
export type AgentStripStats = Record<AgentKey, AgentStats>;

export function useAgentStripStats(): AgentStripStats {
  const audit = useAdOptimizerAuditCurrent();
  const conversations = useConversations();
  const creativeJobs = useCreativeJobsCurrent();

  return {
    nova: deriveNovaStats(audit.data),
    alex: deriveAlexStats(conversations.data),
    mira: deriveMiraStats(creativeJobs.data),
  };
}

export function deriveNovaStats(data: AuditReportSet | undefined): AgentStats {
  if (!data?.latestReport) return { primary: "—", secondary: "—" };
  const r = data.latestReport;
  const spend = formatUSDCompact(r.summary.totalSpend);
  const campaigns = r.summary.activeCampaigns;
  const pending = r.recommendations.filter(rec => rec.draftId).length;
  return {
    primary: spend,
    secondary: `${campaigns} campaigns · ${pending} recs pending`,
  };
}

export function deriveAlexStats(
  data: { conversations: ConversationListItem[] } | undefined,
): AgentStats {
  if (!data) return { primary: "—", secondary: "—" };
  const today = startOfTodayLocal();
  const todayCount = data.conversations.filter(c =>
    new Date(c.lastActivityAt) >= today
  ).length;
  const ownerCount = data.conversations.filter(c =>
    c.status === "human_override"
  ).length;
  return { primary: `${todayCount} today`, secondary: `${ownerCount} need owner` };
}

export function deriveMiraStats(jobs: CreativeJobSummary[] | undefined): AgentStats {
  if (!jobs) return { primary: "—", secondary: "—" };
  const inFlight = jobs.filter(j => j.currentStage !== "complete" && !j.stoppedAt).length;
  const atGate = jobs.filter(j => j.currentStage === "review" && !j.stoppedAt).length;
  return { primary: `${inFlight} in flight`, secondary: `${atGate} awaiting approval` };
}
```

`useAdOptimizerAuditCurrent` and `useCreativeJobsCurrent` are thin wrappers (defined in the same file) that:

1. Call `useDeploymentForModule("ad-optimizer")` / `("creative")` to resolve the deployment id.
2. Pass that id to `useAdOptimizerAudit` / `useCreativeJobs`.
3. Short-circuit (`{ data: undefined, isLoading: false, error: null }`) when no deployment exists. Disabled queries via `enabled: !!deploymentId` already exist in the underlying hooks; the wrapper just guards the missing-deployment case so derivation receives a clean `undefined`.

`startOfTodayLocal()` is a small pure helper (uses local timezone via `new Date()` zeroed at midnight, not UTC, since "today" is operator-local).

`formatUSDCompact(n)` formats e.g. `4820 → "$ 4,820"` and `48200 → "$ 48.2k"`. One-line wrapper over `Intl.NumberFormat`.

All derivation functions return `{ primary: "—", secondary: "—" }` for undefined data, so the strip renders without throwing under any auth/network/loading state.

### `panel-chrome.tsx` — shared `<PanelHead>` + `<PanelFoot>`

```tsx
export function PanelHead({ label, meta }: { label: string; meta?: ReactNode }) {
  return (
    <header className="panel-head">
      <span className="label">{label}</span>
      {meta && <div className="meta">{meta}</div>}
    </header>
  );
}

export function PanelFoot({
  stats,
  cta,
}: {
  stats: ReactNode;
  cta?: ReactNode;
}) {
  return (
    <footer className="panel-foot">
      <div className="stats">{stats}</div>
      {cta}
    </footer>
  );
}
```

Both panels (Nova, Alex, Mira) wrap their body in `<section className="panel">` and render `<PanelHead>` + body + `<PanelFoot>`. The chrome stays consistent across all three.

### `<NovaPanel>` — campaign rows from the audit

```tsx
export function NovaPanel() {
  const audit = useAdOptimizerAuditCurrent();
  const modules = useModuleStatus();

  if (modules.isLoading || audit.isLoading) return <ZoneSkeleton label="Loading Nova" />;
  if (modules.error || audit.error) {
    return <ZoneError message="Couldn't load Nova." onRetry={() => { modules.refetch(); audit.refetch(); }} />;
  }

  const moduleList = (modules.data ?? []) as Array<{ id: string; state: string }>;
  if (!moduleList.some(m => m.id === "ad-optimizer" && m.state === "live")) {
    return (
      <section id="agent-panel-nova" className="panel" role="region" aria-labelledby="agent-card-nova">
        <ZoneEmpty
          message="No ad-optimizer deployed yet."
          cta={<Link href="/marketplace" className="btn btn-text">Connect ad-optimizer →</Link>}
        />
      </section>
    );
  }

  const report = audit.data?.latestReport;
  return (
    <section id="agent-panel-nova" className="panel" role="region" aria-labelledby="agent-card-nova">
      <PanelHead
        label="Nova · Campaigns"
        meta={report && <span><b>{report.summary.activeCampaigns}</b> live · <b>{report.summary.campaignsInLearning}</b> learning</span>}
      />
      <NovaCampaignTable report={report ?? null} />
      <NovaRecommendationNote report={report ?? null} />
      <PanelFoot
        stats={
          report ? (
            <span>
              <b>{formatUSDCompact(report.summary.totalSpend)}</b> spend
              <span className="sep"> · </span>
              <b>{report.summary.totalLeads}</b> leads
            </span>
          ) : <span>—</span>
        }
        cta={<Link className="pill-graphite" href="/dashboard/roi">See ROI →</Link>}
      />
    </section>
  );
}
```

`<NovaCampaignTable>` (in `nova-campaign-table.tsx`) renders the `table.adset` markup. One row per recommendation in `report.recommendations`, joined to `report.sourceComparison.rows` by `campaignId`:

| Column        | Source                                                                            |
|---------------|-----------------------------------------------------------------------------------|
| `campaign`    | `recommendation.campaignName`                                                     |
| `spend`       | `sourceComparison.rows[i].cpl * leads` if available, else `summary.totalSpend / activeCampaigns` |
| `leads`       | `sourceComparison.rows[i]` lead count if available, else `—`                      |
| `CPL`         | `sourceComparison.rows[i].cpl`                                                    |
| `trend`       | `audit.periodDeltas` direction for CPL: `↑` (`.spark.up green`) or `↓` (`.spark.down coral`) |
| `action`      | `recommendation.action`                                                           |
| `status`      | `recommendation.draftId` present → `<Link href="#q-${draftId}" onClick={scrollToQueueCard(draftId)}>Pending approval</Link>`; else `Suggested` |

Empty / no-recommendations branch: render the table with a single muted row `<td colSpan={...}>No actions recommended right now.</td>`.

`<NovaRecommendationNote>` (in `nova-recommendation-note.tsx`) reads `useApprovals()` to confirm the `draftId` exists in the pending queue, then renders the `panel-note` styling exactly when at least one recommendation has a matching approval. If multiple, surface the first; the others are visible inside the table's `status` column.

```tsx
export function NovaRecommendationNote({ report }: { report: AuditReport | null }) {
  const approvals = useApprovals();
  if (!report) return null;
  const pendingIds = new Set((approvals.data?.approvals ?? []).map(a => a.id));
  const link = report.recommendations.find(r => r.draftId && pendingIds.has(r.draftId));
  if (!link) return null;

  return (
    <div className="panel-note">
      <span className="msg">
        Drafting <em>{link.action}</em> on <b>{link.campaignName}</b> — approve in queue above ↑
      </span>
      <button
        type="button"
        className="anchor"
        onClick={() => scrollToQueueCard(link.draftId!)}
      >
        Jump to card →
      </button>
    </div>
  );
}
```

### `<AlexPanel>` — conversation list

```tsx
export function AlexPanel() {
  const conversations = useConversations();
  if (conversations.isLoading) return <ZoneSkeleton label="Loading Alex" />;
  if (conversations.error) {
    return <ZoneError message="Couldn't load Alex." onRetry={() => conversations.refetch()} />;
  }

  const all = conversations.data?.conversations ?? [];
  const sorted = [...all].sort((a, b) =>
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  );
  const recent = sorted.slice(0, 8);
  const today = startOfTodayLocal();
  const todayCount = all.filter(c => new Date(c.lastActivityAt) >= today).length;
  const ownerCount = all.filter(c => c.status === "human_override").length;

  if (recent.length === 0) {
    return (
      <section id="agent-panel-alex" className="panel" role="region" aria-labelledby="agent-card-alex">
        <ZoneEmpty message="No conversations yet." />
      </section>
    );
  }

  return (
    <section id="agent-panel-alex" className="panel" role="region" aria-labelledby="agent-card-alex">
      <PanelHead
        label="Alex · Conversations"
        meta={<span><b>{ownerCount}</b> owner · <b>{all.length - ownerCount}</b> agent</span>}
      />
      <ul className="conv-list">
        {recent.map((c) => (
          <li key={c.id}>
            <Link className="conv-row" href={`/conversations`}>
              <span className="body">
                <span className="meta">{c.channel}</span>
                <span className="intent">{c.currentIntent ?? "No intent yet"}</span>
              </span>
              <span className="meta">{relativeTime(c.lastActivityAt)}</span>
              <span className={`stage-pill${c.status === "human_override" ? " review" : ""}`}>
                {c.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <PanelFoot
        stats={<span><b>{todayCount}</b> today · <b>{ownerCount}</b> need owner</span>}
        cta={<Link className="pill-graphite" href="/conversations">All conversations →</Link>}
      />
    </section>
  );
}
```

Row click navigates to `/conversations`. The list page already handles thread expansion; we don't duplicate that here.

`relativeTime(iso)` is a small pure helper (e.g. `12m ago`, `2h ago`, `3d ago`).

### `<MiraPanel>` — creative job list

```tsx
export function MiraPanel() {
  const modules = useModuleStatus();
  const jobs = useCreativeJobsCurrent();

  if (modules.isLoading || jobs.isLoading) return <ZoneSkeleton label="Loading Mira" />;
  if (modules.error || jobs.error) {
    return <ZoneError message="Couldn't load Mira." onRetry={() => { modules.refetch(); jobs.refetch(); }} />;
  }

  const moduleList = (modules.data ?? []) as Array<{ id: string; state: string }>;
  if (!moduleList.some(m => m.id === "creative" && m.state === "live")) {
    return (
      <section id="agent-panel-mira" className="panel" role="region" aria-labelledby="agent-card-mira">
        <ZoneEmpty
          message="No creative module deployed yet."
          cta={<Link href="/marketplace" className="btn btn-text">Connect creative →</Link>}
        />
      </section>
    );
  }

  const all = jobs.data ?? [];
  const sorted = [...all].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const recent = sorted.slice(0, 8);
  const inFlight = all.filter(j => j.currentStage !== "complete" && !j.stoppedAt).length;
  const atGate = all.filter(j => j.currentStage === "review" && !j.stoppedAt).length;

  if (recent.length === 0) {
    return (
      <section id="agent-panel-mira" className="panel" role="region" aria-labelledby="agent-card-mira">
        <ZoneEmpty message="No creative jobs in flight." />
      </section>
    );
  }

  return (
    <section id="agent-panel-mira" className="panel" role="region" aria-labelledby="agent-card-mira">
      <PanelHead
        label="Mira · Creatives"
        meta={<span><b>{inFlight}</b> in flight · <b>{atGate}</b> at gate</span>}
      />
      <ul className="creative-list">
        {recent.map((job) => (
          <li key={job.id}>
            <Link className="creative-row" href={`/marketplace/creative-jobs/${job.id}`}>
              <span className="body">
                <span className="meta">{truncate(job.brief?.productDescription ?? "", 48)}</span>
              </span>
              <span className="meta">{relativeTime(job.updatedAt)}</span>
              <span className={`stage-pill${job.currentStage === "review" ? " review" : ""}`}>
                {job.currentStage}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <PanelFoot
        stats={<span><b>{inFlight}</b> in flight · <b>{atGate}</b> awaiting approval</span>}
        cta={<Link className="pill-graphite" href="/marketplace?module=creative">All creatives →</Link>}
      />
    </section>
  );
}
```

`truncate(s, n)`, `relativeTime(iso)`, and `formatUSDCompact(n)` are tiny pure helpers co-located in `panels/format.ts` with their own unit tests. (`<RelativeTime>` exists as a component elsewhere in the dashboard but Phase 3 prefers a string-returning helper for use inside `<span>` text alongside other inline meta.)

### `scroll-to-card.ts` — cross-link helper

```ts
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function scrollToQueueCard(cardId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`q-${cardId}`);
  if (!el) return;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  el.classList.add("is-flashing");
  setTimeout(() => el.classList.remove("is-flashing"), 1000);
}
```

The `.is-flashing` class is the same one Phase 1's welcome-banner tour uses. The CSS `@keyframes zone-flash` already runs over 1000ms — same as the timer here. No new CSS.

## CSS additions (in `console.css` under `[data-v6-console]`)

Most rules already exist in tree (verified by grep). New additions:

```css
/* Phase 3 — panel expand transition */
[data-v6-console] .panel {
  animation: panel-expand 220ms ease-out;
  overflow: hidden;
}
@keyframes panel-expand {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-v6-console] .panel { animation: none; }
}

/* Phase 3 — Alex / Mira list rows */
[data-v6-console] .conv-list,
[data-v6-console] .creative-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
[data-v6-console] .conv-row,
[data-v6-console] .creative-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.85rem 1.4rem;
  align-items: center;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--c-hair-soft);
  font-size: 0.875rem;
  color: var(--c-text-2);
  transition: background 160ms ease;
}
[data-v6-console] .conv-row:hover,
[data-v6-console] .creative-row:hover {
  background: hsl(28 25% 87% / 0.5);
}
[data-v6-console] .conv-row .body,
[data-v6-console] .creative-row .body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
[data-v6-console] .conv-row .intent {
  font-size: 0.9375rem;
  color: var(--c-text);
  font-weight: 500;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
[data-v6-console] .stage-pill {
  font-family: var(--c-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--c-text-3);
  white-space: nowrap;
}
[data-v6-console] .stage-pill.review {
  color: var(--c-coral);
}
```

Existing tokens reused without change: `.panel`, `.panel-head`, `.panel-foot`, `.panel-note`, `.pill-graphite`, `table.adset` (with `.spark.up/.down`, `.action`, `.status`, `.pause-pending`), `zone-flash` keyframe, `.agent-col.active`, `.is-flashing`.

## Removals

- `apps/dashboard/src/components/console/zones/nova-panel.tsx` — moved to `panels/nova-panel.tsx`.
- `apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx` — moved alongside.
- The nested `<Link>` "view conversations →" inside `<button className="agent-col">` in `agent-strip.tsx` — removed.
- The `enabledMap` / `activeKey` derivation lines in `agent-strip.tsx` — removed (live-agent decoration was a stub; `.active` now means expanded).
- Direct `<AgentStrip />` + `<NovaPanel />` renders in `console-view.tsx` — replaced by single `<AgentsZone />`.

Nothing else deleted. `useDashboardOverview`, `use-console-data.ts` remain.

## Tests

Per CLAUDE.md, every new module ships co-located tests with vitest + @testing-library/react. Coverage target stays at the global 55/50/52/55.

| Module                                  | Tests                                                                                                                                                                                       |
|-----------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `expanded-agent-context.tsx`            | default-Nova when localStorage empty; reads valid stored key; reads `__null__` as null; falls back to Nova on garbage; toggle flips/collapses; setExpanded persists; useExpandedAgent throws outside provider |
| `agent-strip.tsx` (updated)             | onClick toggles expansion; aria-pressed reflects expanded; `.active` only on expanded; stats render from useAgentStripStats; em-dash on undefined data; loading/error branches unchanged   |
| `agents-zone.tsx`                       | renders only the expanded panel; renders no panel when expanded=null; section.zone3 wrapper preserved                                                                                       |
| `panel-chrome.tsx`                      | PanelHead renders label + optional meta; PanelFoot renders stats + optional cta                                                                                                             |
| `nova-panel.tsx`                        | loading skeleton; error retry calls both refetches; empty (no deployment) → CTA; loaded → panel renders; PanelFoot ROI link href correct                                                    |
| `nova-campaign-table.tsx`               | one row per recommendation; columns map correctly; trend `.spark.up`/`.spark.down` from periodDeltas; status link to `#q-${draftId}` when draftId; no recs → muted single row              |
| `nova-recommendation-note.tsx`          | renders only when a recommendation's draftId matches a pending approval id; renders nothing when no match; click calls `scrollToQueueCard`                                                  |
| `alex-panel.tsx`                        | sorts by lastActivityAt desc; slices to 8; empty/loading/error; status pill review-coral on human_override; PanelFoot conversations link href correct                                       |
| `mira-panel.tsx`                        | sorts by updatedAt desc; slices to 8; empty/loading/error; module-not-live → CTA; review stage pill is coral; row href to creative job detail                                              |
| `agent-stats.ts`                        | deriveNovaStats / Alex / Mira shapes; em-dash when data undefined; today filter respects local timezone; useAdOptimizerAuditCurrent / useCreativeJobsCurrent short-circuit when no deployment |
| `scroll-to-card.ts`                     | scrollIntoView called with smooth/auto per matchMedia; adds `.is-flashing`; removes after 1000ms; no-op when element missing                                                                |
| `format.ts`                             | truncate respects max length and ellipsis; relativeTime returns expected strings (`now`, `12m ago`, `3h ago`, `2d ago`); formatUSDCompact thresholds (full < 10k, k-suffix ≥ 10k)            |
| `use-keyboard-shortcuts.ts` (updated)   | `1`/`2`/`3` fire agent1/2/3; existing help/halt/escape unchanged; INPUT/TEXTAREA/contentEditable bail-out applies to new keys                                                              |
| `console-view.tsx` (updated)            | ExpandedAgentProvider wraps inner; keyboard `1`/`2`/`3` toggle Nova/Alex/Mira; Esc priority chain (help > collapse > no-op)                                                                |

## Acceptance criteria

A reviewer running `pnpm dev` and opening `/console`:

1. ☐ On first visit, Agents zone renders strip + Nova panel auto-expanded. Nova card has the coral underline (`.active`).
2. ☐ Clicking the Alex card collapses Nova and expands Alex in one transition. Underline moves.
3. ☐ Clicking the Alex card again collapses it. No card has the underline.
4. ☐ Pressing `1` / `2` / `3` toggles Nova / Alex / Mira respectively. Pressing the same key again collapses.
5. ☐ Pressing `Esc` with help open closes help; pressing `Esc` again with a panel expanded collapses it; pressing `Esc` with nothing open is a no-op.
6. ☐ Pressing `1` while focused inside a textarea (e.g. an Escalation reply form) does not toggle Nova.
7. ☐ Strip cards show real today-stats: Nova `$ X · N campaigns · M recs pending`; Alex `K today · J need owner`; Mira `K in flight · J awaiting approval`. While loading or signed-out, em-dashes render without throwing.
8. ☐ Nova renders campaign rows from `useAdOptimizerAudit`. Each row: campaign · spend · leads · CPL · trend · action · status. Recommendations with a `draftId` matching a pending approval link to `#q-${draftId}`.
9. ☐ When at least one recommendation has a draft cross-link to a queue approval-gate, a `panel-note` appears: "Drafting `<action>` on `<campaignName>` — approve in queue above ↑". Clicking "Jump to card →" smooth-scrolls to the matching queue card and the card flashes briefly.
10. ☐ `prefers-reduced-motion: reduce` removes the panel expand animation and uses `behavior: "auto"` for the scroll-to-card.
11. ☐ Alex renders the most recent 8 conversations. Status pill is coral when `human_override`. Row click navigates to `/conversations`.
12. ☐ Mira renders the most recent 8 creative jobs. Stage pill is coral when stage is `review`. Row click navigates to `/marketplace/creative-jobs/${id}`.
13. ☐ Refreshing preserves the expansion choice (open agent or explicit collapse). First-time visitors land on Nova-open.
14. ☐ Nova `<PanelFoot>` includes a "See ROI →" pill link to `/dashboard/roi`.
15. ☐ `pnpm --filter @switchboard/dashboard test` passes (458+ tests, plus the new ones).
16. ☐ `pnpm --filter @switchboard/dashboard typecheck` passes.
17. ☐ `pnpm --filter @switchboard/dashboard lint` passes.
18. ☐ No file in `apps/dashboard/src/components/console/` exceeds 400 lines.
19. ☐ No nested interactive elements in the strip (no `<Link>` inside `<button className="agent-col">`).

## Risks

- **Audit data shape mismatch.** `useAdOptimizerAudit` returns campaign-keyed recommendations; `sourceComparison.rows` is optional and may not always exist. Mitigation: render the `recommendation`-driven row even when `sourceComparison.rows` is missing — `spend` / `leads` / `CPL` columns show `—` rather than crashing. The schema is loose by design (the audit pipeline is still maturing); we treat missing fields as render-em-dash.
- **`useApprovals` cache shape.** `<NovaRecommendationNote>` reads `useApprovals()` to confirm the draft cross-link target exists. The hook is already exercised by `<QueueZone>`, so the cache is shared and warm. If `useApprovals` fails (network) the note silently doesn't render — strictly preferable to a dead link.
- **Stale `localStorage`.** A future build might add a fourth agent or rename keys. The `VALID` allow-list + fall-back-to-Nova guard handles unknown values without throwing. Tests cover this.
- **Esc priority drift.** If a future feature adds another overlay (e.g. a transcript modal) we need to slot it ahead of `expanded` in the chain. The chain lives in one place (`ConsoleViewInner`'s escape handler); test asserts the order.
- **Data fetch on every panel switch.** Conditional render means switching to Alex first time triggers `useConversations`. React Query's default cache is in-memory; switching back is instant. Acceptable.
- **Mobile layout.** The Nova table is wide; existing `.adset` styling does not collapse responsively. Out of scope — Phase 3 ships the desktop console only, matching Phase 1/2 scope.
- **Welcome-banner tour `agents` selector.** The selector targets `.zone3`, which `<AgentsZone>` still renders as the section root. Verified — no regression.

## Coordination (parallel launch-critical track)

ROI / attributed revenue is launch-critical for autonomous optimization but blocked on post-lead event tracking (booking → show → close → revenue, attributed back to `campaignId`). It does not gate Phase 3 — Phase 3 ships Ads-Manager-pure today.

A separate spec spawns alongside Phase 3 (own brainstorm + spec + plan):

- **`docs/superpowers/specs/2026-05-03-post-lead-attribution-design.md`** — booking / show / deal-close webhooks → audit pipeline, surfaced via per-campaign `useRoiSummary`. Owners: ad-optimizer + chat (booking events) + core (audit pipeline).

When attribution lands, two follow-ups apply to Nova:

1. The campaign table gains `roas` and `revenue` columns (small, well-scoped PR — adds two columns to `<NovaCampaignTable>` and reads them from the audit's enriched output).
2. `deriveNovaStats` swaps the strip's primary stat from "spend" to attributed revenue (one-line change).

These follow-ups stay out of Phase 3 to keep this PR shippable today.

## Open questions

None at this time. All architectural choices are settled: ExpandedAgent provider mirrors HaltProvider; Nova auto-expands on first visit and persists explicit collapse; per-kind file split lives under `panels/`; Nova reads campaigns from the audit hook; Alex reads `useConversations`; Mira reads `useCreativeJobs` and is named "Creatives" to avoid collision with Nova's "campaigns".

## Out-of-scope follow-ups (track when post-launch attribution begins or Phase 4 begins)

- Add `roas` and `revenue` columns to Nova once attribution lands (one-PR follow-up).
- Swap Nova's strip primary stat from spend to attributed revenue.
- Phase 4 will reuse `scroll-to-card.ts` for the activity-row CTA jump-to-queue.
- Mobile-responsive collapse of `.adset` table — separate spec when mobile console is in scope.
