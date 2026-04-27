# Dashboard: OwnerToday Operating Brief

**Date:** 2026-04-20
**Status:** Design approved
**Depends on:** Onboarding redesign (Stone & Weight tokens), login page redesign

---

## Problem

OwnerToday is the daily operating screen. It currently shows a greeting, one stat card (pending approvals), an inline approval action, and 6 audit log entries. That is not enough information for an owner to understand the state of their business.

The screen also uses mixed styling: Tailwind semantic tokens in most components, `--sw-*` inline styles in FirstRunBanner. It should converge fully on Stone & Weight.

## North Star

**When the owner opens Switchboard in the morning, they should understand what needs attention, what moved, and what made money — in under 30 seconds.**

This is a daily operating brief, not an analytics board or a debug console.

## Design Principle

Same system as homepage and onboarding: Apple-guided, Stripe-disciplined, quietly magical. But denser than onboarding — this is a working screen. Stripe-level clarity and restraint with slightly more warmth.

---

## Information Hierarchy

The dashboard answers five questions, in order:

1. Did anything important happen overnight?
2. What needs my attention now?
3. Are leads moving through the funnel?
4. Are bookings and revenue healthy?
5. Is Alex handling things, or do I need to step in?

---

## Period Defaults

Each metric uses the period that makes it most useful for morning context:

| Metric            | Period                                  | Rationale                                    |
| ----------------- | --------------------------------------- | -------------------------------------------- |
| New inquiries     | Today, with vs-yesterday delta          | Daily signal, smoothed by comparison         |
| Bookings          | Today's count + upcoming in action zone | Immediate operational awareness              |
| Pending approvals | Current open count                      | Not period-based — these are active items    |
| Owner tasks       | Current open / overdue                  | Action queue, not historical                 |
| Revenue           | Last 7 days, labeled "Revenue (7d)"     | Daily SMB revenue too spiky to be meaningful |
| Funnel            | Current active pipeline by stage        | Live snapshot, not lifetime accumulation     |
| Activity feed     | Latest events, no time filter           | Chronological stream, most recent first      |

**Funnel operating window:** "Current active pipeline" means records in an active lifecycle state. `completed` and `lost` counts use a fixed 30-day rolling window. This is canonical — product, frontend, and store logic must use the same 30-day cutoff. Records older than 30 days in terminal states (`completed`, `lost`) are excluded from the dashboard funnel. They belong in reporting, not in the morning snapshot.

---

## Section-by-Section Design

### 1. Header

Compact orientation block. Not decorative.

**Greeting:** Time-of-day text — "Good morning." / "Good afternoon." / "Good evening."

- Instrument Sans, 24px, semibold, `--sw-text-primary`
- Smaller than onboarding page titles (32px) — this is a working screen

**Operational summary:** One line below greeting.

- "2 approvals waiting · 5 new inquiries · 3 bookings today"
- Inter, 16px, `--sw-text-secondary`
- Generated from the aggregate endpoint using a **fixed priority order**: approvals → escalations → bookings today → new inquiries → overdue tasks. Include only the top 3 non-zero signals. This keeps the header readable and stable regardless of data shape.
- If everything is zero: "All clear this morning."

**Date stamp:** Right-aligned or below summary.

- Inter, 13px, `--sw-text-muted`
- "Sunday, April 20" (no time, no "last updated")

**Spacing:** 48px below header before stat row.

---

### 2. Stat Cards

4–6 cards in a responsive grid. These are the morning dashboard's vital signs.

**Default card set:**

| Card              | Value Source                 | Delta               |
| ----------------- | ---------------------------- | ------------------- |
| Pending approvals | Current open count           | —                   |
| New inquiries     | Today's count                | vs yesterday        |
| Qualified leads   | Current active count         | —                   |
| Bookings today    | Today's confirmed count      | —                   |
| Revenue (7d)      | Sum of last 7 days           | —                   |
| Open tasks        | Current open + overdue count | overdue highlighted |

**Card anatomy:**

