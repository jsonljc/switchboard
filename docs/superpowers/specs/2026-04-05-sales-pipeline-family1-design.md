# Sales Pipeline — Family 1 Design Spec

**Date:** 2026-04-05
**Status:** Draft
**Author:** Jason Li + Claude

---

## 1. What We're Building

Three native AI agents that form an automated sales pipeline. A lead enters through Speed-to-Lead. If they qualify, they move to Sales Closer. If they go cold at any point, Nurture Specialist picks them up. The founder never manually moves a lead between agents — the pipeline state machine handles it automatically.

From the lead's perspective: one continuous conversation with one entity that knows everything that's been said before.

### Marketplace Listing

```
Speed-to-Lead Rep      Chat agent    Trust Score: 50 (starts free)
Sales Closer           Chat agent    Trust Score: 50 (starts free)
Nurture Specialist     Chat agent    Trust Score: 50 (starts free)

Sales Pipeline Bundle  All three together (discounted)
```

Pricing follows existing trust-based model: agents start free at score 50, price scales as trust score increases through approvals.

### Future Agent Families (Catalog Placeholders)

These families are listed in the marketplace as "Coming Soon." Individual agents within each family will be defined when that family is built. All reuse the same infrastructure built for Family 1.

| Family   | Description                           |
| -------- | ------------------------------------- |
| Creative | Content, social media, ad copy        |
| Trading  | Market analysis, alerts, execution    |
| Finance  | Bookkeeping, invoicing, expenses      |
| Legal    | Contract review, compliance, drafting |

---

## 2. Success Metrics

```
Speed-to-Lead      Response time under 60 seconds from lead submission
                   Lead-to-qualified rate increases

Sales Closer       Deals close from conversations the founder never
                   personally participated in

Nurture Specialist Dormant leads re-enter active pipeline
                   Reply rate on follow-up sequences
```

These map directly to trust score inputs — approvals/rejections from the founder feed back into each agent's marketplace trust score via the existing `TrustScoreAdapter`.

---

## 3. Architecture — Reuse Existing Infrastructure

### Three-Layer Model

```
┌─────────────────────────────────────────────────────┐
│              ORCHESTRATOR LAYER (new)                │
│                                                     │
│  Pipeline orchestrator                              │
│  Agent-to-agent handoff logic                       │
│  System prompt assembler                            │
│  AgentPersona configuration                         │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              GOVERNANCE LAYER (existing)             │
│                                                     │
│  Policy evaluation                                  │
│  Approval queue routing                             │
│  Trust score updates (TrustScoreAdapter)            │
│  Audit trail                                        │
│  Auto-pause thresholds                              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              EXECUTOR LAYER (existing)               │
│                                                     │
│  Telegram Adapter    ← apps/chat/src/adapters/      │
│  WhatsApp Adapter    ← apps/chat/src/adapters/      │
│  Slack Adapter       ← apps/chat/src/adapters/      │
│  Instagram Adapter   ← apps/chat/src/adapters/      │
└─────────────────────────────────────────────────────┘
```

### What Exists and Gets Reused

| Component                                  | Location                                      | Reuse                                                                                        |
| ------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Contact model (= Lead)                     | `packages/schemas/src/lifecycle.ts`           | Direct reuse. Add `qualificationData` and `nextFollowUpAt` fields                            |
| Opportunity model (= Pipeline stage)       | `packages/schemas/src/lifecycle.ts`           | Direct reuse. Stages map: interested→qualified→booked→won/lost/nurturing                     |
| ConversationThread (= shared conversation) | `packages/schemas/src/conversation-thread.ts` | Direct reuse. Already has `assignedAgent`, `currentSummary`, `agentContext`, `opportunityId` |
| ConversationMessage                        | `packages/db/prisma/schema.prisma`            | Direct reuse for message history                                                             |
| Channel adapters                           | `apps/chat/src/adapters/`                     | Telegram, WhatsApp, Slack, Instagram all exist                                               |
| LLM adapter                                | `packages/core/src/llm-adapter.ts`            | Claude via existing `LLMAdapter` interface                                                   |
| Conversation state machine                 | `apps/chat/src/conversation/state.ts`         | Extend with pipeline-aware transitions                                                       |
| Message pipeline                           | `apps/chat/src/message-pipeline.ts`           | Route through pipeline orchestrator                                                          |
| Governance pipeline                        | `packages/core/src/orchestrator/`             | Trust scoring, approvals, audit — all wired                                                  |
| AgentListing                               | `packages/schemas/src/marketplace.ts`         | Seed three listings (type: `switchboard_native`)                                             |
| AgentDeployment                            | `packages/schemas/src/marketplace.ts`         | One deployment per agent per org                                                             |
| TrustScoreRecord                           | `packages/schemas/src/marketplace.ts`         | Per-agent per-category trust tracking                                                        |
| OwnerTask                                  | `packages/schemas/src/lifecycle.ts`           | Escalation items surfaced to founder                                                         |

