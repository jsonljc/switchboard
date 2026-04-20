# Thin Harness, Fat Skills — SP1: Proof Migration

**Date:** 2026-04-14
**Status:** Draft
**Governing sentence:** SP1 is not building the skill platform. SP1 is proving that one governed production agent can be migrated from hardcoded orchestration into a skill runtime without losing control, determinism, or quality.

---

## Problem

Switchboard's `packages/core/` contains ~70 files of domain logic (sales pipeline role prompts, creative production stages, ad optimizer rules, dialogue classifiers) that should not be in the orchestrator. This is the "fat harness" anti-pattern — domain judgment hardcoded in TypeScript, tightly coupled to core internals, unreachable by third-party developers, and unimproved by model upgrades.

## SP1 Goal

Prove that one built-in skill can replace one hardcoded agent path with equivalent behavior, while preserving governance and backward compatibility.

**Specifically:** migrate the sales pipeline agent (4 source files, 464 total lines including tests) from `packages/core/src/sales-pipeline/` into a markdown skill file executed by a minimal skill runtime, feature-flagged alongside the existing TypeScript path.

**SP1 is not:**

- A generalized skill platform
- A marketplace feature
- A tool ecosystem
- A broad migration framework

---

## What SP1 Delivers

### Must Have

| Deliverable                                 | Location                                     |
| ------------------------------------------- | -------------------------------------------- |
| `sales-pipeline.md`                         | `skills/`                                    |
| `skill-loader.ts`                           | `packages/core/src/skill-runtime/`           |
| `skill-executor.ts`                         | `packages/core/src/skill-runtime/`           |
| `skill-handler.ts`                          | `packages/core/src/skill-runtime/`           |
| `template-engine.ts`                        | `packages/core/src/skill-runtime/`           |
| `tool-calling-adapter.ts`                   | `packages/core/src/skill-runtime/`           |
| `pipeline-handoff` tool                     | `packages/core/src/skill-runtime/tools/`     |
| Minimal `crm-query` operations              | `packages/core/src/skill-runtime/tools/`     |
| Minimal `crm-write` operations              | `packages/core/src/skill-runtime/tools/`     |
| Feature flag for skill-based sales pipeline | `AgentDeployment.skillSlug`                  |
| Behavioral parity eval suite                | `packages/core/src/skill-runtime/__tests__/` |

### Explicitly NOT in SP1

- `skill-resolver.ts` beyond direct slug lookup
- Generalized `SkillToolRegistry` abstraction
- Version pinning semantics
- `AgentListing` model changes
- Marketplace-facing metadata
- Broad tool library / `packages/tools/` as a separate package
- Deletion of old `sales-pipeline/` code (deferred to cleanup PR after shadow mode passes)
- Skill composition (sub-skills)
- Community authoring assumptions
- Remote skill sources

---

## Skill File Format (Intentionally Incomplete)

For SP1, the skill format is deliberately minimal:

- Frontmatter with flat metadata
- Body with string interpolation only
- No nested skill composition
- No conditional metadata
- No advanced template expressions
- No skill inheritance/fork semantics

### `sales-pipeline.md`