- `--sw-surface-raised` background, 1px `--sw-border`, rounded-xl (12px), 24px padding
- Value: Instrument Sans, 28px, semibold, `--sw-text-primary`
- Label: Inter, 13px, uppercase, tracking 0.05em, `--sw-text-muted`
- Delta (if present): Inter, 13px, `--sw-text-secondary`. Format: "↑ 3 vs yesterday" or "↓ 2 vs yesterday". No color coding — deltas are context, not alerts.
- Zero state: Value shows "0", no special treatment. The card stays visible.
- Overdue badge (tasks only): Small pill, `hsl(0, 38%, 40%)` text on `hsl(0, 20%, 95%)` background, "2 overdue"

**Grid:** `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`, 16px gap. Cards stretch to fill, equal height per row.

**No card should require explanation.** Labels are plain business language, not system terms.

---

### 3. Action Zone — "Needs Your Attention"

The highest-value block on the page. Two modules side by side on desktop, stacked on mobile.

#### 3a. Pending Approvals

Section label: `NEEDS YOUR ATTENTION` — 13px uppercase, `--sw-text-muted`, tracking 0.05em.

Show the top 3 pending approvals. Each approval card:

- `--sw-surface-raised`, 1px `--sw-border`, rounded-xl, 20px padding
- Summary line: Inter, 16px, `--sw-text-primary` — what Alex wants to do
- Context line: Inter, 14px, `--sw-text-secondary` — risk or consequence
- Timestamp: Inter, 13px, `--sw-text-muted` — relative ("2h ago")
- Action buttons right-aligned: "Approve" (amber fill, `--sw-accent`, white text, 36px height, rounded-lg) + "Not now" (no fill, `--sw-text-secondary`, same height)
- Button press: `scale(0.98)`

If more than 3: "View all {N} →" link below, Inter 14px, `--sw-accent`.

Empty state: Card with "All caught up" in Inter 16px, `--sw-text-secondary`, centered. No icon.

Also include in this section if present:

- Overdue owner tasks (up to 2, below approvals)
- Active escalations / handoffs (up to 2)

These share the same card anatomy but with appropriate context lines.

#### 3b. Today's Bookings

Section label: `TODAY'S BOOKINGS`

Show upcoming + completed bookings for today. Each row:

- Time: Inter, 16px, semibold, `--sw-text-primary` — "2:30 PM"
- Service + contact: Inter, 16px, `--sw-text-primary` — "Teeth Whitening · Sarah Chen"
- Status: Small dot + label — confirmed (green), pending (amber), completed (gray, muted text)
- Channel icon if relevant: 16px, `--sw-text-muted`

**Inclusion rules:** Show confirmed and pending bookings (upcoming first, then completed for today). **Exclude cancelled bookings by default** — they add clutter without actionable signal for most SMBs. A cancellation that matters operationally (e.g., a gap in the schedule) surfaces through the activity feed instead.

Container: Single `--sw-surface-raised` card, rows separated by 1px `--sw-border` internal dividers. 16px vertical padding per row, 20px horizontal. Show up to 5 rows.

If no bookings today: "No bookings today" in `--sw-text-secondary`.

If bookings exist but all are past: Show completed bookings with muted treatment, "No more bookings today" at bottom.

---

### 4. Funnel Snapshot

Section label: `PIPELINE`

A compact horizontal representation of the active pipeline. Not a chart — a count strip.

```
Inquiry    Qualified    Booked    Purchased    Completed
  12          8           5          3            2
```

**Layout:** Horizontal row of 5 cells, equal width, connected by subtle chevrons or thin lines.

**Cell anatomy:**

- Stage name: Inter, 13px, uppercase, `--sw-text-muted`
- Count: Instrument Sans, 24px, semibold, `--sw-text-primary`
- Subtle background gradient or left-border accent showing progression (optional — only if it reads cleanly)

**Container:** Full-width, `--sw-surface-raised`, 1px `--sw-border`, rounded-xl, 24px padding.

