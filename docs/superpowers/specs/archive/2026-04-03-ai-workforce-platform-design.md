# Switchboard — AI Workforce Platform Design

**Date**: 2026-04-03
**Status**: Draft
**Supersedes**: `2026-03-20-switchboard-product-vision-design.md` (multi-vertical SMB platform)

---

## 1. What This Document Covers

Switchboard is evolving from a multi-vertical SMB operations platform into an AI Workforce Platform — a system where businesses hire AI employees from a catalog, each with a role, personality, memory, and governance guardrails.

This spec covers:

- The Employee SDK and how it relates to the existing cartridge/agent architecture
- The memory and learning layer
- The first AI employee (Creative)
- Migration strategy from the current codebase
- What stays, what goes, and what remains undecided

It does not cover: pricing, billing infrastructure, marketplace mechanics, or employees beyond the Creative. Those are future specs.

---

## 2. Why the Pivot

The current platform (5 cartridges targeting clinic/gym/commerce verticals) has strong infrastructure but no revenue validation. The governance spine, event loop, knowledge pipeline, and multi-channel chat adapters are production-grade. The domain logic on top of them is not validated by paying customers.

The AI Workforce Platform repositions the same infrastructure around a different value proposition: businesses hire AI employees that learn, improve, and operate autonomously within policy guardrails. The governance layer — which is unusual in the agent framework space — becomes the trust differentiator rather than a compliance checkbox.

The first employee is an **AI Creative** — a content strategist and producer that learns a business's brand voice and improves over time. Creative work was chosen because it has high demand across verticals, low trust barrier (review before publish), clear cost displacement ($3-8K/mo freelancer or agency), and a natural feedback loop (approved vs. rejected content, engagement metrics).

---

## 3. Architectural Approach: Unified SDK, Split Runtime

### The Problem

The current architecture separates two concerns:

- **Cartridges** execute governance-gated actions against external services. They implement the `Cartridge` interface from `cartridge-sdk`.
- **Agents** handle events with LLM intelligence and propose actions. They implement `AgentPort` + `AgentHandler` from `packages/agents`.

An "AI employee" is conceptually both — it thinks and it acts. But the separation between "governance-gated action execution" and "event-driven LLM reasoning" is architecturally valuable. The policy engine, risk scoring, approval flows, and competence tracking all depend on the action boundary being clean and inspectable.

### The Solution

The `employee-sdk` exposes a single `defineEmployee()` function. Developers write one definition file. The SDK compiles it into the two runtime primitives the existing infrastructure expects:

```
defineEmployee(config)
  |
  +---> AgentPort + AgentHandler     (event handling, LLM reasoning)
  |       feeds into EventLoop, AgentRouter, PolicyBridge
  |
  +---> CartridgeManifest + Cartridge (action definitions, execution)
  |       feeds into PolicyEngine, LifecycleOrchestrator, CompetenceTracker
  |
  +---> PersonalitySpec              (system prompt generation)
  |       injected into LLM calls via EmployeeContext
  |
  +---> ConnectionContract[]         (credential requirements)
  |       feeds into existing credential resolution
  |
  +---> Default policies + guardrails
          seeded into PolicyStore on registration
```

This means:

- The governance pipeline runs unchanged. Actions still flow through the 9-step policy evaluation.
- The event loop runs unchanged. Events still route through AgentRouter with policy gating.
- CompetenceTracker still works. It tracks per-employee, per-action performance with the same scoring and promotion/demotion thresholds.
- Third-party developers see one interface. The split is an implementation detail they never encounter.

### What the Interface Looks Like

