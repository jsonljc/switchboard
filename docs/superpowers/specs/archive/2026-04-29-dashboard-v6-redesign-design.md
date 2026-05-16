# Dashboard v6 Redesign — The Home Page Made Operational

> **Status: Superseded (2026-04-30).** Direction shifted from "home page made operational" (5-zone agent-surfaces layout with PhoneFrame / Nova table / Mira pipeline / voiced frame headline / floating dock) to a tighter operating-console layout per [`2026-04-30-console-as-home-dashboard-design.md`](./2026-04-30-console-as-home-dashboard-design.md). The per-agent surfaces from this spec move to `/modules/{ad-optimizer,creative,...}` deep-link destinations rather than living on the dashboard. This file is preserved for context and history; implementation should follow the 2026-04-30 spec.

**Status:** Superseded
**Date:** 2026-04-29
**Scope:** `apps/dashboard` — the authed `/dashboard` route, shared foundations the rebuild depends on.
**Out of scope:** All other authed routes (Onboarding, My Agent, Decide, Settings, Modules, Conversations, Tasks, Escalations, Deployments). Each becomes a follow-on spec.

## Background

Switchboard's marketing surface (`apps/dashboard/src/app/(public)/page.tsx`, the v6 landing) sells a _three-agent revenue desk_: Alex replies, Nova watches spend, Mira ships creative. The page is built around three distinctive agent surfaces — a WhatsApp phone-frame for Alex, a real ad-platform table with a pinned draft note for Nova, a brief→script→clip pipeline for Mira — plus a unified design language (cream/graphite/coral, General Sans + JetBrains Mono, mono "beat frame" labels at every section's corners, a synergy ladder, a floating dock).

The authed dashboard at `/dashboard` (`OwnerToday` in `apps/dashboard/src/components/dashboard/owner-today.tsx`) is shaped against a different design system entirely (warm-white + amber `--sw-*` tokens, Inter + Cormorant Garamond) and surfaces only Alex's loop: inquiries, qualified, bookings, revenue, funnel. Nova and Mira are absent from the page even when their modules are enabled. The home page promises three agents with character; the dashboard delivers one without.

Two consequences:

1. **The marketing promise breaks on first login.** A user who came in from the home page expecting a 3-agent desk sees an Alex-only ops page in a different visual language.
2. **The dashboard composition is generic.** Even if we paint over with v6 atoms (cream, hairlines, mono labels, coral) the underlying composition — header + 6 stat cards + 3 module cards + paired sections + sidebar — is a 2010s SaaS dashboard. v6 has a stronger, more distinctive composition that the dashboard should adopt at the _layout_ level, not just the _paint_ level.

## Goal

Rebuild `/dashboard` so that:

- It is the **home page made operational**: the same agent surfaces (PhoneFrame, Nova table + draft note, Mira brief→script→clip pipeline), reused as components and bound to the user's live data.
- The page is **multi-agent native**: every primary surface attributes work to Alex / Nova / Mira either structurally (the agent owns the panel) or via a consistent attribution token (mark glyph + name pill).
- It is **repeat-glance friendly**: density via numbers, mono micro-labels, status pills, tabular numerics — _not_ prose narrative. v6's editorial typography appears at exactly one moment (the inactive-agent "hire" surface, where it echoes the home page's Synergy beat).
- **Inactive agents have a graceful, non-pushy presence**: a muted version of the agent's surface with a `Hire X →` CTA, sitting where the live panel would be. Owners see _empty seats_, not missing data rows.
- **First-run renders as a real cold-start**, not an empty checkmark trophy room.

## Non-goals

- Redesigning every authed route in this spec. Onboarding, My Agent, Decide, Settings et al. are deferred to follow-on specs (see _Sequencing_ below).
- Building a deeper-look "ops" view for the funnel/per-day breakdowns that this redesign cuts. A `/dashboard/ops` detail surface is a follow-on spec.
- Changing what `OwnerToday` _does_ outside of presentation: the underlying queries (`useDashboardOverview`, `useModuleStatus`, `useOrgConfig`, etc.) are extended for Nova/Mira fields but their semantics don't change.
- Replacing the production chat UI at `/conversations`. The Alex panel's PhoneFrame is a glance device, not a chat surface — clicking through goes to `/conversations`.
- Migrating shadcn/Radix primitives. The redesigned dashboard uses v6's primitives (mono labels, hairlines, cream surface) over shadcn cards where they conflict.

