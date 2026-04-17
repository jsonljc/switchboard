# Alex Wedge Validation Sprint — Design Spec

**Date:** 2026-04-16
**Governing sentence:** Prove that Alex can reliably receive a WhatsApp lead, hold a natural multi-turn conversation, qualify, and deliver a booking outcome — in a tone that feels local and believable — across 20-50 real conversations.

---

## What This Sprint Proves

One real WhatsApp number. One vertical. One market (Singapore). One business. 20-50 live conversations. Three pass criteria:

1. **Technical pass** — the plumbing works end-to-end
2. **Conversation pass** — the agent qualifies and books naturally
3. **Commercial pass** — it's faster and at least as effective as staff

If all three pass, the wedge is real. If not, we know exactly what's weak.

---

## Sprint Scope

### Must Prove (blocks the test)

| #   | Requirement                                         | What "done" looks like                                                                                                                     |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | WhatsApp can receive and send messages reliably     | Inbound webhook → agent response → outbound message. Works 50+ times without failure.                                                      |
| 2   | Multi-turn conversation state persists              | Lead can send 5+ messages across minutes/hours. Agent remembers context throughout.                                                        |
| 3   | Agent can handle one real business's FAQ set        | Business knowledge loaded via context resolver. Agent answers top 10 FAQs correctly without hallucinating.                                 |
| 4   | Agent can qualify naturally in chat                 | Agent identifies service intent, asks minimum useful details, captures urgency — without sounding like a form.                             |
| 5   | Agent can move to a booking action                  | After qualification, agent transitions to booking naturally. No jarring mode switch.                                                       |
| 6   | Agent can deliver a booking link or booking outcome | Lead receives a working booking link (Cal.com, Calendly, or direct URL). Agent confirms when booking is made.                              |
| 7   | Human escalation works                              | Agent recognizes when to escalate (anger, out-of-scope, explicit request). Business owner receives notification with conversation context. |
| 8   | Tone feels local and believable enough              | 5 real people in Singapore read 10 sample conversations and rate tone as "natural" or "acceptable" (not "robotic" or "foreign").           |
| 9   | 20-50 real conversations can be run and reviewed    | Conversations are logged, reviewable, and taggable for quality assessment.                                                                 |

### Nice to Have (improve during/after test)

- Read and delivery status tracking
- Better objection-handling breadth (beyond basic "too expensive" / "let me think")
- Follow-up reminder messages
- Basic source attribution (which ad/link drove the lead)
- Simple conversation tagging (qualified/not/booked/escalated) — note: basic manual tagging via spreadsheet is required for pass criteria evaluation, but a built-in tagging system is nice-to-have
- Basic metrics sheet (response time, qualification rate, booking rate)

### Defer (production hardening)

- Full CRM sync hardening
- Full nurture engine (Riley)
- Compliance hardening
- Rate-limit edge cases
- Advanced dashboards
- Full staff training program
- Complex dedup logic
- Kill switch sophistication

---

## What Already Exists

| Component                  | Status                                                                                                 | Gap for Sprint                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| WhatsApp adapter           | Built — webhook verify, send text, send template, interactive buttons, retry, rate limit, typing delay | Need to verify end-to-end wiring with skill runtime path                   |
| Skill runtime              | Built — executor, handler, hooks, governance, context resolver                                         | Working. No changes needed.                                                |
| `sales-pipeline.md` skill  | Built — 3-role stage routing                                                                           | Needs rewrite as Alex (single conversion flow). See Skill Rewrite section. |
| CRM tools                  | Built — crm-query, crm-write, pipeline-handoff                                                         | Working. May simplify pipeline-handoff for 2-agent model.                  |
| Conversation store         | Built                                                                                                  | Need to verify multi-turn persistence with WhatsApp threading.             |
| Knowledge context resolver | Built                                                                                                  | Need to load one real business's knowledge.                                |
| Escalation/handoff         | Built — in agent runtime and chat app                                                                  | Need to verify WhatsApp notification to business owner works.              |

---

## Skill Rewrite: `sales-pipeline.md` → Alex Conversion Flow

The current skill routes to 3 roles based on `PIPELINE_STAGE`. For the sprint, rewrite as **one Alex skill** covering all conversion stages.

### What Changes

**Before:** Three-role stage routing (Speed-to-Lead → Sales Closer → Nurture Specialist)
**After:** One continuous Alex flow (Respond → Qualify → Convert → Book)

### Alex Skill Structure

```
skills/alex.md
```

**Frontmatter:** Same parameter structure. Remove stage-based role routing. Add personality/voice section.

**Body structure:**