```markdown
---
name: sales-pipeline
slug: sales-pipeline
version: 1.0.0
description: >
  Qualifies new leads, closes qualified leads, and re-engages dormant leads
  through a three-stage pipeline with automatic handoff between stages.
author: switchboard
parameters:
  - name: BUSINESS_NAME
    type: string
    required: true

  - name: PIPELINE_STAGE
    type: enum
    values: [interested, qualified, quoted, booked, showed, won, lost, nurturing]
    required: true

  - name: OPPORTUNITY_ID
    type: string
    required: true
    description: >
      Active opportunity UUID. Resolved by SkillHandler before execution.
      If no active opportunity exists, handler fails before LLM call.

  - name: LEAD_PROFILE
    type: object
    required: false

  - name: PERSONA_CONFIG
    type: object
    required: true
    schema:
      tone: { type: string, required: true }
      qualificationCriteria: { type: object, required: true }
      disqualificationCriteria: { type: object, required: true }
      escalationRules: { type: object, required: true }
      bookingLink: { type: string, required: false }
      customInstructions: { type: string, required: false }

tools:
  - crm-query
  - crm-write
  - pipeline-handoff
---

# Sales Pipeline Agent

You manage a three-stage sales pipeline for {{BUSINESS_NAME}}.

## Stage Routing

Based on {{PIPELINE_STAGE}}, you operate as one of three roles:

### When PIPELINE_STAGE is "interested": Speed-to-Lead

Your job: respond quickly, build rapport, qualify through natural conversation.

**Qualification framework:**
{{PERSONA_CONFIG.qualificationCriteria}}

**Disqualifiers:**
{{PERSONA_CONFIG.disqualificationCriteria}}

**Behavior:**

- Keep first message under 3 sentences: acknowledge inquiry, establish relevance,
  ask one open question.
- Never say "How can I help you?" — you already know why they reached out.
- Ask qualification questions naturally, not as a checklist.
- When all criteria are met, use tool `crm-write.stage.update` with the
  current OPPORTUNITY_ID to move to "qualified", then confirm qualification.
- When a hard disqualifier is detected, politely close.

**Escalation — hand off to the business owner when:**
{{PERSONA_CONFIG.escalationRules}}

- Lead explicitly asks to speak to a human
- Lead expresses frustration or anger
- Question is outside your knowledge scope
- Conversation reaches 15 messages without qualification outcome

### When PIPELINE_STAGE is "qualified", "quoted", "booked", or "showed": Sales Closer

Your job: close qualified leads. Never re-qualify — that work is done.

Your first message MUST reference something specific from the prior conversation.
Never re-ask questions already answered.

**Objection handling:**

- Price: reframe around value, mention payment options if available
- Timing: create urgency through value, not pressure
- Trust: share relevant proof points or guarantees
- Competitor: differentiate on strengths, never disparage
- "Need to think": suggest a specific next step with a timeline
- Anything else: escalate to the business owner

**Close after:**

- Successfully handling an objection
- Lead asks positive buying-signal questions (pricing, availability, next steps)
- Lead mentions a timeline that aligns with the offering

**Booking link:** {{PERSONA_CONFIG.bookingLink}}

**Escalation — hand off to the business owner when:**
{{PERSONA_CONFIG.escalationRules}}

- Lead explicitly asks for a human
- Objection is outside the categories above

### When PIPELINE_STAGE is "nurturing": Nurture Specialist

Your job: re-engage leads who have gone cold.

**Approach — vary across the cadence:**

1. Value reminder — highlight what they were interested in
2. New angle — present offering from a different perspective
3. Social proof — share a relevant success story
4. Soft check-in — ask if their situation has changed
5. Final touch — let them know you're here if needed

**Rules:**

- Reference prior conversation context. Never send generic messages.
- One follow-up per 24 hours maximum.
- If they re-engage with buying signals, use tool `crm-write.stage.update`
  to move to "qualified".
- If they re-engage but need more qualification (e.g., situation has changed
  significantly), use tool `crm-write.stage.update` to move to "interested".
- If they say stop/unsubscribe, stop immediately, use tool
  `crm-write.activity.log` to record opt-out.
- After final follow-up with no reply, stop outreach.

### When PIPELINE_STAGE is "won" or "lost": Terminal

Do not engage. The deal is closed. If the customer reaches out, acknowledge and
escalate to the business owner.

## Tone

{{PERSONA_CONFIG.tone}}
{{PERSONA_CONFIG.customInstructions}}
```

**Critical separation:** The skill body contains ZERO governance/safety rules. All mandatory rules (AI disclosure, opt-out enforcement, no fabrication, escalation guarantee, etc.) are injected by the executor as a separate system prompt section that skill authors cannot see or override. Skills define capability. The runtime defines authority.

### Tool Naming Convention

Each tool operation becomes one Anthropic tool definition. The name format is `{toolId}.{operationName}`:

- `crm-query.contact.get`
- `crm-write.stage.update`
- `crm-write.activity.log`
- `pipeline-handoff.determine`

The skill body's natural language references (e.g., "use tool `crm-write.stage.update`") must match these names exactly. This is the contract between skill authors and the tool layer.

### Format Rules for SP1

**Frontmatter:**

- `name`, `slug`, `version`, `description`, `author` — required strings
- `parameters` — array of typed declarations. Object params must include a `schema` field for validation.
- `tools` — array of tool IDs (statically registered at bootstrap)

**Template engine rules (strict):**

- `{{FOO}}` → string substitution from `params.FOO`
- `{{FOO.bar}}` → dot-notation access into object params
- Missing required params → throw `SkillParameterError` (fail fast)
- Object values → serialize to deterministic YAML (sorted keys, no anchors)
- No `{{FOO.bar.baz}}` deep nesting in SP1 — max one level of dot access
- No array interpolation
- No conditional expressions
- Schema-validated object params before interpolation, not just type-labeled

**Anti-bloat rule (enforced, not advisory):** Any branch condition based on explicit state, time thresholds, counters, or fixed mappings must move to code. A skill must not encode deterministic state logic. If you catch yourself writing "if stage is X and last reply is older than Y hours then..." inside markdown, that belongs in a tool. This is a review gate: PRs adding deterministic branching to skill files are rejected.

---

## Skill Runtime (Minimal)

Five files in `packages/core/src/skill-runtime/`. No generalized abstractions — just enough to execute one skill.

### 1. Skill Loader (`skill-loader.ts`)

