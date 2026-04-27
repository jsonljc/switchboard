# Alex Wedge — Full Production Readiness Checklist

> Reference document. This is NOT the sprint scope. See `2026-04-16-alex-wedge-validation-sprint-design.md` for the actual sprint spec. Use this checklist before go-live to verify production readiness.

## 1. Channel and API Readiness

### WhatsApp Connection

- Business has a valid WhatsApp Business setup
- Phone number is properly connected
- Cloud API or BSP connection is live
- Webhook is receiving inbound messages reliably
- Webhook retries are handled correctly
- Outbound messages are sending successfully
- Delivery status is tracked
- Read status is tracked
- Failed sends are logged
- Rate limits and throttling are understood

### Conversation Continuity

- Incoming messages are mapped to the correct lead
- Multi-turn conversation state is preserved
- Agent can resume after delay
- Duplicate webhook events do not cause duplicate replies
- Session window behavior is handled correctly
- Template vs freeform rules are respected
- Conversation history is accessible to the runtime

### Fallback Infrastructure

- Human handoff can be triggered
- Staff can continue in the same thread
- Agent can pause when handoff happens
- Agent can resume after human intervention if needed
- Failure states do not leave the lead hanging

## 2. Booking and Operational Reality

### Booking System Integration

- Agent can read availability
- Agent can propose available slots
- Agent can confirm a selected slot
- Agent can create a booking
- Agent can reschedule
- Agent can cancel if allowed
- Agent can detect unavailable or stale slots
- Agent can avoid double-booking
- Agent can handle timezone correctly
- Agent can confirm branch/location correctly

### Real Business Workflow

- Business has a clean appointment flow
- Business rules are documented
- Staff escalation points are clear
- Agent knows when it must ask staff
- Exceptions are mapped, not improvised
- There is an owner responsible for operational fixes

### Confirmation Flow

- User gets clear booking confirmation
- User gets date, time, location, service details
- Reminder flow exists if needed
- Missed or incomplete bookings are recoverable

## 3. Knowledge and Answer Quality

### Business Knowledge

- Service list is accurate
- Pricing info is accurate or intentionally withheld
- Promos are current
- Opening hours are current
- Branch details are current
- Common FAQs are covered
- Refund/cancellation policies are covered
- Eligibility rules are covered
- Escalation scenarios are covered

### Answer Reliability

- Agent does not hallucinate unavailable services
- Agent does not invent prices or promos
- Agent can say "I'm not sure" gracefully
- Agent can escalate uncertainty
- Agent can answer in short and clear form
- Agent does not overload with too much text

## 4. Conversation and Persuasion Quality

### First Response

- Agent replies quickly enough to feel immediate
- First message feels natural, not robotic
- Agent acknowledges the inquiry correctly
- Agent does not sound too salesy too early
- Agent moves the conversation forward

### Qualification

- Agent can identify service intent
- Agent can ask for the minimum useful details
- Agent does not interrogate too much
- Agent qualifies naturally inside conversation
- Agent captures urgency and intent
- Agent detects high-intent vs browsing leads

### Objection Handling

- Agent can handle "too expensive"
- Agent can handle "let me think about it"
- Agent can handle "not now"
- Agent can handle "need to ask spouse/friend"
- Agent can handle "what's the difference"
- Agent can handle "is this suitable for me"
- Agent does not become pushy
- Agent knows when to stop pushing

### Booking Push

- Agent can ask for the booking at the right time
- Agent uses clear booking prompts
- Agent can offer two or three good options
- Agent can recover when lead hesitates
- Agent can move from chat to booked status cleanly

## 5. Tone, Trust, and Local Fit

### Brand Fit

- Tone matches the business category
- Tone matches the business's level of formality
- Tone fits premium vs mass-market positioning
- Tone sounds like a believable staff member or concierge
- Tone does not sound overengineered or AI-ish

### Local Communication

- Agent handles local English naturally
- Agent understands shorthand and casual phrasing
- Agent can code-switch if needed
- Agent can support relevant market languages
- Agent does not sound overly American or generic
- Agent handles culturally normal politeness levels

### Approachability

- Agent sounds warm enough to build trust
- Agent sounds competent enough to convert
- Agent is concise enough for messaging apps
- Agent does not over-explain
- Agent feels human enough to keep the lead engaged

## 6. Safety, Compliance, and Business Controls

### Policy Boundaries

- Agent knows what it can and cannot claim
- Medical, legal, or financial-sensitive categories are constrained
- Agent avoids guarantees or risky promises
- Agent avoids misleading urgency
- Agent avoids unauthorized discounts
- Agent avoids making up policy exceptions

### Consent and Privacy

