# Alex Three-Bucket Routing — Design Spec

**Date:** 2026-04-19
**Status:** Approved
**Scope:** Single-agent routing model for Alex with structured business knowledge and wired escalation

---

## Problem

Alex currently operates as a single conversational agent but lacks:

1. **Structured business knowledge** — Bucket B answers (hours, pricing, policies) rely on raw RAG chunks with no operator-managed structured input and no confidence gate. Alex can improvise answers from ungrounded context.
2. **Wired escalation** — Bucket C triggers are prompt-only instructions. No tool call creates a `HandoffPackage` or notifies the `HandoffNotifier`. Escalation is cosmetic.
3. **Explicit routing boundaries** — No formal classification of what Alex handles directly vs. answers from knowledge vs. escalates. The LLM decides implicitly.

Additionally, `pipeline-handoff` tool points toward visible multi-agent handoffs (speed-to-lead / sales-closer / nurture-specialist), which contradicts the single-agent model.

## Design Principle

**One visible agent. Three internal behaviors.**

The customer always talks to Alex. Under the hood:

| Bucket          | Scope                                                                          | Behavior                                                       | Source of truth                                                  |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| **A: Handle**   | Booking wedge — slots, confirmation, service basics, simple FAQ                | Alex answers directly using tools                              | Skill prompt + tools (calendar-book, crm-query, crm-write)       |
| **B: Grounded** | Business facts — pricing, hours, policies, prep, parking, eligibility          | Answer ONLY from retrieved structured knowledge                | `BusinessFacts` store (operator-managed via dashboard)           |
| **C: Escalate** | Complaints, refunds, exceptions, high-risk, angry customers, missing knowledge | Create `HandoffPackage`, notify human, bridge conversationally | `HandoffStore` + `HandoffNotifier` (already built, needs wiring) |

**Key rule:** If Alex cannot ground a Bucket B answer in operator-approved business facts, it becomes Bucket C. No hallucinated fallback. No "probably" answers.

**Knowledge boundary:**

- `BUSINESS_FACTS` = authoritative source for operational facts (hours, pricing, policies, services)
- `PLAYBOOK_CONTEXT` / unstructured context = persuasion and process guidance only (objection handling, qualification frameworks)
- Never use unstructured context to answer factual business questions

---

## Implementation Slices

### Slice 1: Bucket B — Business Facts (build first)

Makes Bucket B real: structured operator-managed facts, context injection, grounding rules, deployment gate.

Parts covered: 1 (Business Facts), 2 (Context Injection), 5.1 (context replacement), 5.2 (bucket guidance)

### Slice 2: Bucket C — Wired Escalation (build second)

Makes Bucket C operational: `escalate` tool, handoff wiring, `pipeline-handoff` retirement, acceptance tests.

Parts covered: 3 (Escalation), 4 (Retire pipeline-handoff)

---

## Part 1: Business Facts — Structured Knowledge Ingestion

### 1.1 Schema

Add `BusinessFactsSchema` to `packages/schemas/src/marketplace.ts`:

```typescript
export const BusinessFactsSchema = z.object({
  businessName: z.string(),
  timezone: z.string().default("Asia/Singapore"),
  locations: z
    .array(
      z.object({
        name: z.string(),
        address: z.string(),
        parkingNotes: z.string().optional(),
        accessNotes: z.string().optional(),
      }),
    )
    .min(1),
  openingHours: z.record(
    z.string(),
    z.object({
      open: z.string(), // "09:00"
      close: z.string(), // "18:00"
      closed: z.boolean().default(false),
    }),
  ),
  services: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        durationMinutes: z.number().optional(),
        price: z.string().optional(),
        currency: z.string().default("SGD"),
      }),
    )
    .min(1),
  bookingPolicies: z
    .object({
      cancellationPolicy: z.string().optional(),
      reschedulePolicy: z.string().optional(),
      noShowPolicy: z.string().optional(),
      advanceBookingDays: z.number().optional(),
      prepInstructions: z.string().optional(),
    })
    .optional(),
  escalationContact: z.object({
    name: z.string(),
    channel: z.enum(["whatsapp", "telegram", "email", "sms"]),
    address: z.string(),
  }),
  additionalFaqs: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
      }),
    )
    .default([]),
});

export type BusinessFacts = z.infer<typeof BusinessFactsSchema>;
```