### What's New to Build

| Component                   | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| **AgentPersona model**      | Business context: name, product, tone, qualification criteria, escalation rules |
| **Pipeline orchestrator**   | Automatic lead handoffs between agents based on conversation state              |
| **System prompt assembler** | Combines AgentPersona + agent role + conversation history into LLM prompt       |
| **Deploy wizard extension** | Marketplace UI for founder to configure AgentPersona and launch the bundle      |

---

## 4. Data Model Changes

### New Model: AgentPersona

The persona is shared across all agents in a bundle. It links to `organizationId`, not to a specific deployment. All three agent deployments read from the same persona record.

```prisma
model AgentPersona {
  id                       String   @id @default(cuid())
  organizationId           String   @unique // one persona per org (shared across all agent deployments)
  businessName             String
  businessType             String
  productService           String
  valueProposition         String
  tone                     String   // validated as: "casual" | "professional" | "consultative"
  qualificationCriteria    Json     // what makes a lead qualified
  disqualificationCriteria Json     // hard disqualifiers
  bookingLink              String?
  escalationRules          Json     // when to escalate to founder
  customInstructions       String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([organizationId])
}
```

### Field Additions to Contact

```prisma
// Add to existing Contact model:
qualificationData  Json?      // captured during qualification conversations
```

Note: `nextFollowUpAt` already exists on `ConversationThread.followUpSchedule.nextFollowUpAt`. The existing field is the single source of truth for follow-up scheduling — no duplication on Contact.

### No Other Schema Changes

Everything else — Lead stages, pipeline stages, conversation threads, messages, trust scores — uses existing models as-is.

---

## 5. Agent Specifications

### Agent 1: Speed-to-Lead Rep

**Purpose:** Respond to inbound leads within 60 seconds. Qualify through natural conversation.

**Trigger:** New Contact created via webhook, manual entry, or inbound message.

**Conversation flow:**

1. First message sent within 60 seconds — acknowledges their specific inquiry, one open question
2. Build rapport, then pivot to qualification questions
3. Qualification uses founder's criteria from AgentPersona (problem fit, timeline, decision maker, budget signal)
4. When all criteria met → mark Opportunity as `qualified`, hand off to Sales Closer
5. Hard disqualifier detected → mark as `lost`

**Escalation triggers** (creates OwnerTask):

- Lead explicitly asks for a human
- Frustration or anger detected
- Question outside agent's knowledge scope
- Competitor mention
- 15+ messages without qualification outcome
- Custom rules from AgentPersona.escalationRules

**Trust score events:**

- Approval: lead reaches qualified, books next step, successful handoff
- Rejection: lead disengages, founder overrides outcome, escalation required

### Agent 2: Sales Closer

**Purpose:** Take qualified leads and close them. Never re-qualifies. Picks up exactly where Speed-to-Lead left off.

**Trigger:** Opportunity transitions to `qualified` stage.

**Critical constraint:** First message must reference something specific from the prior conversation. Never re-asks answered questions. Reads full ConversationThread history before responding.

**Objection handling:**

- Price → value reframe, payment options
- Timing → create urgency without pressure
- Trust → social proof, guarantees
- Competitor → differentiation, not disparagement
- "Need to think" → specific next step with timeline
- Anything else → escalate to founder

**Trust score events:**

- Approval: deal closes (Opportunity → `won`), booking confirmed
- Rejection: deal lost after agent involvement, founder takes over

### Agent 3: Nurture Specialist

**Purpose:** Re-engage cold leads through scheduled follow-ups.

**Trigger:** Contact goes dormant (no reply after configurable timeout) at any pipeline stage, or Opportunity marked as `nurturing`.