```typescript
import { defineEmployee } from "@switchboard/employee-sdk";

export default defineEmployee({
  id: "creative",
  name: "AI Creative",
  version: "1.0.0",
  description: "Content strategist and creator that learns your brand voice",

  personality: {
    role: "You are a creative strategist and content producer.",
    tone: "professional-creative",
    traits: ["proactive", "brand-aware", "data-informed"],
  },

  // Event subscriptions (compiles to AgentPort.inboundEvents)
  inboundEvents: [
    "content.requested",
    "content.feedback_received",
    "content.performance_updated",
    "employee.onboarded",
  ],

  // Events this employee can emit (compiles to AgentPort.outboundEvents)
  outboundEvents: ["content.draft_ready", "content.published", "content.calendar_updated"],

  // Governance-gated actions (compiles to CartridgeManifest.actions)
  actions: [
    {
      type: "creative.content.draft",
      description: "Draft content for a channel and format",
      riskCategory: "low",
      reversible: true,
      parameters: ContentDraftParamsSchema,
    },
    {
      type: "creative.content.publish",
      description: "Publish approved content to a channel",
      riskCategory: "medium",
      reversible: false,
      parameters: ContentPublishParamsSchema,
    },
    // ... more actions
  ],

  // Event handler (compiles to AgentHandler.handle)
  async handle(event, context) {
    // context.memory  — brand knowledge, learned skills, performance history
    // context.knowledge — RAG retrieval (existing KnowledgeStore)
    // context.llm — LLM adapter (existing)
    // context.actions — propose governance-gated actions
    // context.emit — emit events to other employees
    // context.learn — persist a learned pattern
  },

  // Action executor (compiles to Cartridge.execute)
  async execute(actionType, params, context) {
    // Returns ExecuteResult (success, summary, undo recipe)
  },

  connections: [{ service: "openai", purpose: "Content generation", required: true }],

  guardrails: {
    rateLimits: [{ actionPattern: "creative.content.publish", maxPerHour: 10 }],
    cooldowns: [{ actionPattern: "creative.content.publish", seconds: 300 }],
  },

  policies: [
    { action: "creative.content.publish", effect: "require_approval" },
    { action: "creative.content.draft", effect: "allow" },
  ],
});
```

### Compilation Layer

The compilation layer is the bridge between the `defineEmployee()` interface and the two runtime primitives. This section specifies the concrete type mappings and runtime construction.

#### Type Placement

The existing `AgentPort`, `AgentHandler`, and `AgentContext` types currently live in `packages/agents/src/ports.ts`. The `Cartridge` interface and `CartridgeManifest` live in `packages/cartridge-sdk/src/cartridge.ts`. For `employee-sdk` (Layer 2) to compile down to these types without depending on Layer 3+ packages, the shared interface types need to move:

- `AgentPort`, `AgentHandler`, `AgentContext`, `AgentResponse` → move to `packages/schemas/src/agent-types.ts` (Layer 1)
- `Cartridge`, `CartridgeManifest`, `ActionDefinition`, `ExecuteResult` → move to `packages/schemas/src/cartridge-types.ts` (Layer 1)
- `RoutedEventEnvelope`, canonical event types → move to `packages/schemas/src/event-types.ts` (Layer 1)

This is a file move + re-export, not a rewrite. The existing packages can re-export from schemas for backwards compatibility during migration.

#### Handler Return Type Mapping

The `handle()` function in `defineEmployee()` returns a simplified shape. The SDK's compilation layer maps it to `AgentResponse`:

```typescript
// What the employee developer writes:
interface EmployeeHandlerResult {
  actions: Array<{ type: string; params: Record<string, unknown> }>;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
}

// What the compilation layer produces for the runtime:
function compileHandler(result: EmployeeHandlerResult, event: RoutedEventEnvelope): AgentResponse {
  return {
    events: result.events.map((e) =>
      createEventEnvelope({
        type: e.type,
        payload: e.payload,
        correlationId: event.correlationId,
        causationId: event.id,
      }),
    ),
    actions: result.actions.map((a) => ({
      type: a.type,
      parameters: a.params,
    })),
    state: undefined, // managed internally by the SDK via context.memory
    threadUpdate: undefined, // managed internally by the SDK via context
  };
}
```

The `state` and `threadUpdate` fields on `AgentResponse` are managed by the SDK's context wrapper, not by the employee developer. If the employee calls `context.learn()` or `context.memory.brand.update()`, those mutations are collected and written to state/thread by the compilation wrapper after the handler returns.

#### EmployeeContext Construction

At runtime, when the event loop dispatches to a compiled employee handler, the SDK constructs an `EmployeeContext` from the existing `AgentContext` plus injected services:

```typescript
interface EmployeeContext {
  // Composed from existing AgentContext fields
  organizationId: string;
  contactData: ContactData;

  // Wraps existing KnowledgeRetriever (scoped to this employee + org)
  knowledge: KnowledgeRetriever;

  // New: unified memory interface (brand, skills, performance)
  memory: EmployeeMemory;

  // Wraps existing LLMAdapter
  llm: LLMAdapter;

  // Wraps existing ActionExecutor (governance-gated)
  actions: { propose: (type: string, params: Record<string, unknown>) => Promise<ExecuteResult> };

  // Wraps event emission (collected, returned as AgentResponse.events)
  emit: (type: string, payload: Record<string, unknown>) => void;

  // New: persists a learned pattern to skill store
  learn: (skill: SkillInput) => Promise<void>;

  // New: compiled from defineEmployee personality config
  personality: { toPrompt: () => string };
}
```

The `EmployeeContext` is constructed by a factory function in the SDK that receives the raw `AgentContext` plus runtime service references (knowledge store, memory stores, LLM adapter) via dependency injection at registration time. This mirrors how `conversation-deps.ts` currently wires dependencies for the event loop.

#### Compilation Output

`defineEmployee(config)` returns a `CompiledEmployee` object:

```typescript
interface CompiledEmployee {
  port: AgentPort; // event subscriptions, capabilities
  handler: AgentHandler; // wrapped handle() with context bridging
  cartridge: Cartridge; // action manifest + execute() with governance hooks
  defaults: {
    policies: PolicyRule[];
    guardrails: GuardrailSet;
  };
  connections: ConnectionContract[];
}
```

The registration logic in `apps/api` destructures this and registers each part with its respective runtime system — handler with `HandlerRegistry`, cartridge with `CartridgeRegistry`, policies with `PolicyStore`.

### Open Questions

- **Does `defineEmployee()` need lifecycle hooks beyond `handle` and `execute`?** The current cartridge has `enrichContext`, `getRiskInput`, `resolveEntity`, `captureSnapshot`. Some of these could be auto-derived from the action definitions (e.g., `getRiskInput` from the `riskCategory` field). Others may need explicit hooks. Start with `handle` + `execute` and add hooks when a real employee needs them.
- **Interceptors** — the current system supports `CartridgeInterceptor` chains for cross-cutting concerns (HIPAA redaction, consent gates). The employee SDK should support these, but the first Creative employee likely doesn't need any. Defer the interceptor compilation story until the second employee.
- **`URGENT_EVENT_TYPES` in event-loop.ts** — currently hardcoded to ad-specific events (`ad.anomaly_detected`, `ad.performance_review`). This needs to become configurable or derived from employee definitions. Flag during implementation.

---

## 4. Memory and Learning Layer

The existing codebase has building blocks for memory:

- `KnowledgeStore` with pgvector for semantic search (per-org, per-agent scoped)
- `ConversationStore` with context persistence (objections, preferences, sentiment)
- `CompetenceTracker` for performance-based trust adjustment
- `IngestionPipeline` for chunking and embedding documents

The new memory layer extends these rather than replacing them. It introduces three scoped memory types, all accessed through a unified `EmployeeMemory` interface on the handler context.

### Dependency Structure

The `memory` package defines interfaces (ports) at its own layer. The Prisma-backed implementations live in `db` (which is one layer higher and can import `memory`). At runtime, the implementations are injected via dependency injection — the same ports-and-adapters pattern used throughout the codebase (e.g., `KnowledgeStore` interface in `core`, `PrismaKnowledgeStore` in `db`).

```
memory/src/
  interfaces.ts       — EmployeeMemory, BrandMemoryStore, SkillStore, PerformanceStore
  brand-memory.ts      — BrandMemory class (wraps KnowledgeStore, adds brand-specific retrieval)
  skill-retriever.ts   — Retrieves relevant skills for a task (uses SkillStore interface)
  performance-query.ts — Queries performance history (uses PerformanceStore interface)

db/src/stores/
  prisma-skill-store.ts        — implements SkillStore with EmployeeSkill Prisma model
  prisma-performance-store.ts  — implements PerformanceStore with EmployeePerformanceEvent model
```

