# Website Scanner — SP2: Pattern-Defining Migration

> **⚠ SUPERSEDED** — This spec is superseded by Section 5 of
> `docs/superpowers/specs/2026-04-15-sp2-tool-ecosystem-design.md`.
> Unique value (latent/deterministic split, token budget analysis, homepageHtml pattern)
> has been merged into the SP2 spec. Retained for historical context only.

**Date:** 2026-04-15
**Status:** Superseded
**Governing sentence:** SP2 is not just migrating a domain. SP2 is locking the pattern that all future domain migrations will follow.

---

## Problem

`packages/core/src/website-scanner/` contains 250 lines of domain logic (URL validation, page fetching, platform detection, LLM-based business profile extraction) that should not be in the orchestrator. This is the second domain module to migrate from TypeScript to a skill file, following the SP1 proof migration of the sales pipeline.

## SP2 Goal

Migrate the website scanner from hardcoded TypeScript to a skill file + deterministic tools, while defining the reusable patterns for all future migrations.

**SP2 must validate 5 things:**

1. **Skill structure pattern** — clear steps, input parameters, structured output
2. **Tool boundary clarity** — what belongs in tools vs what belongs in the skill
3. **Resolver discipline** — minimal context loading, no bloated system prompts
4. **Error handling pattern** — standard failure modes reusable across domains
5. **Eval framework reuse** — SP1's eval fixture pattern works for non-conversational skills

---

## What SP2 Delivers

### Must Have

| Deliverable                                                                           | Location                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `website-profiler.md`                                                                 | `skills/`                                          |
| `web-scanner` tool (3 operations)                                                     | `packages/core/src/skill-runtime/tools/`           |
| `SkillHandler` generalized for task-based skills                                      | `packages/core/src/skill-runtime/skill-handler.ts` |
| Error handling pattern (reusable)                                                     | Documented in skill + tool                         |
| Behavioral parity eval suite                                                          | `packages/core/src/skill-runtime/__tests__/`       |
| Deletion of `core/src/website-scanner/`                                               | After eval suite passes                            |
| Removal of `website-scanner` exports from `core/src/index.ts` and `core/package.json` | Same PR as deletion                                |

### Explicitly NOT in SP2

- Generalized tool registry / `packages/tools/`
- Skill composition (sub-skills)
- Resolver intelligence beyond slug lookup
- Changes to `AgentDeployment` or marketplace models
- Shadow mode (this is not a conversational agent — no chat path to shadow)

---

## Latent vs Deterministic Split

This is the most important decision in SP2 — and the pattern all future migrations follow.

### Current Code: What's Deterministic, What's Latent

| Current File             | Current Behavior                                                                                                         | Classification    | SP2 Destination                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------- |
| `url-validator.ts`       | URL parsing, scheme check, credential check, private IP detection, DNS resolution                                        | **Deterministic** | `web-scanner.validate-url` tool operation                     |
| `page-fetcher.ts`        | HTTP fetch with timeout, HTML stripping, abort signal                                                                    | **Deterministic** | `web-scanner.fetch-pages` tool operation                      |
| `platform-detector.ts`   | Regex-based platform matching (Shopify/WP/Wix/Squarespace)                                                               | **Deterministic** | `web-scanner.detect-platform` tool operation (fast-path hint) |
| `scanner.ts` lines 11-27 | LLM extraction prompt — "extract business name, products, services, location, hours, phone, email, FAQs, brand language" | **Latent**        | `website-profiler.md` skill body                              |
| `scanner.ts` lines 29-74 | Orchestration — validate → fetch → detect → extract → assemble                                                           | **Process**       | `website-profiler.md` skill body (step sequence)              |

### Key Reframe: Platform Detection

The current `platform-detector.ts` uses 11 hardcoded regex patterns. This is a deterministic fast-path that catches the obvious cases (Shopify CDN URL, WordPress generator tag, Wix SDK). But it misses custom themes, headless storefronts, platform migrations, and lesser-known platforms.

**SP2 decision:** Keep the regex detector as a deterministic tool (fast, cheap, reliable for obvious cases). The skill body instructs the LLM to also analyze the page content and make its own platform judgment. If the tool found a match, the LLM confirms or overrides. If the tool found nothing, the LLM infers from page structure.

This is the correct latent/deterministic split: the tool provides a fast hint, the LLM makes the final judgment.

---

## Skill File: `website-profiler.md`

