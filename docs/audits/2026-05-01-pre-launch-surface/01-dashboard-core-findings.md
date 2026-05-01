---
surface: 01-dashboard-core
discovered_at: 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
dimensions_in_scope: [A, B, C, D, E, F, G, H, I-light]
session_started: 2026-05-01
session_closed: open
---

# Dashboard core — Findings

> Surface: authenticated, high-traffic. Routes audited: `/console`, `/decide` (incl. `/decide/[id]`), `/escalations`, `/conversations`. Tier: Deep. Calibration anchor for subsequent surfaces.

## Coverage

Checked: A — pending session
Checked: B — pending session
Checked: C — pending session
Checked: D — pending session
Checked: E — pending session
Checked: F — pending session
Checked: G — pending session
Checked: H — see findings below
Checked: I-light — pending session

## Calibration precedents (this surface)

_Populated during the calibration ritual at session closeout._

---

<!-- Findings appended below using the §6 template. Each finding starts with `## DC-NN`. -->

## DC-01

- **Surface:** /console
- **Sub-surface:** Nova panel (Zone 3 expanded)
- **Dimension:** H, C
- **Severity:** Launch-blocker
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** L

**What:**
The Nova "Ad actions" panel always renders the demo fixture rows ("Cleaning · retarget · 30d $596 · 2.4% CTR", "Whitening · Ad Set B $180 · 0.4% CTR · Recommended: Pause", etc.) regardless of the live data, because `mapConsoleData` short-circuits `novaPanel` to `consoleFixture.novaPanel`. To a paying operator this presents fabricated ad-set spend, CTR, sparklines, and "recommended pause" actions as if they came from their own ad accounts.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:262
- Repro:
  1. Sign in as any tenant whose org config + dashboard overview load successfully (i.e. live data path runs, not the fixture fallback at use-console-data.ts:56).
  2. Navigate to `/console`.
  3. Scroll to the "Nova · Ad actions" panel under Zone 3.
  4. Observe the ad-set table renders the hardcoded demo rows from `consoleFixture.novaPanel` (cleaning/whitening/implants ad sets), the `$842` spend total, `0.87` confidence, and the "Drafting pause on Whitening · Ad Set B" cross-link to `#queue-pause-pending` — none of which are derived from the tenant's data.

**Fix:**
Either gate the Nova panel behind an explicit "no data yet" empty state until Option C wires real ad-set aggregation, or hide the panel for tenants without a live ad-optimizer deployment. Do not ship hardcoded fixture rows as live operator metrics.

---

## DC-02

- **Surface:** /console
- **Sub-surface:** Agent strip (Zone 3)
- **Dimension:** H, C
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
Every entry in the agent strip ("Alex", "Nova", "Mira") renders the literal string `pending option C` as its primary stat and `—` as its sub-stat. The text is rendered in the same body-weight style as a real metric (no muted/placeholder treatment in `console.css` for `.a-stat`), so internal jargon ("option C") leaks directly into the operator's primary at-a-glance view of agent activity.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:180
- File: apps/dashboard/src/components/console/console.css:593

**Fix:**
Replace the literal with a user-facing copy choice (e.g. blank, em-dash, or "—" with the same muted treatment used by the placeholder numbers cells), or hide the stat row entirely until per-agent today-stats are wired.

---

## DC-03

- **Surface:** /console
- **Sub-surface:** Numbers strip (Zone 1.5)
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** M

**What:**
Three of the five at-a-glance numbers cells — "Revenue today", "Spend today", "Reply time" — render as `—` with the secondary label `pending option C`. This is the known Option C deferral (revenueToday / spendToday / replyTime not served by `DashboardOverviewSchema`), and the cells are styled with the muted `.placeholder` class so the intent reads as "not yet available." The literal sub-line text "pending option C" still leaks internal jargon to the operator.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:48-86
- File: packages/schemas/src/dashboard.ts:11-20

**Fix:**
Either (a) extend `DashboardOverviewSchema` with the three fields per the Option C plan, or (b) keep the placeholder cells but replace `pending option C` with neutral copy ("not tracked yet", blank, etc.) until the schema lands.

---

## DC-04

- **Surface:** /console
- **Sub-surface:** global (error + loading fallback)
- **Dimension:** H, C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
On any hook error or while data is loading, `useConsoleData` returns the entire `consoleFixture` (Aurora Dental demo data: $1,240 revenue, "Sarah" booking, "Whitening · Ad Set B", etc.). The accompanying error banner reads "Couldn't load live data. **Showing the last known shape.**" — but the user is seeing a hardcoded demo, not a previously-cached snapshot, so the copy misrepresents the source of the displayed values.