Updated dependency layers reflecting this:

```
Layer 1: schemas         -> No @switchboard/* imports
Layer 2: employee-sdk    -> schemas only
Layer 3: core            -> schemas + employee-sdk
Layer 4: memory          -> schemas + core (defines interfaces, not implementations)
Layer 5: db              -> schemas + core + memory (implements memory interfaces)
Layer 6: employees/*     -> schemas + employee-sdk + core + memory (NEVER db/apps/other employees)
Layer 7: apps/*          -> May import anything, wires db implementations into memory interfaces
```

### Brand Memory

What the employee knows about the specific business it serves. Populated during onboarding (brand guidelines, past content examples, competitor URLs) and enriched continuously as the employee works.

Implementation: stored as knowledge chunks in the existing `KnowledgeStore` with a `source_type` of `brand`. This means it gets the same embedding, retrieval, and boosting infrastructure that already works. The retrieval boosting weights may need adjustment — brand knowledge should likely rank higher than generic document knowledge for the Creative employee.

### Skill Store

Reusable patterns the employee learns from successful task completions. This is the Hermes-inspired self-improvement loop.

When a task is completed successfully AND the output is approved by the human, the employee can extract a pattern:

- "LinkedIn posts with storytelling hooks get 2x engagement for this brand"
- "This brand prefers shorter paragraphs and avoids jargon"
- "Blog posts with data citations get approved on first draft 80% of the time"

Skills are versioned. If a newer approach consistently outperforms an older one, the skill evolves. Skills are injected into the LLM context during task execution, giving the employee learned heuristics it didn't have on day one.

Implementation: new `EmployeeSkill` Prisma model with fields for `employeeId`, `orgId`, `pattern` (text description), `evidence` (task IDs that validated it), `version`, `performanceScore`, `embedding` (for relevance matching). Retrieved via the same pgvector similarity search used for knowledge.

### Performance Memory

What worked and what didn't. Tracks:

- Approved vs. rejected outputs with the rejection reason
- Engagement metrics on published content (when connected to analytics)
- Time-to-approval trends
- Most-used formats and channels

This feeds into two systems:

1. The employee's own reasoning — "posts with questions get higher engagement" becomes context for future drafts
2. The existing `CompetenceTracker` — governing whether the employee can auto-execute actions or needs approval

Implementation: partially new (`EmployeePerformanceEvent` Prisma model), partially reusing `CompetenceRecord`.

### Open Questions

- **Skill extraction** — v1 uses explicit `context.learn()` calls in the handler (as shown in the Section 5 handler sketch). The employee developer decides when to extract a skill, not an automatic post-approval hook. Automatic extraction can be explored in v2 once we understand the quality of explicitly extracted skills. A dashboard view to audit learned skills is needed either way.
- **Cross-org skill sharing** — if the Creative employee learns "carousel posts outperform static images" across 5 clients, should that skill propagate to new clients? Probably yes for generic patterns, no for brand-specific ones. The boundary is fuzzy and deferred.
- **Memory limits** — how many skills can an employee accumulate before they start degrading LLM performance via context bloat? Likely need a relevance-gated retrieval approach (only inject top-K skills relevant to the current task) rather than dumping all skills into context. The existing knowledge retrieval with top-K and similarity thresholds handles this, but max context budget per memory type should be configurable.

---

## 5. The AI Creative Employee

### Capabilities at Launch

| Action                        | Risk   | Default Policy   | Description                                       |
| ----------------------------- | ------ | ---------------- | ------------------------------------------------- |
| `creative.content.draft`      | Low    | allow            | Generate content for any format and channel       |
| `creative.content.revise`     | Low    | allow            | Revise a draft based on feedback                  |
| `creative.calendar.plan`      | Low    | allow            | Propose a content calendar for a time period      |
| `creative.calendar.schedule`  | Low    | allow            | Add content to the calendar                       |
| `creative.content.publish`    | Medium | require_approval | Publish to a channel — human reviews first        |
| `creative.competitor.analyze` | Low    | allow            | Analyze competitor content for a topic or channel |
| `creative.performance.report` | Low    | allow            | Generate a performance summary                    |

