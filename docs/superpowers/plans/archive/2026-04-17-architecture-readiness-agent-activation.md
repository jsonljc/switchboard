# Architecture Readiness & Agent Activation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PlatformIngress migration, wire 3 dead agents to end-to-end execution, clean dead references.

**Architecture:** All new proposal ingress routes through `PlatformIngress.submit()`. Agents activate through the existing ChannelGateway → SkillHandler → SkillExecutor path. Dead legacy code is removed. No new abstractions introduced.

**Tech Stack:** TypeScript, Fastify, Prisma, Vitest, Zod, Anthropic SDK

**Spec:** `docs/superpowers/specs/2026-04-17-architecture-readiness-agent-activation.md`

---

## File Map

### Phase 1: PlatformIngress Migration

- **Modify:** `apps/api/src/routes/actions.ts` — migrate propose + batch to PlatformIngress
- **Modify:** `apps/api/src/validation.ts` — add batch idempotency key field
- **Modify:** `apps/api/src/__tests__/api-actions.test.ts` — update for new ingress path
- **Create:** `apps/api/src/__tests__/ingress-boundary.test.ts` — boundary enforcement test

### Phase 2A: Sales Pipeline Agents

- **Modify:** `packages/db/prisma/seed-marketplace.ts` — add skillSlug to 3 deployments
- **Create:** `apps/chat/src/gateway/__tests__/sales-pipeline-e2e.test.ts` — integration test

### Phase 2B: Website Profiler

- **Modify:** `packages/db/prisma/seed-marketplace.ts` — add listing + deployment
- **Modify:** `apps/chat/src/gateway/gateway-bridge.ts` — wire builder + tool
- **Create:** `apps/chat/src/gateway/__tests__/website-profiler-e2e.test.ts` — integration test

### Phase 2C: Ad Optimizer (Chat-Triggered)

- **Create:** `packages/core/src/skill-runtime/builders/ad-optimizer-interactive.ts` — interactive builder
- **Modify:** `packages/core/src/skill-runtime/builders/index.ts` — export new builder
- **Modify:** `packages/core/src/skill-runtime/index.ts` — re-export from barrel
- **Modify:** `apps/chat/src/gateway/gateway-bridge.ts` — wire builder + tool
- **Modify:** `packages/db/prisma/seed-marketplace.ts` — add deployment with skillSlug
- **Create:** `apps/chat/src/gateway/__tests__/ad-optimizer-e2e.test.ts` — integration test

### Phase 4: Dead References

- **Modify:** `packages/core/package.json` — remove dead exports
- **Modify:** `.dependency-cruiser.cjs` — remove cartridge rules
- **Modify:** `scripts/arch-check.ts` — remove cartridge checks
- **Modify:** `apps/chat/src/bootstrap.ts` — remove null \_crmProvider
- **Delete:** `cartridges/` — empty directory

---

## Phase 1: PlatformIngress Migration

### Task 1: Boundary enforcement test

**Files:**

- Create: `apps/api/src/__tests__/ingress-boundary.test.ts`

This test ensures no route file calls `orchestrator.resolveAndPropose()` directly. The existing parity test (criterion 8) only checks `execute.ts`. This test scans ALL route files.

- [ ] **Step 1: Write the boundary test**

```typescript
// apps/api/src/__tests__/ingress-boundary.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES_DIR = resolve(import.meta.dirname, "../routes");

/**
 * Routes that are exempt from the PlatformIngress boundary.
 * - simulate.ts: read-only dry-run, not a work submission
 * - approvals.ts: responds to existing work, not new ingress
 */
const EXEMPT_ROUTES = new Set(["simulate.ts", "approvals.ts"]);

describe("PlatformIngress boundary enforcement", () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("has route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const file of routeFiles) {
    if (EXEMPT_ROUTES.has(file)) continue;

    it(`${file} does not call orchestrator.resolveAndPropose()`, () => {
      const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
      expect(source).not.toContain("orchestrator.resolveAndPropose");
      expect(source).not.toContain("resolveAndPropose(");
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- --run ingress-boundary`

Expected: FAIL — `actions.ts` contains `orchestrator.resolveAndPropose` at lines 52 and 237.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/api/src/__tests__/ingress-boundary.test.ts
git commit -m "test(api): add PlatformIngress boundary enforcement test

Asserts no route file calls orchestrator.resolveAndPropose() directly.
Exempts simulate.ts (read-only) and approvals.ts (response to existing work).
Currently fails — actions.ts still bypasses PlatformIngress."
```

---

### Task 2: Migrate POST /api/actions/propose to PlatformIngress

**Files:**

- Modify: `apps/api/src/routes/actions.ts:11-88`

The `POST /api/actions/propose` handler currently calls `app.orchestrator.resolveAndPropose()`. Replace it with `app.platformIngress.submit()`.

Key mapping: `ProposeBodySchema` fields → `SubmitWorkRequest`:

- `actionType` → `intent`
- `parameters` → `parameters`
- `principalId` → `actor.id` (type: `"user"`)
- `organizationId` → `organizationId`
- `message` → `parameters._message` (preserved in parameters)
- Idempotency-Key header → `idempotencyKey`
- `"api"` → `trigger`

Response mapping: `SubmitWorkResponse` → existing 201 shape:

- `workUnit.id` → `envelopeId`
- `workUnit.traceId` → `traceId`
- On deny: `denied: true`, `explanation: result.summary`
- On approval: `approvalRequest: result.outputs`, `approvalId: result.approvalId`
- On execute: `denied: false`, `executionResult: result.outputs`

- [ ] **Step 1: Replace the propose handler**

Replace the `app.post("/propose", ...)` handler (lines 13-88 of `actions.ts`) with:

```typescript
app.post(
  "/propose",
  {
    schema: {
      description:
        "Create a new action proposal through PlatformIngress. Requires Idempotency-Key header.",
      tags: ["Actions"],
      body: proposeJsonSchema,
      headers: {
        type: "object",
        properties: {
          "Idempotency-Key": { type: "string", description: "Required for replay protection" },
        },
      },
    },
  },
  async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      return reply.code(400).send({
        error: "Idempotency-Key header is required for POST /api/actions/propose",
        statusCode: 400,
      });
    }

    const parsed = ProposeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

    // Skin tool filter enforcement
    const skin = app.resolvedSkin;
    if (skin) {
      const { include, exclude } = skin.toolFilter;
      const included = matchesAny(body.actionType, include);
      const excluded = exclude ? matchesAny(body.actionType, exclude) : false;
      if (!included || excluded) {
        return reply.code(403).send({
          error: `Action "${body.actionType}" is not available in the current skin configuration`,
          statusCode: 403,
        });
      }
    }

    const organizationId = request.organizationIdFromAuth ?? body.organizationId ?? null;
    if (!organizationId) {
      return reply.code(400).send({
        error: "organizationId is required (set via API key metadata or request body)",
        statusCode: 400,
      });
    }

    const submitRequest: SubmitWorkRequest = {
      intent: body.actionType,
      parameters: body.message ? { ...body.parameters, _message: body.message } : body.parameters,
      actor: { id: body.principalId, type: "user" as const },
      organizationId,
      trigger: "api" as const,
      idempotencyKey,
    };

    try {
      const response = await app.platformIngress.submit(submitRequest);

      if (!response.ok) {
        const status = response.error.type === "intent_not_found" ? 404 : 400;
        return reply.code(status).send({
          error: response.error.message,
          statusCode: status,
        });
      }

      const { result, workUnit } = response;

      if ("approvalRequired" in response && response.approvalRequired) {
        return reply.code(201).send({
          outcome: "PENDING_APPROVAL",
          envelopeId: workUnit.id,
          traceId: workUnit.traceId,
          approvalId: result.approvalId,
          approvalRequest: result.outputs,
        });
      }

      const EXECUTION_ERROR_CODES = ["CARTRIDGE_ERROR", "EXECUTION_ERROR", "GOVERNANCE_ERROR"];
      if (result.outcome === "failed") {
        const isExecutionFailure =
          !result.error?.code || EXECUTION_ERROR_CODES.includes(result.error.code);

        if (isExecutionFailure) {
          return reply.code(201).send({
            outcome: "FAILED",
            envelopeId: workUnit.id,
            traceId: workUnit.traceId,
            error: result.error,
          });
        }

        return reply.code(201).send({
          outcome: "DENIED",
          envelopeId: workUnit.id,
          traceId: workUnit.traceId,
          denied: true,
          explanation: result.summary,
        });
      }

      return reply.code(201).send({
        outcome: "EXECUTED",
        envelopeId: workUnit.id,
        traceId: workUnit.traceId,
        executionResult: result.outputs,
        denied: false,
      });
    } catch (err) {
      if (err instanceof NeedsClarificationError) {
        return reply.code(422).send({
          status: "needs_clarification",
          question: err.question,
        });
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          explanation: err.explanation,
        });
      }
      return reply.code(500).send({
        error: sanitizeErrorMessage(err, 500),
      });
    }
  },
);
```

- [ ] **Step 2: Update imports at top of actions.ts**

Add the PlatformIngress import and NeedsClarificationError/NotFoundError:

```typescript
import {
  inferCartridgeId,
  matchesAny,
  NeedsClarificationError,
  NotFoundError,
} from "@switchboard/core";
import type { SubmitWorkRequest } from "@switchboard/core/platform";
```

Remove `inferCartridgeId` from the import if it's no longer used (the propose handler no longer needs it). Check: the `:id/execute` and `:id/undo` handlers don't use `inferCartridgeId` either — only the old propose did. The batch handler (migrated next) also won't need it. If no remaining usage, remove the import.

- [ ] **Step 3: Run boundary test to verify propose passes**

Run: `pnpm --filter @switchboard/api test -- --run ingress-boundary`

Expected: Still FAIL — batch handler (line 237) still calls `resolveAndPropose`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/actions.ts
git commit -m "feat(api): migrate POST /api/actions/propose to PlatformIngress

Replaces orchestrator.resolveAndPropose() with platformIngress.submit().
Requires Idempotency-Key header (new requirement).
Response shape uses outcome/envelopeId/traceId pattern matching execute.ts."
```

