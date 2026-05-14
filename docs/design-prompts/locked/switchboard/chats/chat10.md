# Alex Cockpit Redesign

_Started 2026-05-12 06:42 UTC_

---

## User

refer to alex home.html https://claude.ai/design/p/019dd48e-8ec9-75d0-a069-123a7b7b7509?file=agent-home-cockpit%2FAlex+Home.html i want this to be less cluttered and more clean. And add 1. Direct-to-Alex command — design lets you watch and approve, but not direct. A
founder often wants to say "pause an hour," "follow up with Maya tonight," "stop
offering the founding rate." A bottom-edge composer or ⌘K → message Alex would
unlock this. Today the only steering is Halt (binary) and Settings (slow). 2. ROI line, not just spend — KPIs show "ad spend $214" but never connect it to
outcomes. The one number a founder cares about is cost per booking. Adding a
derived line ("$214 / 11 = $19 per booking") under the KPIs would do more for trust
than any chart. 3. Day-1 empty state — the three states (idle/approval/busy) all assume weeks of
history. A brand-new connection has zero rows, zero KPIs, no contacts. That state
is what most users see first and the design doesn't define it. Without a directive
empty state ("Connect Meta Ads to begin → "), the cockpit looks broken on day one. 4. Drill-in continuity — every activity row's ↗ arrow leaves the cockpit. For a
surface opened 10×/day, inline expansion (peek the thread without losing your
scroll position) is the difference between "glanceable" and "click farm." 5. What is Alex configured for — design assumes you remember. A subtle "SDR · Tours
pipeline · HotPod" subtitle under the agent name anchors first-time visitors and
confirms Alex is set up for the right outcome. Also room to add Alex Avatar.html

## Assistant

_[tool: list_files]_

_[tool: local_ls]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: snip]_

_[tool: update_todos]_

_[tool: copy_files]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: grep]_

_[tool: snip]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Cleaned up Alex Home as **agent-home-v3/Alex Home v2.html** with the five asks built in:

- **Direct-to-Alex composer** pinned to the bottom edge — free-text input plus quick-chips ("Pause an hour", "Follow up with Maya tonight"). Sends a toast confirmation in Alex's voice. ⌘K affordance shown inline.
- **ROI line** below the KPI strip — derived `$214 ÷ 11 bookings = $19 per booking` in tabular mono, dashed-divided so it reads as a calculation, not another KPI.
- **Day-1 empty state** as its own state with a 4-step setup checklist (Meta Ads · inbox · calendar · rules), one primary CTA, no KPIs, no fake activity. Closes with a directive footnote.
- **Inline activity expansion** — every row is now a button; click peeks the body, a 2-turn thread preview, and "Open thread →" / "Tell Alex about Jordan" actions without losing scroll position.
- **"SDR · Tours pipeline · HotPod"** subtitle under Alex's name (mono, ink3), plus the **pixel avatar** from `alex-avatar/` swapped in for the "A" circle (sprite animates idle/drafting/sleep based on status). Tweaks lets you swap variant: classic / operator / cozy / agent.

Layout is one column on a wider canvas (1180), more breathing room, fewer borders, no left-rail clutter. Tweaks panel also lets you isolate any single state full-screen.

## User

confirm this is the most refined version you can make

## Assistant

_[tool: snip]_

No — I'd call it solid, not refined. Honest assessment of what's still rough:

**Composer**

- Quick-chips feel boilerplate ("Brief me at 5 PM" — generic). They should be _contextual_ — derived from current activity (e.g. busy state should suggest "Hold Jordan until I review"; idle should suggest "Resume the dormant batch").
- No NL parsing feedback. User types "pause an hour" → I just echo the string back. A real refined version would parse → show a structured chip ("⏸ pause · 1h · until 1:57 PM") with an Undo affordance before committing.
- ⌘K should _do_ something. It's decorative right now.

**ROI line**