The publish action defaults to `require_approval`. Over time, if the CompetenceTracker promotes the employee (score >= 80, >= 10 successes), the business owner can optionally allow auto-publish. This is an existing mechanism, not new code.

### Event Vocabulary

| Event                         | Emitted When                                                                                            | Consumed By                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `content.requested`           | Owner requests content via dashboard or chat                                                            | Creative employee                         |
| `content.draft_ready`         | Draft complete                                                                                          | Dashboard (approval queue)                |
| `content.approved`            | Owner approves via dashboard (emitted by `POST /api/employees/creative/drafts/:id/approve`)             | Creative employee (triggers publish)      |
| `content.rejected`            | Owner rejects via dashboard with feedback (emitted by `POST /api/employees/creative/drafts/:id/reject`) | Creative employee (revises, learns)       |
| `content.published`           | Content published to channel                                                                            | Performance tracking                      |
| `content.performance_updated` | Analytics data arrives                                                                                  | Creative employee (learns what worked)    |
| `employee.onboarded`          | Brand knowledge ingested                                                                                | Creative employee (begins proactive work) |

### Schema Locations

Employee-specific Zod schemas (e.g., `ContentDraftParamsSchema`, `ContentPublishParamsSchema`) live inside the employee definition itself — in `employees/creative/src/schemas.ts`. They are not added to the shared `packages/schemas` package.

The shared `packages/schemas` package gains only the employee-agnostic types moved from `packages/agents` and `packages/cartridge-sdk` (see Section 3, Type Placement): `AgentPort`, `AgentResponse`, `Cartridge`, `ExecuteResult`, `RoutedEventEnvelope`, etc. These are runtime interface types, not domain schemas.

### Content Formats (Initial)

- Social media posts (LinkedIn, Twitter/X, Instagram captions, Facebook)
- Email copy (newsletters, sequences, announcements)
- Blog post drafts (outlines + full drafts)
- Ad copy (headlines, descriptions, CTAs)
- Presentation outlines

Image generation, video scripting, and design assets are future scope. The first version is text-focused.

### Onboarding Flow

1. Owner provides: business name, industry, target audience description
2. Owner uploads (optional): brand guidelines doc, past content examples, competitor URLs
3. Employee ingests these into brand memory via existing IngestionPipeline
4. Employee generates a "brand voice sample" — a short piece of content for the owner to approve or correct
5. Corrections feed into performance memory as high-priority training signal
6. Employee begins proactive work: suggests a content calendar based on brand + industry

### How the Creative Employee Handles Events

Sketch of the handler logic (not final implementation):

```typescript
async handle(event, context) {
  switch (event.type) {
    case "content.requested": {
      const brandContext = await context.memory.brand.search(event.payload.topic);
      const skills = await context.memory.skills.getRelevant("content-creation", event.payload.format);
      const topPerformers = await context.memory.performance.getTop(event.payload.channel, 5);

      const draft = await context.llm.generate({
        system: context.personality.toPrompt(),
        context: [...brandContext, ...skills, ...topPerformers],
        prompt: buildContentBrief(event.payload),
      });

      return {
        actions: [{
          type: "creative.content.draft",
          params: { content: draft, channel: event.payload.channel, format: event.payload.format },
        }],
        events: [{ type: "content.draft_ready", payload: { draftId: generateId() } }],
      };
    }

    case "content.rejected": {
      // Learn from the rejection
      await context.learn({
        type: "rejection",
        input: event.payload.originalDraft,
        feedback: event.payload.reason,
        channel: event.payload.channel,
      });

      // Revise with the feedback
      const revised = await context.llm.generate({
        system: context.personality.toPrompt(),
        prompt: `Revise this draft based on feedback: "${event.payload.reason}"\n\nOriginal:\n${event.payload.originalDraft}`,
      });

      return {
        actions: [{
          type: "creative.content.revise",
          params: { content: revised, originalDraftId: event.payload.draftId },
        }],
        events: [{ type: "content.draft_ready", payload: { draftId: event.payload.draftId, revision: true } }],
      };
    }

    case "content.performance_updated": {
      // Analyze what worked and extract a skill if pattern emerges
      const insight = await context.llm.generate({
        prompt: `Given this performance data, what content pattern works for this brand? Return a JSON object with "pattern" (string) and "confidence" (0-1 number).\n${JSON.stringify(event.payload.metrics)}`,
        schema: PerformanceInsightSchema, // Zod schema — uses existing structured output
      });

      if (insight.parsed.confidence > 0.8) {
        await context.learn({ type: "performance_pattern", pattern: insight.parsed.pattern, evidence: event.payload.contentIds });
      }

      return { actions: [], events: [] };
    }
  }
}
```