---

### Task 3: Migrate POST /api/actions/batch to PlatformIngress

**Files:**

- Modify: `apps/api/src/routes/actions.ts:196-253`
- Modify: `apps/api/src/validation.ts:29-42`

Each proposal in the batch becomes an independent `SubmitWorkRequest`. No parent/child WorkUnit relationship. Each gets its own idempotency key derived from a batch-level key + index.

- [ ] **Step 1: Add batch idempotency key to validation schema**

In `apps/api/src/validation.ts`, update `BatchProposeBodySchema` to include an optional `batchCorrelationId`:

```typescript
export const BatchProposeBodySchema = z.object({
  proposals: z
    .array(
      z.object({
        actionType: z.string().min(1).max(500),
        parameters: boundedParameters,
      }),
    )
    .min(1)
    .max(50),
  principalId: z.string().min(1).max(500),
  organizationId: z.string().max(500).optional(),
  cartridgeId: z.string().max(500).optional(),
  batchCorrelationId: z.string().max(500).optional(),
});
```

- [ ] **Step 2: Replace the batch handler**

Replace the `app.post("/batch", ...)` handler (lines 197-253 of `actions.ts`) with:

```typescript
app.post(
  "/batch",
  {
    schema: {
      description: "Submit multiple action proposals as independent WorkUnits via PlatformIngress.",
      tags: ["Actions"],
      body: batchJsonSchema,
      headers: {
        type: "object",
        properties: {
          "Idempotency-Key": {
            type: "string",
            description: "Required batch-level key. Per-proposal keys derived as {key}:{index}.",
          },
        },
      },
    },
  },
  async (request, reply) => {
    const batchKey = request.headers["idempotency-key"];
    if (!batchKey || typeof batchKey !== "string" || !batchKey.trim()) {
      return reply.code(400).send({
        error: "Idempotency-Key header is required for POST /api/actions/batch",
        statusCode: 400,
      });
    }

    const parsed = BatchProposeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

    // Skin tool filter enforcement — reject entire batch if any proposal is disallowed
    const batchSkin = app.resolvedSkin;
    if (batchSkin) {
      const { include, exclude } = batchSkin.toolFilter;
      for (const proposal of body.proposals) {
        const included = matchesAny(proposal.actionType, include);
        const excluded = exclude ? matchesAny(proposal.actionType, exclude) : false;
        if (!included || excluded) {
          return reply.code(403).send({
            error: `Action "${proposal.actionType}" is not available in the current skin configuration`,
            statusCode: 403,
          });
        }
      }
    }

    const organizationId = request.organizationIdFromAuth ?? body.organizationId ?? null;
    if (!organizationId) {
      return reply.code(400).send({
        error: "organizationId is required (set via API key metadata or request body)",
        statusCode: 400,
      });
    }

    const results = [];
    for (let i = 0; i < body.proposals.length; i++) {
      const proposal = body.proposals[i];

      const submitRequest: SubmitWorkRequest = {
        intent: proposal.actionType,
        parameters: proposal.parameters,
        actor: { id: body.principalId, type: "user" as const },
        organizationId,
        trigger: "api" as const,
        idempotencyKey: `${batchKey}:${i}`,
      };

      try {
        const response = await app.platformIngress.submit(submitRequest);

        if (!response.ok) {
          results.push({
            index: i,
            outcome: "ERROR",
            error: response.error.message,
          });
          continue;
        }

        const { result, workUnit } = response;
        results.push({
          index: i,
          outcome: result.outcome === "failed" ? "DENIED" : "EXECUTED",
          envelopeId: workUnit.id,
          traceId: workUnit.traceId,
          summary: result.summary,
        });
      } catch (err) {
        results.push({
          index: i,
          outcome: "ERROR",
          error: sanitizeErrorMessage(err, 500),
        });
      }
    }

    return reply.code(201).send({ results });
  },
);
```

- [ ] **Step 3: Clean up unused imports in actions.ts**