```typescript
interface SkillDefinition {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  parameters: ParameterDeclaration[];
  tools: string[];
  body: string;
}

interface ParameterDeclaration {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "object";
  required: boolean;
  description?: string;
  values?: string[]; // For enum type
  schema?: Record<string, unknown>; // For object type — validated before interpolation
}
```

**Responsibilities:**

- Parse frontmatter with a lightweight YAML parser. Note: `gray-matter` is a CJS package. If it does not work cleanly with ESM-only builds, use `yaml` (pure ESM) for parsing + manual frontmatter extraction (split on `---` delimiters). Test during implementation.
- Validate against a Zod schema (`SkillDefinitionSchema`)
- `loadSkill(slug: string, skillsDir: string): SkillDefinition` — that's it
- No caching, no hot reload, no directory watching in SP1

**Loader validation tests (brutal — skill files are executable business logic):**

| Test                                                               | Expected Behavior                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Malformed YAML frontmatter                                         | Throws `SkillParseError` with line number                                 |
| Missing required field (e.g., no `slug`)                           | Throws `SkillValidationError` listing missing fields                      |
| Unknown parameter type (e.g., `type: "map"`)                       | Throws `SkillValidationError`                                             |
| Enum parameter with no `values`                                    | Throws `SkillValidationError`                                             |
| Object parameter with no `schema`                                  | Throws `SkillValidationError`                                             |
| Duplicate parameter names                                          | Throws `SkillValidationError`                                             |
| Tool ID referenced in body but not declared in `tools` frontmatter | Throws `SkillValidationError` (regex scan for tool name patterns in body) |
| Unknown tool ID (not registered at bootstrap)                      | Throws at execution time, not load time (tools are runtime-resolved)      |
| Empty body (frontmatter only, no markdown)                         | Throws `SkillValidationError`                                             |
| Valid skill file                                                   | Returns `SkillDefinition` with correct types                              |

### 2. Skill Executor (`skill-executor.ts`)

The core of SP1. Executes a skill by interpolating parameters, injecting governance, calling the LLM with tools, and running the tool-call loop.

```typescript
interface SkillExecutor {
  execute(params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

interface SkillExecutionParams {
  skill: SkillDefinition;
  parameters: Record<string, unknown>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  deploymentId: string;
  orgId: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
}

interface ToolCallRecord {
  toolId: string;
  operation: string;
  params: unknown;
  result: unknown;
  durationMs: number;
}
```

**Execution flow:**

1. Validate all required parameters (type-check + schema-validate object params)
2. Interpolate `{{PARAM}}` templates in skill body
3. Build system prompt: `[interpolated skill body] + [executor-injected governance constraints]`
4. Convert registered tools to Anthropic tool definitions (name: `{toolId}.{operationName}`, input_schema from `SkillToolOperation.inputSchema`)
5. Call `ToolCallingAdapter` with system prompt, messages, and tool definitions
6. If LLM invokes a tool → execute deterministically → feed result back as `tool_result` message
7. Continue loop until `stop_reason = "end_turn"` or budget exceeded
8. Return response + tool call records + token usage

**Hard operational limits:**

- Maximum tool calls per execution: **5**
- Maximum LLM turns in tool loop: **6** (initial + 5 tool-result turns)
- Maximum prompt size: **64,000 tokens** (generous for SP1; the sales pipeline skill is ~200 lines of markdown + persona config + conversation history. This limit prevents runaway, not normal operation. Conversation windowing is a future optimization if needed.)
- Maximum runtime duration: **30 seconds**
- Hard failure when any limit exceeded — no soft degradation
- Full execution trace logged for every run (tool calls, LLM turns, governance decisions)

**Governance integration:**

The skill executor does NOT create `ActionProposal` objects for the skill execution itself. The existing governance pipeline is designed for cartridge actions with fields (`evidence`, `confidence`, `originatingMessageId`, `interpreterName`) that don't map to skill execution. Instead:

- The **outer call** to `SkillHandler.onMessage()` is governed by the existing `AgentRuntime` → `AgentHandler` flow, which already has trust-level-based governance.
- **Tool calls within the skill** are governed individually per this fixed policy table:

| Tool Operation               | Supervised           | Guided       | Autonomous   |
| ---------------------------- | -------------------- | ------------ | ------------ |
| `crm-query.contact.get`      | auto-approve         | auto-approve | auto-approve |
| `crm-query.activity.list`    | auto-approve         | auto-approve | auto-approve |
| `pipeline-handoff.determine` | auto-approve         | auto-approve | auto-approve |
| `crm-write.activity.log`     | auto-approve         | auto-approve | auto-approve |
| `crm-write.stage.update`     | **require approval** | auto-approve | auto-approve |

Only `crm-write.stage.update` requires approval, and only in supervised mode. This is the one tool that changes deal state. All read operations and activity logging are always auto-approved. This avoids the "6 approval prompts per message" problem.