---

## 6. Migration Strategy

### Guiding Principles

- **Don't break what works.** The governance spine, event loop, and knowledge pipeline are proven. Extend, don't rewrite.
- **Coexistence during migration.** Old cartridges don't need to run alongside new employees, but the infrastructure that powered them does. We're swapping the payload, not the pipeline.
- **Delete confidently.** Domain-specific code (med spa interceptors, ad platform connectors, ROAS optimizers) has no place in the new product. It should be removed cleanly, not left to rot behind feature flags.
- **Defer what's uncertain.** Marketplace, cross-org skill sharing, image generation — these are real features that shouldn't be designed yet. Build the first employee, learn from it, then spec the next thing.

### What Stays (Infrastructure)

| Component                         | Location                                                 | Change Required                                                                 |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Policy engine (9-step evaluation) | `packages/core/src/engine/policy-engine.ts`              | None                                                                            |
| LifecycleOrchestrator             | `packages/core/src/orchestrator/lifecycle.ts`            | None                                                                            |
| RuntimeOrchestrator interface     | `packages/core/src/orchestrator/runtime-orchestrator.ts` | None                                                                            |
| CompetenceTracker                 | `packages/core/src/competence/tracker.ts`                | None                                                                            |
| Storage interfaces                | `packages/core/src/storage/interfaces.ts`                | Extend with employee-specific stores                                            |
| EventLoop                         | `packages/agents/src/event-loop.ts`                      | Likely moves to core or employee-sdk                                            |
| AgentRouter                       | `packages/agents/src/router.ts`                          | Event type registry updated                                                     |
| HandlerRegistry                   | `packages/agents/src/handler-registry.ts`                | Register compiled employee handlers                                             |
| EscalationService                 | `packages/agents/src/escalation.ts`                      | None                                                                            |
| ScheduledRunner                   | `packages/agents/src/scheduled-runner.ts`                | None                                                                            |
| ActionExecutor                    | `packages/agents/src/action-executor.ts`                 | None                                                                            |
| PolicyBridge                      | `packages/agents/src/policy-bridge.ts`                   | None                                                                            |
| KnowledgeStore interface          | `packages/core/src/knowledge-store.ts`                   | None                                                                            |
| IngestionPipeline                 | `packages/agents/src/knowledge/`                         | None                                                                            |
| KnowledgeRetriever                | `packages/agents/src/knowledge/retrieval.ts`             | Boost weights may change                                                        |
| LLM adapter + model router        | `packages/core/src/llm-adapter.ts`, `model-router.ts`    | None                                                                            |
| Structured output                 | `packages/core/src/structured-output.ts`                 | None                                                                            |
| ConversationStore                 | `packages/core/src/conversation-store.ts`                | None                                                                            |
| Channel adapters                  | `apps/chat/src/adapters/`                                | None                                                                            |
| Multi-tenant webhook runtime      | `apps/chat/src/`                                         | None                                                                            |
| Rate limiter                      | `apps/api/src/plugins/rate-limiter.ts`                   | None                                                                            |
| Credential encryption             | `packages/db/`                                           | None                                                                            |
| Prisma governance models          | `packages/db/prisma/schema.prisma`                       | Keep: Principal, Policy, ActionEnvelope, ApprovalRecord, CompetenceRecord, etc. |

### What Goes (Domain Code)