v1 required fields: `businessName`, `timezone`, `locations` (min 1), `openingHours`, `services` (min 1), `escalationContact`. Everything else is optional. `additionalFaqs` is gravy — useful but not core.

### 1.2 Storage

The existing `BusinessConfig` Prisma model (stores JSON in `config` column, scoped by `organizationId`) is sufficient. `BusinessFacts` is stored as the `config` JSON. No new tables needed.

Add a typed accessor in `packages/db`:

```typescript
export interface BusinessFactsStore {
  get(organizationId: string): Promise<BusinessFacts | null>;
  upsert(organizationId: string, facts: BusinessFacts): Promise<void>;
}
```

### 1.3 Dashboard UI

Add a **Business Facts** section to the deploy wizard and as a standalone page accessible from the deployment detail view.

**Location in wizard flow:** After "Review profile" (review-scan), before "Review & customize" (review). The website scanner pre-fills fields where possible from `ScannedBusinessProfile`.

**Deployment gate:** Deployment is blocked if required business facts are missing. Alex must not go live in booking mode without operator-approved facts. The deploy button stays disabled with a message indicating which required sections are incomplete.

**Standalone page:** `apps/dashboard/src/app/(auth)/deployments/[id]/business-facts/page.tsx` — operator can edit facts post-deployment.

**Form sections:**

1. **Business Identity** — name, timezone
2. **Locations** — address, parking notes, access notes (repeatable)
3. **Opening Hours** — day-of-week grid with open/close times and closed toggle
4. **Services** — name, description, duration, price (repeatable)
5. **Booking Policies** — cancellation, reschedule, no-show, advance booking, prep instructions
6. **Escalation Contact** — name, channel, address
7. **Additional FAQs** — question/answer pairs (repeatable, optional)

All fields are validated client-side via Zod. Required fields are marked.

### 1.4 API Route

`apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts`:

- `GET` — returns current `BusinessFacts` for the deployment's organization
- `PUT` — validates via `BusinessFactsSchema`, upserts into `BusinessConfig`

### 1.5 Pre-fill from Website Scanner

The existing `ScannedBusinessProfile` already extracts `products`, `services`, `location`, `hours`, `faqs`. Map these into `BusinessFacts` fields during the wizard:

- `ScannedBusinessProfile.products` → `BusinessFacts.services`
- `ScannedBusinessProfile.location` → `BusinessFacts.locations[0]`
- `ScannedBusinessProfile.hours` → `BusinessFacts.openingHours`
- `ScannedBusinessProfile.faqs` → `BusinessFacts.additionalFaqs`

Operator reviews and approves — scanner output is a draft, not a source of truth.

---

## Part 2: Skill Context Injection

### 2.1 New Context Kind: `business-facts`

Add `"business-facts"` to the `KnowledgeKindSchema` enum in `packages/schemas/src/knowledge.ts`.

Add a new context requirement to Alex's skill definition:

```yaml
context:
  - kind: business-facts
    scope: operator-approved
    inject_as: BUSINESS_FACTS
    required: true
```

The `ContextResolverImpl` in `packages/core/src/skill-runtime/context-resolver.ts` currently resolves context by querying `KnowledgeEntryStore.findActive()` with kind/scope filters. For `business-facts`, it should instead load from `BusinessFactsStore.get(orgId)` and render the structured template. This is a new resolution path — the resolver dispatches on `kind === "business-facts"` before falling through to the default knowledge entry lookup.

