# Dashboard Operational Trust — Design

**Date:** 2026-03-18
**Goal:** Transform the dashboard from a reporting tool into an operational trust dashboard where founders see their AI agents working, follow money through the funnel, and intervene when needed.

**Three features, in priority order:**

1. Closed-loop campaign reporting (follow money from ad spend to revenue)
2. Human handoff inbox (surface conversations needing attention)
3. Agent activity feed (see what each agent is doing)

---

## Feature 1: Closed-Loop Campaign Reporting

### Problem

Campaign reporting stops at leads. Founders can't see whether ad spend actually converts into bookings and revenue. The data pipeline exists (CrmContact has `sourceCampaignId`, deals track stage, RevenueEvents record payments) but the dashboard doesn't connect it.

### Solution

Enhance the existing campaign-attribution API to aggregate the full funnel and add a "Mark as Paid" action on lead detail.

### Data Flow

```
Campaign (spend)
  -> CrmContact (sourceCampaignId) = leads
    -> CrmDeal (stage=booked+) = bookings
      -> CrmDeal (stage=won) + RevenueEvent = paid + revenue
        -> ROAS = revenue / spend
```

### API Changes

**Enhance `GET /api/reports/campaign-attribution`** to join deals and revenue:

```typescript
interface CampaignAttribution {
  campaignId: string;
  name: string;
  spend: number | null;
  leads: number;
  bookings: number;
  paid: number;
  revenue: number;
  costPerLead: number | null;
  costPerBooking: number | null;
  roas: number | null;
}
```

Aggregation: per campaign, count contacts (leads), count deals at booked+ stages (bookings), count deals at won/paid stage (paid), sum RevenueEvents (revenue).

### "Mark as Paid" on Lead Detail

On `/leads/[id]`, add a "Mark as Paid" button next to deal stage:

1. Dialog: amount (required), reference/note (optional)
2. `PATCH /api/crm/deals/:id` — move stage to `"won"`, set `amount`
3. `POST /api/revenue` — create RevenueEvent with `source: "manual"`
4. Campaign attribution picks this up automatically via contact's `sourceCampaignId`

### Campaign Table

Enhance columns: `Campaign | Spend | Leads | Bookings | Paid | Revenue | ROAS`

### Files

| Action | File                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| MODIFY | `apps/api/src/routes/reports.ts` — enhance attribution aggregation                    |
| MODIFY | `apps/dashboard/src/app/leads/[id]/page.tsx` — add Mark as Paid dialog                |
| MODIFY | `apps/dashboard/src/app/campaigns/page.tsx` — use enriched data                       |
| MODIFY | `apps/dashboard/src/components/pilot-report/campaign-table.tsx` — add Bookings + ROAS |
| MODIFY | `apps/dashboard/src/hooks/use-leads.ts` — add mark-as-paid mutation                   |
| MODIFY | `apps/dashboard/src/app/api/dashboard/campaign-attribution/route.ts` — proxy updates  |

---

## Feature 2: Human Handoff Inbox

### Problem

Human override exists on individual conversation pages, but there's no central place for founders to see "3 conversations need you." Handoff data is rich (`HandoffPackage` with reason, lead snapshot, SLA deadline, suggested opening) but not surfaced.

### Solution

New `/inbox` page with nav badge showing pending count.

### Handoff Triggers

From `HandoffReason`: `human_requested`, `max_turns_exceeded`, `complex_objection`, `negative_sentiment`, `compliance_concern`, `booking_failure`, `escalation_timeout`. Plus conversations with `status: "human_override"`.

### Page Layout

**Active section** — cards for pending/active handoffs, sorted by SLA urgency:

- Lead name, channel badge, time waiting
- Handoff reason (human-readable label)
- Conversation summary snippet
- Suggested opening line
- SLA countdown
- Actions: "Jump In" (opens conversation with chat) and "Release" (returns to AI)

**Resolved section** — collapsed list of recently handled (last 7 days)

### Nav Integration

Add "Inbox" between "Chats" and "Campaigns" in shell nav. Badge shows pending handoff count, polls every 30s.

### API Changes

**New backend route: `GET /api/handoff/pending`** — exposes `HandoffStore.listPending(orgId)` enriched with conversation data.

**New backend route: `POST /api/handoff/:id/release`** — `HandoffStore.updateStatus(id, "released")` + toggle conversation back to active.

**New BFF routes:**

