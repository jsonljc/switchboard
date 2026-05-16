# Alex Vertical Adaptation — Med Spa SG/MY

**Date:** 2026-05-10
**Status:** Draft
**Approach:** A — Data-layer deepening (single skill, market × category profiles)

## Problem

Alex's conversation style is generic sales. To convert med spa / beauty aesthetics leads in Singapore and Malaysia, Alex needs:

1. Market-specific sales personality (SG and MY buyers convert differently)
2. Easy business knowledge onboarding (dump URL/PDF → extract → fill gaps)
3. A feedback loop where Alex surfaces patterns and the operator decides what to act on

No generic industry knowledge — all knowledge is business-specific and operator-confirmed. The architecture stays vertical-agnostic; med spa SG/MY is the first instantiation.

## Design Decisions

| Decision          | Choice                                                          | Rationale                                                                                                  |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Approach          | Data-layer deepening, not skill variants or personality modules | One skill to maintain. Verticals differ in data, not control flow. Fork only with evidence.                |
| Generic knowledge | None                                                            | Clashes with business-specific content. Generic value lives in conversation patterns, not treatment facts. |
| Learning model    | Pattern surfacing (C)                                           | Alex detects patterns, operator decides. Not autonomous, not purely manual.                                |
| Market profiles   | Market × category keyed                                         | SG med-spa and SG dental can differ without code changes. A data column, not a code fork.                  |
| Medical knowledge | Operator-owned free text only                                   | No structured clinical fields. Operator writes `aftercareNotes`, Alex never generates medical claims.      |

## Section 1: Market × Category Conversation Profiles

The dialogue system currently has market-specific voice configs (SG, MY) that control language only. We extend these to carry real sales weight by combining market with business category.

### MarketProfile Schema

```typescript
MarketProfileSchema = z.object({
  market: z.enum(["SG", "MY"]),
  category: z.string(), // "med-spa", "dental", "fitness", etc.

  // Sales dynamics
  pricingStyle: z.enum(["upfront", "on-request", "range"]),
  closingPace: z.enum(["single-session", "multi-touch"]),
  trustDrivers: z.array(z.string()),

  // Conversation tuning
  warmupLength: z.number().min(1).max(3),
  objectionStyle: z.enum(["direct-reframe", "empathize-then-reframe"]),
  urgencySignals: z.array(z.string()),

  // Voice
  localPatterns: z.array(z.string()),
  formality: z.enum(["professional-casual", "formal", "casual"]),
  priceFormat: z.object({
    currency: z.string(),
    display: z.enum(["prefix", "suffix"]),
  }),
  timeFormat: z.enum(["12h", "24h"]),
});
```

### Seed Profiles

**SG med-spa:**

- `pricingStyle: "upfront"` — Singaporeans ghost if you hide pricing
- `closingPace: "single-session"` — most treatments book in one conversation
- `trustDrivers: ["safety", "results", "social-proof"]`
- `warmupLength: 1` — acknowledge why they reached out, then qualify
- `objectionStyle: "direct-reframe"` — "actually the downtime is only 2 days, most clients come in on Friday and are fine by Monday"
- `localPatterns: ["lah", "can", "ya", "no worries", "sure can"]`
- `formality: "professional-casual"`, `currency: "SGD"`, `timeFormat: "12h"`

**MY med-spa:**

- `pricingStyle: "range"` — more relationship before exact numbers
- `closingPace: "single-session"`
- `trustDrivers: ["credentials", "experience", "safety"]`
- `warmupLength: 2` — more rapport before qualifying
- `objectionStyle: "empathize-then-reframe"`
- `localPatterns: ["lah", "kan", "boleh", "ok can"]`
- `formality: "professional-casual"`, `currency: "MYR"`, `timeFormat: "12h"`

### Integration

- New `MARKET_PROFILE` parameter added to Alex skill frontmatter
- Alex builder loads profile from deployment config (market + category lookup)
- Skill body references `{{MARKET_PROFILE}}` for voice, pacing, and objection handling
- Hardcoded "Singapore English" section in `alex.md` replaced with template-driven voice section