- Currently text. A refined version is a single inline visual: spend bar where the filled portion = "earned back" (assuming a booking value). One glance, not arithmetic.
- Doesn't render in the empty state (zero division), which is correct, but it also doesn't render in week-1 with low bookings — should still show "tracking $X per booking, target $Y."

**Day-1 empty**

- Reads like a generic onboarding checklist. A more refined cut would make Alex the _narrator_ — a single block of Alex's voice ("I'm ready. Connect Meta Ads and I'll pull the first leads in under a minute.") with the steps secondary.
- No progress indication of what Alex will do _next_ once a step completes.

**Inline expand**

- Thread preview is 2 messages, hardcoded. Should show last 3, scrollable, with a real "reply as me" inline composer — otherwise "Open thread →" still wins and the expand is half-useful.
- Expand state doesn't persist across filter changes or re-renders.

**Identity / avatar**

- Pixel avatar sits inside the amber circle a bit awkwardly cropped — the chin clips. Either drop the circle, or make a proper pixel "badge frame."
- "SDR · Tours pipeline · HotPod" is right info, wrong density — should be tappable to edit Alex's configuration, not just static metadata.

**Information density / hierarchy**

- KPI strip still competes with the approval block for attention when both are present. In a refined version, KPIs collapse to a single-line summary when there's an open approval.
- "Today · Mon May 11" eyebrow appears twice in spirit (top of activity + implied by KPI range). One header per page.

**Things I didn't address from the original brief**

- Mobile is gone in v3. Original had mobile artboards; I dropped them.
- "Direct-to-Alex" should be reachable from _anywhere_ via ⌘K — currently only via the composer bar. That's the actual unlock.

Want me to take another pass on any subset of these? The composer parsing + contextual chips + ⌘K palette would be the highest-leverage next move.

## User

do all so you are extremely proud of the result.

## Assistant

_[tool: snip]_

_[tool: update_todos]_

_[tool: read_file]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: str_replace_edit]_

_[tool: update_todos]_

_[tool: done]_

_[tool: snip]_

_[tool: update_todos]_

_[tool: fork_verifier_agent]_

All ten refinement asks landed in `agent-home-v3/Alex Home v2.html`:

- **Composer NL parser** → "pause an hour" stages a structured chip `[⏸ pause · 1h · until 2:47 PM]` with Confirm / Undo before committing. Supports pause/resume/halt/follow up/brief/stop offering/reply myself/tell Alex about.
- **Contextual quick-chips** per state (idle suggests resume + brief; approval suggests hold Jordan; busy suggests hold replies).
- **⌘K palette** — global shortcut, grouped commands, parsed-from-text suggestion at top, Enter to commit.
- **ROI bar** — actual visual: spend-vs-tour-value, break-even tick, "per booking · target $30" readout, $-color flips green on target.
- **Day-1 narrator** — Alex speaks in first person ("I'm set up and quiet…") with a `NEXT MOVE` chip; checklist is secondary.
- **Inline thread** — 3–4 messages per preview, with an inline reply box ("Send as me" / "Ask Alex to draft"). Open state persists per row.
- **Avatar** — rounded-square pixel frame, no chin clip. Sprite animates by status (idle / draft / sleep).
- **Tappable mission** — "SDR · Tours pipeline · HotPod" opens a mission popover with role/pipeline/brand/channels.
- **KPI collapse** when an approval is open — single-line summary instead of competing 4-stat strip.
- **Mobile restored** — second canvas row at 390 wide for all four states.

## User

<system-info comment="Only acknowledge these if relevant">
Project title is now "Switchboard"
User is now viewing agent-home-v3/Alex Home v2.html in the project pane
Current date is now May 13, 2026
</system-info>

<pasted_text name="Pasted text (96 lines)">
Create `agent-home-v3/Riley Home v2.html` — the Riley cockpit, a sibling to
`Alex Home v2.html` in the same project. Reuse Alex's shell components
(topbar, identity row, mission popover, kpi-strip, roi-bar, approval-block,
activity-stream, status-pill, dot, tokens) without redesign. Only the data
shown inside those components changes. The two files should diff cleanly.

