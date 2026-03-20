# Section 2: Full Agent-to-Cartridge Infrastructure Map

2 Implemented + 3 Planned Agents → 5 Cartridges

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT LAYER                              │
│                    (packages/agents)                             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Lead         │  │ Sales        │  │ Nurture      │          │
│  │ Responder    │  │ Closer       │  │ Agent        │          │
│  │ IMPLEMENTED  │  │ IMPLEMENTED  │  │ PLANNED      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Ad           │  │ Revenue      │                             │
│  │ Optimizer    │  │ Tracker      │                             │
│  │ PLANNED      │  │ PLANNED      │                             │
│  └──────┬───────┘  └──────┬───────┘                             │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │    deps (DI)    │
┌─────────┼─────────────────┼─────────────────────────────────────┐
│         ▼                 ▼        CARTRIDGE LAYER              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ customer-    │  │ digital-ads  │  │ crm          │          │
│  │ engagement   │  │              │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ payments     │  │ revenue-     │                             │
│  │              │  │ growth       │                             │
│  └──────────────┘  └──────────────┘                             │
│                                                                 │
│  (quant-trading cartridge exists but is not wired to any agent) │
└─────────────────────────────────────────────────────────────────┘
```

---

## Agent 1: Lead Responder — IMPLEMENTED

UI role: responder — "Replies to new leads"
Listens for: `lead.received`
Emits: `lead.qualified`, `lead.disqualified`, `conversation.escalated`

| Type  | Operation                  | Status | Cartridge Source                                                  |
| ----- | -------------------------- | ------ | ----------------------------------------------------------------- |
| READ  | Score lead                 | WIRED  | customer-engagement → `deps.scoreLead()`                          |
| READ  | Match objection            | WIRED  | customer-engagement → `deps.matchObjection()`                     |
| READ  | Check conversation history | WIRED  | `context.conversationHistory` (AgentContext)                      |
| WRITE | Qualify lead               | WIRED  | `customer-engagement.lead.qualify`                                |
| WRITE | Handle objection           | WIRED  | `customer-engagement.conversation.handle_objection`               |
| WRITE | Escalate to human          | WIRED  | `conversation.escalated` event (unmatched objection or max turns) |

Notes:

- FAQ matching (`faq-matcher.ts`) exists in customer-engagement but is **not** wired into this agent's handler.
- Cadence start (`customer-engagement.cadence.start`) is **not** triggered by this agent — it would need to be handled by a downstream listener on `lead.disqualified`.

---

## Agent 2: Sales Closer — IMPLEMENTED (partial)

UI role: booker — "Schedules appointments"
Listens for: `lead.qualified`
Emits: `stage.advanced`, `revenue.recorded`, `conversation.escalated`

| Type  | Operation                   | Status  | Cartridge Source                             |
| ----- | --------------------------- | ------- | -------------------------------------------- |
| READ  | Get booking config          | WIRED   | `context.profile.booking` (business profile) |
| WRITE | Book appointment            | WIRED   | `customer-engagement.appointment.book`       |
| WRITE | Escalate (no booking cfg)   | WIRED   | `conversation.escalated` event               |
| READ  | Check calendar availability | PLANNED | `customer-engagement` → availability.ts      |
| READ  | Get contact data            | PLANNED | `crm.contact.search`                         |
| READ  | Score LTV                   | PLANNED | customer-engagement → `computeLtv()`         |
| READ  | Get service/product pricing | PLANNED | Business profile                             |
| WRITE | Create deal in CRM          | PLANNED | `crm.deal.create`                            |
| WRITE | Update journey stage        | PLANNED | `customer-engagement.journey.update_stage`   |
| WRITE | Send checkout/quote link    | PLANNED | `payments.link.create`                       |

---

## Agent 3: Nurture Agent — PLANNED

UI role: nurturer — "Follows up with leads"
Listens for: `lead.disqualified`, `stage.advanced`, `revenue.recorded`
Emits: `stage.advanced`, `lead.qualified` (re-qualification)

| Type  | Operation                | Status  | Cartridge Source                           |
| ----- | ------------------------ | ------- | ------------------------------------------ |
| READ  | Check cadence status     | PLANNED | customer-engagement → cadence engine       |
| READ  | Analyze activity cadence | PLANNED | `crm.activity.analyze`                     |
| READ  | Score LTV                | PLANNED | customer-engagement → `computeLtv()`       |
| READ  | Check treatment affinity | PLANNED | customer-engagement → service-affinity.ts  |
| WRITE | Start/stop cadence       | PLANNED | `customer-engagement.cadence.start/stop`   |
| WRITE | Send reminder            | PLANNED | `customer-engagement.reminder.send`        |
| WRITE | Request review           | PLANNED | `customer-engagement.review.request`       |
| WRITE | Log activity             | PLANNED | `crm.activity.log`                         |
| WRITE | Update journey stage     | PLANNED | `customer-engagement.journey.update_stage` |

---

## Agent 4: Ad Optimizer — PLANNED

UI role: optimizer / strategist — "Adjusts your budget" / "Manages campaigns"
Listens for: `revenue.attributed`, `ad.performance_check` (scheduled)
Emits: `ad.optimized`

| Type  | Operation                             | Status  | Cartridge Source                      |
| ----- | ------------------------------------- | ------- | ------------------------------------- |
| READ  | Diagnose funnel                       | PLANNED | `digital-ads.funnel.diagnose`         |
| READ  | Diagnose portfolio                    | PLANNED | `digital-ads.portfolio.diagnose`      |
| READ  | Analyze structure                     | PLANNED | `digital-ads.structure.analyze`       |
| READ  | Fetch snapshot                        | PLANNED | `digital-ads.snapshot.fetch`          |
| READ  | Run advisors (creative fatigue, etc.) | PLANNED | digital-ads → advisor modules         |
| READ  | Run revenue-growth diagnostic         | PLANNED | `revenue-growth.diagnostic.run`       |
| WRITE | Adjust campaign budget                | PLANNED | `digital-ads.campaign.adjust_budget`  |
| WRITE | Pause/resume campaign                 | PLANNED | `digital-ads.campaign.pause/resume`   |
| WRITE | Pause/resume ad set                   | PLANNED | `digital-ads.adset.pause/resume`      |
| WRITE | Modify targeting                      | PLANNED | `digital-ads.targeting.modify`        |
| WRITE | Create campaign (guided)              | PLANNED | `digital-ads.campaign.setup_guided`   |
| WRITE | Deploy creative test                  | PLANNED | `revenue-growth.creative.deploy-test` |

---

## Agent 5: Revenue Tracker — PLANNED

UI role: monitor — "Tracks what's working"
Listens for: `revenue.recorded`, `stage.advanced`, `ad.optimized`
Emits: `revenue.attributed`

| Type  | Operation                | Status  | Cartridge Source                    |
| ----- | ------------------------ | ------- | ----------------------------------- |
| READ  | Query attribution data   | PLANNED | revenue-growth → diagnostic history |
| READ  | Get pipeline status      | PLANNED | `crm.pipeline.status`               |
| READ  | Diagnose pipeline health | PLANNED | `crm.pipeline.diagnose`             |
| READ  | Fetch ad snapshots       | PLANNED | `digital-ads.snapshot.fetch`        |
| WRITE | Log activity in CRM      | PLANNED | `crm.activity.log`                  |
| WRITE | Update contact in CRM    | PLANNED | `crm.contact.update`                |

Notes:

- Offline conversion dispatch (CAPI, Google, TikTok) is **not yet in any manifest**. The digital-ads cartridge has `digital-ads.signal.capi.diagnose` (READ only). Sending conversions back to ad platforms will require new action types to be added:
  - `digital-ads.capi.dispatch` (Meta)
  - `digital-ads.google.offline_conversion` (Google)
  - `digital-ads.tiktok.offline_conversion` (TikTok)

---

## Event Chain (the full funnel)

```
lead.received
    → Lead Responder [IMPLEMENTED] (score, qualify)
        → lead.qualified
            → Sales Closer [IMPLEMENTED — partial] (book appointment)
            → HubSpot connector (create contact + deal) [IMPLEMENTED]
                → stage.advanced
                    → Nurture Agent [PLANNED] (reminders, follow-ups)
                    → revenue.recorded
                        → Revenue Tracker [PLANNED] (attribute, send to ad platforms)
                            → revenue.attributed
                                → Ad Optimizer [PLANNED] (adjust budgets based on ROAS)
                                    → ad.optimized
        → lead.disqualified
            → Nurture Agent [PLANNED] (cold nurture cadence)
            → HubSpot connector (update contact) [IMPLEMENTED]
```