- Full audit trail: every tool call is logged to the execution trace regardless of trust level.

**Governance constraints (injected by executor, not authored in skill):**

```typescript
const EXECUTOR_GOVERNANCE_CONSTRAINTS = `
MANDATORY RULES — Injected by runtime. Cannot be overridden.
- Never claim to be human. If asked directly, acknowledge you are an AI assistant.
- Never make financial promises, guarantees, or binding commitments.
- Never disparage competitors by name. Differentiate, don't disparage.
- Always offer human escalation when asked.
- Never share other customers' information, deals, or conversations.
- Respect opt-out immediately. If they say stop/unsubscribe/leave me alone, stop.
- Never fabricate statistics, case studies, or testimonials.
- Never pressure or manipulate. Create urgency through value, not fear.
`;
```

### 3. Skill Handler (`skill-handler.ts`)

The glue between the existing `AgentHandler` interface and the skill executor. Implements the SDK `AgentHandler` from `packages/sdk/src/handler.ts`.

```typescript
import type { AgentHandler } from "@switchboard/sdk";
import type { AgentContext } from "@switchboard/sdk";
import type { SkillExecutor } from "./skill-executor.js";
import type { SkillDefinition } from "./skill-loader.js";

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    // Map AgentContext → SkillExecutionParams
    const parameters = this.buildParameters(ctx);
    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = await this.executor.execute({
      skill: this.skill,
      parameters,
      messages,
      deploymentId: /* from ctx or config */,
      orgId: /* from ctx or config */,
      trustScore: ctx.trust.score,
      trustLevel: ctx.trust.level,
    });

    await ctx.chat.send(result.response);
  }

  private buildParameters(ctx: AgentContext): Record<string, unknown> {
    // Maps AgentContext fields to skill parameters (structured state only):
    // - BUSINESS_NAME ← ctx.persona.businessName
    // - PIPELINE_STAGE ← from resolved opportunity (see opportunity resolution rule)
    // - OPPORTUNITY_ID ← from resolved opportunity
    // - LEAD_PROFILE ← from ctx.state or contact record
    // - PERSONA_CONFIG ← mapped from ctx.persona (AgentPersona fields)
    // Note: conversation context is NOT a parameter — it flows via the messages array
    return { ... };
  }
}
```

**Parameter wiring — how existing data maps to skill parameters:**

Skill parameters carry structured state only. The conversation itself is passed via the `messages` array to the Anthropic API — not as a parameter. This avoids duplicate context, wasted tokens, and conflicting sources of truth.

| Skill Parameter  | Source                                                                 | Transformation                                                                                                          |
| ---------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `BUSINESS_NAME`  | `AgentPersona.businessName`                                            | Direct string                                                                                                           |
| `PIPELINE_STAGE` | `Opportunity.stage` via `PrismaOpportunityStore.findActiveByContact()` | Lookup by contactId, take most recent active opportunity's stage                                                        |
| `OPPORTUNITY_ID` | Same lookup as `PIPELINE_STAGE`                                        | The resolved opportunity's UUID                                                                                         |
| `LEAD_PROFILE`   | `PrismaContactStore.findById()`                                        | Contact record (name, phone, email, source, stage)                                                                      |
| `PERSONA_CONFIG` | `AgentPersona`                                                         | Map `tone`, `qualificationCriteria`, `disqualificationCriteria`, `escalationRules`, `bookingLink`, `customInstructions` |

**Opportunity resolution rule:** Skill execution for `sales-pipeline` requires a resolved active `opportunityId`. The `SkillHandler.buildParameters()` calls `PrismaOpportunityStore.findActiveByContact(orgId, contactId)`. If no active opportunity exists, the handler escalates to the business owner with a message explaining no active deal was found — the LLM is never called. If multiple active opportunities exist, take the most recently created one.

The `SkillHandler` fetches `PIPELINE_STAGE`, `OPPORTUNITY_ID`, and `LEAD_PROFILE` on every `onMessage` call. This is 2 DB queries per message — acceptable for SP1.

### 4. Tool-Calling Adapter (`tool-calling-adapter.ts`)

New adapter wrapping the Anthropic SDK for tool-use loops. The existing `LLMAdapter` interface (`generateReply → { reply, confidence }`) is untouched.

```typescript
interface ToolCallingAdapter {
  chatWithTools(params: {
    system: string;
    messages: Array<AnthropicMessage>;
    tools: AnthropicToolDefinition[];
    maxTokens?: number;
  }): Promise<{
    content: Array<TextBlock | ToolUseBlock>;
    stopReason: "end_turn" | "tool_use" | "max_tokens";
    usage: { inputTokens: number; outputTokens: number };
  }>;
}
```