CONTEXT
Riley is the ad-optimizer agent in a multi-agent product (Alex/Riley/Mira).
Operator job-to-be-done: "is my ad spend efficient, and what should I
approve to fix the leaky ad sets?" Riley does NOT talk to customers — Riley
analyzes ad performance and recommends pause/reduce/scale/rotate actions
that the operator approves.

VISUAL IDENTITY

- Accent color: warm clay `hsl(15 45% 50%)` (Alex uses marketing orange
  `hsl(20 90% 55%)` — keep the palette identical except where Riley's accent
  replaces Alex's). Shared neutrals: warm-white background `hsl(45 25% 98%)`,
  amber for approvals `hsl(35 75% 55%)`.
- Avatar: same component shape as Alex's, recolored to warm clay.
- Typography, spacing, container widths, type ramp — identical to Alex.

TOPBAR
Same layout as Alex. Switchboard mark · agent tabs (Alex | Riley active |
Mira) · ⌘K placeholder · halt switch · avatar.

IDENTITY ROW

- Avatar (warm clay) · "Riley" · status pill · mission subtitle "Optimizing
  Meta Ads for {org name}" (clickable, opens mission popover).
- Status pill states (use these exact words): WATCHING (steady), REVIEWING
  (transient, dot pulses), WAITING (approval pending), IDLE (no ad platform
  connected), HALTED.

MISSION POPOVER (when subtitle clicked)
Four rows: Role = "Ad optimizer" · Pipeline = "Ad sets" · Brand = org name
· Channels = "Meta Ads" (with status dot — connected/degraded/disconnected).

KPI STRIP — four tiles

1. Leads (this week) — live; show value + "+N from last week"
2. Spend (this week) — show as unavailable: "—" with subtle
   "Connect Meta Ads" affordance
3. CPL (cost per lead) — unavailable variant
4. ROAS (return on ad spend) — unavailable variant, with "Set avg lead
   value" hint
   The "unavailable" treatment is critical — show how it looks when Meta isn't
   connected yet. Render at least one mockup variant with all four tiles live
   for comparison (split the page or include a second state below the fold).

ROI BAR
Horizontal track with 1× break-even tick. Track value = ROAS. To the right,
a comparator pill showing current CPL vs target CPL. Below 1× = red/amber
zone, above 1× = green zone. Same visual primitive as Alex's spend bar.
Show a degraded variant where avgValueCents is null — bar collapses, only
the CPL comparator remains, centered.

APPROVAL BLOCK (replaces NeedsYouBlock)
Amber paper card. Same shape as Alex's. Content:

- Source line: campaign name (warm clay accent dot), e.g. "Spring Sale —
  Awareness"
- Quote (the `humanSummary` field, persisted): e.g. "CPL $42 vs $25 target
  for 3 days. Spend $680 at risk this week."
- Risk note (small, muted): "$680 at risk"
- Two buttons: [Pause adset] [Decline] (labels come from
  `presentation.primaryLabel` / `presentation.dismissLabel`)
  Show 2–3 example approval cards stacked to illustrate variety:
  a) Pause adset — "CPL $42 vs $25 target for 3 days"
  b) Rotate creative — "CTR down 38% over 5 days; same creative 14 days"
  c) Scale budget — "ROAS 3.2× sustained for 7 days; under target spend"

ACTIVITY STREAM
Collapsed rows: `9:14a · WATCHING · Paused "Spring Sale" — budget exhausted`.
Show ~6 rows mixing statuses:

- WATCHING · Paused "Spring Sale" — budget exhausted
- WAITING · Recommends rotating creative on "Retargeting — Hot"
- WATCHING · Scaled "Lookalike 1%" by 18%
- WATCHING · Shifted budget from "Cold Interests" to "Lookalike 1%"
- REVIEWING · Scoring 3 ad sets… (dot pulses)
- WATCHING · Meta Ads token expiring in 4 days — reconnect

Each row: time · status pill (mini) · head text. Click expands the row to
show full reasoning (don't mock the expanded state in detail — just imply
it).