After both migrations, `inferCartridgeId` is no longer used in actions.ts. Remove it from the import line. Keep `matchesAny`. Verify the final import block:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { matchesAny, NeedsClarificationError, NotFoundError } from "@switchboard/core";
import type { SubmitWorkRequest } from "@switchboard/core/platform";
import { ProposeBodySchema, BatchProposeBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";
```

Note: `assertOrgAccess` is still used by `GET /:id`, `POST /:id/execute`, `POST /:id/undo`.

- [ ] **Step 4: Run boundary test**

Run: `pnpm --filter @switchboard/api test -- --run ingress-boundary`

Expected: PASS — no route file calls `resolveAndPropose` anymore.

- [ ] **Step 5: Run all API tests**

Run: `pnpm --filter @switchboard/api test`

Expected: Some existing `api-actions.test.ts` tests may fail due to:

1. Missing `Idempotency-Key` header in test payloads
2. Changed response shape (now `outcome`/`envelopeId`/`traceId` instead of `envelope`/`decisionTrace`)

Fix these in the next task.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/actions.ts apps/api/src/validation.ts
git commit -m "feat(api): migrate POST /api/actions/batch to PlatformIngress

Each batch proposal becomes an independent WorkUnit with key {batchKey}:{index}.
No parent/child relationship — governance operates per-WorkUnit.
Removes last direct resolveAndPropose call from route layer."
```

---

### Task 4: Fix api-actions tests for new ingress path

**Files:**

- Modify: `apps/api/src/__tests__/api-actions.test.ts`

The existing tests for `/api/actions/propose` and `/api/actions/batch` need two updates:

1. Add `Idempotency-Key` header to all request payloads
2. Update response assertions to match the new shape

- [ ] **Step 1: Read the existing test file**

Read `apps/api/src/__tests__/api-actions.test.ts` to understand all test cases and their assertions.

- [ ] **Step 2: Add Idempotency-Key headers**

Add `headers: { "Idempotency-Key": "test-key-{unique}" }` to every `app.inject()` call targeting `POST /api/actions/propose` or `POST /api/actions/batch`. Use unique keys per test to avoid idempotency collisions.

- [ ] **Step 3: Update response shape assertions**

For propose tests, update from:

```typescript
expect(body.envelope).toBeDefined();
expect(body.decisionTrace).toBeDefined();
```

To:

```typescript
expect(body.envelopeId).toBeDefined();
expect(body.traceId).toBeDefined();
expect(body.outcome).toBeDefined();
```

For batch tests, update from:

```typescript
expect(body.results[0].envelope).toBeDefined();
```

To:

```typescript
expect(body.results[0].envelopeId).toBeDefined();
expect(body.results[0].outcome).toBeDefined();
```

- [ ] **Step 4: Add test for Idempotency-Key requirement**

```typescript
it("returns 400 when Idempotency-Key header is missing on propose", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    payload: {
      actionType: "digital-ads.campaign.pause",
      parameters: { campaignId: "camp_123" },
      principalId: "default",
      organizationId: "org_test",
    },
  });

  expect(res.statusCode).toBe(400);
  expect(res.json().error).toContain("Idempotency-Key");
});

it("returns 400 when Idempotency-Key header is missing on batch", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/actions/batch",
    payload: {
      proposals: [
        { actionType: "digital-ads.campaign.pause", parameters: { campaignId: "camp_1" } },
      ],
      principalId: "default",
      organizationId: "org_test",
    },
  });

  expect(res.statusCode).toBe(400);
  expect(res.json().error).toContain("Idempotency-Key");
});
```

- [ ] **Step 5: Run all API tests**

Run: `pnpm --filter @switchboard/api test`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/__tests__/api-actions.test.ts
git commit -m "test(api): update actions tests for PlatformIngress migration

Adds Idempotency-Key headers to all propose/batch test payloads.
Updates response assertions to new outcome/envelopeId/traceId shape.
Adds tests verifying Idempotency-Key is required."
```

---

## Phase 2A: Sales Pipeline Agents

### Task 5: Add skillSlug to sales pipeline deployment seeds

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts:500-532`

The 3 sales pipeline demo deployments are created without `skillSlug`. The `salesPipelineBuilder` is already in the gateway's builderMap. Adding `skillSlug: "sales-pipeline"` activates skill-based execution.

- [ ] **Step 1: Add skillSlug to deployment creation loop**

In `seed-marketplace.ts`, find the deployment creation loop (starting ~line 501):

```typescript
const deployment = await prisma.agentDeployment.upsert({
  where: {
    organizationId_listingId: {
      organizationId: ORG_ID,
      listingId: listing.id,
    },
  },
  update: {
    status: "active",
    inputConfig: {},
    governanceSettings: {},
    connectionIds: [],
  },
  create: {
    organizationId: ORG_ID,
    listingId: listing.id,
    status: "active",
    inputConfig: {},
    governanceSettings: {},
    connectionIds: [],
  },
});
```

Replace with:

```typescript
const deployment = await prisma.agentDeployment.upsert({
  where: {
    organizationId_listingId: {
      organizationId: ORG_ID,
      listingId: listing.id,
    },
  },
  update: {
    status: "active",
    skillSlug: "sales-pipeline",
    inputConfig: {
      businessName: "Austin Bakery Co",
      tone: "friendly",
      bookingLink: "https://cal.com/austin-bakery",
    },
    governanceSettings: {},
    connectionIds: [],
  },
  create: {
    organizationId: ORG_ID,
    listingId: listing.id,
    status: "active",
    skillSlug: "sales-pipeline",
    inputConfig: {
      businessName: "Austin Bakery Co",
      tone: "friendly",
      bookingLink: "https://cal.com/austin-bakery",
    },
    governanceSettings: {},
    connectionIds: [],
  },
});
```

- [ ] **Step 2: Run seed to verify**

Run: `pnpm db:seed`

Expected: Seeds complete without errors. Console output shows 3 sales pipeline deployments created with skill slug.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/seed-marketplace.ts
git commit -m "feat(db): add skillSlug to sales pipeline deployment seeds

Sets skillSlug: 'sales-pipeline' on Speed-to-Lead, Sales Closer,
and Nurture Specialist demo deployments. Adds inputConfig with
businessName, tone, and bookingLink for parameter builder."
```

---

### Task 6: Sales pipeline gateway integration test

**Files:**

- Create: `apps/chat/src/gateway/__tests__/sales-pipeline-e2e.test.ts`

This test verifies sales pipeline deployments route through SkillHandler (not DefaultChatHandler), using the same gateway path as Alex.

- [ ] **Step 1: Write the integration test**

```typescript
// apps/chat/src/gateway/__tests__/sales-pipeline-e2e.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import type {
  ChannelGatewayConfig,
  DeploymentInfo,
  IncomingChannelMessage,
  ReplySink,
  SkillRuntimeDeps,
} from "@switchboard/core/channel-gateway";
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
} from "@switchboard/core/skill-runtime";
import type { ParameterBuilder, SkillStores } from "@switchboard/core/skill-runtime";
import type { AgentPersona } from "@switchboard/sdk";