```markdown
---
name: website-profiler
slug: website-profiler
version: 1.0.0
description: >
  Scans a business website to extract a structured business profile including
  name, products, services, location, contact info, FAQs, and platform.
author: switchboard
parameters:
  - name: TARGET_URL
    type: string
    required: true
    description: The business website URL to scan.

tools:
  - web-scanner
---

# Website Profiler

You analyze a business website and produce a structured business profile.

## Process

Follow these steps in order. Use the provided tools for deterministic operations.
Make your own judgment for analysis and synthesis.

### Step 1: Validate the URL

Use tool `web-scanner.validate-url` with the TARGET_URL.

If the tool returns `valid: false`, respond with a JSON object:
`{ "error": "<the tool's error message>" }`
Do not proceed to further steps.

### Step 2: Fetch page content

Use tool `web-scanner.fetch-pages` with the validated URL.

The tool fetches up to 6 pages (/, /about, /pricing, /faq, /contact, /services)
and returns stripped text content for each. Note: `rawHtml` is NOT included in
the returned data — only cleaned text. The homepage HTML for platform detection
is returned separately in the `homepageHtml` field.

If `fetchedCount` is 0, respond with a JSON object:
`{ "error": "Could not fetch any pages from the provided URL" }`
Do not proceed.

### Step 3: Detect platform (fast path)

Use tool `web-scanner.detect-platform` with the `homepageHtml` from Step 2.

The tool checks for known platform markers (Shopify CDN, WordPress generator tag,
Wix SDK, Squarespace). It returns a platform name or null.

This is a hint, not a final answer. You will make the final platform judgment
in Step 4 after analyzing the full content.

### Step 4: Analyze and extract

Read all fetched page content carefully. Extract factual information ONLY —
do not infer or fabricate details that are not explicitly stated on the pages.

Produce a structured profile with:

- **businessName**: The business name as it appears on the site
- **description**: 1-2 sentence summary of what the business does
- **products**: Array of { name, description, price? } — only if explicitly listed
- **services**: Array of service names
- **location**: { address, city, state } — only if explicitly stated
- **hours**: Day-to-hour mapping — only if explicitly stated
- **phone**: Phone number — only if found
- **email**: Email address — only if found
- **faqs**: Array of { question, answer } — from FAQ page or inline FAQs
- **brandLanguage**: Array of 3-5 words that capture the brand's tone
  (e.g., ["bold", "playful", "modern"])
- **platformDetected**: Your final judgment on the platform. Consider the tool's
  fast-path hint AND your own analysis of the page structure, asset URLs,
  JavaScript includes, and meta tags. One of: shopify, wordpress, wix,
  squarespace, or custom.

For any field where information is not found, use null or empty array.
Never fabricate.

### Step 5: Return the profile

Format your response as a single JSON object matching the structure above.
No markdown wrapping, no explanations — just the JSON.
```

**Design notes:**

- The skill body describes a process, not code. Each step says what to do and what judgment to apply.
- The skill does NOT contain governance/safety rules — those are injected by the executor (same as SP1).
- Platform detection is a two-pass approach: deterministic tool hint + LLM judgment.
- The skill is non-conversational — it takes a URL, produces a profile. No back-and-forth.
- `brandLanguage` is explicitly described as an array of words, matching the `z.array(z.string())` schema.
- `platformDetected` is always populated (including "custom" as fallback), though the schema allows optional.

---

## Tool: `web-scanner` (3 operations)

All operations extracted from existing TypeScript. Thin wrappers, JSON in/out, no LLM.

### `web-scanner.validate-url`

Extracted from `url-validator.ts`. Validates URL scheme, checks for credentials, resolves DNS to verify non-private IP.

```typescript
interface ValidateUrlInput {
  url: string;
}

interface ValidateUrlOutput {
  valid: boolean;
  validatedUrl: string | null;
  error: string | null;
}
```

**Implementation:** Calls existing `validateScanUrl()` + `assertPublicHostname()`. Catches thrown errors and returns structured result instead of throwing.

### `web-scanner.fetch-pages`

Extracted from `page-fetcher.ts`. Fetches up to 6 default paths, strips HTML, returns text content.

**Critical: `rawHtml` is NOT returned to the LLM.** Raw HTML pages can be 50-100KB each. Sending 6 pages of raw HTML back as a tool result would blow the 64K token budget. Instead:

```typescript
interface FetchPagesInput {
  url: string;
  paths?: string[]; // defaults to ["/", "/about", "/pricing", "/faq", "/contact", "/services"]
  timeoutMs?: number; // defaults to 10000
}

interface FetchPagesOutput {
  pages: Array<{
    path: string;
    text: string; // Stripped text content (max 8KB per page)
  }>;
  homepageHtml: string; // Raw HTML of homepage ONLY (for platform detection, max 50KB)
  fetchedCount: number;
  failedPaths: string[];
}
```