**What happens if business facts are missing at runtime:** If `required: true` and `BusinessFactsStore.get()` returns null, the `ContextResolver` throws `ContextResolutionError`. This prevents Alex from executing without grounded facts. The deployment gate (1.3) should prevent this in practice, but the runtime enforces it as a safety net.

### 2.2 Structured Injection Format

The `BUSINESS_FACTS` variable renders as a clear, parseable block in the skill prompt:

```
## Business Facts (Operator-Approved — answer ONLY from these facts)

**Business:** {{businessName}}
**Timezone:** {{timezone}}

### Locations
{{#each locations}}
- {{name}}: {{address}}
  {{#if parkingNotes}}Parking: {{parkingNotes}}{{/if}}
  {{#if accessNotes}}Access: {{accessNotes}}{{/if}}
{{/each}}

### Opening Hours
{{#each openingHours}}
- {{@key}}: {{#if closed}}Closed{{else}}{{open}} - {{close}}{{/if}}
{{/each}}

### Services
{{#each services}}
- {{name}}: {{description}}
  {{#if durationMinutes}}Duration: {{durationMinutes}} min{{/if}}
  {{#if price}}Price: {{price}} {{currency}}{{/if}}
{{/each}}

### Booking Policies
{{#if bookingPolicies}}
{{#if bookingPolicies.cancellationPolicy}}Cancellation: {{bookingPolicies.cancellationPolicy}}{{/if}}
{{#if bookingPolicies.reschedulePolicy}}Reschedule: {{bookingPolicies.reschedulePolicy}}{{/if}}
{{#if bookingPolicies.prepInstructions}}Preparation: {{bookingPolicies.prepInstructions}}{{/if}}
{{/if}}

### Escalation Contact
{{escalationContact.name}} via {{escalationContact.channel}}: {{escalationContact.address}}

### Additional FAQs
{{#each additionalFaqs}}
Q: {{question}}
A: {{answer}}
{{/each}}
```

### 2.3 Prompt Update — Grounding Rule

Add to `skills/alex.md` after the `## Available Services` section (which gets replaced by `## Business Facts`):

```markdown
## Business Knowledge Rules

You have access to operator-approved business facts above. Follow these rules strictly:

1. **If the customer asks about hours, pricing, services, policies, parking, prep, or any business fact:**
   - Answer ONLY from the Business Facts section above
   - If the answer is not in the Business Facts, do NOT guess or improvise
   - Instead, say: "I'm not certain about that detail. Let me get a team member to confirm for you."
   - Then call the `escalate` tool to create a handoff

2. **Never say "probably", "I think", or "usually" about business facts.**
   A wrong answer about pricing or policy is worse than a polite escalation.

3. **Safe conversational bridges are allowed:**
   - "I'm not sure about that detail."
   - "A team member can confirm that for you."
   - "I can still help you find a booking slot in the meantime."
     These are NOT factual claims. They are safe transitions.
```

---

## Part 3: Wired Escalation (Bucket C)

### 3.1 New Skill Tool: `escalate`

Add `packages/core/src/skill-runtime/tools/escalate.ts`:

```typescript
export function createEscalateTool(): SkillTool {
  return {
    id: "escalate",
    operations: {
      "handoff.create": {
        description:
          "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, or when the customer is frustrated.",
        governanceTier: "write",
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "human_requested",
                "missing_knowledge",
                "complex_objection",
                "negative_sentiment",
                "compliance_concern",
                "booking_failure",
                "max_turns_exceeded",
              ],
            },
            summary: {
              type: "string",
              description: "Brief summary of why escalation is needed and what the customer wants",
            },
            customerSentiment: {
              type: "string",
              enum: ["positive", "neutral", "frustrated", "angry"],
            },
          },
          required: ["reason", "summary"],
        },
        execute: async (params) => {
          // Implementation builds HandoffPackage from:
          // - params (reason, summary, sentiment)
          // - skill execution context (sessionId, orgId, lead snapshot)
          // Calls HandoffStore.save() + HandoffNotifier.notify()
          // Returns { handoffId, status: "pending" }
        },
      },
    },
  };
}
```