**Implementation:** Thin wrapper around `new Anthropic().messages.create()` with the `tools` parameter. No retry logic, no caching — just the API call. The executor handles the loop.

### 5. Template Engine (`template-engine.ts`)

```typescript
function interpolate(
  template: string,
  params: Record<string, unknown>,
  declarations: ParameterDeclaration[],
): string;
```

**SP1 rules:**

- Validate all required params present before interpolation
- Schema-validate object params against their `schema` declaration
- `{{FOO}}` → string coercion of `params.FOO`
- `{{FOO.bar}}` → one level of dot access into object params
- Object values → deterministic YAML (sorted keys)
- Missing param → `SkillParameterError` (not silent "undefined")
- No deep nesting, no arrays, no conditionals

---

## Tools (Minimal Surface)

Tools live inside `packages/core/src/skill-runtime/tools/` for SP1 — not a separate package. This avoids layer placement complexity. They receive Prisma stores via dependency injection at bootstrap.

### Tool Interface

```typescript
interface SkillTool {
  id: string;
  operations: Record<string, SkillToolOperation>;
}

interface SkillToolOperation {
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema → maps to Anthropic input_schema
  execute(params: unknown): Promise<unknown>;
}
```

No plugin discovery, no dynamic loading, no marketplace concerns. Tools are stored in a simple `Map<string, SkillTool>` inside the executor. No generalized registry abstraction.

### Data Layer Mapping

The spec tools delegate to existing Prisma stores. Here is exactly which store and method each tool operation calls:

| Tool Operation               | Prisma Store                                                                     | Method                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `crm-query.contact.get`      | `PrismaContactStore` (`packages/db/src/stores/prisma-contact-store.ts`)          | `findById(orgId, contactId)`                                      |
| `crm-query.activity.list`    | `PrismaActivityLogStore` (`packages/db/src/stores/prisma-activity-log-store.ts`) | `listByDeployment(orgId, deploymentId)`                           |
| `crm-write.stage.update`     | `PrismaOpportunityStore` (`packages/db/src/stores/prisma-opportunity-store.ts`)  | `updateStage(orgId, opportunityId, stage)`                        |
| `crm-write.activity.log`     | `PrismaActivityLogStore`                                                         | `write({ organizationId, deploymentId, eventType, description })` |
| `pipeline-handoff.determine` | None — pure function                                                             | Inline logic extracted from `pipeline-orchestrator.ts`            |

**Note:** `crm-query.activity.list` uses `PrismaActivityLogStore.listByDeployment()` which takes `(orgId, deploymentId)`, not `contactId`. The tool's inputSchema should reflect this. `crm-write.stage.update` operates on opportunities, not contacts directly — it needs `opportunityId`, not `contactId`. The skill body and tool schemas are updated accordingly.

### `crm-query` (2 operations)

```typescript
// Constructed with injected stores at bootstrap
function createCrmQueryTool(
  contactStore: PrismaContactStore,
  activityStore: PrismaActivityLogStore,
): SkillTool {
  return {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get a contact by ID. Returns name, phone, email, stage, source.",
        inputSchema: {
          type: "object",
          properties: {
            contactId: { type: "string", description: "Contact UUID" },
            orgId: { type: "string", description: "Organization ID" },
          },
          required: ["contactId", "orgId"],
        },
        execute: async (params: { contactId: string; orgId: string }) =>
          contactStore.findById(params.orgId, params.contactId),
      },
      "activity.list": {
        description: "List recent activity logs for a deployment.",
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            deploymentId: { type: "string" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
          required: ["orgId", "deploymentId"],
        },
        execute: async (params: { orgId: string; deploymentId: string; limit?: number }) =>
          activityStore.listByDeployment(params.orgId, params.deploymentId, {
            limit: params.limit ?? 20,
          }),
      },
    },
  };
}
```

### `crm-write` (2 operations)

```typescript
function createCrmWriteTool(
  opportunityStore: PrismaOpportunityStore,
  activityStore: PrismaActivityLogStore,
): SkillTool {
  return {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update an opportunity's pipeline stage.",
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            opportunityId: { type: "string", description: "Opportunity UUID" },
            stage: {
              type: "string",
              enum: [
                "interested",
                "qualified",
                "quoted",
                "booked",
                "showed",
                "won",
                "lost",
                "nurturing",
              ],
            },
          },
          required: ["orgId", "opportunityId", "stage"],
        },
        execute: async (params: {
          orgId: string;
          opportunityId: string;
          stage: OpportunityStage;
        }) => opportunityStore.updateStage(params.orgId, params.opportunityId, params.stage),
      },
      "activity.log": {
        description: "Log an activity event.",
        inputSchema: {
          type: "object",
          properties: {
            organizationId: { type: "string" },
            deploymentId: { type: "string" },
            eventType: { type: "string", description: "e.g. opt-out, qualification, handoff" },
            description: { type: "string" },
          },
          required: ["organizationId", "deploymentId", "eventType", "description"],
        },
        execute: async (params: WriteActivityLogInput) => activityStore.write(params),
      },
    },
  };
}
```

