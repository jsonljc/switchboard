# Go-to-Market Positioning — Validation & Design

**Date:** 2026-03-17
**Status:** Approved
**Market:** Singapore + Malaysia (SG/MY)
**Segment:** Service business owners (clinics, gyms, aesthetics) — direct outreach + pilot

---

## One-Line Positioning

**"Switchboard turns your ad spend into paying patients — every lead answered, every booking captured, every ad dollar pointed at people who actually pay."**

---

## Positioning Hierarchy

1. **Never lose a lead** — more patients = more money (primary)
2. **Revenue visibility** — know which ads bring paying patients, kill the ones that don't (supports #1)
3. **Governed AI** — trust layer that makes owners comfortable letting it run (enables #1)

The closed loop is the architecture, not the pitch.

---

## Objection Scripts

### "I don't trust AI talking to my patients"

**Reframe:** "It's not autonomous AI — it's a digital receptionist that follows your rules."

- It asks permission before booking
- Medical claim filter blocks 17 regulatory-violating phrases
- Activity log shows exactly what was said
- Hands off to your staff when it should (auto-escalation, SLA deadlines)
- Gets better with practice — after 47 perfect bookings, handles routine ones automatically

**Pitch line:** "Your receptionist doesn't make up treatment plans either — she follows your script. This does the same thing, just 24/7 and never forgets to follow up."

### "That's too expensive"

**Reframe:** "How much are you spending on ads right now without knowing which ones bring paying patients?"

- Most clinics waste 30-50% of ad spend on leads that never pay
- A missed WhatsApp lead at $15/click is money burned — Switchboard replies in seconds
- System pays for itself: $500/mo saved ad waste + 5 extra patients × $200 = $1,500/mo value

**Pitch line:** "You're already spending $2-3K on ads. I'm not adding a cost — I'm making that money work. Right now you can't tell me which of your ads brought a patient who actually paid. After Switchboard, you can."

---

## Defensibility Map

### Genuinely defensible (technical moat)

| Moat Layer               | What We Have                                                                                                     | Why It's Hard to Copy                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Governance engine        | 10-step policy evaluation, risk scoring, approval workflows, consent gates, audit chain                          | 6+ months of engineering. Chatbot companies need to rebuild their architecture.                      |
| Full-stack integration   | Lead capture + AI conversation + CRM + booking + payment recording + ad feedback — all through one policy engine | Competitors do 1-2 of these. Stitching them through one governance layer is the product.             |
| Vertical configurability | Skins + profiles — deploy as a dental clinic in 1 config swap                                                    | Most competitors hard-code one vertical or build generic tools needing heavy setup.                  |
| Attribution pipeline     | CRM contact → ConversionBus → CAPI/Google/TikTok with real dollar values                                         | Marketing tools send pixel events. CRMs track deals. Nobody wires payment back to ad click for SMBs. |

### NOT defensible (don't lean on these)

- "We use AI" — everyone does
- "Multi-channel" — Manychat, Respond.io, Trengo all do this
- "We have a CRM" — thousands of CRMs, HubSpot is free
- "We do ads" — Meta's own tools, AdEspresso, Madgicx — crowded

### The moat in one sentence

**"Nobody else governs the AI, tracks the payment, and feeds it back to the ad platform — in one system, for SMBs, in Southeast Asia."**

---

## Governance Surface — Launch Simplification

Keep everything that a clinic owner can feel in a demo. Hide everything only an enterprise buyer would ask about.

| Feature                      | Launch Decision | Surface As                                           |
| ---------------------------- | --------------- | ---------------------------------------------------- |
| Competence tracking          | **Keep**        | "Your AI has handled 47 bookings with 100% accuracy" |
| Consent gate                 | **Keep**        | "Only contacts patients who opted in"                |
| Medical claim filter         | **Keep**        | "Blocks anything that could get you in trouble"      |
| Approval before booking      | **Keep**        | "Asks you before doing anything big"                 |
| Audit trail                  | **Keep**        | "Activity log — see everything it did"               |
| 4 governance tiers           | **Simplify**    | Default to guarded, don't expose selector            |
| Delegated approvers + quorum | **Cut**         | Enterprise feature                                   |
| Role overlays                | **Cut**         | Enterprise feature                                   |
| System risk posture          | **Cut**         | Enterprise feature                                   |

**The owner hears:** "Your AI receptionist gets better with practice. It started by asking permission for everything. After 47 perfect bookings, it handles routine ones automatically. You still see everything it does, and it still asks you for anything unusual."

---

## Pilot Playbook

### The three metrics that sell the next customer

| Metric                          | What It Proves                                        | Data Source                                               |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| Speed-to-lead                   | "We replied to 95% of leads within 2 minutes"         | `ConversationStateData.firstReplyAt` vs inbound timestamp |
| Lead-to-patient conversion rate | "34% of ad leads became paying patients, up from 12%" | Journey stage transitions + revenue events                |
| Cost per paying patient         | "Cost dropped from $180 to $65"                       | Ad spend (platform API) ÷ revenue events with attribution |

### Onboarding requirements per pilot

1. Ad account access (Meta/Google)
2. WhatsApp Business or Telegram
3. Self-reported baseline numbers (leads/mo, conversion rate, ad spend, reply speed)
4. Staff buy-in on payment recording ("john paid 350" in ops chat)

### 30-day pilot timeline

- **Week 1:** Connect channels, AI replies, staff approves everything (guarded). Capture baseline speed-to-lead.
- **Week 2-3:** AI qualifies autonomously, staff approves bookings. Competence climbs. Record payments via chat.
- **Week 4:** Produce pilot report. Close.

**The close:** "You spent $X on ads. Switchboard turned that into Y paying patients worth $Z. Without Switchboard, you were getting half that. Want to continue?"

---

## Pilot Report Design

### Purpose

One-page dashboard answering: "Is Switchboard worth what I'm paying?"

Live at `/results`. Not a PDF — screenshottable for case studies.

### Layout

**Card 1: Speed-to-Lead**

- Median first-reply time (e.g., "47 seconds")
- Comparison to baseline ("vs 4+ hours before")
- "X out of Y leads replied within 2 minutes (Z%)"

**Card 2: Conversion Rate**

- Leads who became paying patients (e.g., "34%")
- Comparison to baseline ("vs ~12% before")
- "X paying patients from Y leads this month"

**Card 3: Cost Per Paying Patient**

- Ad spend ÷ paying patients (e.g., "$65")
- Comparison to baseline ("vs ~$180 before")
- "Total spend: $X → Total revenue: $Y → ROAS: Z:1"

**Chart: 30-Day Funnel**

- Horizontal bar: Leads → Qualified → Booked → Showed Up → Paid
- Numbers and drop-off % at each stage
- Data: journey walker

**Table: Top Campaigns by Revenue**

- Columns: campaign name, spend, leads, paying patients, revenue, cost per paying patient
- Sorted by revenue descending
- Data: outcome tracker per campaign

### Baseline capture

At onboarding, store owner's self-reported numbers on `BusinessConfig`:

- Leads per month
- Conversion rate
- Monthly ad spend
- Typical reply speed

These are the "before" numbers on the report.

### Scope boundaries

- Not a full analytics dashboard — one screen, one story
- Daily refresh, not real-time
- No export/PDF — screenshot is enough for pilots
- No date pickers or filters

---

## Pre-Launch Blockers

| #   | Blocker                                    | Status                         | Impact                                                     |
| --- | ------------------------------------------ | ------------------------------ | ---------------------------------------------------------- |
| 1   | "Feels human" conversation engine          | In progress (separate branch)  | Can't demo without it — trust objection stays alive        |
| 2   | Revenue recording (chat-first offline POS) | In progress (closed-loop plan) | Can't prove cost-per-paying-patient without it             |
| 3   | Cross-channel identity resolution          | In progress (closed-loop plan) | Pilot clinic on WhatsApp + IG will see duplicate contacts  |
| 4   | Pilot report page                          | **Not started**                | Numbers sell the next customer — verbal proof isn't enough |