**Behavior:**

- Follows a cadence: Day 1, Day 3, Day 7, Day 14, Day 30 (configurable)
- Each follow-up references prior conversation context
- Varies approach: value reminder, new angle, social proof, soft check-in
- If lead re-engages with buying signals → hand back to Sales Closer
- If lead re-engages but needs qualification → hand back to Speed-to-Lead
- After final follow-up with no reply → mark Contact as `dormant`, stop outreach

**Trust score events:**

- Approval: dormant lead re-engages, lead re-enters active pipeline
- Rejection: lead complains about follow-ups, founder disables nurture for a contact

---

## 6. Pipeline State Machine

```
Contact.stage + Opportunity.stage → determines which agent owns the conversation

INBOUND LEAD
  → Contact created (stage: "new", roles: ["lead"])
  → Opportunity created (stage: "interested")
  → ConversationThread created (assignedAgent: "speed-to-lead")
  → Speed-to-Lead sends first message within 60s

QUALIFICATION
  → Speed-to-Lead qualifies lead
  → Opportunity.stage → "qualified"
  → ConversationThread.assignedAgent → "sales-closer"
  → Sales Closer picks up with full context

CLOSING
  → Sales Closer works the deal
  → Opportunity.stage → "won" (success) or "lost" (failed)
  → If won: Contact.stage → "customer"

GOING COLD (at any point)
  → No reply after X hours (configurable per AgentPersona)
  → Opportunity.stage → "nurturing"
  → ConversationThread.assignedAgent → "nurture-specialist"
  → Nurture Specialist begins follow-up cadence

RE-ENGAGEMENT
  → Lead replies to Nurture Specialist
  → If buying signals: Opportunity.stage → "qualified", assign Sales Closer
  → If needs qualification: Opportunity.stage → "interested", assign Speed-to-Lead

DORMANT
  → Nurture cadence exhausted, no reply
  → Contact.stage → "dormant"
  → Pipeline stops for this lead
```

### Shared State — Critical Design Decision

All three agents share a single `ConversationThread` record. When a lead moves between agents, the entire conversation history, qualification data, and context summary travels with them. No agent ever starts cold.

The `ConversationThread.agentContext` JSON field stores structured data: objections raised, preferences detected, offers made, topics discussed, and sentiment trend. Each agent reads this before responding.

---

## 7. System Prompt Assembly

Each agent's prompt is assembled from four components:

```
1. ROLE PROMPT (per agent type)
   "You are a Speed-to-Lead Rep for {businessName}..."

2. BUSINESS CONTEXT (from AgentPersona)
   Product/service description, value proposition,
   qualification criteria, escalation rules

3. CONVERSATION CONTEXT (from ConversationThread)
   Rolling summary + recent messages + agentContext
   (objections, preferences, sentiment)

4. GOVERNANCE CONSTRAINTS (hardcoded, non-overridable)
   - Never claim to be human
   - Never make financial promises
   - Never disparage competitors by name
   - Always offer human escalation when asked
   - Never share other customers' information
   - Respect opt-out immediately
```

The assembler lives in the orchestrator layer. It reads AgentPersona, determines which agent role prompt to use based on `ConversationThread.assignedAgent`, pulls conversation context, and appends governance constraints.

---

## 8. Deploy Experience

Founder buys the Sales Pipeline bundle (or individual agent) from the marketplace. The existing onboarding wizard is extended with an agent configuration step.

### Deploy Form (~5 minutes)

1. **Business basics** — name, what you sell, value proposition
2. **Qualification criteria** — what makes a lead worth pursuing (multiple choice + custom)
3. **Tone** — casual / professional / consultative
4. **Escalation rules** — when should the agent hand off to you (checkboxes + custom)
5. **Channel** — which of your connected channels should agents use

This populates one `AgentPersona` record. All three agents read from the same persona — they share business context but differ in behavior based on their role prompts.

### What Happens on Deploy

1. Three `AgentDeployment` records created (one per agent, linked to org)
2. One `AgentPersona` record created (shared config)
3. Agents begin listening on connected channels
4. New inbound messages trigger the pipeline

---

## 9. Trust Scoring Integration

Each agent has its own `AgentListing` with its own trust score. Trust follows existing mechanics:

- **Start:** 50 (supervised autonomy, free tier)
- **Approval:** +3 pts (streak bonus up to +5)
- **Rejection:** -10 pts
- **Autonomy levels:** <40 supervised, 40-69 guided, >=70 autonomous
- **Price tiers:** <30 free, 30-54 basic, 55-79 pro, >=80 elite

The founder reviews agent actions via the existing task review queue. Each approval/rejection updates the specific agent's trust score through `TrustScoreAdapter`, which already bridges marketplace trust into the governance layer.

Agents can reach different trust levels independently. Speed-to-Lead might reach autonomous (70+) while Nurture is still guided (55) because it has fewer interactions.

---

## 10. Design Decisions & Edge Cases

**One thread per contact:** `ConversationThread` has a unique constraint on `[contactId, organizationId]`. This means one active pipeline conversation per lead. If the same person inquires about a second product, it flows through the same thread. This is intentional — the agents should know everything about a lead in one place.

**Opportunity auto-creation:** When a lead enters the pipeline, an Opportunity is auto-created. `serviceId` and `serviceName` are populated from `AgentPersona.productService`. If the founder sells multiple products, the agent determines which one during qualification and updates the Opportunity.

**Dormancy scheduling:** The existing scheduler infrastructure (native runtime scheduler) handles dormancy detection and nurture cadence. The `ConversationThread.followUpSchedule.nextFollowUpAt` field is polled by the scheduler. No new scheduling mechanism needed.

**State reconciliation:** `ConversationThread` is the persisted source of truth for agent assignment. The in-memory conversation state (`ConversationStateData`) is reconstructed from the thread on each message. Pipeline handoffs update the thread first, then the in-memory state follows.

**Channel support at launch:** WhatsApp and Telegram only for inbound leads. The `Contact.primaryChannel` enum will be extended to include `"slack"` and `"instagram"` in a future update if those channels are needed for lead ingestion.

**Trust score categories:** Each agent uses a single task category matching its role: `"lead-qualification"` (Speed-to-Lead), `"sales-closing"` (Sales Closer), `"lead-nurturing"` (Nurture Specialist). These are the `taskCategory` values in `TrustScoreRecord`.

**Bundle representation:** The bundle is a fourth `AgentListing` with `type: "switchboard_native"` and `metadata: { bundleListingIds: [...] }`. Deploying the bundle creates three individual `AgentDeployment` records. The bundle listing itself has no deployment — it's a catalog entry only.

**Manual override:** The founder can manually reassign a lead's agent via the dashboard. This updates `ConversationThread.assignedAgent` and creates an audit entry. Available through the existing OwnerTask escalation flow.

**60-second SLA:** If the LLM response takes >10 seconds, a templated acknowledgment is sent immediately ("Hi! Got your message, one moment...") while the personalized response generates.

**WhatsApp rate limits:** Nurture follow-ups respect WhatsApp's 24-hour messaging window. Messages outside the window use approved message templates. Maximum one follow-up per 24 hours per lead.

---

## 11. Scope — What's Explicitly Excluded

| Excluded                               | Reason                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| CRM integration (HubSpot, GoHighLevel) | Phase 2. Founders export from dashboard for now                 |
| Multi-model LLM support                | Claude only at launch. LLMAdapter supports it later             |
| SMS adapter                            | Use existing WhatsApp/Telegram channels                         |
| Email adapter                          | Use existing channels. Email is Phase 2                         |
| Voice adapter                          | Phase 2                                                         |
| Custom deploy wizard                   | Extend existing onboarding wizard instead                       |
| Separate conversation stores per agent | Shared ConversationThread is the core design decision           |
| Agent-to-agent direct communication    | Agents communicate via shared state, not messages to each other |

---

## 12. Implementation Dependencies

Build order (each step depends on the previous):

1. **AgentPersona model** — Prisma migration, Zod schema, store
2. **Contact field additions** — `qualificationData`, `nextFollowUpAt`
3. **Seed marketplace listings** — Three AgentListing records + future family placeholders
4. **System prompt assembler** — Role prompts + persona + context + constraints
5. **Pipeline orchestrator** — Handoff logic, dormancy detection, re-engagement routing
6. **Deploy wizard extension** — AgentPersona form in marketplace UI
7. **Integration testing** — Full pipeline: lead in → qualify → close → nurture cycle