1. **Identity** — You are Alex, the frontline agent for {{BUSINESS_NAME}}. Your job is to turn inbound inquiries into booked appointments.

2. **Voice rules** — From identity spec Section 2. Quick, direct, curious early. Warmer and more confident as conversation progresses. No corporate filler. Mirror the lead's formality. No persona overperformance.

3. **Respond mode** (first 1-2 messages) — Acknowledge inquiry, establish relevance, ask one qualifying question. Under 3 sentences.

4. **Qualify mode** — Use qualification criteria from {{PERSONA_CONFIG}}. Ask naturally, not as a checklist. Capture service intent, timing, budget signal.

5. **Convert mode** (after qualification) — Handle objections using {{PLAYBOOK_CONTEXT}}. Reframe around value. Don't pressure.

6. **Book mode** — Deliver booking link {{PERSONA_CONFIG.bookingLink}}. Suggest specific times if available. Confirm booking.

7. **Escalation rules** — From identity spec handoff triggers. Hard disqualifier, frustration, out-of-scope, explicit human request, 15-message cap.

8. **Knowledge** — {{KNOWLEDGE_CONTEXT}} for FAQs, services, pricing, hours.

### Singapore Tone Calibration

Add a tone section to the skill body:

```markdown
## Local Tone (Singapore English)

- Natural Singaporean English. Not American, not British, not forced Singlish.
- Comfortable with casual register: "Sure, can!" / "No worries" / "Got it"
- Don't force lah/lor/ah — only if it fits naturally and the lead uses them first
- Short messages. WhatsApp is a chat app, not email.
- Use "ya" instead of "yes" when tone is casual
- Use "book" not "schedule an appointment"
- Price in SGD
- Time in 12-hour format with am/pm
- Address by first name after they share it
```

This section is the hypothesis. The 20-50 conversations will tell us if it's right.

---

## Booking Integration

### Sprint Approach: Booking Link Delivery

For the sprint, Alex delivers a booking link — not a full booking API integration.

**Why:** A Cal.com/Calendly link is the simplest way to prove the booking flow works. The lead clicks, picks a time, done. No availability API, no double-booking logic, no timezone complexity. Those are production hardening tasks.

**Implementation:**

- `PERSONA_CONFIG.bookingLink` already exists in the skill parameters
- Alex delivers it in the convert/book phase: "Here's a link to pick a time that works for you: {{PERSONA_CONFIG.bookingLink}}"
- If the lead comes back and says "I booked," Alex confirms and logs via `crm-write.activity.log`

**What this doesn't cover (deferred):**

- Reading availability programmatically
- Creating bookings via API
- Confirming slots in real-time
- Reschedule/cancel flows

---

## Knowledge Loading: One Real Business

### What's Needed

One real business's knowledge loaded into the context resolver as `KnowledgeEntry` records:

| Knowledge Type            | Content                                  |
| ------------------------- | ---------------------------------------- |
| Services                  | List of services with descriptions       |
| Pricing                   | Price list or "contact for pricing"      |
| Hours                     | Operating hours per location             |
| Location                  | Address, how to get there                |
| FAQs                      | Top 10 questions customers ask           |
| Policies                  | Cancellation, refund, rescheduling rules |
| Qualification criteria    | What makes someone a good fit            |
| Disqualification criteria | When to politely decline                 |

### How It's Loaded

The context resolver already supports `kind: knowledge` with `scope` matching. Load via seed script or API endpoint. One org, one set of knowledge entries.

---

## End-to-End Wiring Verification

The sprint must verify that this full path works:

```
WhatsApp webhook (inbound)
  → apps/chat webhook handler
    → WhatsApp adapter.parseIncomingMessage()
      → ChannelGateway.handleIncoming()
        → deploymentLookup.findByChannelToken() (resolves deployment)
        → resolveHandler() (picks SkillHandler if deployment.skillSlug is set)
          → SkillHandler.onMessage()
            → parameter builder (resolves opportunity, lead profile, persona config)
            → context resolver (injects business knowledge)
            → SkillExecutor.execute() (Alex skill + tools + governance)
              → LLM call (Claude) with tool loop
          → response
        → WhatsApp adapter.sendTextReply()
  → WhatsApp Cloud API (outbound)
```

### Specific Verification Points

1. **Webhook → Skill path:** Does a WhatsApp inbound actually route to the skill handler (not legacy handler)?
2. **Parameter resolution:** Does the parameter builder correctly resolve opportunity, lead profile, and persona config for WhatsApp-originated conversations?
3. **Context injection:** Does the context resolver inject the loaded business knowledge into the skill?
4. **Tool execution:** Do CRM tools work correctly within the skill executor loop?
5. **Response delivery:** Does the skill response get sent back through the WhatsApp adapter?
6. **State persistence:** Does the conversation store correctly persist state between WhatsApp messages (keyed by phone number)?