Only `text` (stripped, max 8KB) is returned per page. The `homepageHtml` field contains raw HTML for the homepage only — this is needed by `detect-platform` but is consumed by the tool, not by the LLM directly. The skill instructs the LLM to pass `homepageHtml` to the detect-platform tool.

**Token budget consideration:** 6 pages × 8KB text = ~48KB max. Plus ~50KB homepage HTML passed to detect-platform (consumed by tool, not sent back as text). This stays within the 64K token budget.

**Implementation:** Calls existing `fetchPages()`. Strips `rawHtml` from per-page results. Extracts homepage `rawHtml` into separate `homepageHtml` field.

### `web-scanner.detect-platform`

Extracted from `platform-detector.ts`. Regex-based platform detection from HTML.

```typescript
interface DetectPlatformInput {
  html: string; // The homepageHtml from fetch-pages
}

interface DetectPlatformOutput {
  platform: "shopify" | "wordpress" | "wix" | "squarespace" | null;
  confidence: "regex-match" | "none";
}
```

**Implementation:** Calls existing `detectPlatform()`. Wraps result with confidence indicator so the LLM knows this is a hint, not ground truth.

### Data Layer Mapping

| Tool Operation                | Existing Code          | Method                                         |
| ----------------------------- | ---------------------- | ---------------------------------------------- |
| `web-scanner.validate-url`    | `url-validator.ts`     | `validateScanUrl()` + `assertPublicHostname()` |
| `web-scanner.fetch-pages`     | `page-fetcher.ts`      | `fetchPages()`                                 |
| `web-scanner.detect-platform` | `platform-detector.ts` | `detectPlatform()`                             |

All three operations use pure functions from the existing code. No Prisma stores, no database. The tool is self-contained.

### Tool Governance Policy

All `web-scanner.*` operations are read-only. They auto-approve in all trust levels. The `getToolGovernanceDecision()` function in `types.ts` already returns `auto-approve` for any tool name not explicitly listed. No changes needed.

---

## Error Handling Pattern (Reusable)

SP2 defines the standard error handling pattern for all skill migrations.

### Principle: Tools Return Errors, Skills Decide What To Do

Tools never throw on expected failures. They return structured error results. The skill body (LLM) decides how to handle each failure — retry, degrade gracefully, or report to the user.

| Error Type                            | Who Handles                                    | How                                                          |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Invalid URL (bad scheme, credentials) | Tool returns `{ valid: false, error: "..." }`  | Skill responds with `{ "error": "..." }` JSON                |
| DNS resolution failure                | Tool returns `{ valid: false, error: "..." }`  | Skill responds with `{ "error": "..." }` JSON                |
| All page fetches fail                 | Tool returns `{ pages: [], fetchedCount: 0 }`  | Skill responds with `{ "error": "Could not fetch..." }` JSON |
| Some pages fail, some succeed         | Tool returns partial results                   | Skill works with what's available                            |
| Platform not detected                 | Tool returns `{ platform: null }`              | Skill infers from content analysis                           |
| LLM extraction produces invalid JSON  | Executor handles (existing budget enforcement) | Standard executor error path                                 |
| Empty TARGET_URL parameter            | `SkillParameterError` thrown during validation | No LLM call                                                  |

**Anti-pattern:** Do NOT put error handling logic in the skill markdown as deterministic branching ("if fetchedCount === 0 then..."). The skill instructs the LLM: "If fetchedCount is 0, respond with an error JSON." The LLM evaluates the tool result and responds appropriately.

**Pattern for future migrations:** Tools return `{ success: boolean, data?, error? }` or equivalent. Skills describe what to do in success/failure scenarios using natural language. The LLM reads the tool result and responds appropriately.

---

## SkillHandler Generalization: `onTask()` Support

SP1's `SkillHandler` only supports `onMessage()` with sales-pipeline-specific dependencies (opportunity store, contact store, contactId). SP2 needs `onTask()` for task-based skills, and future migrations need different store dependencies.

### Refactoring: Make SkillHandler Generic

Split `SkillHandler` into:

1. **`SkillHandler`** (base) — implements `AgentHandler`, delegates to `SkillExecutor`. No skill-specific stores.
2. **`buildParameters` callback** — injected per-skill, maps context to skill parameters.

