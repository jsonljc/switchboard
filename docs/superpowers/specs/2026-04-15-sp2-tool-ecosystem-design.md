# SP2: Tool Ecosystem for Mass Migration

**Date:** 2026-04-15
**Status:** Draft
**Governing sentence:** SP2 locks the migration pattern for conversational agents that sit inside the revenue loop (lead responder, profiler, qualifier, nurturer, closer), so future agents can be added by standard extension points instead of bespoke runtime logic.

---

## Problem

SP1 proved that one governed production agent (sales pipeline) can run from a markdown skill file. But the implementation is one-off:

- `SkillHandler` is hardcoded to sales-pipeline — it fetches opportunities, maps persona fields, resolves contacts
- Tools live in an ad-hoc `Map<string, SkillTool>` with no registration or validation
- Governance is a single `if` statement checking one tool name
- Every new skill migration would require a new handler class, new manual wiring, and new governance logic

This means migrating the next agent requires creativity, not mechanics. SP2 fixes that.

## SP2 Goal

Make migrating a conversational agent from TypeScript to a skill file a mechanical checklist — no custom handler classes, no framework extensions, no governance hand-wiring. Prove it by migrating the website profiler as the second skill.

**SP2 is not:**

- A batch/async execution model (ad-optimizer, creative-director are separate SPs)
- A marketplace feature (no listing metadata, versioning, or community publishing)
- An org-level governance configuration system
- A deletion of old sales-pipeline code (separate cleanup PR)

---

## What SP2 Delivers

### Must Have

| Deliverable                                               | Location                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `ToolRegistry` class                                      | `packages/core/src/skill-runtime/tool-registry.ts`                  |
| Governance tier system                                    | `packages/core/src/skill-runtime/governance.ts`                     |
| Generic `SkillHandler` (ParameterBuilder-based)           | Modify `packages/core/src/skill-runtime/skill-handler.ts`           |
| `ParameterBuilder` type + registration                    | `packages/core/src/skill-runtime/parameter-builder.ts`              |
| Sales-pipeline ParameterBuilder (extract from handler)    | `packages/core/src/skill-runtime/builders/sales-pipeline.ts`        |
| Website profiler skill file                               | `skills/website-profiler.md`                                        |
| Website profiler tools (`web-scanner`)                    | `packages/core/src/skill-runtime/tools/web-scanner.ts`              |
| Website profiler ParameterBuilder                         | `packages/core/src/skill-runtime/builders/website-profiler.ts`      |
| Website profiler eval suite                               | `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-*.json` |
| Migration checklist documentation                         | This spec                                                           |
| SP1 tools reclassified with governance tiers              | Modify existing tool files                                          |
| Bootstrap validation (tool deps, governance completeness) | `packages/core/src/skill-runtime/tool-registry.ts`                  |

### Explicitly NOT in SP2

- Batch/async skill execution (Inngest-triggered pipelines)
- Remote skill loading or hot reload
- Skill versioning or pinning
- Marketplace metadata on `AgentListing`
- Org-level governance overrides
- Deletion of `packages/core/src/sales-pipeline/` (cleanup after shadow mode)
- Skill composition (sub-skills)
- Dynamic tool loading or plugin discovery

---

## Architecture

### 1. ParameterBuilder — Generic SkillHandler

#### The Problem

Current `SkillHandler` is hardcoded to sales-pipeline. It:

- Fetches opportunities from `PrismaOpportunityStore`
- Resolves contacts from `PrismaContactStore`
- Maps `AgentPersona` fields to `PERSONA_CONFIG`
- Knows about pipeline stages, opportunity IDs

Every new skill would need a new handler class. That's agent class explosion.

#### The Solution

ParameterBuilder functions registered per skill slug. The `SkillHandler` becomes generic — it calls a registered builder to get parameters, then runs the executor.