### `pipeline-handoff` (1 operation)

Extracted from `pipeline-orchestrator.ts`. Pure deterministic logic — no LLM, no DB.

```typescript
const pipelineHandoffTool: SkillTool = {
  id: "pipeline-handoff",
  operations: {
    determine: {
      description:
        "Check if a lead should be handed off to a different pipeline agent based on current stage and time since last customer reply. Returns { action, toAgent?, reason? }.",
      inputSchema: {
        type: "object",
        properties: {
          opportunityStage: {
            type: "string",
            enum: [
              "interested",
              "qualified",
              "quoted",
              "booked",
              "showed",
              "won",
              "lost",
              "nurturing",
            ],
          },
          assignedAgent: {
            type: "string",
            enum: ["speed-to-lead", "sales-closer", "nurture-specialist"],
            description: "Current agent role handling this lead",
          },
          lastCustomerReplyAt: {
            type: ["string", "null"],
            description: "ISO 8601 timestamp of last customer reply, or null if never replied",
          },
          dormancyThresholdHours: {
            type: "number",
            description: "Hours of silence before entering nurture",
          },
        },
        required: ["opportunityStage", "assignedAgent", "dormancyThresholdHours"],
      },
      execute: async (params) => {
        // Identical logic to current determineHandoff():
        // 1. Terminal stages (won/lost) → { action: "none" }
        // 2. Dormancy check (hours since lastCustomerReplyAt > threshold) → { action: "go-dormant", toAgent: "nurture-specialist" }
        // 3. Stage-to-agent mapping (interested→speed-to-lead, qualified→sales-closer, nurturing→nurture-specialist) → handoff if mismatch
        // Note: messageCount is intentionally dropped — it was unused in the original function's output
      },
    },
  },
};
```

**Total tool operations: 5.** That's the entire tool surface for SP1.

---

## Integration: Feature-Flagged Deployment

### AgentDeployment Model Change

One field added:

```prisma
model AgentDeployment {
  // ... existing fields (including existing `slug String? @unique` which is the deployment's URL slug)
  skillSlug    String?    // NEW: when set, references a skill file by slug. Distinct from `slug` which is the deployment's own URL identifier.
}
```

No changes to `AgentListing`. No version pinning. No marketplace metadata.

### Runtime Routing

The routing decision happens at the level that constructs the `AgentRuntime`. When an `AgentDeployment` has `skillSlug` set, a `SkillHandler` is created instead of looking up a TypeScript `AgentHandler` from the handler registry.

```typescript
// In the deployment bootstrapper (apps/api or apps/chat bootstrap):
function createHandlerForDeployment(deployment: AgentDeployment): AgentHandler {
  if (deployment.skillSlug) {
    const skill = skillLoader.loadSkill(deployment.skillSlug, SKILLS_DIR);
    const executor = new SkillExecutor({ tools, toolCallingAdapter });
    return new SkillHandler(skill, executor);
  }
  // Legacy path — existing TypeScript handler lookup
  return handlerRegistry.get(deployment.listingId);
}

// The AgentRuntime is then constructed with the returned handler
const runtime = new AgentRuntime({
  handler: createHandlerForDeployment(deployment),
  // ... other config unchanged
});
```

The `AgentRuntime` class itself is not modified. The routing happens one level up.

### Rollout Plan

1. **Build** skill runtime + tools + eval suite
2. **Shadow mode** — for deployments with `skillSlug` set, run BOTH the skill path and the legacy path. Only the legacy path's output is sent to the user. The skill path's output is logged alongside the legacy output for comparison. No double CRM writes — the skill path runs with a read-only tool set (write operations are mocked and logged but not executed). Compare: stage routing, tool call intent, escalation triggers, governance decisions. Divergences logged to deployment activity log with `eventType: "skill-shadow-divergence"`.
3. **Feature flag** — once shadow mode shows <5% behavioral divergence, flip: `skillSlug` deployment uses skill path as the primary, legacy path disabled.

**Divergence scoring formula:** A single message-handling run is classified as **divergent** if ANY of the following differ between legacy and skill path output:

- Stage routing outcome (which agent role was activated)
- Escalation decision (escalated vs. not)
- Opt-out action (recorded vs. not)
- Terminal stage handling (engaged vs. refused)
- Tool call intent class (ordered list of tool operation names)

Divergence rate = (divergent runs / total runs) over a rolling 7-day window. The threshold is <5% divergence rate to flip primary. Wording differences, response length, and style variations are explicitly NOT counted as divergence. 4. **Eval pass** — behavioral parity eval suite passes 5. **Cleanup PR** — delete `core/src/sales-pipeline/` (separate PR, after shadow mode passes)