**Evidence:**
- File: apps/dashboard/src/components/console/use-console-data.ts:56-58
- File: apps/dashboard/src/app/(auth)/console/page.tsx:18-22
- File: apps/dashboard/src/components/console/console-data.ts:155-392

**Fix:**
Either render a real skeleton/empty state when there is no live data (do not render demo fixture as a fallback), or if the fixture stays as a fallback, change the banner copy to make clear the values shown are illustrative and not the tenant's data.

---

## DC-05

- **Surface:** /escalations
- **Sub-surface:** EscalationCard expanded body
- **Dimension:** H
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
The expanded escalation card reads `escalation.leadName` and `escalation.leadChannel` as flat top-level fields, but the API (`GET /api/escalations`) returns lead context nested inside `leadSnapshot: { name, channel, ... }`. Both flat fields are therefore always `undefined`, so the `Lead: … · Channel: …` block never renders even when the data is present in the response.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:31-32
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:172-176
- File: apps/api/src/routes/escalations.ts:51-66

**Fix:**
Read `escalation.leadSnapshot?.name` and `escalation.leadSnapshot?.channel` (mirroring how `console-mappers.ts:108-109` already handles the same shape), or normalize the API response into the flat fields the component expects.

---

## DC-06

- **Surface:** /console
- **Sub-surface:** Approval gate queue card
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
`mapApprovalGateCard` hardcodes `stageProgress: "—"` and `countdown: "—"` for every approval-gate card in the queue. The view template renders these as load-bearing slots ("Stage 2 of 5 · 3 hook variants ready · gate closes in 21h" in the design), so the live UI shows two em-dashes flanking the stage detail with no signal that progress/countdown data is pending. The schema (`PendingApproval`) does serve `expiresAt`, which is enough to compute a real countdown today.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:142-145
- File: apps/dashboard/src/components/console/console-view.tsx:120-127
- File: apps/dashboard/src/hooks/use-approvals.ts:6-15

**Fix:**
Either compute `countdown` from `approval.expiresAt` (which is already in the response) and drop `stageProgress` until creative-pipeline stage data is available, or treat both as Option C placeholders with the same muted styling used in the numbers strip.

---

## DC-07

- **Surface:** /console
- **Sub-surface:** Activity trail (Zone 4)
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
Activity rows are rendered from a slug derived from `eventType` only (`e.action.replace(/^[^.]+\./, "").replace(/[._]/g, " ")` → e.g. `"approved"`, `"executed"`). The `AuditEntry` schema serves a populated `summary` string (`packages/schemas/src/audit.ts:84`) that the API already returns — but the console mapper drops it on the floor. Operators see one-word activity rows ("approved", "rejected") instead of the human-readable summary the backend already produces.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:228-233
- File: packages/schemas/src/audit.ts:84
- File: apps/dashboard/src/hooks/use-audit.ts:6-18

**Fix:**
Use `e.summary` as the activity message (falling back to the eventType slug only when summary is empty), and surface it through the `AuditEntry` mapper in `use-console-data.ts:64-78`.

---

## DC-08

- **Surface:** /decide
- **Sub-surface:** History tab
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
The History tab filters audit entries to `["action.approved", "action.rejected", "action.expired"]`. The `AuditEventType` schema also serves approval-lifecycle events `action.denied`, `action.cancelled`, and `action.approval_expired`, which are silently dropped from the operator-facing approval history.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:22
- File: packages/schemas/src/audit.ts:17-63

**Fix:**
Expand `APPROVAL_EVENT_TYPES` to cover the full approval lifecycle (or document the reason for the filter and rename the constant), so the History tab matches the events Switchboard actually records against approvals.

---

## DC-09

- **Surface:** /console
- **Sub-surface:** Queue (escalation cards)
- **Dimension:** H
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
Every escalation card in the console queue is labelled `agent: "alex"` regardless of which agent actually triggered the handoff. Approval gates are similarly hardcoded to `mira`. There is no field on the API response that determines agent attribution today, so the mapper guesses; the guess is wrong for any handoff that did not originate with Alex/Mira.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:115
- File: apps/dashboard/src/components/console/console-mappers.ts:135

**Fix:**
Either add an agent-attribution field to the escalation/approval API response (Option C territory) or remove the agent badge from the card chrome until the data exists.