## Section 2: Knowledge Onboarding Pipeline

Operator pastes a URL, PDF, or raw text. Alex extracts what it can. A pre-filled form shows what was found and highlights gaps. Operator fills gaps. Knowledge is live immediately.

### Stage 1 — Extraction

- **Inputs:** URL (website, Instagram, Facebook page), PDF (menu/brochure), raw pasted text
- Extends existing website scanner schema (`website-scan.ts`) to handle PDFs and raw text
- Each extracted field gets a confidence score (high/medium/low)
- Output: draft `BusinessFacts` object with confidence annotations

### Stage 2 — Gap-fill Form

- Pre-filled form rendered from extraction output
- High-confidence fields: shown as confirmed (editable)
- Medium-confidence fields: shown as "please verify" (highlighted)
- Missing fields: empty with clear labels
- Structured around what Alex needs to sell: services (name, price, duration, what it does, who it's for, prep/aftercare), hours, booking policies, cancellation policy, escalation contact, FAQs
- No generic treatment knowledge fields — only "what do YOU offer"

### Stage 3 — Activation

- On submit: BusinessFacts saved, knowledge entries created, Alex immediately ready
- Operator can edit anytime — changes live on next conversation
- Dashboard shows knowledge completeness indicator (not a gate, just visibility)

### Relationship to Existing Playbook Schema

The Playbook schema (`playbook.ts`) with section-by-section status tracking becomes the internal completeness model. The operator-facing experience is dump-first, form-second. The playbook tracks readiness internally; it is not the primary input method.

### Extraction Constraint

Extraction is best-effort. Low-confidence extractions go to the gap-fill form, never into production knowledge. Every fact Alex uses is either operator-confirmed or high-confidence extracted. This prevents generic knowledge clash.

## Section 3: Conversation Analytics + Operator Feedback Loop

### Component 1 — Conversation Outcome Tracking

Tag every conversation with its outcome:

- `booked` — calendar-book tool called successfully
- `qualified-not-booked` — CRM stage reached "qualified" but no booking
- `stalled` — no lead response 24h after Alex's last reply
- `escalated` — handoff triggered
- `disqualified` — hit a disqualification criterion

The conversion bus already tracks `inquiry → qualified → booked`. Add `stalled` detection via a lightweight scheduled check on open conversations.

### Component 2 — Pattern Detection

Periodic analysis (daily or on-demand) per deployment:

- **Knowledge gaps:** questions Alex escalated (Bucket C) or couldn't answer (Bucket B miss), grouped by topic. "7 leads asked about parking, Alex had no answer."
- **Drop-off patterns:** last topic/phase before stalled conversations. "4 leads stalled during pricing discussion."
- **Objection frequency:** which objections appear most, booking rate after each type.
- **Winning patterns:** what differs in conversations that booked vs didn't.

Output: ranked list of actionable insights, each with a suggested action.

### Component 3 — Operator Action Surface

Surfaced in dashboard (not notification spam):

- **"Add knowledge" prompts** — "Leads keep asking about [X]. Want to add an answer?" → one-click opens knowledge editor pre-filled with the question
- **"Conversation review" flags** — "This conversation booked after handling a price objection well. Worth reviewing?" → link to conversation
- Knowledge completeness trends over time

### Boundaries

- Not autonomous learning — Alex does not change its own behavior
- Not A/B testing — no automated experimentation
- Not real-time — pattern detection runs on batches
- Insights are suggestions, operator decides

### Where This Lives

- Outcome tagging: extension to existing conversation/conversion tracking in `packages/core`
- Pattern detection: new module in `packages/core`, triggered by scheduler (Inngest or cron)
- Operator surface: new dashboard section in `apps/dashboard`

## Section 4: Alex Skill Body Adaptation

### New Parameter

`MARKET_PROFILE` — injected by the Alex builder from deployment's market × category config.

### Voice Section

Hardcoded "Singapore English" section becomes a template reference:

```markdown
## Local Voice

{{MARKET_PROFILE}}

Match the voice patterns above. Adapt formality to lead's tone but never drop below the configured level.
```

### Conversation Phase Changes

1. **Respond** — warmup length from `{{MARKET_PROFILE.warmupLength}}`. SG: 1 message then qualify. MY: 2 messages, build rapport first.
2. **Qualify** — unchanged logic. Per-service `bookingBehavior` awareness added: if service is `consultation_only`, Alex qualifies toward a consultation booking, not the treatment.
3. **Convert** — objection style from `{{MARKET_PROFILE.objectionStyle}}`. Pricing approach from `{{MARKET_PROFILE.pricingStyle}}` determines whether Alex leads with exact price or range.
4. **Book** — unchanged tool-calling protocol. After confirmation, surface `prepInstructions` from BusinessFacts if available.

### What Does NOT Change

- 4-phase flow structure
- Tool set (crm-query, crm-write, calendar-book, escalate)
- Governance constraints
- Context requirements (playbook, policy, business-facts, qualification)
- Bucket A/B/C operating boundaries

## Section 5: BusinessFacts Schema Extension

### Extended Service Fields

```typescript
ServiceSchema = z.object({
  // existing
  name: z.string(),
  description: z.string().optional(),
  durationMinutes: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),

  // new
  bookingBehavior: z.enum(["book_directly", "consultation_only", "ask_first"]).optional(),
  prepInstructions: z.string().optional(),
  aftercareNotes: z.string().optional(),
  idealFor: z.string().optional(),
  notSuitableFor: z.string().optional(),
  popularCombinations: z.array(z.string()).optional(),
  consultationRequired: z.boolean().optional(),
});
```

### Field Rationale

| Field                  | Why                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bookingBehavior`      | Alex needs to know whether to book directly or push toward consultation. Already in Playbook schema, surfaced per service. |
| `prepInstructions`     | #1 post-booking question. Reduces anxiety and no-shows.                                                                    |
| `aftercareNotes`       | Common follow-up question. Keeps conversation in Bucket A.                                                                 |
| `idealFor`             | Lets Alex match lead's concern to right service without improvising.                                                       |
| `notSuitableFor`       | Enables Bucket C escalation when lead mentions a flag.                                                                     |
| `popularCombinations`  | Natural upsell grounded in operator-approved data.                                                                         |
| `consultationRequired` | Hard gate — Alex never books directly for these services.                                                                  |

### Constraints

- All new fields are optional. Alex works without them.
- Knowledge completeness indicator shows which services have thin vs rich profiles.
- No structured medical/clinical fields. Operator owns free-text content in `aftercareNotes` and `notSuitableFor`. Alex never generates medical claims from structured data.

## Phasing

### Phase 1 — Foundation (everything else depends on this)

- `MarketProfile` schema in `packages/schemas` + SG/MY med-spa seed profiles
- `BusinessFacts` schema extension (new service fields)
- Alex builder loads and injects market profile
- `alex.md` refactored: `{{MARKET_PROFILE}}` replaces hardcoded SG English
- Knowledge onboarding extraction pipeline (URL/text → draft BusinessFacts)

### Phase 2 — Onboarding UX (unblocks real businesses)

- Gap-fill form in dashboard (pre-filled from extraction, gaps highlighted)
- Knowledge completeness indicator
- Operator can edit/add knowledge anytime, live on next conversation

### Phase 3 — Feedback Loop (compounds value over time)

- Conversation outcome tagging
- Stalled conversation detection (scheduled check)
- Pattern detection module
- Operator insight surface in dashboard

### Sequencing Rationale

- Phase 1 makes Alex good for med spa SG/MY — this is the wedge
- Phase 2 makes onboarding possible without hand-holding — unblocks real businesses
- Phase 3 makes Alex improve over time per business — this is the moat
- Each phase is independently shippable
- Phase 3 can start outcome tagging early (Phase 1) even if pattern detection ships later

### Out of Scope

- Additional markets beyond SG/MY
- Additional verticals beyond med spa (architecture supports them, not pre-built)
- Autonomous learning (Alex changing its own behavior)
- A/B testing conversation strategies