---

## Equivalence Definition

Before coding, define what "equivalent" means across explicit dimensions:

### Must Be Equivalent

| Dimension                    | How to Verify                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Stage routing**            | Same agent role activated for each `OpportunityStage` value                                                               |
| **Mandatory compliance**     | AI disclosure, opt-out, no fabrication — identical behavior                                                               |
| **Escalation triggers**      | Same conditions trigger handoff to business owner (15-msg cap, frustration, out-of-scope, explicit request, custom rules) |
| **Tool side effects**        | Same CRM writes (stage updates, activity logs) for same inputs                                                            |
| **Dormancy detection**       | Same handoff result from `pipeline-handoff.determine`                                                                     |
| **Conversational objective** | Same goal per stage (qualify, close, nurture)                                                                             |
| **Re-engagement routing**    | Nurture specialist routes buying signals → closer, needs-qualification → speed-to-lead                                    |
| **Governance wrapping**      | Trust-level-appropriate tool call governance                                                                              |

### Explicitly NOT Required to Be Equivalent

| Dimension          | Why                                          |
| ------------------ | -------------------------------------------- |
| Exact wording      | LLM output varies. Test behavior, not prose. |
| Sentence structure | Style may differ between model calls         |
| Response length    | Within reasonable bounds                     |
| Internal reasoning | Different path to same outcome is fine       |

---

## Behavioral Parity Eval Suite

A fixed corpus of test conversations. Each test asserts behavioral properties, not exact text. Tests use a `MockToolCallingAdapter` that returns scripted LLM responses for deterministic assertions.

### Test Cases

| #   | Scenario                                      | Key Assertions                                                                                          |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | New interested lead, first message            | Speed-to-Lead role activated. Response < 3 sentences. One open question asked. No "How can I help you?" |
| 2   | Lead answers qualification questions          | Qualification criteria checked naturally. No checklist format.                                          |
| 3   | Lead becomes qualified                        | `crm-write.stage.update` called with stage="qualified".                                                 |
| 4   | Qualified lead, price objection               | Sales Closer role. Reframes around value. Does not disparage competitors.                               |
| 5   | Qualified lead, references prior conversation | First message references something specific from history. No re-qualification.                          |
| 6   | Dormant lead, nurture message                 | Nurture Specialist role. References prior context. Not generic.                                         |
| 7   | Lead says "stop"                              | Immediate stop. `crm-write.activity.log` records opt-out. No further messages.                          |
| 8   | Lead asks to speak to a human                 | Escalation triggered. Offers human connection.                                                          |
| 9   | Won/lost stage                                | No engagement. Escalation to business owner.                                                            |
| 10  | Invalid parameter (missing BUSINESS_NAME)     | `SkillParameterError` thrown. No LLM call.                                                              |
| 11  | Tool loop budget exceeded                     | Hard failure after limit. Execution trace logged.                                                       |
| 12  | Dormancy-based handoff                        | `pipeline-handoff.determine` called with correct params. Returns `go-dormant` when hours exceeded.      |
| 13  | Lead expresses frustration (Speed-to-Lead)    | Escalation triggered. Not handled by qualification flow.                                                |
| 14  | 15 messages without qualification outcome     | Escalation triggered per Speed-to-Lead rules.                                                           |
| 15  | Nurture re-engagement, buying signals         | `crm-write.stage.update` to "qualified" (→ closer handoff).                                             |
| 16  | Nurture re-engagement, needs qualification    | `crm-write.stage.update` to "interested" (→ speed-to-lead handoff).                                     |

### Assertion Types

```typescript
type BehavioralAssertion =
  | {
      type: "tool_called";
      toolId: string;
      operation: string;
      paramsMatch?: Record<string, unknown>;
    }
  | { type: "tool_not_called"; toolId: string }
  | { type: "response_contains"; substring: string }
  | { type: "response_not_contains"; substring: string }
  | { type: "error_thrown"; errorType: string }
  | { type: "max_tokens_under"; limit: number };
```

Each test case is a JSON fixture with input parameters, conversation messages, expected tool call sequence, and an array of behavioral assertions.

### Migration Comparison Tests

In addition to behavioral assertions, each fixture is run through BOTH the legacy TypeScript path and the skill path. Structured outcomes are extracted and compared:

| Comparison Dimension  | How Extracted                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Stage routing         | Which agent role was activated (speed-to-lead / sales-closer / nurture-specialist / terminal) |
| Escalation decision   | Did the agent escalate to business owner? (yes/no)                                            |
| Tool call intent      | Ordered list of tool operations invoked (e.g., `["crm-write.stage.update"]`)                  |
| Terminal/non-terminal | Did the agent engage or refuse engagement?                                                    |
| Opt-out handling      | Was opt-out recorded? Was further messaging stopped?                                          |