```typescript
type ParameterBuilder = (ctx: AgentContext) => Promise<Record<string, unknown>>;

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private buildParams: ParameterBuilder,
    private config: { deploymentId: string; orgId: string },
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    const parameters = await this.buildParams(ctx);
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

  async onTask(ctx: AgentContext): Promise<void> {
    if (!ctx.task) throw new Error("No task in context");

    const parameters = await this.buildParams(ctx);

    const result = await this.executor.execute({
      skill: this.skill,
      parameters,
      messages: [{ role: "user", content: JSON.stringify(ctx.task.input) }],
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      trustScore: ctx.trust.score,
      trustLevel: ctx.trust.level,
    });

    // Parse the response as the task output and notify via chat
    await ctx.notify({
      title: `Task completed: ${this.skill.name}`,
      body: result.response,
      data: { taskId: ctx.task.id, output: result.response },
    });
  }
}
```

### Task Output Lifecycle

When `onTask()` completes:

1. The executor runs the skill and returns `SkillExecutionResult`
2. The handler calls `ctx.notify()` with the result (the task output)
3. The caller (whoever dispatched the task via `AgentRuntime.handleTask()`) is responsible for updating `AgentTask.output` and `AgentTask.status` to `completed` or `failed` — this already exists in the `AgentRuntime` flow.

The `SkillHandler` does NOT directly update task status. That's the runtime's job. The handler produces the output; the runtime manages the lifecycle. This matches how `AgentHandler.onTask()` already works in the SDK — the handler does work, the runtime records results.

### Parameter Builders (Per-Skill)

Each skill provides a parameter builder function:

**Sales pipeline builder** (SP1 — refactored from inline):

```typescript
function salesPipelineParamBuilder(
  stores: { opportunityStore: OpportunityStoreSubset; contactStore: ContactStoreSubset },
  contactId: string,
): ParameterBuilder {
  return async (ctx) => {
    const opportunities = await stores.opportunityStore.findActiveByContact(/* ... */);
    // ... existing opportunity resolution logic
    return { BUSINESS_NAME: ctx.persona.businessName, PIPELINE_STAGE: opp.stage, ... };
  };
}
```

**Website profiler builder** (SP2):

```typescript
function websiteProfilerParamBuilder(): ParameterBuilder {
  return async (ctx) => {
    const input = (ctx.task?.input ?? {}) as Record<string, unknown>;
    const url = input["url"] ?? input["targetUrl"];
    if (!url || typeof url !== "string") {
      throw new SkillParameterError(
        "Missing required parameter: TARGET_URL (no url in task input)",
      );
    }
    return { TARGET_URL: url };
  };
}
```

This pattern means adding a new skill requires: (1) write the skill `.md` file, (2) write the parameter builder function, (3) register tools. No handler class changes.

---

## Behavioral Parity Eval Suite

### Test Strategy

The website-profiler is not conversational, so eval fixtures look different from SP1. Each fixture provides mocked tool responses and a mocked LLM response. Assertions verify tool call sequence, error handling, and output structure.

### Test Cases

| #   | Scenario                                       | Key Assertions                                                                                                     |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Valid URL, all pages fetched, Shopify detected | Tools called in order: validate-url, fetch-pages, detect-platform. Response is valid JSON with `platformDetected`. |
| 2   | Valid URL, some pages fail                     | `fetch-pages` returns partial results (`fetchedCount < 6`). Profile still produced.                                |
| 3   | Valid URL, no pages fetched                    | `fetch-pages` returns `{ pages: [], fetchedCount: 0 }`. Response contains `error` field. No further tools called.  |
| 4   | Invalid URL (bad scheme)                       | `validate-url` returns `{ valid: false }`. No further tools called. Response contains `error` field.               |
| 5   | Invalid URL (private IP)                       | `validate-url` returns `{ valid: false, error: "private IP" }`. Response contains `error` field.                   |
| 6   | Valid URL, no platform detected                | `detect-platform` returns `{ platform: null }`. Profile includes `platformDetected: "custom"`.                     |
| 7   | Valid URL, WordPress detected                  | `detect-platform` returns `{ platform: "wordpress" }`. LLM confirms in extraction.                                 |
| 8   | Missing TARGET_URL parameter                   | `SkillParameterError` thrown before LLM call.                                                                      |
| 9   | Empty TARGET_URL parameter                     | `SkillParameterError` thrown (empty string caught by param builder).                                               |
| 10  | Tool budget not exceeded                       | Normal scan uses 3 tool calls. Well within budget of 5.                                                            |

### Migration Comparison

Each fixture is also run through the existing `WebsiteScanner.scan()` TypeScript path with the same mocked `LLMClient`. Structured outcomes compared:

| Comparison Dimension   | How Extracted                                                       |
| ---------------------- | ------------------------------------------------------------------- |
| URL validation outcome | Did the scan accept or reject the URL?                              |
| Platform detection     | Same platform detected? (both paths use same regex + same mock LLM) |
| Profile completeness   | Same fields populated (not same values — LLM wording varies)        |
| Error handling         | Same failure mode for same invalid input?                           |