```typescript
// GET /api/dashboard/inbox
interface InboxItem {
  handoff: HandoffPackage;
  conversation: ConversationSummary;
  waitingSince: string;
  slaRemaining: number | null;
}

// POST /api/dashboard/inbox/[id]/release
// Returns updated handoff status
```

### Files

| Action | File                                                                                |
| ------ | ----------------------------------------------------------------------------------- |
| CREATE | `apps/api/src/routes/handoff.ts` — backend handoff routes                           |
| MODIFY | `apps/api/src/bootstrap/routes.ts` — register handoff routes                        |
| CREATE | `apps/dashboard/src/app/api/dashboard/inbox/route.ts` — BFF proxy                   |
| CREATE | `apps/dashboard/src/app/api/dashboard/inbox/[id]/release/route.ts` — release action |
| CREATE | `apps/dashboard/src/hooks/use-inbox.ts` — hook with 30s polling                     |
| CREATE | `apps/dashboard/src/app/inbox/page.tsx` — inbox page                                |
| MODIFY | `apps/dashboard/src/components/layout/shell.tsx` — add Inbox nav item with badge    |

---

## Feature 3: Agent Activity Feed

### Problem

The `/team` page shows agent configuration but not what agents are doing. Founders can't see their AI employees "working." The audit log (`/activity`) exists but is a flat chronological log, not grouped by agent.

### Solution

New `/agents` page showing per-agent status and a unified activity timeline.

### Page Layout

**Top strip: Agent status cards** — one per active agent:

- Agent name + role icon
- Status: working / idle / blocked (from `/api/agents/state`)
- Last action timestamp
- Action count today

**Below: Unified activity timeline** — all agents interleaved chronologically:

- Agent avatar + human-readable sentence (via event-translator)
- Relative timestamp
- Outcome indicator (success/denied/pending)
- Click to expand: full details, link to affected entity

**Filter bar:** Agent, outcome (all/executed/blocked/pending), time range (today/7d/30d). Default: today, all agents.

### Action-to-Agent Mapping

```typescript
const agentActionMap: Record<string, string[]> = {
  lead_agent: ["customer-engagement.*", "crm.contact.*", "crm.deal.*"],
  ad_agent: ["digital-ads.*", "campaign.*"],
  booking_agent: ["customer-engagement.booking.*"],
  follow_up_agent: ["customer-engagement.cadence.*"],
};
```

Unmatched actions show as "System."

### API Changes

**New BFF route: `GET /api/dashboard/agents/activity`** — combines roster + state + recent audit entries:

```typescript
interface AgentActivity {
  agent: AgentRosterEntry;
  state: AgentState;
  todayCount: number;
  lastActionAt: string | null;
  recentActions: TranslatedAuditEntry[];
}
```

### Nav Changes

Replace "Team" in nav with "Agents" pointing to `/agents`. The `/team` configuration page stays accessible via "Configure" links on agent cards.

### Files

| Action | File                                                                                 |
| ------ | ------------------------------------------------------------------------------------ |
| CREATE | `apps/dashboard/src/app/agents/page.tsx` — agents page                               |
| CREATE | `apps/dashboard/src/app/api/dashboard/agents/activity/route.ts` — BFF route          |
| CREATE | `apps/dashboard/src/hooks/use-agent-activity.ts` — hook with 30s polling             |
| CREATE | `apps/dashboard/src/components/agents/agent-status-card.tsx` — status card           |
| CREATE | `apps/dashboard/src/components/agents/activity-timeline.tsx` — timeline              |
| CREATE | `apps/dashboard/src/components/agents/agent-action-map.ts` — action-to-agent mapping |
| MODIFY | `apps/dashboard/src/components/layout/shell.tsx` — rename Team to Agents             |

---

## Updated Nav Structure

| Order | href             | Label     | Badge                  |
| ----- | ---------------- | --------- | ---------------------- |
| 1     | `/mission`       | Today     | —                      |
| 2     | `/leads`         | Leads     | —                      |
| 3     | `/conversations` | Chats     | —                      |
| 4     | `/inbox`         | Inbox     | pending handoff count  |
| 5     | `/campaigns`     | Campaigns | —                      |
| 6     | `/results`       | Results   | —                      |
| 7     | `/growth`        | Growth    | —                      |
| 8     | `/agents`        | Agents    | —                      |
| 9     | `/approvals`     | Decide    | pending approval count |

---

## Implementation Order

1. **Closed-loop campaign reporting** — data foundation, touches existing pages
2. **Human handoff inbox** — new page, highest daily-use value
3. **Agent activity feed** — new page, trust layer

Each feature is independently shippable.