describe("Sales Pipeline end-to-end wiring", () => {
  let mockDeploymentLookup: ChannelGatewayConfig["deploymentLookup"];
  let mockConversationStore: ChannelGatewayConfig["conversationStore"];
  let mockStateStore: ChannelGatewayConfig["stateStore"];
  let mockActionRequestStore: ChannelGatewayConfig["actionRequestStore"];
  let mockLlmAdapterFactory: ChannelGatewayConfig["llmAdapterFactory"];
  let mockSkillRuntime: SkillRuntimeDeps;
  let mockSkillExecutor: SkillExecutor;
  let mockSkillStores: SkillStores;
  let replySink: ReplySink;
  let sentMessages: string[];

  const mockPersona: AgentPersona = {
    businessName: "Austin Bakery Co",
    tone: "friendly",
    qualificationCriteria: [],
    disqualificationCriteria: [],
    escalationRules: [],
    bookingLink: "https://cal.com/austin-bakery",
    customInstructions: "",
  };

  const ROLE_FOCUS_CASES = [
    { slug: "speed-to-lead", roleFocus: "leads", deploymentId: "deploy_stl" },
    { slug: "sales-closer", roleFocus: "growth", deploymentId: "deploy_closer" },
    { slug: "nurture-specialist", roleFocus: "care", deploymentId: "deploy_nurture" },
  ] as const;

  const mockSkillDefinition: SkillDefinition = {
    name: "Sales Pipeline",
    slug: "sales-pipeline",
    version: "1.0.0",
    description: "Three-stage sales pipeline agent",
    author: "Switchboard",
    parameters: [
      { name: "BUSINESS_NAME", type: "string", required: true },
      { name: "OPPORTUNITY_ID", type: "string", required: true },
      { name: "LEAD_PROFILE", type: "object", required: true },
      { name: "PIPELINE_STAGE", type: "string", required: true },
      { name: "PERSONA_CONFIG", type: "object", required: true },
    ],
    tools: ["crm-query", "crm-write"],
    body: "You are a sales pipeline agent.",
    context: [],
  };

  const mockSkillResult: SkillExecutionResult = {
    response: "Welcome! How can I help with your order?",
    toolCalls: [],
    tokenUsage: { input: 80, output: 40 },
    trace: {
      durationMs: 200,
      turnCount: 1,
      status: "success",
      responseSummary: "Greeting sent",
      writeCount: 0,
      governanceDecisions: [],
    },
  };

  beforeEach(() => {
    sentMessages = [];

    mockConversationStore = {
      getOrCreateBySession: vi.fn(async () => ({
        conversationId: "conv_sp",
        messages: [],
      })),
      addMessage: vi.fn(async () => {}),
    };

    mockStateStore = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({})),
    };

    mockActionRequestStore = {
      save: vi.fn(async () => {}),
      findById: vi.fn(async () => null),
      findPendingByDeployment: vi.fn(async () => []),
      updateStatus: vi.fn(async () => {}),
    };

    mockLlmAdapterFactory = vi.fn(() => ({
      generateReply: vi.fn(async () => ({
        reply: "Fallback LLM — should NOT be used",
        usage: { inputTokens: 10, outputTokens: 10 },
      })),
    }));

    mockSkillStores = {
      opportunityStore: {
        findActiveByContact: vi.fn(async () => [
          { id: "opp_sp", stage: "qualification", createdAt: new Date() },
        ]),
      },
      contactStore: {
        findById: vi.fn(async () => ({
          id: "contact_sp",
          name: "Test Lead",
          email: "lead@example.com",
        })),
      },
      activityStore: {
        listByDeployment: vi.fn(async () => []),
      },
    };

    mockSkillExecutor = {
      execute: vi.fn(async (_params: SkillExecutionParams) => mockSkillResult),
    };

    replySink = {
      send: vi.fn(async (text: string) => {
        sentMessages.push(text);
      }),
      onTyping: vi.fn(),
    };
  });

  for (const { slug, roleFocus, deploymentId } of ROLE_FOCUS_CASES) {
    it(`routes ${slug} (roleFocus: ${roleFocus}) through SkillHandler`, async () => {
      const deploymentInfo: DeploymentInfo = {
        deployment: {
          id: deploymentId,
          listingId: `listing_${slug}`,
          organizationId: "org_test",
          skillSlug: "sales-pipeline",
        },
        persona: mockPersona,
        trustScore: 45,
        trustLevel: "guided",
      };

      mockDeploymentLookup = {
        findByChannelToken: vi.fn(async () => deploymentInfo),
      };

      const mockBuilder: ParameterBuilder = vi.fn(async (ctx, _config, _stores) => ({
        BUSINESS_NAME: ctx.persona.businessName,
        OPPORTUNITY_ID: "opp_sp",
        LEAD_PROFILE: { id: "contact_sp", name: "Test Lead" },
        PIPELINE_STAGE: "qualification",
        PERSONA_CONFIG: { tone: ctx.persona.tone },
      }));

      mockSkillRuntime = {
        skillsDir: "/mock/skills",
        loadSkill: vi.fn(() => mockSkillDefinition),
        createExecutor: vi.fn(() => mockSkillExecutor),
        builderMap: new Map([["sales-pipeline", mockBuilder]]),
        stores: mockSkillStores,
        hooks: [],
        contextResolver: {
          resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
        },
      };

      const gateway = new ChannelGateway({
        deploymentLookup: mockDeploymentLookup,
        conversationStore: mockConversationStore,
        stateStore: mockStateStore,
        actionRequestStore: mockActionRequestStore,
        llmAdapterFactory: mockLlmAdapterFactory,
        skillRuntime: mockSkillRuntime,
      });

      const message: IncomingChannelMessage = {
        channel: "whatsapp",
        token: "sp_token",
        sessionId: "session_sp",
        text: "I want to order a cake for Saturday",
        visitor: { name: "Test Lead", email: "lead@example.com" },
      };

      await gateway.handleIncoming(message, replySink);

      // Verify SkillHandler path was used (not DefaultChatHandler)
      expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("sales-pipeline", "/mock/skills");
      expect(mockSkillRuntime.createExecutor).toHaveBeenCalled();
      expect(mockSkillExecutor.execute).toHaveBeenCalled();

      // Verify skill response was sent (not fallback LLM)
      expect(replySink.send).toHaveBeenCalledWith(mockSkillResult.response);

      // Verify fallback LLM was NOT used
      const llmFactory = mockLlmAdapterFactory as ReturnType<typeof vi.fn>;
      const llmAdapter = llmFactory.mock.results[0]?.value;
      if (llmAdapter) {
        expect(llmAdapter.generateReply).not.toHaveBeenCalled();
      }
    });
  }

  it("falls back to DefaultChatHandler when skillSlug is missing", async () => {
    const noSkillDeployment: DeploymentInfo = {
      deployment: {
        id: "deploy_no_skill",
        listingId: "listing_no_skill",
        organizationId: "org_test",
        // No skillSlug
      },
      persona: mockPersona,
      trustScore: 10,
      trustLevel: "supervised",
    };

    mockDeploymentLookup = {
      findByChannelToken: vi.fn(async () => noSkillDeployment),
    };

    mockSkillRuntime = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn(() => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map([["sales-pipeline", vi.fn()]]),
      stores: mockSkillStores,
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

    const gateway = new ChannelGateway({
      deploymentLookup: mockDeploymentLookup,
      conversationStore: mockConversationStore,
      stateStore: mockStateStore,
      actionRequestStore: mockActionRequestStore,
      llmAdapterFactory: mockLlmAdapterFactory,
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "telegram",
      token: "tg_token",
      sessionId: "session_noskill",
      text: "Hello",
      visitor: { name: "Visitor" },
    };

    await gateway.handleIncoming(message, replySink);

    // Verify SkillHandler was NOT used
    expect(mockSkillExecutor.execute).not.toHaveBeenCalled();

    // Verify DefaultChatHandler (LLM) was used
    expect(replySink.send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @switchboard/chat test -- --run sales-pipeline-e2e`

Expected: PASS — all 4 test cases (3 role focus variants + 1 fallback) pass.

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/gateway/__tests__/sales-pipeline-e2e.test.ts
git commit -m "test(chat): add sales pipeline gateway integration tests

Verifies all 3 sales agents (speed-to-lead, closer, nurture) route
through SkillHandler via the same gateway path as Alex.
Confirms DefaultChatHandler fallback when skillSlug is absent."
```

---

## Phase 2B: Website Profiler

### Task 7: Wire websiteProfilerBuilder and web scanner tool into gateway

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts:32,130-133,143-154`

- [ ] **Step 1: Add import for websiteProfilerBuilder and createWebScannerTool**

In `gateway-bridge.ts`, update the skill-runtime import (line 28-35):

```typescript
import {
  loadSkill,
  SkillExecutorImpl,
  AnthropicToolCallingAdapter,
  createCrmQueryTool,
  createCrmWriteTool,
  createWebScannerTool,
  alexBuilder,
  salesPipelineBuilder,
  websiteProfilerBuilder,
  ContextResolverImpl,
} from "@switchboard/core/skill-runtime";
```

- [ ] **Step 2: Add website-profiler to builderMap**

Update the builderMap (line 130-133):

```typescript
const builderMap = new Map<string, ParameterBuilder>([
  ["sales-pipeline", salesPipelineBuilder],
  ["alex", alexBuilder],
  ["website-profiler", websiteProfilerBuilder],
]);
```

- [ ] **Step 3: Add web scanner tool to createExecutor**

Update the `createExecutor` function to include the web scanner tool:

```typescript
const createExecutor = () => {
  const crmQueryTool = createCrmQueryTool(contactStore, activityStore);
  const crmWriteTool = createCrmWriteTool(opportunityStore, activityStore);
  const webScannerTool = createWebScannerTool();

  const toolsMap = new Map([
    [crmQueryTool.id, crmQueryTool],
    [crmWriteTool.id, crmWriteTool],
    [webScannerTool.id, webScannerTool],
  ]);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return new SkillExecutorImpl(new AnthropicToolCallingAdapter(client), toolsMap, modelRouter);
};
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `pnpm --filter @switchboard/chat test`

Expected: PASS — adding new entries to maps doesn't break existing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts
git commit -m "feat(chat): wire website profiler builder and web scanner tool into gateway

Registers websiteProfilerBuilder in builderMap and createWebScannerTool
in executor tool map. Deployments with skillSlug 'website-profiler' now
route through SkillHandler."
```

---

### Task 8: Add website profiler listing and deployment seed

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

- [ ] **Step 1: Add WEBSITE_PROFILER listing constant**

Add after the `AD_OPTIMIZER` constant (around line 199):

```typescript
const WEBSITE_PROFILER = {
  name: "Website Profiler",
  slug: "website-profiler",
  description:
    "Scans a business website and extracts a structured profile — platform, contact info, services, pricing signals, and brand language. Results feed into other agents.",
  taskCategories: ["website-analysis"],
  metadata: {
    isBundle: false,
    family: "onboarding",
    setupSchema: {
      onboarding: {
        websiteScan: false,
        publicChannels: false,
        privateChannel: false,
        integrations: [],
      },
      steps: [
        {
          id: "basics",
          title: "Profiler Setup",
          fields: [
            {
              key: "targetUrl",
              type: "url",
              label: "Website URL to scan",
              required: true,
            },
          ],
        },
      ],
    },
  },
};
```

- [ ] **Step 2: Seed the listing in `seedMarketplace()`**

Add after the Alex listing upsert (around line 459):

```typescript
// Seed Website Profiler
const profiler = await prisma.agentListing.upsert({
  where: { slug: WEBSITE_PROFILER.slug },
  update: {
    name: WEBSITE_PROFILER.name,
    description: WEBSITE_PROFILER.description,
    taskCategories: WEBSITE_PROFILER.taskCategories,
    metadata: WEBSITE_PROFILER.metadata,
    status: "listed",
  },
  create: {
    ...WEBSITE_PROFILER,
    type: "switchboard_native",
    status: "listed",
    trustScore: 0,
    autonomyLevel: "supervised",
    priceTier: "free",
    priceMonthly: 0,
  },
});
console.warn(`  Seeded listing: ${WEBSITE_PROFILER.name} (${profiler.id})`);
```

- [ ] **Step 3: Add deployment with skillSlug in `seedDemoData()`**

In `seedDemoData()`, after the Alex deployment creation (around line 603), add:

```typescript
// 5. Create Website Profiler deployment with skillSlug
const profilerListing = await prisma.agentListing.findUnique({
  where: { slug: "website-profiler" },
});
if (profilerListing) {
  const profilerDeployment = await prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: {
        organizationId: ORG_ID,
        listingId: profilerListing.id,
      },
    },
    update: {
      status: "active",
      skillSlug: "website-profiler",
      inputConfig: {},
      governanceSettings: {},
      connectionIds: [],
    },
    create: {
      organizationId: ORG_ID,
      listingId: profilerListing.id,
      status: "active",
      skillSlug: "website-profiler",
      inputConfig: {},
      governanceSettings: {},
      connectionIds: [],
    },
  });
  console.warn(`  Created deployment: ${WEBSITE_PROFILER.name} (${profilerDeployment.id})`);
}
```

- [ ] **Step 4: Run seed**

Run: `pnpm db:seed`

Expected: Seeds complete. Website Profiler listing and deployment created.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed-marketplace.ts
git commit -m "feat(db): seed website profiler listing and deployment

Adds Website Profiler to marketplace with skillSlug 'website-profiler'.
Read-only agent for scanning business websites and extracting profiles."
```

---

### Task 9: Website profiler integration test

**Files:**

- Create: `apps/chat/src/gateway/__tests__/website-profiler-e2e.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/chat/src/gateway/__tests__/website-profiler-e2e.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import type {
  ChannelGatewayConfig,
  DeploymentInfo,
  IncomingChannelMessage,
  ReplySink,
  SkillRuntimeDeps,
} from "@switchboard/core/channel-gateway";
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
} from "@switchboard/core/skill-runtime";
import type { ParameterBuilder, SkillStores } from "@switchboard/core/skill-runtime";

describe("Website Profiler end-to-end wiring", () => {
  let replySink: ReplySink;
  let sentMessages: string[];
  let mockSkillExecutor: SkillExecutor;

  const mockSkillDefinition: SkillDefinition = {
    name: "Website Profiler",
    slug: "website-profiler",
    version: "1.0.0",
    description: "Website analysis agent",
    author: "Switchboard",
    parameters: [
      { name: "TARGET_URL", type: "string", required: true },
      { name: "BUSINESS_NAME", type: "string", required: false },
      { name: "PERSONA_CONFIG", type: "object", required: false },
    ],
    tools: ["web-scanner"],
    body: "You are a website profiler.",
    context: [],
  };

  const mockSkillResult: SkillExecutionResult = {
    response: "I found a WordPress site for Glow Aesthetics with 5 service pages...",
    toolCalls: [
      {
        toolId: "web-scanner",
        operation: "fetch-pages",
        input: { url: "https://glow-aesthetics.com" },
        output: { homepageHtml: "<html>...</html>" },
        governanceDecision: "auto-approved",
        durationMs: 1500,
      },
    ],
    tokenUsage: { input: 200, output: 150 },
    trace: {
      durationMs: 3000,
      turnCount: 3,
      status: "success",
      responseSummary: "Website profile extracted",
      writeCount: 0,
      governanceDecisions: [],
    },
  };

  beforeEach(() => {
    sentMessages = [];
    replySink = {
      send: vi.fn(async (text: string) => {
        sentMessages.push(text);
      }),
      onTyping: vi.fn(),
    };
    mockSkillExecutor = {
      execute: vi.fn(async (_params: SkillExecutionParams) => mockSkillResult),
    };
  });

  it("routes message with URL through SkillHandler with web-scanner tool", async () => {
    const deploymentInfo: DeploymentInfo = {
      deployment: {
        id: "deploy_profiler",
        listingId: "listing_profiler",
        organizationId: "org_test",
        skillSlug: "website-profiler",
      },
      persona: {
        businessName: "Glow Aesthetics",
        tone: "professional",
        qualificationCriteria: [],
        disqualificationCriteria: [],
        escalationRules: [],
        bookingLink: "",
        customInstructions: "",
      },
      trustScore: 20,
      trustLevel: "supervised",
    };

    const mockBuilder: ParameterBuilder = vi.fn(async () => ({
      TARGET_URL: "https://glow-aesthetics.com",
      BUSINESS_NAME: "Glow Aesthetics",
      PERSONA_CONFIG: { tone: "professional" },
    }));

    const mockSkillRuntime: SkillRuntimeDeps = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn(() => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map([["website-profiler", mockBuilder]]),
      stores: {
        opportunityStore: { findActiveByContact: vi.fn(async () => []) },
        contactStore: { findById: vi.fn(async () => null) },
        activityStore: { listByDeployment: vi.fn(async () => []) },
      },
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

    const gateway = new ChannelGateway({
      deploymentLookup: {
        findByChannelToken: vi.fn(async () => deploymentInfo),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn(async () => ({ conversationId: "conv_prof", messages: [] })),
        addMessage: vi.fn(async () => {}),
      },
      stateStore: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => ({})),
      },
      actionRequestStore: {
        save: vi.fn(async () => {}),
        findById: vi.fn(async () => null),
        findPendingByDeployment: vi.fn(async () => []),
        updateStatus: vi.fn(async () => {}),
      },
      llmAdapterFactory: vi.fn(() => ({
        generateReply: vi.fn(async () => ({
          reply: "Fallback — should NOT be used",
          usage: { inputTokens: 10, outputTokens: 10 },
        })),
      })),
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "widget",
      token: "widget_token_prof",
      sessionId: "session_prof",
      text: "Can you scan https://glow-aesthetics.com?",
      visitor: { name: "Owner" },
    };

    await gateway.handleIncoming(message, replySink);

    // Verify SkillHandler path
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("website-profiler", "/mock/skills");
    expect(mockSkillExecutor.execute).toHaveBeenCalled();
    expect(replySink.send).toHaveBeenCalledWith(mockSkillResult.response);

    // Verify skill received the web-scanner tool declaration
    const execCall = (mockSkillExecutor.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(execCall.skill.tools).toContain("web-scanner");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @switchboard/chat test -- --run website-profiler-e2e`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/gateway/__tests__/website-profiler-e2e.test.ts
git commit -m "test(chat): add website profiler gateway integration test

Verifies website-profiler deployments route through SkillHandler
with web-scanner tool available. Confirms skill execution path."
```

---

## Phase 2C: Ad Optimizer (Chat-Triggered)

### Task 10: Write interactive ad optimizer parameter builder

**Files:**

- Create: `packages/core/src/skill-runtime/builders/ad-optimizer-interactive.ts`
- Modify: `packages/core/src/skill-runtime/builders/index.ts`
- Modify: `packages/core/src/skill-runtime/index.ts`

The existing `adOptimizerBuilder` is a `BatchParameterBuilder` — different signature from the interactive `ParameterBuilder` the gateway expects. We need a thin interactive builder that provides deployment config and lets the LLM use tools at runtime.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/skill-runtime/builders/__tests__/ad-optimizer-interactive.test.ts
import { describe, it, expect, vi } from "vitest";
import { adOptimizerInteractiveBuilder } from "../ad-optimizer-interactive.js";
import type { AgentContext } from "@switchboard/schemas";

describe("adOptimizerInteractiveBuilder", () => {
  it("returns DEPLOYMENT_CONFIG from inputConfig", async () => {
    const ctx = {
      persona: { businessName: "Test Biz", tone: "professional" },
      deployment: {
        inputConfig: {
          monthlyBudget: "5000",
          targetCPA: "25",
          targetROAS: "3.0",
          auditFrequency: "weekly",
          pixelId: "123456",
        },
      },
      conversation: { messages: [{ content: "Audit my campaigns" }] },
    } as unknown as AgentContext;

    const config = { deploymentId: "dep_ao", orgId: "org_test", contactId: "c_1" };
    const stores = {
      opportunityStore: { findActiveByContact: vi.fn(async () => []) },
      contactStore: { findById: vi.fn(async () => null) },
      activityStore: { listByDeployment: vi.fn(async () => []) },
    };

    const result = await adOptimizerInteractiveBuilder(ctx, config, stores);

    expect(result.DEPLOYMENT_CONFIG).toEqual({
      monthlyBudget: "5000",
      targetCPA: "25",
      targetROAS: "3.0",
      auditFrequency: "weekly",
      pixelId: "123456",
    });
    expect(result.BUSINESS_NAME).toBe("Test Biz");
    expect(result.PERSONA_CONFIG).toBeDefined();
  });

  it("provides empty DEPLOYMENT_CONFIG when inputConfig is missing", async () => {
    const ctx = {
      persona: { businessName: "Empty Config Biz", tone: "casual" },
      deployment: { inputConfig: {} },
      conversation: { messages: [] },
    } as unknown as AgentContext;

    const config = { deploymentId: "dep_ao2", orgId: "org_test", contactId: "c_2" };
    const stores = {
      opportunityStore: { findActiveByContact: vi.fn(async () => []) },
      contactStore: { findById: vi.fn(async () => null) },
      activityStore: { listByDeployment: vi.fn(async () => []) },
    };

    const result = await adOptimizerInteractiveBuilder(ctx, config, stores);

    expect(result.DEPLOYMENT_CONFIG).toEqual({});
    expect(result.BUSINESS_NAME).toBe("Empty Config Biz");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run ad-optimizer-interactive`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the builder**

```typescript
// packages/core/src/skill-runtime/builders/ad-optimizer-interactive.ts
import type { ParameterBuilder } from "../parameter-builder.js";

/**
 * Interactive parameter builder for the Ad Optimizer skill.
 *
 * Unlike the batch builder (which pre-fetches all campaign data from APIs),
 * this builder provides only deployment configuration. The LLM uses
 * ads-analytics tools at runtime to fetch and analyze campaign data
 * based on the user's conversational request.
 */
export const adOptimizerInteractiveBuilder: ParameterBuilder = async (ctx, _config, _stores) => {
  const inputConfig = (ctx.deployment?.inputConfig ?? {}) as Record<string, unknown>;

  return {
    BUSINESS_NAME: ctx.persona.businessName,
    DEPLOYMENT_CONFIG: inputConfig,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
```

- [ ] **Step 4: Export from builders barrel**

In `packages/core/src/skill-runtime/builders/index.ts`, add:

```typescript
export { adOptimizerInteractiveBuilder } from "./ad-optimizer-interactive.js";
```

- [ ] **Step 5: Re-export from skill-runtime barrel**

In `packages/core/src/skill-runtime/index.ts`, add `adOptimizerInteractiveBuilder` to the builders export line:

```typescript
export {
  alexBuilder,
  salesPipelineBuilder,
  websiteProfilerBuilder,
  adOptimizerInteractiveBuilder,
} from "./builders/index.js";
```

- [ ] **Step 6: Run test**

Run: `pnpm --filter @switchboard/core test -- --run ad-optimizer-interactive`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/builders/ad-optimizer-interactive.ts \
       packages/core/src/skill-runtime/builders/__tests__/ad-optimizer-interactive.test.ts \
       packages/core/src/skill-runtime/builders/index.ts \
       packages/core/src/skill-runtime/index.ts
git commit -m "feat(core): add interactive ad optimizer parameter builder

Thin interactive builder for chat-triggered ad optimization.
Provides deployment config; LLM uses ads-analytics tools at runtime
to fetch campaign data. Separate from batch builder (used for scheduled runs)."
```

---

### Task 11: Wire ad optimizer into gateway

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`

- [ ] **Step 1: Add imports**

Update the skill-runtime import to include `adOptimizerInteractiveBuilder` and `createAdsAnalyticsTool`:

```typescript
import {
  loadSkill,
  SkillExecutorImpl,
  AnthropicToolCallingAdapter,
  createCrmQueryTool,
  createCrmWriteTool,
  createWebScannerTool,
  createAdsAnalyticsTool,
  alexBuilder,
  salesPipelineBuilder,
  websiteProfilerBuilder,
  adOptimizerInteractiveBuilder,
  ContextResolverImpl,
} from "@switchboard/core/skill-runtime";
```

- [ ] **Step 2: Add ad-optimizer to builderMap**

```typescript
const builderMap = new Map<string, ParameterBuilder>([
  ["sales-pipeline", salesPipelineBuilder],
  ["alex", alexBuilder],
  ["website-profiler", websiteProfilerBuilder],
  ["ad-optimizer", adOptimizerInteractiveBuilder],
]);
```

- [ ] **Step 3: Add ads-analytics tool to createExecutor**

```typescript
const createExecutor = () => {
  const crmQueryTool = createCrmQueryTool(contactStore, activityStore);
  const crmWriteTool = createCrmWriteTool(opportunityStore, activityStore);
  const webScannerTool = createWebScannerTool();
  const adsAnalyticsTool = createAdsAnalyticsTool();

  const toolsMap = new Map([
    [crmQueryTool.id, crmQueryTool],
    [crmWriteTool.id, crmWriteTool],
    [webScannerTool.id, webScannerTool],
    [adsAnalyticsTool.id, adsAnalyticsTool],
  ]);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return new SkillExecutorImpl(new AnthropicToolCallingAdapter(client), toolsMap, modelRouter);
};
```

Note: `createAdsDataTool(deps)` is NOT wired here — it requires `adsClient`/`capiClient` infrastructure (Meta OAuth). The `ads-analytics` tool is zero-arg and provides diagnostic analysis (diagnose, compare-periods, analyze-funnel, check-learning-phase). The `ads-data` tool (which fetches real campaign data from Meta APIs) can be wired later when OAuth infrastructure is ready.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/chat test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts
git commit -m "feat(chat): wire ad optimizer builder and ads-analytics tool into gateway

Registers adOptimizerInteractiveBuilder in builderMap and ads-analytics
tool in executor. ads-data tool (requires Meta OAuth) deferred to later.
Deployments with skillSlug 'ad-optimizer' now route through SkillHandler."
```

---

### Task 12: Add ad optimizer deployment seed with skillSlug

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

- [ ] **Step 1: Add ad optimizer deployment in seedDemoData()**

After the website profiler deployment (added in Task 8), add:

```typescript
// 6. Create Ad Optimizer deployment with skillSlug
const adOptimizerListing = await prisma.agentListing.findUnique({
  where: { slug: "ad-optimizer" },
});
if (adOptimizerListing) {
  const adOptDeployment = await prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: {
        organizationId: ORG_ID,
        listingId: adOptimizerListing.id,
      },
    },
    update: {
      status: "active",
      skillSlug: "ad-optimizer",
      inputConfig: {
        monthlyBudget: "3000",
        targetCPA: "30",
        targetROAS: "2.5",
        auditFrequency: "weekly",
      },
      governanceSettings: {},
      connectionIds: [],
    },
    create: {
      organizationId: ORG_ID,
      listingId: adOptimizerListing.id,
      status: "active",
      skillSlug: "ad-optimizer",
      inputConfig: {
        monthlyBudget: "3000",
        targetCPA: "30",
        targetROAS: "2.5",
        auditFrequency: "weekly",
      },
      governanceSettings: {},
      connectionIds: [],
    },
  });
  console.warn(`  Created deployment: ${AD_OPTIMIZER.name} (${adOptDeployment.id})`);
}
```

- [ ] **Step 2: Run seed**

Run: `pnpm db:seed`

Expected: Ad Optimizer deployment created with skillSlug.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/seed-marketplace.ts
git commit -m "feat(db): seed ad optimizer deployment with skillSlug

Sets skillSlug: 'ad-optimizer' on demo deployment with inputConfig
for monthly budget, target CPA/ROAS, and audit frequency."
```