```typescript
/**
 * A ParameterBuilder resolves runtime context into skill parameters.
 *
 * BOUNDARY RULE: Builders only resolve and normalize inputs.
 * All decision-making belongs in the skill. Builders must NOT:
 * - Contain business logic
 * - Make decisions about what the skill should do
 * - Call unrelated services
 * - Perform side effects
 */
type ParameterBuilder = (
  ctx: AgentContext,
  config: { deploymentId: string; orgId: string },
  stores: SkillStores,
) => Promise<Record<string, unknown>>;

/**
 * Superset of all store interfaces that any ParameterBuilder may need.
 * Each builder uses only what it needs — the rest are ignored.
 * New stores are added here as new skills require them.
 */
interface SkillStores {
  opportunityStore: {
    findActiveByContact(
      orgId: string,
      contactId: string,
    ): Promise<Array<{ id: string; stage: string; createdAt: Date }>>;
  };
  contactStore: {
    findById(orgId: string, contactId: string): Promise<unknown>;
  };
  activityStore: {
    listByDeployment(
      orgId: string,
      deploymentId: string,
      opts: { limit: number },
    ): Promise<unknown>;
  };
}
```

The generic `SkillHandler.onMessage()` becomes:

```typescript
async onMessage(ctx: AgentContext): Promise<void> {
  const builder = this.builderMap.get(this.skill.slug);
  if (!builder) {
    throw new Error(`No parameter builder registered for skill: ${this.skill.slug}`);
  }

  const parameters = await builder(ctx, this.config, this.stores);

  const messages = (ctx.conversation?.messages ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const result = await this.executor.execute({
    skill: this.skill,
    parameters,
    messages,
    deploymentId: this.config.deploymentId,
    orgId: this.config.orgId,
    trustScore: ctx.trust.score,
    trustLevel: ctx.trust.level,
  });

  await ctx.chat.send(result.response);
}
```

**Why not declarative frontmatter mapping?** Some parameters need async DB queries (opportunity resolution), conditional logic (take most recent opportunity), or message parsing (extract URL from latest message). A declarative syntax either can't express these or becomes a fake DSL. Registered functions are more honest.

#### ParameterBuilder Examples

**Sales pipeline** (extracted from current SkillHandler):

```typescript
const salesPipelineBuilder: ParameterBuilder = async (ctx, config, stores) => {
  const contactId = ctx.sessionId;

  const opportunities = await stores.opportunityStore.findActiveByContact(config.orgId, contactId);

  if (opportunities.length === 0) {
    throw new ParameterResolutionError(
      "no-active-opportunity",
      "No active deal found for this conversation. Let me connect you with the team.",
    );
  }

  const opportunity = opportunities.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;

  const leadProfile = await stores.contactStore.findById(config.orgId, contactId);

  return {
    BUSINESS_NAME: ctx.persona.businessName,
    PIPELINE_STAGE: opportunity.stage,
    OPPORTUNITY_ID: opportunity.id,
    LEAD_PROFILE: leadProfile,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      qualificationCriteria: ctx.persona.qualificationCriteria,
      disqualificationCriteria: ctx.persona.disqualificationCriteria,
      escalationRules: ctx.persona.escalationRules,
      bookingLink: ctx.persona.bookingLink ?? "",
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
```

**Website profiler** (minimal — no DB queries):

```typescript
const websiteProfilerBuilder: ParameterBuilder = async (ctx, _config, _stores) => {
  const lastMessage = ctx.conversation?.messages?.at(-1);
  const url = extractUrl(lastMessage?.content ?? "");

  return {
    TARGET_URL: url,
    BUSINESS_NAME: ctx.persona.businessName,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
```

#### ParameterResolutionError

When a builder cannot resolve required context (e.g., no active opportunity), it throws a `ParameterResolutionError` with a user-facing message. The `SkillHandler` catches this and sends the message to the user without calling the executor. This replaces the hardcoded "no active deal" check in the current handler.

```typescript
export class ParameterResolutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "ParameterResolutionError";
  }
}
```

#### Bootstrap Validation