PAGE STATES TO SHOW
Render the page twice on the canvas, vertically stacked or side-by-side:

1. "Cold start" — Meta not connected: status=IDLE, KPI strip all
   unavailable, ROI bar collapsed, approval block absent, activity stream
   shows just connection prompts.
2. "Steady state" — connected, 2 approvals pending: status=WAITING, KPIs
   live (synthetic numbers), ROI bar shows ROAS 1.6× with CPL $28 vs target
   $25, two approval cards, full activity stream.

CRITICAL CONSTRAINT
Riley's cockpit is **structurally identical** to Alex's — same components,
same grid, same spacing. The diff between the two files should read as
"data, copy, and accent color." If you find yourself adding a new layout
section that Alex doesn't have, push back instead.
</pasted_text>

<!-- The user attached a local folder named "switchboard". It may contain a codebase, design components, or other files. Explore it with local_ls("switchboard") — all paths into this folder must start with "switchboard/". -->

## Assistant

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: update_todos]_

_[tool: str_replace_edit]_

Got it. Re-using shell components verbatim — only data, copy, and accent color change. Let me refactor cockpit to read from `window.AGENT` with Alex defaults, then build Riley as a sibling.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: grep]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: copy_files]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: done]_

_[tool: show_html]_

_[tool: sleep]_

_[tool: snip]_

_[tool: fork_verifier_agent]_

Built `agent-home-v3/Riley Home v2.html` as a true sibling to Alex.

**Shell reuse:** cockpit.jsx now reads brand-specific values from `window.AGENT` (name, accent, variants, tabs, status colors, mission rows, composer placeholder, toast voice). Identity, Topbar, KPIStrip, ROIBar, ApprovalBlock, ActivityStream, ThreadPreview, Composer, Toast, MissionPopover, EmptyState — all unchanged in layout, all parameterized.

**File diff between the two HTMLs is just three script src lines:**

- `sprites.jsx` → `riley-sprites.jsx`
- `alex-config.jsx` → `riley-config.jsx`
- `data.jsx` → `riley-data.jsx`

**Riley specifics, all data-driven:**

- Clay accent `#B86C50` swapped in via `AGENT.accent` — avatar frame, ROI bar fill, campaign source dot, sender label color.
- Tabs: `Alex | Riley active | Mira`.
- Status palette: WATCHING (green steady), REVIEWING (amber, pulsing dot in activity pill), WAITING (approval amber), IDLE, HALTED — all via `AGENT.statusColor` / `statusPulse`.
- Mission popover: Ad optimizer / Ad sets / HotPod / Meta Ads (with green "ok" dot — first time a row has a connection-state dot).
- KPIStrip rewritten to render `kpis.tiles[]`; unavailable variant shows `—` with dashed "Connect Meta Ads →" affordance.
- ROIBar takes an explicit `roi` config; supports a `degraded` mode (cold state) that collapses the bar and centers a CPL comparator pill.
- ApprovalBlock accepts an array — three stacked cards in steady state (Pause adset / Rotate creative / Scale budget), each with a clay campaign dot, the persisted `humanSummary` as a quote, and a `⚠ $680 at risk` line.
- Activity stream gets new kinds (watching/reviewing/paused/scaled/rotated/shifted/alert); REVIEWING shows the pulsing dot.

**Alex stays compatible.** KPIStrip's `legacyTiles` / `legacyRoi` derive the new schema from Alex's existing flat fields, so `data.jsx` didn't have to change. Same for single-vs-array approval.

**Two Riley states on the canvas:** cold start (Meta not connected — KPIs all `—`, ROI degraded, activity = connection prompts, no approval) and steady (live KPIs, ROAS 1.6× bar with break-even tick, CPL $28 vs $25 target comparator turning amber, three approvals).

## User

Verifier agent check completed

## Assistant

Verifier came back clean on both files. Riley's three stacked approvals + cold-state degraded ROI render correctly, and Alex didn't regress.