**Duplicate protection:** Even though `idempotent: false` in metadata, the implementation must guard against duplicate handoffs for the same session. Before creating a new `HandoffPackage`, check `HandoffStore.getBySessionId(sessionId)` — if a pending handoff already exists for this session, return its ID instead of creating another. This prevents the LLM from escalating the same conversation multiple times in a single exchange.

### 3.2 Add `missing_knowledge` to HandoffReason

Update `packages/core/src/handoff/types.ts`:

```typescript
export type HandoffReason =
  | "human_requested"
  | "max_turns_exceeded"
  | "complex_objection"
  | "negative_sentiment"
  | "compliance_concern"
  | "booking_failure"
  | "escalation_timeout"
  | "missing_knowledge"; // NEW
```

### 3.3 Wire `escalate` Tool into Alex Skill

Update `skills/alex.md` frontmatter:

```yaml
tools:
  - crm-query
  - crm-write
  - calendar-book
  - escalate # NEW
```

Update the escalation section to reference the tool:

```markdown
## Escalation

When escalating:

1. Call `escalate.handoff.create` with the reason and a brief summary
2. Say: "Let me get someone from the team to help with this. They'll reach out shortly."
3. Do NOT continue trying to answer the question after escalating
```

### 3.4 Escalation Notification

The `HandoffNotifier` already formats messages and sends via `ApprovalNotifier`. The `escalate` tool's `execute` function wires it:

1. Build `LeadSnapshot` from skill execution context (lead profile, channel)
2. Build `ConversationSummary` from the LLM's tool call params (summary, sentiment) plus turn count from executor state
3. Set `slaDeadlineAt` based on org settings (default: 30 minutes)
4. Check `HandoffStore.getBySessionId()` for existing pending handoff (duplicate guard)
5. Call `HandoffStore.save()` to persist
6. Call `HandoffNotifier.notify()` to alert the team

---

## Part 4: Retire `pipeline-handoff` Tool

The `pipeline-handoff` tool maps opportunity stages to visible agent roles. This contradicts the single-agent model.

**Action:** Remove from skill tool registry. The dormancy detection logic (hours since last reply → nurture) is useful but belongs in a background job or CRM automation, not in a customer-facing tool call. Extract the timing logic into a note in the codebase or a follow-up task before deleting.

- Delete `packages/core/src/skill-runtime/tools/pipeline-handoff.ts`
- Remove from tool index `packages/core/src/skill-runtime/tools/index.ts`
- Remove any tests

---

## Part 5: Alex Skill Prompt Refinements

### 5.1 Replace `KNOWLEDGE_CONTEXT` with `BUSINESS_FACTS`

`BUSINESS_FACTS` (structured, operator-approved) replaces `KNOWLEDGE_CONTEXT` for answerable business facts. `KNOWLEDGE_CONTEXT` was RAG-based and unstructured — not appropriate for factual business questions.

Unstructured context (`PLAYBOOK_CONTEXT`, `QUALIFICATION_CONTEXT`, `POLICY_CONTEXT`) remains for persuasion and process guidance. This is NOT "all knowledge should become structured." Only operational facts that a wrong answer could damage trust need the structured path.

Update context block in `skills/alex.md`:

```yaml
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: POLICY_CONTEXT
  - kind: business-facts
    scope: operator-approved
    inject_as: BUSINESS_FACTS
    required: true
  - kind: playbook
    scope: qualification-framework
    inject_as: QUALIFICATION_CONTEXT
```

Remove the old `knowledge` context entry (`kind: knowledge, scope: offer-catalog`).

### 5.2 Bucket Classification Guidance

Add to the Alex skill prompt (before Conversation Flow):