At startup, validate that every loaded skill with `skillSlug` set on a deployment has a registered builder:

```typescript
function validateBuilderRegistration(
  deployments: Array<{ skillSlug: string | null }>,
  builders: Map<string, ParameterBuilder>,
): void {
  for (const d of deployments) {
    if (d.skillSlug && !builders.has(d.skillSlug)) {
      throw new Error(
        `Deployment references skill "${d.skillSlug}" but no ParameterBuilder is registered`,
      );
    }
  }
}
```

Fail at startup, not at first runtime invocation.

---

### 2. Tool Registry + Governance Tiers

#### Tool Registry

Not a plugin system. Just a typed Map with validation.

```typescript
class ToolRegistry {
  private tools = new Map<string, SkillTool>();

  /**
   * Register a tool. Throws if duplicate tool ID or duplicate operation ID.
   */
  register(tool: SkillTool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate tool registration: ${tool.id}`);
    }
    // Validate every operation has required fields
    for (const [opName, op] of Object.entries(tool.operations)) {
      if (!op.governanceTier) {
        throw new Error(`Operation ${tool.id}.${opName} missing governanceTier`);
      }
    }
    this.tools.set(tool.id, tool);
  }

  /**
   * Validate that every tool declared by loaded skills exists in the registry.
   * Also warn about registered tools that no skill references.
   */
  validateSkillDependencies(skills: SkillDefinition[]): void {
    const declaredToolIds = new Set(skills.flatMap((s) => s.tools));
    const registeredToolIds = new Set(this.tools.keys());

    // Missing tools — hard error
    for (const id of declaredToolIds) {
      if (!registeredToolIds.has(id)) {
        throw new Error(`Skill declares tool "${id}" but it is not registered`);
      }
    }

    // Orphan tools — warning (not error, tools may be shared across future skills)
    for (const id of registeredToolIds) {
      if (!declaredToolIds.has(id)) {
        console.warn(`Tool "${id}" is registered but no loaded skill references it`);
      }
    }
  }

  /**
   * Resolve a list of tool IDs into a Map for the executor.
   */
  resolve(toolIds: string[]): Map<string, SkillTool> {
    const resolved = new Map<string, SkillTool>();
    for (const id of toolIds) {
      const tool = this.tools.get(id);
      if (!tool) throw new Error(`Unknown tool: ${id}`);
      resolved.set(id, tool);
    }
    return resolved;
  }
}
```

Three methods. The executor still receives a `Map<string, SkillTool>` — the registry is bootstrap infrastructure, not a runtime dependency.

#### Operation-Level Identity

Every tool operation has a composite identity: `${toolId}.${operationName}`. This is the identifier used in governance decisions, logging, audit trails, and metrics.

```typescript
type ToolOperationId = `${string}.${string}`;

function getOperationId(toolId: string, operationName: string): ToolOperationId {
  return `${toolId}.${operationName}`;
}
```

The registry validates that tool IDs are unique. Composite operation IDs (`toolId.operationName`) are inherently unique when tool IDs are unique, so no cross-tool operation name validation is needed.

#### Governance Tiers

Each tool operation declares a risk tier. A central policy table maps `(tier, trustLevel) → decision`.

```typescript
type GovernanceTier = "read" | "internal_write" | "external_write" | "destructive";
type TrustLevel = "supervised" | "guided" | "autonomous";
type GovernanceDecision = "auto-approve" | "require-approval" | "deny";

/**
 * ToolCallRecord.governanceDecision maps policy decisions to outcomes:
 * "auto-approve" → "auto-approved"
 * "require-approval" → "require-approval"
 * "deny" → "denied"
 */
type GovernanceOutcome = "auto-approved" | "require-approval" | "denied";