## The model

The home page has six beats: 01 Hero / 02 Synergy / 03 Alex / 04 Nova / 05 Mira / 06 Control. Three of those beats (Alex, Nova, Mira) are _literally dashboard surfaces dressed as marketing_: the V6BeatNova section is a real-looking ad platform dashboard with stats, a table, and a pinned draft note. V6BeatAlex is a phone frame showing a working WhatsApp thread. V6BeatMira is a 3-card creative pipeline showing brief→script→clip in flight.

The dashboard's design becomes: **strip those three beats out of the home page, parameterize them for live data, compose them around a unified queue + voiced headline, and ship that as `/dashboard`.**

This makes the v6 home page and the v6 dashboard a single design system at the layout level, not just the token level. The components are shared. What the marketing showed is what the dashboard delivers.

## Layout

Top to bottom, full viewport width, max content width `80rem` matching v6 sections:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frame strip (mono, full-bleed)                                     │
│  Switchboard · {Org}     {voiced headline sentence}     ● dispatch  │
│                                                         halt button │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  01 — Needs you                                                     │
│  Unified queue: APPROVAL / HEALTH / SUGGESTION rows, agent-tagged   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  02 — Alex · today's replies                                        │
│  PhoneFrame thread with last 4–6 messages from real conversations   │
│  Footer mono row: 14 replied · 4 qualified · 2 booked · view →      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  03 — Nova · today's spend                                          │
│  Compressed BeatNova table (top 3 ad sets) + pinned draft note      │
│  Footer mono row: spend $X / cap $Y · CPA Δ · ROAS · view →         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  04 — Mira · today's creative                                       │
│  3-card pipeline: brief / script / draft clip — today's actual jobs │
│  Footer mono row: 3 in flight · 1 awaiting publish · view →         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  05 — Activity                                                      │
│  Unified timeline, agent-tagged, mono timestamps                    │
│  At ≥1440px collapses to right rail; below 1440px renders inline    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                       ╔═════════════════════════╗
                       ║  ●  Dispatch · running  ║   ← floating dock
                       ╚═════════════════════════╝
```

Each numbered section uses v6's beat-frame: corner mono labels (`02 — Alex · today's replies` left, `a 01 / · alex · live` right), border-top hairline at `hsl(20 8% 14% / 0.06)`, generous vertical padding scaling with viewport.

## Section detail

### Frame strip

- One row, full-bleed, sits at the top of the dashboard route's main column (replaces the current `DashboardHeader` block).
- Left: `Switchboard · {Org name} · Today` in mono, `text-v6-graphite-2`.
- Center: a **single voiced headline** computed from live state. Format: short clauses joined by `·`. Examples:
  - _"3 want your call · 4 booked since midnight · Nova drafting a pause"_
  - _"All caught up · 12 replied overnight · Mira shipped 2 clips"_
  - _"Switchboard set up — pick a first action"_ (first-run)
- Right: dispatch pulse indicator (`v6-dash-pulse` style; coral when running, graphite-3 when paused), then **emergency halt** as a discoverable ghost button — out of the dock, into the topbar where it has a permanent visible home and where it doesn't compete with floating elements.
- Headline is computed by a pure function `composeFrameHeadline(overview)` returning `string`. Falls back to `"X waiting · Y booked today"` neutral form when nothing dramatic is happening. Never empty. Never hyperbolic. Co-located unit tests cover the empty/cold-start/normal/active branches.

### 01 — Needs you (the unified queue)