---

### Task 13: Ad optimizer integration test

**Files:**

- Create: `apps/chat/src/gateway/__tests__/ad-optimizer-e2e.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/chat/src/gateway/__tests__/ad-optimizer-e2e.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import type {
  ChannelGatewayConfig,
  DeploymentInfo,
  IncomingChannelMessage,
  ReplySink,
  SkillRuntimeDeps,
} from "@switchboard/core/channel-gateway";
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
} from "@switchboard/core/skill-runtime";
import type { ParameterBuilder, SkillStores } from "@switchboard/core/skill-runtime";

describe("Ad Optimizer chat-triggered end-to-end wiring", () => {
  let replySink: ReplySink;
  let sentMessages: string[];
  let mockSkillExecutor: SkillExecutor;
  let capturedExecParams: SkillExecutionParams | null;

  const mockSkillDefinition: SkillDefinition = {
    name: "Ad Optimizer",
    slug: "ad-optimizer",
    version: "1.0.0",
    description: "Campaign audit and optimization agent",
    author: "Switchboard",
    parameters: [
      { name: "BUSINESS_NAME", type: "string", required: true },
      { name: "DEPLOYMENT_CONFIG", type: "object", required: true },
      { name: "PERSONA_CONFIG", type: "object", required: false },
    ],
    tools: ["ads-analytics"],
    body: "You are an ad optimization specialist.",
    context: [],
  };

  const mockSkillResult: SkillExecutionResult = {
    response:
      "Campaign audit complete. Your top campaign has a CPA of $28 — below your $30 target.",
    toolCalls: [
      {
        toolId: "ads-analytics",
        operation: "diagnose",
        input: { metrics: { spend: 2800, conversions: 100 } },
        output: { diagnosis: "healthy", cpa: 28 },
        governanceDecision: "auto-approved",
        durationMs: 50,
      },
    ],
    tokenUsage: { input: 300, output: 200 },
    trace: {
      durationMs: 1500,
      turnCount: 2,
      status: "success",
      responseSummary: "Campaign audit completed",
      writeCount: 0,
      governanceDecisions: [],
    },
  };

  beforeEach(() => {
    sentMessages = [];
    capturedExecParams = null;
    replySink = {
      send: vi.fn(async (text: string) => {
        sentMessages.push(text);
      }),
      onTyping: vi.fn(),
    };
    mockSkillExecutor = {
      execute: vi.fn(async (params: SkillExecutionParams) => {
        capturedExecParams = params;
        return mockSkillResult;
      }),
    };
  });

  it("routes 'audit my campaigns' through SkillHandler with ads-analytics tool", async () => {
    const deploymentInfo: DeploymentInfo = {
      deployment: {
        id: "deploy_adopt",
        listingId: "listing_adopt",
        organizationId: "org_test",
        skillSlug: "ad-optimizer",
        inputConfig: {
          monthlyBudget: "3000",
          targetCPA: "30",
          auditFrequency: "weekly",
        },
      },
      persona: {
        businessName: "Austin Bakery Co",
        tone: "professional",
        qualificationCriteria: [],
        disqualificationCriteria: [],
        escalationRules: [],
        bookingLink: "",
        customInstructions: "",
      },
      trustScore: 35,
      trustLevel: "guided",
    };

    const mockBuilder: ParameterBuilder = vi.fn(async (ctx) => ({
      BUSINESS_NAME: ctx.persona.businessName,
      DEPLOYMENT_CONFIG: ctx.deployment?.inputConfig ?? {},
      PERSONA_CONFIG: { tone: ctx.persona.tone },
    }));

    const mockSkillRuntime: SkillRuntimeDeps = {
      skillsDir: "/mock/skills",
      loadSkill: vi.fn(() => mockSkillDefinition),
      createExecutor: vi.fn(() => mockSkillExecutor),
      builderMap: new Map([["ad-optimizer", mockBuilder]]),
      stores: {
        opportunityStore: { findActiveByContact: vi.fn(async () => []) },
        contactStore: { findById: vi.fn(async () => null) },
        activityStore: { listByDeployment: vi.fn(async () => []) },
      },
      hooks: [],
      contextResolver: {
        resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
      },
    };

    const gateway = new ChannelGateway({
      deploymentLookup: { findByChannelToken: vi.fn(async () => deploymentInfo) },
      conversationStore: {
        getOrCreateBySession: vi.fn(async () => ({ conversationId: "conv_ao", messages: [] })),
        addMessage: vi.fn(async () => {}),
      },
      stateStore: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => ({})),
      },
      actionRequestStore: {
        save: vi.fn(async () => {}),
        findById: vi.fn(async () => null),
        findPendingByDeployment: vi.fn(async () => []),
        updateStatus: vi.fn(async () => {}),
      },
      llmAdapterFactory: vi.fn(() => ({
        generateReply: vi.fn(async () => ({
          reply: "Fallback — should NOT be used",
          usage: { inputTokens: 10, outputTokens: 10 },
        })),
      })),
      skillRuntime: mockSkillRuntime,
    });

    const message: IncomingChannelMessage = {
      channel: "widget",
      token: "widget_ao",
      sessionId: "session_ao",
      text: "Can you audit my campaigns?",
      visitor: { name: "Owner" },
    };

    await gateway.handleIncoming(message, replySink);

    // Verify SkillHandler path
    expect(mockSkillRuntime.loadSkill).toHaveBeenCalledWith("ad-optimizer", "/mock/skills");
    expect(mockSkillExecutor.execute).toHaveBeenCalled();
    expect(replySink.send).toHaveBeenCalledWith(mockSkillResult.response);

    // Verify ads-analytics tool was declared
    expect(capturedExecParams?.skill.tools).toContain("ads-analytics");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @switchboard/chat test -- --run ad-optimizer-e2e`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/gateway/__tests__/ad-optimizer-e2e.test.ts