const GOVERNANCE_POLICY: Record<GovernanceTier, Record<TrustLevel, GovernanceDecision>> = {
  read: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  internal_write: {
    supervised: "require-approval",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  external_write: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "require-approval",
  },
  destructive: {
    supervised: "deny",
    guided: "require-approval",
    autonomous: "require-approval",
  },
};
```

**Note on external_write:** `autonomous` defaults to `require-approval` as the safe baseline. External writes include sending messages, triggering APIs, and posting content — auto-approving these for autonomous agents is dangerous. Org-level overrides can loosen this in a future SP when the config system exists.

#### Per-Operation Override

Optional escape hatch for operations that don't fit their tier cleanly:

```typescript
interface SkillToolOperation {
  description: string;
  inputSchema: Record<string, unknown>;
  governanceTier: GovernanceTier;
  /** Override tier-based default for specific trust levels. Use only when genuinely needed. */
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
  /** Whether this operation is safe to retry on failure. Default: false. */
  idempotent?: boolean;
  execute(params: unknown): Promise<unknown>;
}
```

Resolution logic:

```typescript
function getToolGovernanceDecision(
  op: SkillToolOperation,
  trustLevel: TrustLevel,
): GovernanceDecision {
  if (op.governanceOverride?.[trustLevel]) {
    return op.governanceOverride[trustLevel]!;
  }
  return GOVERNANCE_POLICY[op.governanceTier][trustLevel];
}
```

Override takes priority. Tier-based default is the fallback.

#### Governance Observability

Every governance decision is logged for audit:

```typescript
interface GovernanceLogEntry {
  operationId: ToolOperationId;
  tier: GovernanceTier;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
```

Lightweight — just log the decision. No separate infrastructure.

#### SP1 Tools Reclassified

| Tool Operation               | Current Behavior               | New Tier         | Change                                   |
| ---------------------------- | ------------------------------ | ---------------- | ---------------------------------------- |
| `crm-query.contact.get`      | auto-approve always            | `read`           | None                                     |
| `crm-query.activity.list`    | auto-approve always            | `read`           | None                                     |
| `pipeline-handoff.determine` | auto-approve always            | `read`           | None                                     |
| `crm-write.activity.log`     | auto-approve always            | `internal_write` | Now requires approval in supervised mode |
| `crm-write.stage.update`     | require-approval in supervised | `internal_write` | Same behavior                            |

**One behavioral change:** `crm-write.activity.log` moves from always auto-approve to `internal_write` (require-approval in supervised mode). This is correct — logging an activity is a write operation, and in supervised mode writes should be reviewed. The SP1 hardcoded exception was an oversight, not a design choice.

---

### 3. Skill Output Schema

Skills declare their expected output structure in frontmatter. This is not enforced by the runtime in SP2 (the LLM produces natural language), but it documents the contract for downstream consumers and eval assertions.

```yaml
output:
  fields:
    - name: profile_summary
      type: string
      required: true
      description: One-paragraph business summary
    - name: business_model
      type: enum
      values: [service, ecommerce, hybrid, unclear]
      required: true
    - name: confidence
      type: enum
      values: [high, medium, low]
      required: true
      description: Overall confidence in the profile
    - name: data_completeness
      type: enum
      values: [high, medium, low]
      required: true
    - name: missing_fields
      type: array
      items: { type: string }
      required: false
      description: Fields that could not be determined
```

**SP2 scope:** Output schemas are declared in frontmatter and validated by the loader (schema is well-formed). They are NOT enforced at runtime — the executor does not parse LLM output against the schema. Runtime enforcement is a future SP concern.

**Why declare them now:** Eval fixtures can assert against expected fields. Downstream agents know what to expect. The contract is documented even if not yet enforced.

---

### 4. Migration Checklist

Every conversational agent migration follows these steps:

#### Step 1: Identify the latent/deterministic split

What's LLM judgment (→ skill body) vs. fixed logic (→ tool operations)?

- URL validation → tool
- HTTP fetching → tool
- Platform regex matching → tool
- Business model classification → skill (LLM judgment)
- Qualification questions → skill (LLM judgment)
- Stage transition rules → tool (deterministic)

**Rule:** If it's `if/else` on explicit state, time thresholds, counters, or fixed mappings — it's a tool. If it requires understanding, interpretation, or judgment — it's skill body.

#### Step 2: Write tool operations

- Thin wrappers around existing stores/APIs
- JSON in/out, no LLM inside tools
- Each operation declares `governanceTier` and `idempotent`
- Token-aware: strip HTML, limit response sizes, avoid blowing budget
- Tools provide hints and structured data — the LLM makes final judgments

#### Step 3: Write the skill file

- `skills/{slug}.md` with YAML frontmatter
- Parameters declare inputs the skill needs
- Tools declare which tool IDs the skill may call
- Body contains process instructions and judgment boundaries
- **Not pseudo-code** — instructions + decision criteria + escalation rules
- No deterministic branching in skill body (anti-bloat rule from SP1)

#### Step 3.5: Define output schema

- Declare expected output fields in frontmatter `output:` section
- Include interpretation fields (business model, confidence, intent type)
- Include completeness signals (`data_completeness`, `missing_fields`)
- This feeds eval assertions and downstream agent contracts

#### Step 4: Write the ParameterBuilder

- One function per skill slug
- Resolves context from `AgentContext` + stores into declared parameters
- **Boundary rule:** Builders only resolve and normalize inputs. All decision-making belongs in the skill.
- Throws `ParameterResolutionError` with user-facing message when required context is unavailable

#### Step 5: Register at bootstrap

- Register tools in `ToolRegistry`
- Register builder in builder map
- Run `validateSkillDependencies()` and `validateBuilderRegistration()`
- Fail at startup if anything is missing

#### Step 6: Write eval fixtures

- Behavioral parity tests with scripted mock responses
- Assert tool calls, response properties, error cases
- Include contradiction scenarios (e.g., tool says X, content suggests Y)
- Test partial data (some pages fail, incomplete extraction)
- Test error cases (invalid input, tool failures)

#### Step 7: Feature flag and rollout

1. Set `skillSlug` on deployment
2. Run eval suite — must pass
3. Limited rollout — run skill path alongside legacy in shadow mode
4. Confirm behavioral parity in production-like runs
5. Only then delete old TypeScript code (separate cleanup PR)

**Do not delete old code until parity + stability is confirmed in production-like runs.** Eval fixtures are necessary but not sufficient — real-world inputs will surface edge cases.

---

### 5. Website Profiler — Proof Migration

The website profiler is the right second migration because it validates the pattern is not sales-pipeline-specific:

- New tool types (HTTP fetch, HTML parsing)
- No DB dependencies for parameter building
- Exercises the interpretive layer (business model, confidence)
- Conversational (user sends URL → agent profiles the business)

#### Tools

**`web-scanner`** (tier: `read`)

| Operation               | Description                                                                                                                                                              | Idempotent |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `validate-url`          | Validate and normalize a URL, check accessibility                                                                                                                        | Yes        |
| `fetch-pages`           | Fetch homepage + key pages (pricing, about, FAQ), strip HTML to text, return structured content. `rawHtml` is NOT returned — avoid blowing token budget.                 | Yes        |
| `detect-platform`       | Regex-based platform detection from HTML signatures (Shopify, WordPress, Wix, etc.). Returns `{ platform, confidence, reasoning }` as a hint — LLM makes final judgment. | Yes        |
| `extract-business-info` | Parse structured data (JSON-LD, Open Graph, meta tags) from fetched pages. Returns factual fields only — no inference.                                                   | Yes        |

All operations are `read` tier (no side effects, safe to retry).

#### Skill File: `skills/website-profiler.md`

```yaml
---
name: website-profiler
slug: website-profiler
version: 1.0.0
description: >
  Profiles a business from its website — extracts factual data, classifies
  business model, identifies platform, and produces decision-ready intelligence
  for downstream agents (lead qualification, ad optimization, creative strategy).
author: switchboard
parameters:
  - name: TARGET_URL
    type: string
    required: true
    description: The URL to profile