| Component                    | Location                                         | Reason                                                                                                  |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 5 cartridge implementations  | `cartridges/`                                    | Domain-specific (med spa, ads, CRM, payments, revenue growth)                                           |
| 5 agent implementations      | `packages/agents/src/agents/`                    | Lead responder, sales closer, nurture, etc. — SMB-specific                                              |
| Skins                        | `skins/`                                         | Vertical deployment configs — employees are universal                                                   |
| Profiles                     | `profiles/`                                      | Per-business instance configs — replaced by DB-stored employee config                                   |
| Domain Prisma models         | `packages/db/prisma/schema.prisma`               | CrmContact, CrmDeal, CrmActivity, RevGrowth\*, CadenceInstance, RevenueAccount, AdsOperatorConfig, etc. |
| Domain API routes            | `apps/api/src/routes/`                           | CRM routes, revenue-growth routes, campaign routes, etc.                                                |
| SMB-specific dashboard pages | `apps/dashboard/src/`                            | Pipeline funnel, CRM views, performance tabs                                                            |
| Advisory systems             | Inside cartridges                                | Compliance advisors, engagement advisors, ROAS advisors                                                 |
| Interceptors                 | Inside cartridges                                | HIPAA redaction, consent gates, medical claim filter                                                    |
| Service registry mappings    | `packages/cartridge-sdk/src/service-registry.ts` | Maps Stripe/Meta Ads/CRM to cartridge IDs — needs new employee mappings                                 |
| Agent roles                  | `agent-roles/`                                   | Ad-operator manifest + defaults                                                                         |

### What's New

| Component                | Location                           | Purpose                                                                                      |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `employee-sdk` package   | `packages/employee-sdk/`           | `defineEmployee()`, builders, test harness, compilation logic                                |
| `memory` package         | `packages/memory/`                 | Brand memory, skill store, performance memory                                                |
| Creative employee        | `employees/creative/`              | First AI employee implementation                                                             |
| Employee Prisma models   | `packages/db/prisma/schema.prisma` | EmployeeRegistration, EmployeeSkill, EmployeePerformanceEvent, ContentDraft, ContentCalendar |
| Employee API routes      | `apps/api/src/routes/`             | Employee management, content review, skill auditing                                          |
| Workforce dashboard      | `apps/dashboard/src/`              | Hire employees, review drafts, view performance, audit skills                                |
| Employee onboarding flow | `apps/dashboard/src/`              | Brand upload, voice calibration, calendar setup                                              |

### Migration Order

This is a suggested phasing, not a rigid plan. The implementation plan (separate document) will refine this.

1. **Create `employee-sdk` with `defineEmployee()` and compilation logic.** This is the foundation. It should compile down to artifacts that the existing runtime can consume without modification.
2. **Create `memory` package.** Brand memory wraps existing KnowledgeStore. Skill store and performance memory are new Prisma models + retrieval logic.
3. **Build the Creative employee.** Uses employee-sdk. Validates the interface against a real use case.
4. **Evolve the DB schema.** Add new models, create a migration. Domain models can be dropped in a separate migration to keep the diff clean.
5. **Refactor API routes.** Remove domain-specific routes, add employee management and content review routes.
6. **Redesign dashboard.** Workforce management UI — hire, onboard, review, monitor.
7. **Remove old domain code.** Cartridges, skins, profiles, domain agents. This is the last step, not the first, so nothing breaks mid-migration.

### Dependency Layer Updates

```
Layer 1: schemas         -> No @switchboard/* imports
Layer 2: employee-sdk    -> schemas only
Layer 3: core            -> schemas + employee-sdk
Layer 4: memory          -> schemas + core
Layer 5: db              -> schemas + core + memory (implements memory interfaces; NEVER employees)
Layer 6: employees/*     -> schemas + employee-sdk + core + memory (NEVER db/apps/other employees)
Layer 7: apps/*          -> May import anything, wires db implementations into memory interfaces
```

### `packages/agents` Dissolution Plan

The `packages/agents` package currently contains both runtime infrastructure and domain-specific agent implementations. During migration, these are separated:

**Moves to `packages/core/src/runtime/`:**