git commit -m "test(chat): add ad optimizer chat-triggered integration test

Verifies ad-optimizer deployments route through SkillHandler with
ads-analytics tool. Confirms interactive builder provides deployment
config and skill execution completes."
```

---

## Phase 4: Clean Dead References

### Task 14: Remove dead exports from core package.json

**Files:**

- Modify: `packages/core/package.json:69-72,81-88`

- [ ] **Step 1: Remove the three dead export entries**

Remove these export entries from `packages/core/package.json`:

```json
    "./smb": {
      "types": "./dist/smb/index.d.ts",
      "import": "./dist/smb/index.js"
    },
```

```json
    "./skin": {
      "types": "./dist/skin/index.d.ts",
      "import": "./dist/skin/index.js"
    },
    "./profile": {
      "types": "./dist/profile/index.d.ts",
      "import": "./dist/profile/index.js"
    },
```

- [ ] **Step 2: Verify no consumers exist**

Run: `grep -r '"@switchboard/core/smb\|@switchboard/core/skin\|@switchboard/core/profile"' packages/ apps/ --include="*.ts" -l`

Expected: Zero matches (no file imports from these paths).

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json
git commit -m "chore(core): remove dead exports for ./skin, ./smb, ./profile

These subpath exports reference directories that do not exist.
Verified zero consumers via grep."
```