- Data collection is appropriate
- Sensitive data is handled carefully
- Consent requirements are met where needed
- Contact info storage is controlled
- Staff access rules are clear
- Audit trail exists for replies and actions

### Business Controls

- Approved language and offers are configurable
- Promotions can be turned off quickly
- Unsafe reply patterns can be patched quickly
- There is a kill switch or pause mechanism
- Escalation to staff can override the agent

## 7. Lead Data and CRM Quality

### Data Capture

- Lead name is captured correctly
- Service interest is captured
- Branch/location preference is captured
- Timing preference is captured
- Budget signal is captured if relevant
- Objections are captured
- Booking status is captured
- Source attribution is captured if possible

### CRM Integration

- New leads are created correctly
- Existing leads are deduplicated
- Conversation updates sync back to CRM
- Booking outcome syncs back to CRM
- Human takeover is logged
- Reactivation status is logged
- Lost reasons are logged when possible

## 8. Nurture and Reactivation Readiness

### Reactivation Logic

- Lead can be marked as not converted
- Follow-up timing rules are defined
- Re-engagement messages are not spammy
- Agent knows when to stop following up
- Agent can vary follow-up language
- Agent can re-route warm leads back into booking flow

### Cadence Quality

- Cadence length is defined
- Message intervals are defined
- No duplicate follow-ups
- No follow-up after successful booking
- No follow-up after explicit opt-out
- Follow-up feels context-aware, not generic

## 9. Handoff and Human-in-the-Loop Design

### Human Takeover

- Agent knows when to escalate
- Staff receive enough context
- Lead does not need to repeat everything
- Handoff is visible in the CRM or inbox
- Staff can step in quickly
- Staff can tag edge cases for future improvement

### Escalation Triggers

- Sensitive questions
- Edge-case eligibility
- Complaint or anger
- Payment issues
- Schedule conflict
- Out-of-policy request
- Repeated misunderstanding
- High-value lead requiring personal handling

## 10. Reliability and Failure Handling

### Runtime Stability

- Conversation does not break on minor errors
- Retries do not create double messages
- External system failures are handled gracefully
- Partial outages degrade safely
- The agent gives a sensible fallback response
- Logs are good enough to debug failures

### Recovery Behavior

- If booking API fails, agent apologizes and escalates
- If knowledge is missing, agent asks staff or offers callback
- If WhatsApp send fails, retry or alert exists
- If lead goes silent, state remains intact
- If a tool times out, the lead still gets a coherent reply

## 11. Metrics and Proof of Value

### Core Funnel Metrics

- Median first response time
- Qualification rate
- Booking rate
- Show-up rate
- Reactivation rate
- Human takeover rate
- Failure rate
- Booking completion time

### Quality Metrics

- Conversation satisfaction if measurable
- Staff review score
- Wrong-answer rate
- Hallucination rate
- Escalation appropriateness
- Drop-off point analysis

### Commercial Metrics

- Incremental bookings vs baseline
- Staff time saved
- Missed-lead recovery rate
- Cost per booking impact
- Lead-to-booking conversion lift
- Reactivated revenue or bookings

## 12. Product Wedge Validation

### Is the Wedge Actually Real?

- Can it reliably answer inbound leads
- Can it move leads toward a booking
- Can it actually book
- Can it recover some cold leads
- Can staff trust it enough to deploy
- Can a buyer understand the value in one sentence

### Buyer Clarity

- The problem statement is obvious
- The product name maps to the outcome
- The setup requirements are not too heavy
- The ROI story is simple
- The pilot scope is easy to explain
- The result is better than "just hire a receptionist"

## 13. Go-Live Pilot Checklist

### Before Launch

- One business selected
- One market selected
- One channel selected
- One clear service scope selected
- Knowledge base reviewed
- Booking flow tested
- CRM sync tested
- Escalation workflow tested
- Staff trained on takeover
- Metrics dashboard ready

### During Pilot

- Review first 20 conversations manually
- Review first 10 bookings manually
- Track failed replies daily
- Track awkward tone examples
- Track missed opportunities
- Patch weak FAQs quickly
- Tighten objection handling weekly

### After Pilot

- Compare conversion against baseline
- Compare response time against staff
- Review top handoff reasons
- Review top failure reasons
- Review lead feedback
- Decide whether wedge is proven, weak, or not ready

## 14. Final Pass-Fail Questions

You should be able to answer yes to most of these:

- Can it connect to WhatsApp reliably?
- Can it hold a coherent multi-turn conversation?
- Can it sound natural for the target market?
- Can it answer enough questions to build trust?
- Can it qualify without friction?
- Can it ask for the booking naturally?
- Can it actually complete the booking?
- Can it hand off safely?
- Can it follow up without annoying people?
- Can you prove it improves a business outcome?

If too many of those are "not yet," then it is still a prototype, not a wedge.