- `event-loop.ts` — recursive event processing with depth limit, policy gating
- `router.ts` — resolves events to agent/webhook/connector destinations
- `handler-registry.ts` — maps agent IDs to handler instances
- `action-executor.ts` — dispatches actions with policy pre-check
- `policy-bridge.ts` — bridges delivery intents to governance engine
- `scheduled-runner.ts` — periodic trigger for scheduled agents
- `escalation.ts` — deduplication, durable record, notifications
- `registry.ts` — per-org agent entries with status and config
- `concurrency.ts` — contact-level mutex

**Moves to `packages/schemas/src/`:**

- `ports.ts` (type definitions only) — `AgentPort`, `AgentHandler`, `AgentContext`, `AgentResponse`, `LifecycleAdvancer`
- `events.ts` (type definitions only) — `RoutedEventEnvelope`, `createEventEnvelope` factory, event type constants

**Moves to `packages/memory/` or stays with knowledge in core:**

- `knowledge/retrieval.ts` — `KnowledgeRetriever`
- `knowledge/ingestion-pipeline.ts` — `IngestionPipeline`
- `knowledge/chunker.ts` — recursive text splitter

**Deleted (domain-specific):**

- `agents/lead-responder/` — SMB-specific
- `agents/sales-closer/` — SMB-specific
- `agents/nurture/` — SMB-specific
- `agents/revenue-tracker/` — SMB-specific
- `agents/ad-optimizer/` — SMB-specific
- `llm/` — Claude-specific LLM/embedding adapters → move to `packages/core/src/llm/` since core already owns the `LLMAdapter` interface and the Creative employee needs LLM access on day one

The existing `cartridge-sdk` package is not immediately deleted — `employee-sdk` may initially depend on it internally for the cartridge compilation target. Once the compilation layer stabilizes, the cartridge-sdk interfaces can be inlined into employee-sdk and the package removed.

---

## 7. Codebase Structure (End State)

```
packages/
  schemas/              Zod schemas and shared types (extended, not rewritten)
  employee-sdk/         defineEmployee(), compilation, builders, test harness
  core/                 Orchestrator, policy engine, event loop, routing, scheduling
  memory/               Brand memory, skill store, performance memory
  db/                   Prisma ORM, stores, credential encryption

employees/
  creative/             AI Creative employee (first)

apps/
  api/                  Fastify REST API — employee management, content review, governance
  chat/                 Multi-channel messaging — employees communicate through existing adapters
  dashboard/            Next.js workforce management UI
  mcp-server/           MCP server for LLM tool use
```

---

## 8. What This Spec Does Not Cover

These are real concerns that should be addressed in future specs, not here:

- **Billing and subscription management.** Per-employee pricing, usage metering, Stripe integration. The current payments cartridge is domain-specific and should not be repurposed without a separate design.
- **Employee marketplace.** Third-party employees, discovery, trust verification, revenue sharing. This needs the SDK to stabilize first.
- **Multi-org architecture.** The current system has multi-org primitives (`OrganizationConfig`, per-org agent registration) but they're lightly tested. A proper multi-tenant design is needed before scaling beyond a handful of customers.
- **Image and video generation.** The Creative employee starts text-only. Adding visual content generation is a meaningful scope expansion.
- **Cross-employee coordination.** Two employees handing off work (e.g., Creative drafts content, then a future Social Media Manager employee publishes it). The event bus supports this in principle, but the coordination patterns need design.
- **Analytics integrations.** Connecting to social media analytics APIs for the performance feedback loop. This is important for the learning layer but can start with manual performance input.
- **Compliance and data residency.** If customers are in regulated industries or specific geographies, data handling requirements may constrain the architecture. Not relevant for the beachhead market but will matter at scale.

---

## 9. Success Criteria

The design is validated when:

1. A Creative employee can be defined using `defineEmployee()` and registered into the runtime without modifying core or the event loop.
2. The employee can draft content, have it reviewed via the dashboard, learn from approvals/rejections, and measurably improve over time.
3. The governance pipeline handles Creative actions identically to how it handled cartridge actions — policy evaluation, risk scoring, approvals, audit trail.
4. A second employee type (e.g., Account Manager) can be built using the same SDK without touching infrastructure code.
5. The total codebase size decreases despite new functionality — removing domain code should outweigh the new employee/memory/SDK code.