A fixture passes migration comparison if ALL five dimensions produce the same classified outcome. Exact wording, sentence structure, and response length are NOT compared.

This gives actual migration proof, not just "the new thing behaves correctly in isolation."

---

## Latent vs Deterministic Boundary

| Latent (skill markdown — LLM judgment)       | Deterministic (tool code — same input, same output) |
| -------------------------------------------- | --------------------------------------------------- |
| Choosing which qualification question to ask | Looking up a contact by ID                          |
| Deciding when to attempt a close             | Updating an opportunity stage                       |
| Crafting a natural follow-up message         | Checking if dormancy threshold exceeded             |
| Reading emotional signals                    | Computing hours since last reply                    |
| Deciding to escalate vs. handle objection    | Logging an activity record                          |
| Selecting the right nurture approach         | Stage-to-agent mapping                              |

**Anti-bloat rule:** A skill must not encode deterministic state logic. "If stage is X and last reply is older than Y hours then..." belongs in a tool. If you see this pattern in markdown, move it to a tool.

---

## Directory Structure After SP1

```
skills/                                    # NEW — fat skills
  sales-pipeline.md

packages/core/src/
  skill-runtime/                           # NEW — minimal runtime
    skill-loader.ts
    skill-loader.test.ts
    skill-executor.ts
    skill-executor.test.ts
    skill-handler.ts                       # AgentHandler → SkillExecutor glue
    skill-handler.test.ts
    template-engine.ts
    template-engine.test.ts
    tool-calling-adapter.ts
    tool-calling-adapter.test.ts
    governance-injector.ts                 # Executor-injected safety rules — ONE static block, nothing dynamic/composable/tenant-aware
    types.ts
    index.ts
    tools/                                 # Inline tools — not a separate package
      crm-query.ts
      crm-query.test.ts
      crm-write.ts
      crm-write.test.ts
      pipeline-handoff.ts
      pipeline-handoff.test.ts
      index.ts
    __tests__/
      eval-suite.test.ts                   # Behavioral parity eval corpus
      eval-fixtures/                       # JSON test conversations
        01-new-interested-lead.json
        02-qualification-flow.json
        03-stage-transition.json
        04-price-objection.json
        05-prior-context-reference.json
        06-dormant-nurture.json
        07-opt-out.json
        08-escalation.json
        09-terminal-stage.json
        10-invalid-params.json
        11-loop-budget-exceeded.json
        12-dormancy-handoff.json
        13-frustration-escalation.json
        14-message-cap-escalation.json
        15-nurture-buying-signals.json
        16-nurture-needs-qualification.json
  sales-pipeline/                          # KEPT until shadow mode passes
    ...                                    # Deleted in separate cleanup PR
```

---

## Risks

| Risk                                               | Mitigation                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Skill interpolation produces malformed prompt      | Schema-validated object params + fail-fast on missing params                                                       |
| LLM ignores governance constraints                 | Governance injected by executor as separate system section; skill authors cannot override                          |
| Tool loop runaway                                  | Hard limits: 5 tool calls, 6 LLM turns, 30s timeout, 64K token cap                                                 |
| Prompt bloat from large object params              | Schema validation catches oversized objects; YAML serialization is deterministic                                   |
| Migration breaks existing behavior                 | Feature-flagged. Shadow mode (read-only skill path) runs alongside legacy. Old code kept until eval suite passes.  |
| Skill becomes a mini-program with hidden branching | Anti-bloat rule enforced: deterministic logic → tool, judgment → skill                                             |
| `gray-matter` CJS incompatibility with ESM         | Use `yaml` package (pure ESM) as fallback; test during implementation                                              |
| Long conversations exceed token budget             | 64K limit is generous. If hit in practice, implement conversation windowing (keep last N messages) as a follow-up. |

---

## What Comes After SP1 (Not In Scope)

These are validated by SP1's success but designed and built separately:

| Future Work                                                                                                                            | Depends On                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **SP2: Tool ecosystem** — `packages/tools/` as separate package, generalized `SkillToolRegistry`, Meta Ads / ElevenLabs / HeyGen tools | SP1 proving tool interface works      |
| **SP3: Mass migration** — remaining 6 domains extracted from core into skills + tools                                                  | SP1 proving migration pattern         |
| **SP4: Skill marketplace** — listing metadata, resolver, versioning, community publishing, fork semantics                              | SP3 completing internal migrations    |
| **Eval infrastructure** — versioned prompt regression testing, golden conversation corpus, automated drift detection                   | SP1 eval suite as foundation          |
| **Skill learning loops** — `/improve` meta-skill that reads feedback and rewrites skill rules                                          | SP4 marketplace + eval infrastructure |