  - name: BUSINESS_NAME
    type: string
    required: true

  - name: PERSONA_CONFIG
    type: object
    required: true
    schema:
      tone: { type: string, required: true }
      customInstructions: { type: string, required: false }

tools:
  - web-scanner

output:
  fields:
    - name: profile_summary
      type: string
      required: true
      description: One-paragraph business summary
    - name: business_model
      type: enum
      values: [service, ecommerce, hybrid, unclear]
      required: true
    - name: price_positioning
      type: enum
      values: [low, mid, premium, unclear]
      required: true
    - name: primary_cta
      type: enum
      values: [book, buy, contact, unclear]
      required: true
    - name: lead_intent_type
      type: enum
      values: [transactional, exploratory, unclear]
      required: true
    - name: platform
      type: string
      required: true
    - name: platform_confidence
      type: enum
      values: [high, medium, low]
      required: true
    - name: confidence
      type: enum
      values: [high, medium, low]
      required: true
    - name: data_completeness
      type: enum
      values: [high, medium, low]
      required: true
    - name: missing_fields
      type: array
      items: { type: string }
      required: false
---
```

Skill body defines a 4-step process:

1. Validate URL and check accessibility
2. Fetch and scan key pages
3. Detect platform (tool provides hint, LLM confirms/overrides with reasoning)
4. Extract and interpret business profile:
   - 4A: Extract factual data (from structured data + page content)
   - 4B: Interpret business model (LLM judgment on business type, pricing, CTA, intent)
   - 4C: Confirm platform (reconcile tool hint with content signals — handle contradictions)
5. Produce final profile with confidence and completeness signals

The full skill body content is in the existing website profiler spec at `docs/superpowers/specs/2026-04-15-website-profiler-sp2-design.md`.

#### Eval Fixtures

| #   | Scenario                          | Key Assertions                                                                            |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Valid URL, full profile           | All tools called. Profile complete. Confidence: high.                                     |
| 2   | Invalid URL                       | `ParameterResolutionError` or `web-scanner.validate-url` returns error. No further calls. |
| 3   | URL accessible but sparse content | Partial profile. `data_completeness: low`. `missing_fields` populated.                    |
| 4   | Platform detection contradiction  | Tool says WordPress, content looks like Shopify store. LLM resolves with reasoning.       |
| 5   | Multiple CTAs detected            | LLM classifies primary CTA. `confidence` reflects ambiguity.                              |
| 6   | No pricing page                   | `price_positioning: unclear`. `missing_fields` includes "pricing".                        |
| 7   | Non-English website               | Handles gracefully. May reduce confidence.                                                |
| 8   | Timeout on fetch                  | Partial results from successful pages. Error noted in response.                           |

---

## Changes to Existing Code

### Modified Files

| File                                                        | Change                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/skill-runtime/types.ts`                  | Add `GovernanceTier`, update `SkillToolOperation` with `governanceTier`, `governanceOverride`, `idempotent`. Add `ParameterResolutionError`. Update `getToolGovernanceDecision` signature.                                                                                    |
| `packages/core/src/skill-runtime/skill-handler.ts`          | Replace hardcoded sales-pipeline logic with generic ParameterBuilder dispatch.                                                                                                                                                                                                |
| `packages/core/src/skill-runtime/skill-executor.ts`         | Update governance call to use operation object instead of tool name string. Add governance logging. Add `deny` code path (return error result to LLM, do not execute the tool). Update `ToolCallRecord.governanceDecision` type to `GovernanceOutcome` (includes `"denied"`). |
| `packages/core/src/skill-runtime/skill-loader.ts`           | Parse `output` section from frontmatter (optional, validated for structure).                                                                                                                                                                                                  |
| `packages/core/src/skill-runtime/tools/crm-query.ts`        | Add `governanceTier: "read"` to operations.                                                                                                                                                                                                                                   |
| `packages/core/src/skill-runtime/tools/crm-write.ts`        | Add `governanceTier: "internal_write"` to operations. Add `idempotent: true` to `stage.update` (verified: Prisma update is a simple SET, safe to retry).                                                                                                                      |
| `packages/core/src/skill-runtime/tools/pipeline-handoff.ts` | Add `governanceTier: "read"` to operations.                                                                                                                                                                                                                                   |
| `packages/core/src/skill-runtime/index.ts`                  | Export new modules (registry, governance, builders).                                                                                                                                                                                                                          |
| `packages/core/src/channel-gateway/types.ts`                | Update `SkillRuntimeDeps` to use `ToolRegistry` and builder map instead of manual wiring.                                                                                                                                                                                     |

### New Files

| File                                                                | Purpose                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/core/src/skill-runtime/tool-registry.ts`                  | `ToolRegistry` class                                                                     |
| `packages/core/src/skill-runtime/tool-registry.test.ts`             | Registry tests (registration, validation, resolution)                                    |
| `packages/core/src/skill-runtime/governance.ts`                     | Tier policy table, `getToolGovernanceDecision`, `GovernanceLogEntry`                     |
| `packages/core/src/skill-runtime/governance.test.ts`                | Governance policy tests (all tiers × trust levels, overrides, deny)                      |
| `packages/core/src/skill-runtime/parameter-builder.ts`              | `ParameterBuilder` type, `ParameterResolutionError`, `SkillStores`, validation utilities |
| `packages/core/src/skill-runtime/parameter-builder.test.ts`         | Builder validation tests                                                                 |
| `packages/core/src/skill-runtime/builders/sales-pipeline.ts`        | Extracted sales-pipeline builder                                                         |
| `packages/core/src/skill-runtime/builders/sales-pipeline.test.ts`   | Sales-pipeline builder tests                                                             |
| `packages/core/src/skill-runtime/builders/website-profiler.ts`      | Website profiler builder                                                                 |
| `packages/core/src/skill-runtime/builders/website-profiler.test.ts` | Website profiler builder tests                                                           |
| `packages/core/src/skill-runtime/builders/index.ts`                 | Builder barrel export                                                                    |
| `packages/core/src/skill-runtime/tools/web-scanner.ts`              | URL validation, page fetching, platform detection, structured data extraction            |
| `packages/core/src/skill-runtime/tools/web-scanner.test.ts`         | Web scanner tool tests                                                                   |
| `skills/website-profiler.md`                                        | Website profiler skill file                                                              |
| `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-*.json` | 8 website profiler eval fixtures                                                         |

---

## Risks

| Risk                                             | Mitigation                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ParameterBuilder becomes a mini-orchestrator     | Boundary rule enforced: builders only resolve/normalize inputs. Code review gate.    |
| Governance tier doesn't fit a tool               | Per-operation override escape hatch. Keep tier set small.                            |
| Website profiler fetch takes too long            | Executor has 30s timeout from SP1. Tool-level timeout for HTTP requests.             |
| HTML content blows token budget                  | Tools strip HTML, return text-only. Token budget enforcement from SP1.               |
| Platform detection contradictions confuse LLM    | Tool returns confidence + reasoning. Eval fixture #4 tests contradiction handling.   |
| Bootstrap validation too strict (blocks startup) | Missing tools = error. Orphan tools = warning. Balance strictness with practicality. |

---

## What Comes After SP2

| Future Work                        | Depends On                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| **SP3: Batch/async execution**     | SkillBatchHandler for Inngest-triggered skills (ad-optimizer, creative-director) |
| **SP4: Mass migration**            | Remaining conversational agents migrated using SP2 checklist                     |
| **SP5: Output schema enforcement** | Runtime validation of LLM output against declared schema                         |
| **SP6: Skill marketplace**         | Listing metadata, resolver, versioning, community publishing                     |
| **Org-level governance overrides** | Per-org config to loosen/tighten tier defaults                                   |
| **Skill improvement loops**        | Capture execution feedback, feed into skill refinement                           |