- Primary action zone of the page. The owner's "what wants me right now."
- Three row types, sorted globally by urgency (high-risk approvals → system health → suggestions, then by recency within type):
  - **APPROVAL** — pending governance approvals from any agent. Rows show: agent mark glyph + name pill (`ALEX` / `NOVA` / `MIRA`), summary, mono consequence/risk line, `Approve` / `Not now` buttons. Replaces today's `ActionCard`.
  - **HEALTH** — system issues that need a human to unblock the agent. Rows: agent prefix + concise issue text + single resolving CTA. Examples: _"Nova · Meta Ads token expired · Reconnect →"_, _"Alex · WhatsApp number not yet verified · Verify →"_. Sourced from per-agent module status checks.
  - **SUGGESTION** — agent-surfaced next moves. Replaces the current `RecommendationBar`. Rows: agent prefix + suggestion + `Review →` CTA + per-row dismiss `×`. Settings flag `dashboard.hideSuggestions` to globally hide this row type for owners who don't want recommendations.
- Row primitive is the v6 Nova draft-note pattern: agent mark glyph (left, `2.4rem` square, white surface, hairline border), then a column with mono micro-label (`agent · timestamp · ROW_TYPE`), body sentence in graphite, button row in graphite-pill + ghost-pill style.
- Empty state (no rows of any kind, post first-run): `"All caught up"` centered in graphite-2, with the v6 check glyph above. Hairline border around the empty card. Not a major block — small.
- First-run state (zero approvals, zero health issues, no suggestions yet): a single cold-start card replaces the queue with _"Start with your first action — connect Alex to WhatsApp →"_. Card is the only primary CTA on the page in this state.
- All three row types share Approve/Action handlers via a small per-type adapter; the queue component itself doesn't know about the difference except for which CTA buttons to render.

### 02 — Alex · today's replies

- Reuses the home page's `PhoneFrame` component from `V6BeatAlex`, lifted into a shared `agent-surfaces/` location and parameterized for live data (see _Shared foundations_).
- Renders the most recent 4–6 message turns across all of the user's active conversations, sorted by timestamp descending. Stamps (mono "Tuesday · 2:47 AM") separate the conversations so the visual reads as a flowing thread even though messages span leads.
- Booking events from the lead pipeline render as the home page's gold-bordered booking row primitive when present.
- Footer mono row, hairline-divided: `14 replied · 4 qualified · 2 booked · view conversations →` linking to the conversations route (`/conversations`).
- Empty state (Alex active but no replies in 24h): the phone frame renders empty thread area with mono center text _"No replies in the last 24h. Last reply 9h ago."_.
- Inactive state (no chat channel connected for org): the PhoneFrame renders muted (`opacity: 0.6`, no live indicators), with a centered overlay card _"Connect Alex to WhatsApp / Telegram → Setup"_. The phone-frame chrome stays visible — owners see the _seat_.

### 03 — Nova · today's spend