Both paths mock their LLM dependency: the skill path mocks via `MockToolCallingAdapter` (scripted responses), the legacy path mocks via `MockLLMClient` (scripted completions). This ensures deterministic comparison.

---

## What Gets Deleted from Core

After the eval suite passes:

| File                   | Lines    | What It Contains                      |
| ---------------------- | -------- | ------------------------------------- |
| `scanner.ts`           | 74       | Orchestration + LLM extraction prompt |
| `url-validator.ts`     | 62       | URL validation + SSRF protection      |
| `page-fetcher.ts`      | 74       | HTTP fetch + HTML stripping           |
| `platform-detector.ts` | 35       | Regex platform detection              |
| `index.ts`             | 5        | Barrel exports                        |
| Tests (4 files)        | ~180     | Unit tests                            |
| **Total**              | **~430** |                                       |

**Also update:**

- `packages/core/src/index.ts` — remove `website-scanner` re-exports
- `packages/core/package.json` — remove `./website-scanner` from `exports` (if present)
- Search all app code for imports from `@switchboard/core/website-scanner` — fix or remove

**Test migration:** The existing unit tests for `url-validator`, `page-fetcher`, and `platform-detector` are ported to `web-scanner.test.ts` in the tools directory. The pure function logic is preserved; only the test location and import paths change.

Unlike SP1 (where old code was kept for shadow mode), **SP2 deletes immediately** after eval passes. There is no chat path to shadow — this is a task-based skill.

---

## Directory Structure After SP2

```
skills/
  sales-pipeline.md                        # SP1
  website-profiler.md                      # SP2 — NEW

packages/core/src/
  skill-runtime/
    skill-handler.ts                       # MODIFIED — generalized with ParameterBuilder
    skill-handler.test.ts                  # MODIFIED — tests for onTask + generic handler
    ... (other SP1 files unchanged)
    tools/
      crm-query.ts                         # SP1
      crm-write.ts                         # SP1
      pipeline-handoff.ts                  # SP1
      web-scanner.ts                       # SP2 — NEW
      web-scanner.test.ts                  # SP2 — NEW (includes ported unit tests)
      index.ts                            # Updated — add web-scanner export
    __tests__/
      eval-suite.test.ts                   # SP1 (sales-pipeline fixtures)
      eval-fixtures/                       # SP1 fixtures
      website-profiler-eval.test.ts        # SP2 — NEW
      website-profiler-fixtures/           # SP2 — NEW
  # website-scanner/                       # DELETED
```

---

## Patterns Locked by SP2

After SP2 ships, these patterns are documented and reusable for SP3+:

| Pattern                                                           | SP1 Status       | SP2 Locks It                                   |
| ----------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| Skill structure (frontmatter + process steps + tool references)   | Established      | Confirmed for non-conversational skills        |
| Tool boundary (deterministic → tool, judgment → skill)            | Established      | Extended with "fast-path hint + LLM override"  |
| Error handling (tools return errors, skills decide)               | Implicit         | **Explicit and documented**                    |
| Eval fixtures (mock tools + mock LLM + behavioral assertions)     | Established      | Confirmed for task-based skills                |
| Non-conversational skill execution (`onTask` via generic handler) | Not covered      | **New pattern**                                |
| Generic SkillHandler with ParameterBuilder injection              | Hardcoded stores | **Generalized — no handler changes per skill** |
| Immediate deletion (no shadow mode for non-chat skills)           | Deferred         | **Established**                                |
| Token budget management (strip rawHtml, control tool output size) | Not tested       | **Explicit pattern**                           |

---

## Risks

| Risk                                                                | Mitigation                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| LLM extraction quality varies from TypeScript structured extraction | Mock LLM in eval suite. Real LLM testing is manual verification.                                                |
| `fetch-pages` tool makes real HTTP requests                         | Tests mock the tool. Existing pure function tests ported to `web-scanner.test.ts`.                              |
| Platform detection regression (regex was deterministic)             | Two-pass approach: regex tool hint + LLM judgment. Both agree = high confidence.                                |
| Deleting old code breaks imports elsewhere                          | Search for all imports from `@switchboard/core/website-scanner`. Remove barrel export from `core/src/index.ts`. |
| Refactoring `SkillHandler` breaks SP1 sales-pipeline                | SP1 tests re-run with refactored handler. Parameter builder pattern is backward compatible.                     |
| `rawHtml` blows token budget                                        | `fetch-pages` returns stripped text only. `homepageHtml` is for detect-platform tool only.                      |