On mobile: Wraps to 2 rows or uses horizontal scroll. Counts stay readable.

**Click behavior:** Each stage links to a filtered view (future — not wired in v1, but the link target should be defined).

---

### 5. Revenue Summary

Section label: `REVENUE (7D)`

Compact commercial block. Not a chart.

**Layout:** Single card, `--sw-surface-raised`, 1px `--sw-border`, rounded-xl, 24px padding.

- Total: Instrument Sans, 32px, semibold, `--sw-text-primary` — "$2,450"
- Count: Inter, 14px, `--sw-text-secondary` — "from 8 transactions"
- Top source (if available): Inter, 14px, `--sw-text-secondary` — "Top: Google Ads · $1,200"

No period selector in v1. The 7-day window is fixed and labeled.

Zero state: "$0" with "No revenue recorded in the last 7 days" below in `--sw-text-muted`.

---

### 6. Activity Feed

Section label: `RECENT ACTIVITY`

Replaces the current audit log with a business-activity feed. Events should read like business operations, not backend exhaust.

**Event types to surface (in display priority):**

- Approval requested / approved / rejected
- Lead qualified
- Booking confirmed / cancelled
- Escalation triggered
- Payment completed / revenue recorded
- Owner task created

**Event anatomy:**

- Status dot: 8px, left-aligned. Colors: green (positive outcome), amber (needs attention), blue (informational), gray (neutral)
- Description: Inter, 16px, `--sw-text-primary` — "Alex qualified a lead: Sarah Chen"
- Timestamp: Inter, 13px, `--sw-text-muted` — relative ("2h ago", "yesterday")
- No expand/collapse. Events are one-liners.

**Container:** No outer card. Events stack with 1px `--sw-border` dividers, 12px vertical padding each.

Show 8 events max. "See all activity →" link at bottom, Inter 14px, `--sw-accent`.

**Activity Translation Rule**

Every activity item must resolve to **{actor} {action} {business object}** phrasing in plain English. This is a hard rule, not a guideline.

- The actor is always named: "Alex", "You", or the contact name
- The action is a plain verb: "qualified", "confirmed", "approved", "escalated"
- The business object is a real thing: a person's name, a service, a booking time, a dollar amount
- **Never expose** internal IDs, event type enums, entity type strings, or system field names

The translation layer lives server-side in the aggregate endpoint, not in frontend formatting. The API returns pre-translated `description` strings.

Examples:

- Good: "Alex qualified a lead: Sarah Chen"
- Bad: "LeadQualification event executed for contact_id:abc123"
- Good: "Booking confirmed: Teeth Whitening, Thursday 2:30 PM"
- Bad: "Booking status updated to CONFIRMED"
- Good: "You approved Alex's booking for Sarah Chen"
- Bad: "ApprovalResponse { decision: APPROVED, envelopeId: env_abc }"

---

### 7. Owner Tasks (if any exist)

Section label: `YOUR TASKS`

Only renders if the owner has open tasks. Not a permanent section.

**Task row:**

- Title: Inter, 16px, `--sw-text-primary`
- Due date or "overdue" flag: Inter, 13px. Normal: `--sw-text-muted`. Overdue: `hsl(0, 38%, 40%)`
- Checkbox: 20px, `--sw-border`, rounded-sm. On complete: amber fill, white check, 200ms

Container: `--sw-surface-raised` card, rows separated by dividers.

Show up to 5. "View all →" if more.

---

## Page Layout

### Desktop

Single column, `max-width: 64rem` (1024px), centered. `48px` horizontal padding.

```
[Header: greeting + summary + date]
                48px
[Stat cards — 6 across]
                48px
[Action zone: 2-column grid]
  [Needs attention]     [Today's bookings]
                48px
[Funnel snapshot — full width]
                48px
[2-column grid]
  [Revenue summary]     [Owner tasks]
                48px
[Activity feed — full width]
```

The action zone and revenue/tasks rows use `grid-cols-1 lg:grid-cols-[1fr_1fr]` with 24px gap. If owner tasks is empty, revenue summary takes full width.