---

### Task 15: Remove cartridge references from architecture tooling

**Files:**

- Modify: `.dependency-cruiser.cjs:47-72`
- Modify: `scripts/arch-check.ts:92,140-188`
- Delete: `cartridges/` (empty directory)

- [ ] **Step 1: Remove cartridge-specific rules from dependency-cruiser**

In `.dependency-cruiser.cjs`, remove these three rules (lines 47-72):

```javascript
    // Rule: cartridges-no-db
    {
      name: "cartridges-no-db",
      ...
    },
    // Rule: cartridges-no-apps
    {
      name: "cartridges-no-apps",
      ...
    },
    // Rule: no-cross-cartridge-imports
    {
      name: "no-cross-cartridge-imports",
      ...
    },
```

Also remove `cartridges` from the `to.path` patterns in rules that reference it (schemas-no-internal-deps, cartridge-sdk-only-schemas, core-allowed-deps, db-allowed-deps). Replace `"^(packages|cartridges|apps)/"` with `"^(packages|apps)/"` and similar.

- [ ] **Step 2: Remove cartridge checks from arch-check.ts**

In `scripts/arch-check.ts`:

- Line 92: Remove `"cartridges"` from the `getPackageDirs()` directory list. Change to `["packages", "apps"]`.
- Lines 140-158: Delete the `checkDockerfile()` function entirely (it only checks cartridge presence in Dockerfile).
- Lines 162-188: Delete the `checkEslintSync()` function entirely (it only checks cartridge presence in ESLint config).
- Remove any calls to these deleted functions from the main execution flow.