- Reuses the V6BeatNova table primitive — the 4-column stats band, the dense table, the pinned Nova draft note — extracted into the shared `agent-surfaces/` location and parameterized.
- **Stats band** (4 cells): `Spend · today` / `Leads · today` / `CPL · blended today` / `ROAS · today`. Tabular-nums display value, mono delta line below (good-green / coral). Replaces the current dashboard's 6-card stat strip — those were Alex-only metrics; Nova's metrics live here, attributed.
- **Compressed table** (top 3 rows by issue or spend, not full module view): same column shape as V6BeatNova — _Ad set · Status · Spend · CPL · CPA Δ · CTR Δ · ROAS_. Rows flagged by Nova render with the coral left dot + soft coral row tint. Clicking a row deep-links to the relevant Nova module detail page (route slug confirmed in implementation; the `/modules/[module]` route group exists today).
- **Pinned Nova draft note** (the home page's bottom-of-table aside): renders the most recent pending Nova draft (paused-ad recommendation, reallocation, etc.). The Approve action here resolves the matching item in the queue at the top of the page. The link is explicit: both surfaces share the same `approvalId` and clicking Approve in either place updates both via React Query invalidation.
- Footer mono row: `spend $X / cap $Y · CPA Δ · ROAS · view module →` linking to the Nova module detail page.
- Empty state (Nova active, no draft pending, table data present): the draft note slot becomes a calm _"Nova is watching. No drafts pending."_ row.
- Inactive state (Nova module not enabled for org): the entire panel renders muted — table illustration with placeholder rows in graphite-3, no live numbers, no draft note — overlaid with a centered hire card: editorial Georgia-italic _"Nova"_ / mono lede / `Hire Nova →` graphite pill. This is the **first place Georgia italic typography appears in the page** (matches the home page's Synergy ladder).

### 04 — Mira · today's creative

- Reuses the V6BeatMira three-card pipeline — brief / script / draft clip — extracted into `agent-surfaces/` and parameterized.
- The three slots are **stage-anchored, not job-anchored**: slot 1 always shows a brief (the most recent in the brief stage), slot 2 always shows a script, slot 3 always shows a draft clip. If multiple jobs occupy a stage, the most recent one renders; if a stage is empty, the slot renders as a soft-disabled placeholder for that stage (e.g., _"No briefs in flight"_). This preserves the home page's pipeline rhythm regardless of the underlying job mix.
- Each card renders with the same visual language as the marketing illustration: cream surface, hairline border, mono header (`01 / brief`, `02 / script`, `03 / draft clip`), card body in the appropriate format (paragraph / script blocks / `ClipCanvas`).
- Cards are clickable into the per-job detail route at `apps/dashboard/src/app/(auth)/modules/creative/jobs/[jobId]/page.tsx` (already exists).
- Mira's "review" CTA on the draft-clip card publishes through approvals — same dual-attribution model as Nova's draft note (queue at top + panel CTA both work).
- Footer mono row: `3 in flight · 1 awaiting publish · view creative →` linking to the Mira / creative module detail page.
- Empty state (Mira active, queue empty): three cream cards rendered with placeholder copy _"No briefs in flight. Send Mira a brief →"_, soft-disabled, with one CTA.
- Inactive state (Mira module not enabled): same muted treatment as Nova — three cards rendered as muted illustrations with a centered hire card: Georgia-italic _"Mira"_ / mono lede / `Hire Mira →` graphite pill.

### 05 — Activity timeline

- Replaces the current `ActivityFeed` card list.
- Format: vertical timeline with a thin graphite-4 rail; each event is a row with `[mono timestamp] [agent mark glyph] [agent name pill] [event sentence] [optional inline → link]`.
- Most recent ~12 events with internal scroll on desktop, "View all →" link to a future activity detail page (out of scope).
- Empty state: _"No activity in the last 24h."_
- Layout: at ≥1440px, the timeline collapses to a sticky right rail (`360px` wide) alongside the agent panels, matching the current `dashboard-content-grid` two-column behavior. Below 1440px, the timeline renders inline below the agent panels.

### Persistent dock

- Single floating pill, bottom-center, mirroring `V6Dock` from the home page.
- **One job only:** the dispatch toggle (running / paused) with the agent-pulse indicator. Clicking flips state with a confirmation toast.
- Emergency halt is **not** in the dock — it's in the frame strip topbar. Open-chat is **not** in the dock — it's the existing `OperatorChatWidget` (separate floater, lives in `(auth)/layout.tsx`). The two floaters get an explicit z-stack contract: dock at `z-60` (same as home page's `V6Dock`), chat widget at `z-50`, and on screens narrower than `640px` the dock pins to bottom-left and the chat widget to bottom-right so they cannot overlap.
- The dock is conditionally hidden on routes that already have a "primary action" affordance baked in (e.g., onboarding) — out of scope for this spec but the API supports `hideDock` from a layout context.

## Shared foundations

These are required for the dashboard rebuild and ship in the same spec because the dashboard depends on them. They are deliberately small in scope and don't redesign other routes. One specifically affects existing marketing components: extracting the agent surfaces from `V6BeatAlex` / `V6BeatNova` / `V6BeatMira` and refactoring those beats to consume the shared components in `marketing` mode. **The home page must render visually identically** to before this change — that's a hard regression-test gate, covered by the existing v6 `__tests__/` suite plus a manual screenshot diff.

### Tokens

- Lift v6 tokens out of `[data-v6-landing]` scope into a global `:root` token layer in `apps/dashboard/src/app/globals.css`:
  - `--v6-cream`, `--v6-cream-2`, `--v6-cream-3`, `--v6-cream-4`
  - `--v6-graphite`, `--v6-graphite-2`, `--v6-graphite-3`, `--v6-graphite-4`
  - `--v6-coral`, `--v6-good`
  - `--v6-hair`, `--v6-hair-soft`
  - `--v6-ease`
- Existing `--sw-*` tokens (warm-white + amber) are aliased to v6 equivalents in a single migration shim file (`globals.css`, comment-tagged "v6 migration"). The shim is removed when all referencing components are updated — out of scope for this dashboard spec; flagged as a follow-up. For this spec, both token sets coexist.
- The `[data-v6-landing]` scope on the home page page wrapper stays in place; with tokens lifted globally it becomes a no-op gate for the home-page-only rules in `landing-v6.css`. This keeps the home page's existing styles untouched.

### Fonts

- General Sans (body) and JetBrains Mono (mono labels/numerics) are already loaded by `landing-v6.css` from Fontshare. Move that `@import` into `globals.css` so authed routes load them on every page.
- Add Georgia (serif italic) — system stack, no load — for the editorial agent-name moments (Synergy ladder, inactive-agent hire cards).
- The current Inter + Cormorant Garamond pairing is **retired** for the dashboard route. App-wide retirement is a follow-on spec; for `/dashboard`, only General Sans + JetBrains Mono + Georgia render.

### Mark glyphs

- The home page's agent mark glyphs (`#mark-alex`, `#mark-nova`, `#mark-mira`) are defined inside `V6Glyphs` in `apps/dashboard/src/components/landing/v6/glyphs.tsx`, scoped to the marketing page.
- Lift the SVG sprite definition into a shared component `apps/dashboard/src/components/agent-glyphs/agent-glyphs.tsx` rendered once at the root of `(auth)/layout.tsx` so any authed page can `<use href="#mark-alex" />`. The marketing page also switches to this shared sprite to deduplicate; the v6 page's `<V6Glyphs />` component delegates to it.

### Shared agent surfaces

- Create `apps/dashboard/src/components/agent-surfaces/` with extracted, parameterized versions of the home page's three agent surfaces:
  - `agent-surfaces/phone-frame.tsx` — extracted from `V6BeatAlex`'s `PhoneFrame`. Props: `thread: Msg[]`, `header: { name; subtext; status? }`, `mode: "live" | "marketing" | "inactive"`. Marketing mode renders the existing v6 fixture thread; live mode renders props-supplied messages; inactive mode renders muted with overlay slot.
  - `agent-surfaces/nova-table.tsx` — extracted from `V6BeatNova`'s stats band + table + draft note. Props: `stats: NovaStat[]`, `rows: NovaRow[]`, `draftNote?: NovaDraft`, `mode`. Same mode tri-state.
  - `agent-surfaces/creative-pipeline.tsx` — extracted from `V6BeatMira`'s three-card strip. Props: `cards: PipelineCard[]` of length 3, `mode`. Same mode tri-state.
- The home page's beat components (`V6BeatAlex`, `V6BeatNova`, `V6BeatMira`) refactor to consume these shared surfaces in `marketing` mode, passing the same fixture data they have today. **No visual change to the home page.** The home page tests in `__tests__` continue to pass.
- The dashboard panels consume the same surfaces in `live` or `inactive` mode, passing data from the API.

### AppShell topbar

- Update the topbar in `apps/dashboard/src/components/layout/app-shell.tsx` to v6 vocabulary at the chrome level: cream background, graphite text, mono nav labels, coral accent for active state, no icons. Minimum work — not a full nav redesign.
- Houses the **emergency halt** button on the right side, replacing its current in-body location.
- Authed-route nav items remain unchanged in this spec (Identity, Mission Control, etc. stay where they are); only the visual treatment changes.

### Data layer

- `useDashboardOverview` returns extended shape:

  ```ts
  type DashboardOverview = {
    // existing Alex fields (kept)
    stats: AlexStats;
    funnel: Funnel;
    approvals: PendingApproval[];
    activity: ActivityEvent[];
    bookings: BookingPreview[];
    revenue: RevenueSummary;
    tasks: OwnerTask[];
    generatedAt: string;
    // new
    nova: NovaPanelData | null; // null = module not enabled
    mira: MiraPanelData | null; // null = module not enabled
    healthIssues: HealthIssue[]; // new row type for the queue
    suggestions: AgentSuggestion[]; // new row type for the queue
  };

  type NovaPanelData = {
    stats: {
      spendToday: number;
      leadsToday: number;
      cplBlended: number;
      roas: number;
      cap: number;
      spendDelta: number;
      cplDelta: number;
      roasDelta: number;
    };
    rows: NovaTableRow[]; // top 3 by spend or by flag
    draftNote: NovaDraft | null;
  };

  type MiraPanelData = {
    inFlight: number;
    awaitingPublish: number;
    cards: [PipelineCard, PipelineCard, PipelineCard]; // brief, script, clip
  };

  type HealthIssue = {
    id: string;
    agent: AgentKey;
    summary: string;
    cta: { label: string; href: string };
  };

  type AgentSuggestion = {
    id: string;
    agent: AgentKey;
    summary: string;
    href: string;
    createdAt: string;
  };
  ```

- Field types live in `packages/schemas` per Layer-1 doctrine; the dashboard hook in `apps/dashboard/src/hooks/use-dashboard-overview.ts` and the API route at `apps/dashboard/src/app/api/dashboard/overview/route.ts` consume them.
- `nova` and `mira` are `null` when the org's module is not enabled. Components branch on null to render the inactive (hire) state.
- Health issues are computed by querying per-module status (`useModuleStatus` exists today; extended to surface specific reconnect/setup tasks). Suggestions come from existing recommendation engines that today feed `RecommendationBar`.

## What gets removed

- `DashboardHeader` (replaced by frame strip)
- `StatCardGrid` + `StatCard` (replaced by Nova panel's stats band; Alex's metrics move into the Alex panel footer; redundant numbers cut)
- `ModuleCards` + `module-card.tsx` (cross-agent module status collapses into HEALTH rows in the queue)
- `RecommendationBar` (becomes SUGGESTION rows in the queue)
- `SynergyStrip` (cut — synergy is the home page's job, not the dashboard's)
- `FunnelStrip` (deferred to a future `/dashboard/ops` view)
- `RevenueSummary` card (Alex panel footer carries the booked-today total; weekly revenue moves to a future ops view)
- `OwnerTaskList` (folded — owner tasks become SUGGESTION rows where applicable)
- The current `EmergencyHaltButton` body block (button promotes to topbar)
- The current `DispatchToggle` body block (becomes the dock's content)
- `BookingPreview` card on the dashboard (the next-up booking is referenced in the frame headline; full upcoming list moves to a future ops view)

Removed components are deleted, not orphaned. Tests are deleted with their components. Imports are pruned.

## What stays

- `ActivityFeed` — kept but reformatted (timeline rail + agent-tagged rows), shared between desktop rail and mobile inline.
- `FirstRunBanner` — repurposed inside the queue's first-run state, not as a separate body block.
- `EmailVerificationBanner` — kept above the frame strip; v6-styled.
- `OperatorChatWidget` — unchanged in scope; z-stack contract added.

## First-run

A user 30 seconds out of `/onboarding` opens `/dashboard` and sees:

- **Frame strip:** _"Switchboard is set up — pick a first action"_ as the voiced headline; dispatch shows running with a calm cream pulse; halt visible but disabled-styled.
- **Queue:** single cold-start card _"Connect Alex to WhatsApp · 2 min →"_ — a real CTA, sized as a primary action, replacing the empty queue.
- **Alex panel:** PhoneFrame in inactive state with overlay _"Connect a channel to see Alex working"_.
- **Nova panel:** muted illustration with hire card.
- **Mira panel:** muted illustration with hire card.
- **Activity:** _"Switchboard set up · just now"_ as the only event.
- **Dock:** dispatch toggle visible.

The page is _visually substantial_ on first open even with zero data — every panel has presence as a seat-shaped affordance. The owner sees the desk they were sold.

## Failure & loading

- **Loading:** skeletons are v6-shaped (mono micro-labels visible immediately, cells/rows as graphite-3 hairline placeholders, no spinning indicators). Page chrome (frame strip, panel section labels) renders synchronously; only the body data is skeletoned. Matches the v6 aesthetic of "structure first, then numbers."
- **API error:** the existing `isError` branch in `OwnerToday` is preserved but rebuilt — frame strip shows _"Couldn't load — check that the API server is running."_ in coral, with a `Retry` ghost button. Other panels render their inactive states with a small mono _"unavailable"_ footer. The page never blanks.
- **Per-panel error:** if `nova` data fetch fails but `alex` succeeds, the Alex panel renders normally and the Nova panel shows a _"Nova data unavailable · retry →"_ state without dragging the whole page down. Standard React Query per-key error handling.

## Routing & layout

- The route stays at `apps/dashboard/src/app/(auth)/dashboard/page.tsx`. The page component still mounts `OwnerToday`, but `OwnerToday` is rebuilt around the new layout.
- The `(auth)/layout.tsx` wraps with the existing `AppShell`. `AppShell` topbar is updated for v6 vocabulary (see _Shared foundations_); the rest of the shell is unchanged.
- `apps/dashboard/src/lib/app-shell.tsx`'s `page-width` / `content-width` wrappers may need a new `dashboard-frame` wrapper to support the dashboard's full-bleed frame strip; the existing `dashboard-frame` class in the codebase is reused/updated.

## Accessibility

- Mono labels render with `aria-hidden` for purely decorative micro-labels (e.g., `01 — Needs you` is a section heading; `a 02 / · nova · paid spend` corner labels are decorative). Section headings use real `<h2>` elements with the visible text content, styled to v6 typography.
- Mark glyphs are `aria-hidden`; agent name pills carry the textual attribution that screen readers read.
- Dispatch pulse has `role="status"` with a textual fallback (_"running"_ / _"paused"_) for screen readers.
- Color is never the sole signal — coral flags also include text labels (`Drafting pause`), mark glyphs, or status pills.
- Focus states use the v6 coral outline (`focus-visible:outline-2 focus-visible:outline-v6-coral`) consistently across queue rows, panel CTAs, and the dock.
- Dock and chat widget are reachable via tab order; on small screens the z-stack contract documented above prevents overlap.

## Testing

Per CLAUDE.md, every new module has co-located `*.test.ts(x)`. Coverage targets per package; for `apps/dashboard` we hit the global threshold (55/50/52/55).

- `composeFrameHeadline()` — pure function, branch coverage of empty/cold-start/normal/active/error states.
- `agent-surfaces/phone-frame.test.tsx` — renders for each `mode`, handles empty-thread and inactive-overlay cases. The home page's existing PhoneFrame tests (in v6 `__tests__`) move with the component to the new location.
- `agent-surfaces/nova-table.test.tsx` — renders empty/active/inactive with no draft, with a draft, with a flagged row. Click on draft Approve fires the supplied callback.
- `agent-surfaces/creative-pipeline.test.tsx` — renders three cards in each pipeline stage, handles empty queue, handles inactive.
- `dashboard/queue.test.tsx` — renders mixed approval / health / suggestion rows, sorts by urgency, dismiss on suggestion calls callback, first-run state shows cold-start card.
- `dashboard/owner-today.test.tsx` — integration: with `nova: null` and `mira: null`, both panels render hire cards; with full data, all three panels render live; with API error, the frame-strip error state renders; with first-run, the cold-start card replaces the queue.
- The home page's existing `landing/v6/__tests__/*` tests must continue to pass after the agent-surfaces extraction (regression guard).

## Acceptance criteria

The redesigned dashboard ships when:

1. `/dashboard` renders the layout above for an org with all three agents enabled, all three panels live with real data.
2. `/dashboard` renders for an Alex-only org with Nova/Mira panels in inactive (hire) state, no broken rows, no console errors.
3. `/dashboard` renders for a first-run org (just out of onboarding) showing the cold-start card and three inactive panels.
4. The voiced frame headline is computed by `composeFrameHeadline()` and never empty, never longer than ~80 chars.
5. Approving a Nova draft from the panel resolves the matching queue row and vice versa (verified via test).
6. The home page (`/`) renders identically to before this PR (visual regression: existing v6 tests pass, manual screenshot diff at the major breakpoints).
7. Lighthouse desktop score on `/dashboard` (with seeded data, behind dev session): accessibility ≥ 95 (hard requirement, won't ship below); performance ≥ 80 (best-effort target — authed pages load behind session checks and React Query, perf is a softer bar than the marketing page).
8. `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
9. No `any`, no `console.log`, no file > 600 lines per CLAUDE.md.

## Sequencing

This spec is the dashboard. Three follow-on specs are anticipated and called out so they don't accidentally scope-creep into this one:

1. **`onboarding-v6-redesign-design.md`** — port `/onboarding` to v6 vocabulary using the same shared `agent-surfaces/` components. The home page's beat structure maps naturally to onboarding steps. High priority — this is the first impression after signup and currently uses the legacy design system.
2. **`my-agent-decide-v6-redesign-design.md`** — `/my-agent` (identity page), `/decide` (approvals detail). These are reached frequently and need to feel coherent with `/dashboard`.
3. **`settings-modules-v6-token-swap-design.md`** — Settings, Modules detail, Conversations, Tasks, Escalations, Deployments. Lower-priority routes that adopt v6 _tokens_ (cream, fonts, hairlines) but keep their existing structural layouts. The `--sw-*` shim is removed in this spec.

`/dashboard/ops` (the deeper-look funnel + revenue + bookings detail view that this spec defers) becomes a fourth follow-on if needed.

## Open questions

- **Conversation surface in PhoneFrame:** showing 4–6 of _the latest messages across all leads_ mixed in one thread is a visual conceit. An alternative is showing the _single most recent active conversation_ in full. The mixed thread is more "alive" and matches the home page's vibe; the single-conversation view is more honest about the underlying data shape. **Default in this spec: mixed thread, with stamps separating conversations**, but flagging for design review.
- **Top-3 selection on Nova table:** by spend desc, by flag-then-spend, or by Nova-prioritized order? Default in this spec: flag-first (so anything Nova has drafted a change for floats up), then spend desc.
- **Dispatch toggle confirmation flow:** clicking the dock toggle today flips dispatch with a toast. v6 design suggests a calmer modal-less confirm — pulse goes coral, a thin coral undo bar appears for 4s, then commits. Worth confirming the UX in implementation.
- **Mobile rail collapse:** at <1440px the activity timeline goes inline below the panels; the resulting page is long. An alternative is a tabbed strip (Today / Activity / Desk) at the bottom on mobile. Default: long scroll; revisit if mobile feedback is bad.

## Implementation order (rough)

The detailed implementation plan is the next document (writing-plans skill). The intended sequencing for that plan, surfaced here for completeness:

1. Lift tokens, fonts, mark glyphs into shared/global locations. No visual change to either the home page or the dashboard yet.
2. Extract `agent-surfaces/` components from the home page beats. Refactor home page beats to consume them in `marketing` mode. Visual regression: home page identical.
3. Extend `useDashboardOverview` and `packages/schemas` for Nova/Mira/Health/Suggestion fields. Update API route to compute them.
4. Build `composeFrameHeadline()` and the frame strip component.
5. Build the unified queue (`Needs you`) with three row types.
6. Build the three agent panels around the shared agent surfaces in `live` and `inactive` modes.
7. Restyle activity timeline.
8. Build the dock; update AppShell topbar; relocate emergency halt.
9. Wire it all together in `OwnerToday`, delete removed components, fix tests.
10. Visual QA at all breakpoints; first-run / Alex-only / full-desk variant manual smoke.