### Mobile

Single column, 24px horizontal padding. Same section order, all full-width stacked. Stat cards go to 2-column grid.

---

## Visual Treatment

### Background

Full page: `--sw-base` (#F5F3F0).

### Cards

All cards: `--sw-surface-raised` background, 1px `--sw-border`, rounded-xl (12px), 24px padding. No shadows.

### Typography

- Page greeting: Instrument Sans, 24px, semibold
- Stat values: Instrument Sans, 28px, semibold
- Revenue total: Instrument Sans, 32px, semibold
- Funnel counts: Instrument Sans, 24px, semibold
- Section labels: Inter, 13px, uppercase, tracking 0.05em, `--sw-text-muted`
- Body text: Inter, 16px, `--sw-text-primary`
- Secondary text: Inter, 14px, `--sw-text-secondary`
- Timestamps/meta: Inter, 13px, `--sw-text-muted`
- No text below 13px anywhere on the dashboard

### Motion

- Approval action: button press `scale(0.98)`, status change crossfade 200ms
- Task completion: checkbox fill 200ms
- Page load: sections fade in sequentially (stagger 100ms each, 300ms duration, 4px upward translate) — reduced motion: instant
- Data refresh: values crossfade (200ms), no flash or highlight

### Reduced Motion

All animations respect `prefers-reduced-motion`. Crossfades become instant cuts. Stagger loading becomes simultaneous.

---

## FirstRunBanner Integration

The existing FirstRunBanner (already using `--sw-*` tokens) renders conditionally above the stat cards when `isFirstRun` is true. No design changes needed — it already follows Stone & Weight. It dismisses after interaction or 3 days per existing fade-out rules.

---

## Shared Component Inventory

Components designed for reuse across OwnerToday and future StaffDashboard:

| Component         | Purpose                              | Props                                              |
| ----------------- | ------------------------------------ | -------------------------------------------------- |
| `DashboardHeader` | Greeting + summary line + date       | `greeting`, `summary`, `date`                      |
| `StatCard`        | Single metric card                   | `label`, `value`, `delta?`, `badge?`               |
| `StatCardGrid`    | Responsive grid of stat cards        | `stats[]`                                          |
| `ActionCard`      | Approval/task/escalation action card | `title`, `context`, `timestamp`, `actions[]`       |
| `BookingRow`      | Single booking entry                 | `time`, `service`, `contact`, `status`, `channel?` |
| `BookingPreview`  | Card with booking rows               | `bookings[]`                                       |
| `FunnelStrip`     | Horizontal pipeline count strip      | `stages[]` (name + count)                          |
| `RevenueSummary`  | Compact revenue block                | `total`, `count`, `topSource?`                     |
| `ActivityEvent`   | Single activity feed entry           | `dot`, `description`, `timestamp`                  |
| `ActivityFeed`    | Stacked event list                   | `events[]`, `limit`                                |
| `OwnerTaskRow`    | Task with checkbox                   | `title`, `dueAt`, `isOverdue`, `onComplete`        |
| `OwnerTaskList`   | Card with task rows                  | `tasks[]`                                          |
| `SectionLabel`    | 13px uppercase section header        | `children`                                         |

All components use `--sw-*` tokens exclusively. No Tailwind semantic color tokens (no `bg-surface`, `text-muted-foreground`, etc. — those are the old system).

---

## Dashboard Aggregate Endpoint

### Contract

`GET /api/:orgId/dashboard/overview`

Single request, single response. The frontend should not stitch 5–8 calls.

```typescript
interface DashboardOverview {
  generatedAt: string; // ISO 8601 — supports debugging, caching, and future "last updated" display

  greeting: {
    period: "morning" | "afternoon" | "evening";
    operatorName: string;
  };

  stats: {
    pendingApprovals: number;
    newInquiriesToday: number;
    newInquiriesYesterday: number;
    qualifiedLeads: number;
    bookingsToday: number;
    revenue7d: { total: number; count: number };
    openTasks: number;
    overdueTasks: number;
  };

  approvals: Array<{
    id: string;
    summary: string;
    riskContext: string | null;
    createdAt: string;
    envelopeId: string;
  }>; // top 3

  bookings: Array<{
    id: string;
    startsAt: string;
    service: string;
    contactName: string;
    status: "confirmed" | "pending" | "cancelled";
    channel: string | null;
  }>; // today's, sorted by time

  funnel: {
    inquiry: number;
    qualified: number;
    booked: number;
    purchased: number;
    completed: number;
  };

  revenue: {
    total: number;
    count: number;
    topSource: { name: string; amount: number } | null;
    periodDays: 7;
  };

  tasks: Array<{
    id: string;
    title: string;
    dueAt: string | null;
    isOverdue: boolean;
    status: string;
  }>; // open tasks, up to 5

  activity: Array<{
    id: string;
    type: string;
    description: string;
    dotColor: "green" | "amber" | "blue" | "gray";
    createdAt: string;
  }>; // latest 8
}
```

### Implementation

The endpoint assembles data from existing stores in parallel:

- `PrismaApprovalStore` (or current approval query pattern)
- `PrismaBookingStore.listByDate()` — **new method**
- `PrismaConversionRecordStore.activePipelineCounts()` — **new method**
- `PrismaRevenueStore.sumByOrg()` with date filter
- `PrismaOwnerTaskStore.listOpen()` — **new route needed**
- `PrismaAuditStore` (existing) with business-event translation

All queries run via `Promise.all` — no serial waterfall.

---

## New API Routes Needed

### 1. Owner Tasks

`GET /api/:orgId/tasks` — list open/overdue tasks
`PATCH /api/:orgId/tasks/:id` — update status (complete, dismiss)

Store exists: `PrismaOwnerTaskStore`. Needs route registration.

### 2. Bookings Preview

`GET /api/:orgId/bookings?date=today` — list today's bookings sorted by time

Store exists: `PrismaBookingStore`. Needs `listByDate()` method and route.

### 3. Active Pipeline Counts

`GET /api/:orgId/funnel/active` — current stage counts for active pipeline

Store exists: `PrismaConversionRecordStore`. Needs `activePipelineCounts()` method that filters to active lifecycle records (excludes stale `completed`/`lost` beyond the operating window).

### 4. Dashboard Aggregate

`GET /api/:orgId/dashboard/overview` — the composed endpoint described above.

New route. Calls existing stores in parallel.

---

## StaffDashboard — Deferred

**Status:** Documented, not built. Ships when a distinct staff persona is validated.

**Composition (future):** Same shared components, different hierarchy:

- Greeting + shift summary
- Assigned conversations / response queue
- Today's bookings (same component)
- Escalations / handoffs
- Recent activity (same component)
- Lighter funnel or team workload snapshot

**Principle:** Same operating system, different default cockpit.

---

## What This Design Does NOT Include

- Time-series charts (revenue trend, lead volume over time)
- Agent roster with live status indicators
- Token usage / cost analytics
- Conversation message counts or response-time metrics
- Booking calendar mini-view
- Period selector controls
- Drill-down views from stat cards (future click targets defined but not built)

These belong in secondary surfaces or in a future (c)-density evolution.

---

## Acceptance Criteria

1. **30-second test:** An SMB owner can understand what needs attention, what moved, and what made money within 30 seconds of opening the page.
2. **Visual continuity:** The dashboard clearly belongs to the same product family as the homepage, login, and onboarding.
3. **Token discipline:** Stone & Weight tokens exclusively. No Tailwind semantic color tokens, no hardcoded grays.
4. **Single endpoint:** The page loads from one aggregate API call, not 5+ separate fetches.
5. **Mobile quality:** Single-column layout remains calm, readable, and actionable on mobile.
6. **Action-first:** Approvals and bookings are immediately actionable, not just displayed.
7. **Business language:** Every label, stat, and activity event reads as business operations, not system internals.