---

## Human Escalation Design

### Sprint Scope

When Alex escalates, the business owner needs to know and be able to take over.

**Trigger:** Alex detects an escalation condition (from `docs/superpowers/specs/2026-04-16-agent-identity-system-design.md`, Section 1 "Handoff Triggers" table).

**What happens:**

1. Alex sends the lead a message: "Let me get someone from the team to help with this. They'll reach out shortly."
2. Business owner receives a WhatsApp notification (or other configured channel) with:
   - Lead name/number
   - Conversation summary (last 5 messages)
   - Reason for escalation
3. The conversation is paused — Alex stops responding.
4. Business owner can reply directly to the lead in the same WhatsApp thread.

**What already exists:** The `packages/agents/src/escalation.ts` module and the operator handler in `apps/chat/src/handlers/operator-handler.ts`. Need to verify the WhatsApp-specific notification path works.

---

## Conversation Review System

### Sprint Scope

All conversations must be reviewable after the fact. This is how you learn what's working and what's not.

**Minimum:** Every conversation is stored with:

- Full message history (both sides)
- Timestamps
- Tool calls made (stage updates, activity logs)
- Escalation events
- Final outcome (booked / not booked / escalated / dropped)

**Review process:**

- After the sprint, manually review all 20-50 conversations
- Tag each: qualified/not, booked/not, escalated/not, tone issues, knowledge gaps
- Identify the top 3 failure patterns and fix before next round

**What already exists:** Conversation store, agent task logging, tool call records in execution traces. May need a simple review UI or export-to-spreadsheet.

---

## Test Plan

### Phase 1: Technical Smoke Test (internal, ~5 conversations)

- Register a WhatsApp Business test number
- Load test business knowledge
- Send 5 test messages and verify full round-trip
- Verify multi-turn state persistence
- Verify escalation notification
- Fix any wiring issues

### Phase 2: Tone Calibration (internal, ~10 conversations)

- Team members role-play as leads with different styles (formal, casual, Singlish, terse)
- Review Alex's responses for tone fit
- Adjust skill body tone rules
- Re-test until tone feels local

### Phase 3: Live Pilot (real leads, 20-50 conversations)

- One real business, one real WhatsApp number
- Real inbound leads (from existing traffic or small ad spend)
- Run for 1-2 weeks
- Review every conversation
- Measure: response time, qualification rate, booking rate, escalation rate, tone quality

### Pass Criteria

| Criterion                  | Threshold                                                                                    | Notes                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Delivery reliability       | <5% message send/receive failures                                                            | Plumbing works                                          |
| Context continuity         | 90%+ conversations maintain context across turns                                             | State persists                                          |
| FAQ correctness            | 90%+ correct answers on loaded knowledge                                                     | No hallucination                                        |
| Qualification rate         | 60%+ of conversations reach a qualification outcome                                          | Agent can do the job                                    |
| Booked outcome rate        | 20%+ of qualified leads result in a confirmed booking                                        | The real commercial proof — manually verified if needed |
| Escalation appropriateness | 100% of escalation triggers notify business owner; no false escalations on normal objections | Safe fallback works                                     |
| Tone acceptability         | 80%+ of reviewed conversations rated "natural" or "acceptable"                               | Sounds local                                            |

---

## Risks

| Risk                                          | Mitigation                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| WhatsApp number registration takes time       | Start registration immediately. Use test number for Phase 1-2.                          |
| Business knowledge is incomplete              | Start with top 10 FAQs. Add more based on real conversation gaps.                       |
| Tone is too American/generic                  | Phase 2 explicitly tests this. Iterate skill body before Phase 3.                       |
| Skill runtime has bugs in WhatsApp path       | Phase 1 smoke test catches this before real leads.                                      |
| Low inbound volume during pilot               | Small ad spend ($50-100) on click-to-WhatsApp ads to generate leads.                    |
| Business owner doesn't respond to escalations | Define SLA expectation. Add fallback: "Our team will get back to you within [X] hours." |

---

## What Comes After (Not In Sprint)

If the sprint passes:

- **Riley nurture engine** — follow up on leads that didn't convert
- **Booking API integration** — programmatic availability + booking
- **Website** — public-facing site with the validated agent as the demo
- **Second vertical** — test with a different business type
- **Production hardening** — full checklist at `2026-04-16-alex-wedge-production-checklist.md`