```markdown
## Operating Boundaries

You operate in three modes. The customer should never notice these — it's all one conversation.

**Bucket A — You handle directly:**

- Booking flow (finding slots, confirming appointments)
- Service basics mentioned in Business Facts
- Simple FAQ from the Additional FAQs section
- Qualifying the lead through conversation

**Bucket B — Answer only from Business Facts:**

- Hours, pricing, parking, prep instructions, policies, eligibility
- If the fact exists in Business Facts, answer it
- If the fact is NOT in Business Facts, escalate (Bucket C)
- Never improvise, guess, or say "probably"

**Bucket C — Escalate to human:**

- Missing business knowledge (fact not in Business Facts)
- Complaints, refunds, exceptions
- Angry or frustrated customers
- Custom packages or pricing exceptions
- Medical/service questions beyond basic info
- Anything you're not confident about

When in doubt, escalate. A polite handoff is always better than a wrong answer.
```

---

## What This Design Does NOT Include

- **Structured file upload (Phase 2)** — later, once schema is stable
- **Conversational onboarding (Phase 3)** — later, writes into same structured schema
- **Multi-agent internal routing** — not needed for launch. Alex + tools + knowledge + escalation is sufficient.
- **Dashboard handoff management UI** — operators see handoffs via existing notification channels for now. Dashboard queue can come later.
- **Knowledge gap analytics** — tracking which questions trigger `missing_knowledge` escalations to help operators fill gaps. Valuable but post-launch.

---

## File Impact Summary

| File                                                                                        | Change                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/schemas/src/marketplace.ts`                                                       | Add `BusinessFactsSchema`                                                    |
| `packages/schemas/src/knowledge.ts`                                                         | Add `"business-facts"` to `KnowledgeKindSchema` enum                         |
| `packages/db/src/stores/`                                                                   | Add `BusinessFactsStore` implementation                                      |
| `packages/core/src/skill-runtime/tools/escalate.ts`                                         | New `escalate` tool                                                          |
| `packages/core/src/skill-runtime/tools/index.ts`                                            | Register `escalate`, remove `pipeline-handoff`                               |
| `packages/core/src/skill-runtime/tools/pipeline-handoff.ts`                                 | Delete                                                                       |
| `packages/core/src/handoff/types.ts`                                                        | Add `missing_knowledge` reason                                               |
| `packages/core/src/skill-runtime/context-resolver.ts`                                       | Handle `business-facts` context kind                                         |
| `skills/alex.md`                                                                            | Add `escalate` tool, `BUSINESS_FACTS` context, bucket rules, grounding rules |
| `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts` | New API route                                                                |
| `apps/dashboard/src/app/(auth)/deployments/[id]/business-facts/page.tsx`                    | New dashboard page                                                           |
| `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx`                      | Add business facts step                                                      |
| `apps/dashboard/src/components/marketplace/business-facts-form.tsx`                         | New form component                                                           |

---

## Testing Requirements

- `BusinessFactsSchema` validation: required fields, defaults, edge cases
- `BusinessFactsStore`: CRUD operations
- `escalate` tool: creates `HandoffPackage`, calls `HandoffNotifier`, duplicate guard
- Dashboard: form validation, pre-fill from scanner, save/load round-trip, deployment gate
- Integration: end-to-end flow from customer question → missing knowledge → escalation → handoff notification

### Named Acceptance Test (highest-value)

**"Missing knowledge triggers escalation, not improvisation":**

Customer asks a business-fact question (e.g., "Do you have parking?") where the operator has NOT populated parking notes in Business Facts. Alex must:

1. NOT answer with a guess or "probably"
2. Say a safe conversational bridge ("I'm not certain about that detail...")
3. Call `escalate.handoff.create` with reason `missing_knowledge`
4. A `HandoffPackage` is created and `HandoffNotifier` fires

This is the behavior that makes or breaks trust. It must be an explicit, named test — not an implicit side-effect of other test coverage.