- [ ] **Step 3: Delete the empty cartridges directory**

```bash
rmdir cartridges/
```

If the directory is not empty (e.g., contains a `.gitkeep`), delete its contents first.

- [ ] **Step 4: Run architecture check**

Run: `pnpm arch:check`

Expected: PASS — no cartridge-related checks fail.

- [ ] **Step 5: Commit**

```bash
git add .dependency-cruiser.cjs scripts/arch-check.ts
git rm -r cartridges/ 2>/dev/null || true
git commit -m "chore: remove empty cartridges directory and architecture references

Deletes cartridges/ (empty since skill migration). Removes cartridge
rules from dependency-cruiser and cartridge checks from arch-check.ts."
```

---

### Task 16: Remove null stubs

**Files:**

- Modify: `apps/chat/src/bootstrap.ts:101`

- [ ] **Step 1: Remove \_crmProvider null assignment**

In `apps/chat/src/bootstrap.ts`, find line 101:

```typescript
const _crmProvider: CrmProvider | null = null;
```

Delete this line. Then find where `_crmProvider` is passed to `ChatRuntime` (around line 248):

```typescript
  crmProvider: _crmProvider,
```

Change to:

```typescript
  crmProvider: null,
```

Remove the `CrmProvider` import from the imports at the top of the file if it's no longer used elsewhere.

- [ ] **Step 2: Run chat tests**

Run: `pnpm --filter @switchboard/chat test`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/bootstrap.ts
git commit -m "chore(chat): remove unused _crmProvider null variable

Pass null directly to ChatRuntime config. Removes dead assignment
that existed only to suppress lint warnings."
```

---

### Task 16b: Document operator deps status

**Files:**

- No file changes — documentation only

The spec says to remove the `operatorDeps = null` stub. However, `apps/api/src/bootstrap/services.ts` (line 274) conditionally creates `operatorDeps` when `prismaClient` exists — it's not a dead stub, it's a conditional feature. The null case is the "no database" fallback.

The operator routes (`apps/api/src/routes/operator.ts`) check for null deps and disable themselves. This is correct conditional behavior, not dead code.

**Decision:** Leave as-is. This is not a null stub like `_crmProvider` — it's a feature gate. Document in CLAUDE.md that operator routes require database connection.

---

## Final Verification

### Task 17: Full test suite + typecheck

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

Expected: PASS

- [ ] **Step 4: Run architecture check**

Run: `pnpm arch:check`

Expected: PASS

- [ ] **Step 5: Verify success criteria**

```bash
# No resolveAndPropose in route files (except simulate/approvals)
grep -r "resolveAndPropose" apps/api/src/routes/ --include="*.ts" | grep -v simulate | grep -v approvals | grep -v ".test."

# Zero dead exports
grep -c '"./skin"\|"./smb"\|"./profile"' packages/core/package.json

# Zero cartridge references in tooling
grep -c "cartridges" .dependency-cruiser.cjs scripts/arch-check.ts

# Zero null _crmProvider
grep -c "_crmProvider" apps/chat/src/bootstrap.ts
```

Expected: All grep commands return 0 matches.

- [ ] **Step 6: Commit verification results (if any fixes were needed)**

---

## Summary

| Task | Phase | What it does                                            |
| ---- | ----- | ------------------------------------------------------- |
| 1    | P1    | Boundary enforcement test (no direct resolveAndPropose) |
| 2    | P1    | Migrate propose handler to PlatformIngress              |
| 3    | P1    | Migrate batch handler to N independent WorkUnits        |
| 4    | P1    | Fix existing tests for new response shape               |
| 5    | P2A   | Add skillSlug to sales pipeline seeds                   |
| 6    | P2A   | Integration test: sales pipeline through gateway        |
| 7    | P2B   | Wire website profiler builder + web scanner tool        |
| 8    | P2B   | Seed website profiler listing + deployment              |
| 9    | P2B   | Integration test: website profiler through gateway      |
| 10   | P2C   | Interactive ad optimizer builder                        |
| 11   | P2C   | Wire ad optimizer builder + ads-analytics tool          |
| 12   | P2C   | Seed ad optimizer deployment with skillSlug             |
| 13   | P2C   | Integration test: ad optimizer through gateway          |
| 14   | P4    | Remove dead exports from core package.json              |
| 15   | P4    | Remove cartridge refs from dep-cruiser + arch-check     |
| 16   | P4    | Remove null \_crmProvider stub                          |
| 17   | —     | Full verification suite                                 |
