# AI Workforce Platform Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Switchboard from a multi-vertical SMB operations platform into an AI Workforce Platform with a unified Employee SDK, self-improving memory layer, and the AI Creative as the first employee.

**Architecture:** The Employee SDK exposes a single `defineEmployee()` interface that compiles internally into two runtime primitives: an AgentPort/Handler (event handling) and a Cartridge (governance-gated action execution). The existing governance spine, event loop, and knowledge pipeline are preserved unchanged. A new memory package adds brand knowledge, skill acquisition, and performance tracking.

**Tech Stack:** TypeScript, pnpm + Turborepo, Prisma (PostgreSQL + pgvector), Fastify, Next.js, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-04-03-ai-workforce-platform-design.md`

---

## File Map

### New Packages

```
packages/employee-sdk/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    — Public API: defineEmployee, types
    define-employee.ts          — defineEmployee() entry point + validation
    compile-handler.ts          — Compiles handle() → AgentHandler with context bridging
    compile-cartridge.ts        — Compiles actions[] + execute() → Cartridge
    compile-personality.ts      — Compiles personality config → system prompt builder
    compile-connections.ts      — Compiles simplified connections → ConnectionContract[]
    compile-defaults.ts         — Compiles policies + guardrails → governance defaults
    employee-context-factory.ts — Constructs EmployeeContext from AgentContext + services
    types.ts                    — EmployeeConfig, EmployeeHandlerResult, EmployeeContext, CompiledEmployee
    __tests__/
      define-employee.test.ts
      compile-handler.test.ts
      compile-cartridge.test.ts
      compile-personality.test.ts
      employee-context-factory.test.ts

packages/memory/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    — Public API: interfaces + BrandMemory class
    interfaces.ts               — EmployeeMemory, BrandMemoryStore, SkillStore, PerformanceStore
    brand-memory.ts             — BrandMemory (wraps KnowledgeStore with brand-scoped retrieval)
    skill-retriever.ts          — Retrieves top-K relevant skills for a task
    performance-query.ts        — Queries performance history for context injection
    __tests__/
      brand-memory.test.ts
      skill-retriever.test.ts
      performance-query.test.ts
```

### New Employee

```
employees/creative/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    — defineEmployee() call, main export
    schemas.ts                  — Zod schemas: ContentDraftParams, ContentPublishParams, etc.
    handlers/
      content-requested.ts      — Handle content.requested events
      content-rejected.ts       — Handle content.rejected events (learn + revise)
      content-approved.ts       — Handle content.approved events (trigger publish)
      performance-updated.ts    — Handle content.performance_updated (extract skills)
      onboarded.ts              — Handle employee.onboarded (suggest content calendar)
    execute/
      draft.ts                  — Execute creative.content.draft action
      revise.ts                 — Execute creative.content.revise action
      publish.ts                — Execute creative.content.publish action
      calendar.ts               — Execute creative.calendar.plan + schedule actions
      analyze.ts                — Execute creative.competitor.analyze action
      report.ts                 — Execute creative.performance.report action
    __tests__/
      index.test.ts
      handlers/
        content-requested.test.ts
        content-rejected.test.ts
      execute/
        draft.test.ts
        publish.test.ts
```

### Modified Files

```
packages/schemas/src/
  agent-types.ts                — NEW: AgentPort, AgentHandler, AgentContext, AgentResponse (moved from agents/ports.ts)
  cartridge-types.ts            — NEW: Cartridge, CartridgeManifest, ExecuteResult (moved from cartridge-sdk/cartridge.ts)
  event-types.ts                — NEW: RoutedEventEnvelope, createEventEnvelope (moved from agents/events.ts)
  employee-events.ts            — NEW: Creative employee event type constants
  index.ts                      — MODIFY: add re-exports for new type files

packages/core/src/
  runtime/                      — NEW directory
    event-loop.ts               — MOVED from packages/agents/src/event-loop.ts
    router.ts                   — MOVED from packages/agents/src/router.ts
    handler-registry.ts         — MOVED from packages/agents/src/handler-registry.ts
    action-executor.ts          — MOVED from packages/agents/src/action-executor.ts
    policy-bridge.ts            — MOVED from packages/agents/src/policy-bridge.ts
    scheduled-runner.ts         — MOVED from packages/agents/src/scheduled-runner.ts
    escalation.ts               — MOVED from packages/agents/src/escalation.ts
    registry.ts                 — MOVED from packages/agents/src/registry.ts
    concurrency.ts              — MOVED from packages/agents/src/concurrency.ts
    index.ts                    — NEW: barrel re-exports
  llm/                          — MOVED from packages/agents/src/llm/
    claude-adapter.ts
    claude-embedding-adapter.ts
    index.ts
  knowledge/                    — MOVED from packages/agents/src/knowledge/
    retrieval.ts
    ingestion-pipeline.ts
    chunker.ts
    index.ts

packages/db/prisma/schema.prisma — MODIFY: add employee/memory models, later drop domain models
packages/db/src/stores/
  prisma-skill-store.ts          — NEW: implements SkillStore
  prisma-performance-store.ts    — NEW: implements PerformanceStore
  prisma-employee-store.ts       — NEW: employee registration CRUD

apps/api/src/
  bootstrap/
    employees.ts                 — NEW: employee registration (replaces cartridges.ts pattern)
  routes/
    employee-routes.ts           — NEW: employee management
    content-routes.ts            — NEW: content review, draft approve/reject
    skill-routes.ts              — NEW: skill auditing
```

---

## Phase 1: Type Migration to Schemas

Move shared interface types from `packages/agents` and `packages/cartridge-sdk` down to `packages/schemas` (Layer 1) so that `employee-sdk` (Layer 2) can depend on them.

### Task 1: Move agent types to schemas

**Files:**

- Create: `packages/schemas/src/agent-types.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/agents/src/ports.ts` (re-export from schemas)

- [ ] **Step 1: Write the test**

Create `packages/schemas/src/__tests__/agent-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  AgentPort,
  AgentHandler,
  AgentContext,
  AgentResponse,
  ActionRequest,
  ThreadUpdate,
} from "@switchboard/schemas";

describe("agent-types", () => {
  it("exports AgentPort type", () => {
    const port: AgentPort = {
      agentId: "test",
      version: "1.0.0",
      inboundEvents: ["test.event"],
      outboundEvents: ["test.output"],
      tools: [],
      configSchema: {},
    };
    expect(port.agentId).toBe("test");
  });

  it("exports AgentResponse type", () => {
    const response: AgentResponse = {
      events: [],
      actions: [],
    };
    expect(response.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- agent-types`
Expected: FAIL — `agent-types` module doesn't exist yet.

- [ ] **Step 3: Create agent-types.ts**

Read `packages/agents/src/ports.ts` and copy the type definitions (not the runtime code) to `packages/schemas/src/agent-types.ts`. Include: `AgentPort`, `AgentHandler`, `AgentContext`, `AgentResponse`, `ActionRequest`, `ThreadUpdate`, `LifecycleAdvancer`, `ToolDeclaration`, `AgentContextData`. Import any referenced types from existing schema files (e.g., `ConversationThread` from `conversation-thread`, `OpportunityStage` from `lifecycle`).

- [ ] **Step 4: Add re-export to schemas index**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./agent-types.js";
```

- [ ] **Step 5: Update packages/agents/ports.ts to re-export**

Replace the type definitions in `packages/agents/src/ports.ts` with:

```typescript
export type {
  AgentPort,
  AgentHandler,
  AgentContext,
  AgentResponse,
  ActionRequest,
  ThreadUpdate,
  LifecycleAdvancer,
  ToolDeclaration,
  AgentContextData,
} from "@switchboard/schemas";
```

Keep any runtime functions that exist in the file.

- [ ] **Step 6: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test` and `npx pnpm@9.15.4 --filter @switchboard/agents test`
Expected: All tests pass. The agents package consumes re-exported types transparently.

- [ ] **Step 7: Typecheck across the monorepo**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No type errors. All packages importing from `@switchboard/agents` still resolve the types.

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: move agent interface types to schemas package

Move AgentPort, AgentHandler, AgentContext, AgentResponse and related
types from packages/agents to packages/schemas for Layer 1 access.
packages/agents re-exports for backwards compatibility.
EOF
)"
```

### Task 2: Move cartridge types to schemas

**Files:**

- Create: `packages/schemas/src/cartridge-types.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/cartridge-sdk/src/cartridge.ts` (re-export from schemas)

- [ ] **Step 1: Write the test**

Create `packages/schemas/src/__tests__/cartridge-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  Cartridge,
  CartridgeManifest,
  CartridgeContext,
  ExecuteResult,
  ConnectionContract,
  ConnectionHealth,
} from "@switchboard/schemas";

describe("cartridge-types", () => {
  it("exports ExecuteResult type", () => {
    const result: ExecuteResult = {
      success: true,
      summary: "done",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 100,
      undoRecipe: null,
    };
    expect(result.success).toBe(true);
  });

  it("exports ConnectionContract type", () => {
    const conn: ConnectionContract = {
      serviceId: "openai",
      serviceName: "OpenAI",
      authType: "api_key",
      requiredScopes: [],
      refreshStrategy: "none",
      healthCheck: async () => ({ healthy: true, latencyMs: 10 }),
    };
    expect(conn.serviceId).toBe("openai");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- cartridge-types`
Expected: FAIL.

- [ ] **Step 3: Create cartridge-types.ts**

Read `packages/cartridge-sdk/src/cartridge.ts` and `packages/cartridge-sdk/src/connection.ts`. Copy the interface/type definitions to `packages/schemas/src/cartridge-types.ts`. Include: `Cartridge`, `CartridgeManifest`, `CartridgeContext`, `CartridgeInterceptor`, `ExecuteResult`, `ConnectionContract`, `ConnectionHealth`, `ActionDefinition`, `GuardrailConfig`, `RiskInput`, `ResolvedEntity`, `UndoRecipe`. Import referenced types from existing schema files where needed.

- [ ] **Step 4: Add re-export to schemas index and update cartridge-sdk**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./cartridge-types.js";
```

Update `packages/cartridge-sdk/src/cartridge.ts` and `connection.ts` to re-export from schemas.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx pnpm@9.15.4 test` and `npx pnpm@9.15.4 typecheck`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: move cartridge interface types to schemas package

Move Cartridge, ExecuteResult, ConnectionContract and related types
from packages/cartridge-sdk to packages/schemas for Layer 1 access.
EOF
)"
```

### Task 3: Move event types to schemas

**Files:**

- Create: `packages/schemas/src/event-types.ts`
- Create: `packages/schemas/src/employee-events.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/agents/src/events.ts` (re-export from schemas)

- [ ] **Step 1: Write the test**

Create `packages/schemas/src/__tests__/event-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createEventEnvelope } from "@switchboard/schemas";
import type { RoutedEventEnvelope } from "@switchboard/schemas";

describe("event-types", () => {
  it("creates an event envelope with defaults", () => {
    const envelope = createEventEnvelope({
      eventType: "content.requested",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: { topic: "AI trends" },
    });
    expect(envelope.eventId).toBeDefined();
    expect(envelope.eventType).toBe("content.requested");
    expect(envelope.correlationId).toBeDefined();
    expect(envelope.idempotencyKey).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- event-types`
Expected: FAIL.

- [ ] **Step 3: Create event-types.ts and employee-events.ts**

Move `RoutedEventEnvelope` type and `createEventEnvelope` factory from `packages/agents/src/events.ts` to `packages/schemas/src/event-types.ts`. The `createEventEnvelope` function is a pure factory (UUID generation + defaults) with no external dependencies, safe in schemas.

Create `packages/schemas/src/employee-events.ts`:

```typescript
export const CREATIVE_EVENTS = {
  CONTENT_REQUESTED: "content.requested",
  CONTENT_DRAFT_READY: "content.draft_ready",
  CONTENT_APPROVED: "content.approved",
  CONTENT_REJECTED: "content.rejected",
  CONTENT_PUBLISHED: "content.published",
  CONTENT_FEEDBACK_RECEIVED: "content.feedback_received",
  CONTENT_PERFORMANCE_UPDATED: "content.performance_updated",
  CONTENT_CALENDAR_UPDATED: "content.calendar_updated",
  EMPLOYEE_ONBOARDED: "employee.onboarded",
} as const;

export type CreativeEventType = (typeof CREATIVE_EVENTS)[keyof typeof CREATIVE_EVENTS];
```

- [ ] **Step 4: Add re-exports, update agents/events.ts**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./event-types.js";
export * from "./employee-events.js";
```

Update `packages/agents/src/events.ts` to re-export from schemas.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx pnpm@9.15.4 test` and `npx pnpm@9.15.4 typecheck`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: move event types to schemas, add creative employee events

Move RoutedEventEnvelope and createEventEnvelope from packages/agents
to packages/schemas. Add creative employee event type constants.
EOF
)"
```

---

## Phase 2: Employee SDK

Create the `packages/employee-sdk` package with the `defineEmployee()` function and compilation layer.

### Task 4: Scaffold employee-sdk package

**Files:**

- Create: `packages/employee-sdk/package.json`
- Create: `packages/employee-sdk/tsconfig.json`
- Create: `packages/employee-sdk/vitest.config.ts`
- Create: `packages/employee-sdk/src/index.ts`
- Create: `packages/employee-sdk/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@switchboard/employee-sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@switchboard/schemas": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Model after existing packages (e.g., `packages/cartridge-sdk/tsconfig.json`). Set `"composite": true`, extend from root tsconfig, reference `packages/schemas`.

- [ ] **Step 3: Create vitest.config.ts**

Model after existing packages. Set coverage thresholds at 65/65/70/65 (matching core package).

- [ ] **Step 4: Create types.ts with all SDK types**

```typescript
import type {
  AgentPort,
  AgentHandler,
  AgentContext,
  AgentResponse,
  Cartridge,
  CartridgeManifest,
  ExecuteResult,
  ConnectionContract,
  RoutedEventEnvelope,
  ActionDefinition,
  PolicyRule,
  GuardrailConfig,
} from "@switchboard/schemas";
import type { z } from "zod";

// --- Employee definition types (what the developer writes) ---

export interface PersonalityConfig {
  role: string;
  tone: string;
  traits: string[];
}

export interface EmployeeActionDef {
  type: string;
  description: string;
  riskCategory: "low" | "medium" | "high" | "critical";
  reversible: boolean;
  parameters: z.ZodType;
}

export interface EmployeeConnectionDef {
  service: string;
  purpose: string;
  required: boolean;
}

export interface EmployeePolicyDef {
  action: string;
  effect: "allow" | "deny" | "require_approval";
}

export interface EmployeeGuardrailDef {
  rateLimits?: Array<{ actionPattern: string; maxPerHour: number }>;
  cooldowns?: Array<{ actionPattern: string; seconds: number }>;
}

export interface EmployeeHandlerResult {
  actions: Array<{ type: string; params: Record<string, unknown> }>;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
}

// --- Employee context (what the handler receives) ---

export interface EmployeeMemoryContext {
  brand: {
    search: (
      query: string,
      topK?: number,
    ) => Promise<Array<{ content: string; similarity: number }>>;
  };
  skills: {
    getRelevant: (
      taskType: string,
      format?: string,
      topK?: number,
    ) => Promise<Array<{ pattern: string; score: number }>>;
  };
  performance: {
    getTop: (
      channel: string,
      limit: number,
    ) => Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
  };
}

export interface EmployeeContext {
  organizationId: string;
  contactData?: Record<string, unknown>;
  knowledge: {
    search: (
      query: string,
      topK?: number,
    ) => Promise<Array<{ content: string; similarity: number }>>;
  };
  memory: EmployeeMemoryContext;
  llm: {
    generate: (input: {
      system?: string;
      context?: unknown[];
      prompt: string;
      schema?: z.ZodType;
    }) => Promise<{ text: string; parsed?: unknown }>;
  };
  actions: {
    propose: (type: string, params: Record<string, unknown>) => Promise<ExecuteResult>;
  };
  emit: (type: string, payload: Record<string, unknown>) => void;
  learn: (skill: {
    type: string;
    pattern?: string;
    input?: string;
    feedback?: string;
    evidence?: string[];
    channel?: string;
  }) => Promise<void>;
  personality: { toPrompt: () => string };
}

// --- Employee config (input to defineEmployee) ---

export interface EmployeeConfig {
  id: string;
  name: string;
  version: string;
  description: string;
  personality: PersonalityConfig;
  inboundEvents: string[];
  outboundEvents: string[];
  actions: EmployeeActionDef[];
  handle: (event: RoutedEventEnvelope, context: EmployeeContext) => Promise<EmployeeHandlerResult>;
  execute: (
    actionType: string,
    params: Record<string, unknown>,
    context: EmployeeContext,
  ) => Promise<ExecuteResult>;
  connections?: EmployeeConnectionDef[];
  guardrails?: EmployeeGuardrailDef;
  policies?: EmployeePolicyDef[];
}

// --- Compiled output (what the runtime consumes) ---

export interface CompiledEmployee {
  port: AgentPort;
  handler: AgentHandler;
  cartridge: Cartridge;
  defaults: {
    policies: EmployeePolicyDef[];
    guardrails: EmployeeGuardrailDef;
  };
  connections: EmployeeConnectionDef[];
}
```

- [ ] **Step 5: Create index.ts stub**

```typescript
export { defineEmployee } from "./define-employee.js";
export type {
  EmployeeConfig,
  EmployeeContext,
  EmployeeHandlerResult,
  CompiledEmployee,
  PersonalityConfig,
  EmployeeActionDef,
  EmployeeConnectionDef,
  EmployeeMemoryContext,
} from "./types.js";
```

- [ ] **Step 6: Install dependencies and verify build**

Run: `npx pnpm@9.15.4 install` and `npx pnpm@9.15.4 --filter @switchboard/employee-sdk build`
Expected: Build succeeds (with stub exports, will have missing module error until define-employee.ts exists — that's fine for scaffolding).

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: scaffold employee-sdk package with types

Add @switchboard/employee-sdk with EmployeeConfig, EmployeeContext,
CompiledEmployee types. Layer 2, depends on schemas only.
EOF
)"
```

### Task 5: Implement defineEmployee() and compilation

**Files:**

- Create: `packages/employee-sdk/src/define-employee.ts`
- Create: `packages/employee-sdk/src/compile-handler.ts`
- Create: `packages/employee-sdk/src/compile-cartridge.ts`
- Create: `packages/employee-sdk/src/compile-personality.ts`
- Create: `packages/employee-sdk/src/compile-defaults.ts`
- Create: `packages/employee-sdk/src/__tests__/define-employee.test.ts`
- Create: `packages/employee-sdk/src/__tests__/compile-handler.test.ts`
- Create: `packages/employee-sdk/src/__tests__/compile-cartridge.test.ts`
- Create: `packages/employee-sdk/src/__tests__/compile-personality.test.ts`

- [ ] **Step 1: Write test for defineEmployee()**

```typescript
// packages/employee-sdk/src/__tests__/define-employee.test.ts
import { describe, it, expect } from "vitest";
import { defineEmployee } from "../define-employee.js";
import { z } from "zod";

const minimalConfig = {
  id: "test-employee",
  name: "Test Employee",
  version: "1.0.0",
  description: "A test employee",
  personality: { role: "You are a test.", tone: "neutral", traits: ["helpful"] },
  inboundEvents: ["test.requested"],
  outboundEvents: ["test.done"],
  actions: [
    {
      type: "test.do_thing",
      description: "Do a thing",
      riskCategory: "low" as const,
      reversible: true,
      parameters: z.object({ input: z.string() }),
    },
  ],
  handle: async () => ({ actions: [], events: [] }),
  execute: async () => ({
    success: true,
    summary: "done",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
  }),
};

describe("defineEmployee", () => {
  it("returns a CompiledEmployee with port, handler, cartridge, defaults", () => {
    const compiled = defineEmployee(minimalConfig);
    expect(compiled.port.agentId).toBe("test-employee");
    expect(compiled.port.inboundEvents).toEqual(["test.requested"]);
    expect(compiled.port.outboundEvents).toEqual(["test.done"]);
    expect(compiled.cartridge.manifest.id).toBe("test-employee");
    expect(compiled.cartridge.manifest.actions).toHaveLength(1);
    expect(compiled.defaults.policies).toEqual([]);
    expect(compiled.connections).toEqual([]);
  });

  it("validates required fields", () => {
    expect(() => defineEmployee({ ...minimalConfig, id: "" })).toThrow();
    expect(() => defineEmployee({ ...minimalConfig, actions: [] })).toThrow();
    expect(() => defineEmployee({ ...minimalConfig, inboundEvents: [] })).toThrow();
  });

  it("compiles policies and guardrails from config", () => {
    const compiled = defineEmployee({
      ...minimalConfig,
      policies: [{ action: "test.do_thing", effect: "require_approval" }],
      guardrails: { rateLimits: [{ actionPattern: "test.do_thing", maxPerHour: 5 }] },
    });
    expect(compiled.defaults.policies).toHaveLength(1);
    expect(compiled.defaults.guardrails.rateLimits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/employee-sdk test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compile-personality.ts**

```typescript
import type { PersonalityConfig } from "./types.js";

export interface PersonalityPrompt {
  toPrompt: () => string;
}

export function compilePersonality(config: PersonalityConfig): PersonalityPrompt {
  return {
    toPrompt() {
      const traits = config.traits.length > 0 ? `\nKey traits: ${config.traits.join(", ")}.` : "";
      return `${config.role}\nTone: ${config.tone}.${traits}`;
    },
  };
}
```

- [ ] **Step 4: Implement compile-handler.ts**

This compiles the employee's `handle()` function into an `AgentHandler`. The key job is bridging `EmployeeHandlerResult` → `AgentResponse` and constructing `EmployeeContext` (which is deferred to `employee-context-factory.ts` at registration time — here we just define the wrapper).

```typescript
import type {
  AgentHandler,
  AgentContext,
  AgentResponse,
  RoutedEventEnvelope,
} from "@switchboard/schemas";
import { createEventEnvelope } from "@switchboard/schemas";
import type { EmployeeConfig, EmployeeContext, EmployeeHandlerResult } from "./types.js";

export function compileHandler(
  config: EmployeeConfig,
  contextFactory: (agentContext: AgentContext, event: RoutedEventEnvelope) => EmployeeContext,
): AgentHandler {
  return {
    async handle(
      event: RoutedEventEnvelope,
      _config: Record<string, unknown>,
      agentContext: AgentContext,
    ): Promise<AgentResponse> {
      const employeeCtx = contextFactory(agentContext, event);
      const result = await config.handle(event, employeeCtx);
      return mapResult(result, event, config.id);
    },
  };
}

function mapResult(
  result: EmployeeHandlerResult,
  sourceEvent: RoutedEventEnvelope,
  employeeId: string,
): AgentResponse {
  return {
    events: result.events.map((e) =>
      createEventEnvelope({
        eventType: e.type,
        organizationId: sourceEvent.organizationId,
        source: { type: "agent", id: employeeId },
        payload: e.payload,
        correlationId: sourceEvent.correlationId,
        causationId: sourceEvent.eventId,
      }),
    ),
    // IMPORTANT: ActionRequest uses `actionType`, not `type`.
    // Verify against the actual ActionRequest interface in schemas.
    actions: result.actions.map((a) => ({
      actionType: a.type,
      parameters: a.params,
    })),
  };
}
```

- [ ] **Step 5: Implement compile-cartridge.ts**

Compiles `actions[]` + `execute()` → `Cartridge` interface implementation.

```typescript
import type {
  Cartridge,
  CartridgeManifest,
  CartridgeContext,
  ExecuteResult,
} from "@switchboard/schemas";
import type { EmployeeConfig, EmployeeContext } from "./types.js";

export function compileCartridge(
  config: EmployeeConfig,
  contextFactory: (cartridgeContext: CartridgeContext) => EmployeeContext,
): Cartridge {
  // IMPORTANT: Read the actual ActionDefinition type from packages/schemas/src/cartridge.ts
  // (or cartridge-sdk/src/cartridge.ts before migration). The real shape uses `actionType`
  // (not `type`), `baseRiskCategory` (not `riskCategory`), and requires `name` + `parametersSchema`.
  const manifest: CartridgeManifest = {
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    actions: config.actions.map((a) => ({
      actionType: a.type,
      name: a.type.split(".").pop() ?? a.type,
      description: a.description,
      parametersSchema: {}, // Zod schema serialized at compile time
      baseRiskCategory: a.riskCategory,
      reversible: a.reversible,
    })),
  };

  return {
    manifest,
    async initialize() {
      /* no-op for now */
    },
    async enrichContext(_actionType, parameters, _context) {
      return parameters;
    },
    async execute(actionType, parameters, ctx) {
      const employeeCtx = contextFactory(ctx);
      return config.execute(actionType, parameters, employeeCtx);
    },
    async getRiskInput(actionType, _parameters, _context) {
      const actionDef = config.actions.find((a) => a.type === actionType);
      const riskMap = { low: 0.2, medium: 0.5, high: 0.8, critical: 1.0 };
      return {
        baseRisk: riskMap[actionDef?.riskCategory ?? "medium"],
        dollarsAtRisk: 0,
        blastRadius: "single",
        reversibility: actionDef?.reversible ? "full" : "none",
      };
    },
    getGuardrails() {
      // IMPORTANT: Map to actual GuardrailConfig shape at implementation time.
      // Real shape uses { scope, maxActions, windowMs } for rateLimits and
      // { actionType, cooldownMs, scope } for cooldowns. Read the actual type.
      return {
        rateLimits: (config.guardrails?.rateLimits ?? []).map((r) => ({
          scope: r.actionPattern,
          maxActions: r.maxPerHour,
          windowMs: 3_600_000,
        })),
        cooldowns: (config.guardrails?.cooldowns ?? []).map((c) => ({
          actionType: c.actionPattern,
          cooldownMs: c.seconds * 1000,
          scope: "organization",
        })),
        protectedEntities: [],
      };
    },
    async healthCheck() {
      // Real ConnectionHealth shape: { status, latencyMs, error?, capabilities? }
      return { status: "healthy", latencyMs: 0 };
    },
  };
}
```

- [ ] **Step 6: Implement compile-defaults.ts**

```typescript
import type { EmployeeConfig } from "./types.js";

export function compileDefaults(config: EmployeeConfig) {
  return {
    policies: config.policies ?? [],
    guardrails: config.guardrails ?? { rateLimits: [], cooldowns: [] },
  };
}
```

- [ ] **Step 7: Implement define-employee.ts**

```typescript
import type { EmployeeConfig, CompiledEmployee, EmployeeContext } from "./types.js";
import type { AgentContext, CartridgeContext, RoutedEventEnvelope } from "@switchboard/schemas";
import { compileHandler } from "./compile-handler.js";
import { compileCartridge } from "./compile-cartridge.js";
import { compilePersonality } from "./compile-personality.js";
import { compileDefaults } from "./compile-defaults.js";

export function defineEmployee(config: EmployeeConfig): CompiledEmployee {
  validate(config);

  // Placeholder context factory — replaced at registration time with real services
  const personality = compilePersonality(config.personality);
  const placeholderCtx: EmployeeContext = {
    organizationId: "",
    knowledge: { search: async () => [] },
    memory: {
      brand: { search: async () => [] },
      skills: { getRelevant: async () => [] },
      performance: { getTop: async () => [] },
    },
    llm: { generate: async () => ({ text: "" }) },
    actions: {
      propose: async () => ({
        success: false,
        summary: "not wired",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      }),
    },
    emit: () => {},
    learn: async () => {},
    personality,
  };

  const handlerContextFactory = (_agentCtx: AgentContext, _event: RoutedEventEnvelope) =>
    placeholderCtx;
  const cartridgeContextFactory = (_ctx: CartridgeContext) => placeholderCtx;

  const port = {
    agentId: config.id,
    version: config.version,
    inboundEvents: config.inboundEvents,
    outboundEvents: config.outboundEvents,
    tools: [],
    configSchema: {},
  };

  return {
    port,
    handler: compileHandler(config, handlerContextFactory),
    cartridge: compileCartridge(config, cartridgeContextFactory),
    defaults: compileDefaults(config),
    connections: config.connections ?? [],
  };
}

function validate(config: EmployeeConfig): void {
  if (!config.id) throw new Error("Employee id is required");
  if (!config.name) throw new Error("Employee name is required");
  if (!config.version) throw new Error("Employee version is required");
  if (!config.inboundEvents.length) throw new Error("At least one inbound event is required");
  if (!config.actions.length) throw new Error("At least one action is required");
}
```

- [ ] **Step 8: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/employee-sdk test`
Expected: All pass.

- [ ] **Step 9: Write compile-handler test**

```typescript
// packages/employee-sdk/src/__tests__/compile-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { compileHandler } from "../compile-handler.js";
import { createEventEnvelope } from "@switchboard/schemas";

describe("compileHandler", () => {
  it("maps EmployeeHandlerResult to AgentResponse", async () => {
    const mockHandle = vi.fn().mockResolvedValue({
      actions: [{ type: "test.do", params: { x: 1 } }],
      events: [{ type: "test.done", payload: { result: "ok" } }],
    });

    const config = { handle: mockHandle } as any;
    const mockCtxFactory = vi.fn().mockReturnValue({});

    const handler = compileHandler(config, mockCtxFactory);

    const event = createEventEnvelope({
      eventType: "test.requested",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0].actionType).toBe("test.do");
    expect(response.events).toHaveLength(1);
    expect(response.events[0].eventType).toBe("test.done");
    expect(response.events[0].correlationId).toBe(event.correlationId);
    expect(response.events[0].causationId).toBe(event.eventId);
  });
});
```

- [ ] **Step 10: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/employee-sdk test`
Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: implement defineEmployee() with compilation layer

Add defineEmployee() that compiles EmployeeConfig into CompiledEmployee
(AgentPort + AgentHandler + Cartridge + defaults). Includes handler
result mapping, cartridge compilation, personality prompt builder.
EOF
)"
```

### Task 6: Implement EmployeeContext factory

**Files:**

- Create: `packages/employee-sdk/src/employee-context-factory.ts`
- Create: `packages/employee-sdk/src/__tests__/employee-context-factory.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createEmployeeContextFactory } from "../employee-context-factory.js";

describe("createEmployeeContextFactory", () => {
  it("constructs EmployeeContext from services", () => {
    const factory = createEmployeeContextFactory({
      personality: { toPrompt: () => "You are a test." },
      knowledgeRetriever: { search: vi.fn().mockResolvedValue([]) },
      brandMemory: { search: vi.fn().mockResolvedValue([]) },
      skillStore: { getRelevant: vi.fn().mockResolvedValue([]) },
      performanceStore: { getTop: vi.fn().mockResolvedValue([]) },
      llmAdapter: { generate: vi.fn().mockResolvedValue({ text: "hello" }) },
      actionExecutor: { propose: vi.fn() },
      skillWriter: { save: vi.fn() },
    });

    const ctx = factory({ organizationId: "org-1" }, {} as any);
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.personality.toPrompt()).toBe("You are a test.");
    expect(typeof ctx.memory.brand.search).toBe("function");
    expect(typeof ctx.learn).toBe("function");
    expect(typeof ctx.emit).toBe("function");
  });

  it("collects emitted events", () => {
    const factory = createEmployeeContextFactory({
      personality: { toPrompt: () => "" },
      knowledgeRetriever: { search: vi.fn() },
      brandMemory: { search: vi.fn() },
      skillStore: { getRelevant: vi.fn() },
      performanceStore: { getTop: vi.fn() },
      llmAdapter: { generate: vi.fn() },
      actionExecutor: { propose: vi.fn() },
      skillWriter: { save: vi.fn() },
    });

    const ctx = factory({ organizationId: "org-1" }, {} as any);
    ctx.emit("test.done", { result: "ok" });
    // Events are collected internally and returned via the handler wrapper
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement employee-context-factory.ts**

This factory is called at registration time with the real runtime services. It returns a function that creates a fresh `EmployeeContext` per event.

```typescript
import type { AgentContext, RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext } from "./types.js";
import type { PersonalityPrompt } from "./compile-personality.js";

export interface EmployeeServices {
  personality: PersonalityPrompt;
  knowledgeRetriever: {
    search: (
      query: string,
      topK?: number,
    ) => Promise<Array<{ content: string; similarity: number }>>;
  };
  brandMemory: {
    search: (
      query: string,
      topK?: number,
    ) => Promise<Array<{ content: string; similarity: number }>>;
  };
  skillStore: {
    getRelevant: (
      taskType: string,
      format?: string,
      topK?: number,
    ) => Promise<Array<{ pattern: string; score: number }>>;
  };
  performanceStore: {
    getTop: (
      channel: string,
      limit: number,
    ) => Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
  };
  llmAdapter: {
    generate: (input: {
      system?: string;
      context?: unknown[];
      prompt: string;
      schema?: unknown;
    }) => Promise<{ text: string; parsed?: unknown }>;
  };
  actionExecutor: { propose: (type: string, params: Record<string, unknown>) => Promise<unknown> };
  skillWriter: { save: (skill: Record<string, unknown>) => Promise<void> };
}

export function createEmployeeContextFactory(
  services: EmployeeServices,
): (agentContext: AgentContext, event: RoutedEventEnvelope) => EmployeeContext {
  return (agentContext, _event) => {
    const collectedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];

    return {
      organizationId: agentContext.organizationId,
      contactData: agentContext.contactData,
      knowledge: { search: services.knowledgeRetriever.search },
      memory: {
        brand: { search: services.brandMemory.search },
        skills: { getRelevant: services.skillStore.getRelevant },
        performance: { getTop: services.performanceStore.getTop },
      },
      llm: { generate: services.llmAdapter.generate },
      actions: {
        propose: (type: string, params: Record<string, unknown>) =>
          services.actionExecutor.propose(type, params),
      },
      emit(type: string, payload: Record<string, unknown>) {
        collectedEvents.push({ type, payload });
      },
      async learn(skill) {
        await services.skillWriter.save(skill);
      },
      personality: services.personality,
    };
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/employee-sdk test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add EmployeeContext factory for runtime service injection

createEmployeeContextFactory bridges runtime services (knowledge, memory,
LLM, actions) into the EmployeeContext that employee handlers receive.
EOF
)"
```

---

## Phase 3: Memory Package

### Task 7: Scaffold memory package with interfaces

**Files:**

- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/vitest.config.ts`
- Create: `packages/memory/src/index.ts`
- Create: `packages/memory/src/interfaces.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@switchboard/memory",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@switchboard/schemas": "workspace:*",
    "@switchboard/core": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create interfaces.ts**

```typescript
export interface BrandMemoryStore {
  search(
    orgId: string,
    employeeId: string,
    query: string,
    topK?: number,
  ): Promise<Array<{ content: string; similarity: number }>>;
  ingest(
    orgId: string,
    employeeId: string,
    documentId: string,
    content: string,
    sourceType: "brand" | "correction" | "example",
  ): Promise<void>;
}

export interface SkillStore {
  getRelevant(
    orgId: string,
    employeeId: string,
    taskType: string,
    format?: string,
    topK?: number,
  ): Promise<Array<{ id: string; pattern: string; score: number; version: number }>>;
  save(
    orgId: string,
    employeeId: string,
    skill: { type: string; pattern: string; evidence: string[]; channel?: string },
  ): Promise<void>;
  evolve(skillId: string, newPattern: string, evidence: string[]): Promise<void>;
}

export interface PerformanceStore {
  record(
    orgId: string,
    employeeId: string,
    event: {
      contentId: string;
      outcome: "approved" | "rejected";
      feedback?: string;
      metrics?: Record<string, number>;
    },
  ): Promise<void>;
  getTop(
    orgId: string,
    employeeId: string,
    channel: string,
    limit: number,
  ): Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
  getApprovalRate(
    orgId: string,
    employeeId: string,
  ): Promise<{ total: number; approved: number; rate: number }>;
}

export interface EmployeeMemory {
  brand: BrandMemoryStore;
  skills: SkillStore;
  performance: PerformanceStore;
}
```

- [ ] **Step 3: Create index.ts**

```typescript
export type {
  BrandMemoryStore,
  SkillStore,
  PerformanceStore,
  EmployeeMemory,
} from "./interfaces.js";
export { BrandMemory } from "./brand-memory.js";
export { SkillRetriever } from "./skill-retriever.js";
export { PerformanceQuery } from "./performance-query.js";
```

- [ ] **Step 4: Install and verify**

Run: `npx pnpm@9.15.4 install`
Expected: Package resolves.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: scaffold memory package with store interfaces

Add @switchboard/memory with BrandMemoryStore, SkillStore,
PerformanceStore interfaces. Layer 4, implementations live in db.
EOF
)"
```

### Task 8: Implement BrandMemory

**Files:**

- Create: `packages/memory/src/brand-memory.ts`
- Create: `packages/memory/src/__tests__/brand-memory.test.ts`

- [ ] **Step 1: Write test**

Test that BrandMemory wraps KnowledgeStore with brand-scoped retrieval and boosted similarity for brand sources.

- [ ] **Step 2: Implement BrandMemory class**

Wraps existing `KnowledgeStore` interface. Scopes all queries to `(orgId, employeeId)`. Applies a 1.3x boost to `brand` source type results (mirrors existing correction boost pattern in `KnowledgeRetriever`). `ingest()` delegates to the existing `IngestionPipeline` with `sourceType: "brand"`.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: add BrandMemory wrapping KnowledgeStore with brand-scoped retrieval"
```

### Task 9: Implement SkillRetriever and PerformanceQuery

**Files:**

- Create: `packages/memory/src/skill-retriever.ts`
- Create: `packages/memory/src/performance-query.ts`
- Create: `packages/memory/src/__tests__/skill-retriever.test.ts`
- Create: `packages/memory/src/__tests__/performance-query.test.ts`

- [ ] **Step 1: Write tests for SkillRetriever**

Test that it delegates to `SkillStore.getRelevant()` and returns sorted results.

- [ ] **Step 2: Implement SkillRetriever**

Thin wrapper over `SkillStore` interface. Takes `(orgId, employeeId)` at construction time, exposes `getRelevant(taskType, format?, topK?)`.

- [ ] **Step 3: Write tests for PerformanceQuery**

Test that it delegates to `PerformanceStore.getTop()`.

- [ ] **Step 4: Implement PerformanceQuery**

Thin wrapper over `PerformanceStore` interface. Takes `(orgId, employeeId)` at construction time, exposes `getTop(channel, limit)`.

- [ ] **Step 5: Run all memory tests, commit**

```bash
git commit -m "feat: add SkillRetriever and PerformanceQuery in memory package"
```

---

## Phase 4: DB Schema Evolution

### Task 10: Add employee and memory Prisma models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: Prisma migration

- [ ] **Step 1: Add new models to schema.prisma**

Add after existing models (do NOT remove existing models yet — that's Phase 7):

```prisma
model EmployeeRegistration {
  id             String   @id @default(uuid())
  employeeId     String   // e.g. "creative"
  organizationId String
  status         String   @default("active") // active, paused, disabled
  config         Json     @default("{}")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([employeeId, organizationId])
}

model EmployeeSkill {
  id             String   @id @default(uuid())
  employeeId     String
  organizationId String
  type           String   // "performance_pattern", "rejection", "style_preference"
  pattern        String   // text description of the learned pattern
  evidence       String[] // content/task IDs that validated this
  channel        String?  // optional: which channel this applies to
  version        Int      @default(1)
  performanceScore Float  @default(0)
  embedding      Unsupported("vector(1024)")?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([employeeId, organizationId])
}

model EmployeePerformanceEvent {
  id             String   @id @default(uuid())
  employeeId     String
  organizationId String
  contentId      String
  outcome        String   // "approved", "rejected", "published"
  feedback       String?
  metrics        Json?    // engagement metrics when available
  createdAt      DateTime @default(now())

  @@index([employeeId, organizationId])
  @@index([contentId])
}

model ContentDraft {
  id             String   @id @default(uuid())
  employeeId     String
  organizationId String
  channel        String   // "linkedin", "twitter", "email", "blog"
  format         String   // "post", "newsletter", "article", "ad_copy"
  content        String
  status         String   @default("draft") // draft, pending_review, approved, rejected, published
  feedback       String?  // rejection reason
  revision       Int      @default(1)
  parentDraftId  String?  // links revisions to original
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([employeeId, organizationId, status])
}

model ContentCalendarEntry {
  id             String    @id @default(uuid())
  employeeId     String
  organizationId String
  channel        String
  topic          String
  scheduledFor   DateTime
  draftId        String?
  status         String    @default("planned") // planned, drafted, approved, published
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([organizationId, scheduledFor])
}
```

- [ ] **Step 2: Generate migration**

Run: `npx pnpm@9.15.4 db:generate` then create migration:

```bash
cd packages/db && npx prisma migrate dev --name add_employee_memory_models
```

- [ ] **Step 3: Verify migration applies cleanly**

Run: `npx pnpm@9.15.4 db:generate`
Expected: Prisma client regenerates without errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add employee, skill, performance, and content Prisma models

Add EmployeeRegistration, EmployeeSkill, EmployeePerformanceEvent,
ContentDraft, ContentCalendarEntry tables for the AI Workforce Platform.
EOF
)"
```

### Task 11: Implement Prisma store implementations for memory interfaces

**Files:**

- Create: `packages/db/src/stores/prisma-skill-store.ts`
- Create: `packages/db/src/stores/prisma-performance-store.ts`
- Create: `packages/db/src/stores/prisma-employee-store.ts`
- Create tests for each

- [ ] **Step 1: Write test for PrismaSkillStore**

Test `save()`, `getRelevant()`, and `evolve()` against the SkillStore interface. Use Prisma mock or in-memory approach consistent with existing store tests (check `packages/db/src/stores/__tests__/` for the pattern).

- [ ] **Step 2: Implement PrismaSkillStore**

Implements `SkillStore` from `@switchboard/memory`. Uses `prisma.employeeSkill` for CRUD. `getRelevant()` queries by `(employeeId, organizationId)` and filters by type/channel if provided, orders by `performanceScore` desc, limits to `topK`. `save()` creates with embedding via the existing embedding adapter. `evolve()` increments version, updates pattern and evidence.

- [ ] **Step 3: Write test and implement PrismaPerformanceStore**

Implements `PerformanceStore`. `record()` creates `EmployeePerformanceEvent`. `getTop()` queries events with `outcome: "approved"` or `"published"`, orders by metrics. `getApprovalRate()` counts approved/total.

- [ ] **Step 4: Write test and implement PrismaEmployeeStore**

CRUD for `EmployeeRegistration`. `register()`, `getByOrg()`, `updateStatus()`.

- [ ] **Step 5: Run tests, commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add Prisma stores for employee skills, performance, and registration

Implements SkillStore and PerformanceStore interfaces from memory package.
Adds PrismaEmployeeStore for employee registration CRUD.
EOF
)"
```

---

## Phase 5: Creative Employee

### Task 12: Scaffold creative employee package

**Files:**

- Create: `employees/creative/package.json`
- Create: `employees/creative/tsconfig.json`
- Create: `employees/creative/vitest.config.ts`
- Create: `employees/creative/src/schemas.ts`
- Create: `employees/creative/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@switchboard/employee-creative",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@switchboard/schemas": "workspace:*",
    "@switchboard/employee-sdk": "workspace:*",
    "@switchboard/core": "workspace:*",
    "@switchboard/memory": "workspace:*",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create schemas.ts**

```typescript
import { z } from "zod";

export const ContentDraftParamsSchema = z.object({
  content: z.string(),
  channel: z.enum(["linkedin", "twitter", "instagram", "facebook", "email", "blog"]),
  format: z.enum(["post", "newsletter", "article", "ad_copy", "presentation_outline"]),
  topic: z.string().optional(),
  brief: z.string().optional(),
});

export const ContentReviseParamsSchema = z.object({
  content: z.string(),
  originalDraftId: z.string(),
  feedback: z.string().optional(),
});

export const ContentPublishParamsSchema = z.object({
  draftId: z.string(),
  channel: z.string(),
  scheduledFor: z.string().datetime().optional(),
});

export const CalendarPlanParamsSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  channels: z.array(z.string()),
  postsPerWeek: z.number().int().min(1).max(30).optional(),
});

export const CalendarScheduleParamsSchema = z.object({
  channel: z.string(),
  topic: z.string(),
  scheduledFor: z.string().datetime(),
  draftId: z.string().optional(),
});

export const CompetitorAnalyzeParamsSchema = z.object({
  competitorUrl: z.string().url().optional(),
  competitorName: z.string().optional(),
  channel: z.string().optional(),
  topic: z.string().optional(),
});

export const PerformanceReportParamsSchema = z.object({
  period: z.enum(["week", "month", "quarter"]),
  channels: z.array(z.string()).optional(),
});
```

- [ ] **Step 3: Create index.ts stub with defineEmployee call**

Write the full `defineEmployee()` call with all actions, events, personality, and `handle`/`execute` functions that delegate to handler and executor modules (to be implemented in subsequent tasks).

- [ ] **Step 4: Install, verify build, commit**

```bash
git commit -m "feat: scaffold AI Creative employee with schemas and defineEmployee"
```

### Task 13: Implement Creative employee handlers

**Files:**

- Create: `employees/creative/src/handlers/content-requested.ts`
- Create: `employees/creative/src/handlers/content-rejected.ts`
- Create: `employees/creative/src/handlers/content-approved.ts`
- Create: `employees/creative/src/handlers/performance-updated.ts`
- Create: `employees/creative/src/handlers/onboarded.ts`
- Create tests for each handler

- [ ] **Step 1: Write test for content-requested handler**

Test that given a `content.requested` event, the handler queries brand memory, retrieves relevant skills, generates content via LLM, and returns a `creative.content.draft` action + `content.draft_ready` event.

- [ ] **Step 2: Implement content-requested handler**

Follow the handler sketch from the design spec (Section 5). The handler receives `EmployeeContext` and returns `EmployeeHandlerResult`.

- [ ] **Step 3: Write test and implement content-rejected handler**

Test: calls `context.learn()` with rejection feedback, generates revised content, returns `creative.content.revise` action.

- [ ] **Step 4: Write test and implement content-approved handler**

Test: returns `creative.content.publish` action.

- [ ] **Step 5: Write test and implement performance-updated handler**

Test: uses structured output to extract performance patterns, calls `context.learn()` if confidence > 0.8.

- [ ] **Step 6: Implement onboarded handler**

Generates initial content calendar suggestions from brand context.

- [ ] **Step 7: Run all tests, commit**

```bash
git commit -m "feat: implement Creative employee event handlers"
```

### Task 14: Implement Creative employee action executors

**Files:**

- Create: `employees/creative/src/execute/draft.ts`
- Create: `employees/creative/src/execute/revise.ts`
- Create: `employees/creative/src/execute/publish.ts`
- Create: `employees/creative/src/execute/calendar.ts`
- Create: `employees/creative/src/execute/analyze.ts`
- Create: `employees/creative/src/execute/report.ts`
- Create tests for draft and publish

- [ ] **Step 1: Write test for draft executor**

Test: validates params against `ContentDraftParamsSchema`, returns `ExecuteResult` with the draft content.

- [ ] **Step 2: Implement all executors**

Each executor validates its params and returns an `ExecuteResult`. For v1, most are straightforward — validate, return success with the content/result. The `publish` executor is the one that would eventually call external APIs (social media, email), but for v1 it just marks the draft as published in the DB.

- [ ] **Step 3: Wire handlers and executors into index.ts**

Update `employees/creative/src/index.ts` to import handlers and executors, dispatch based on event type in `handle()` and action type in `execute()`.

- [ ] **Step 4: Run all creative employee tests, commit**

```bash
git commit -m "feat: implement Creative employee action executors"
```

---

## Phase 6: API Routes and Employee Registration

### Task 15: Create employee registration bootstrap

**Files:**

- Create: `apps/api/src/bootstrap/employees.ts`

- [ ] **Step 1: Write test**

Test that `registerEmployees()` takes a `CompiledEmployee`, registers the handler with `HandlerRegistry`, the cartridge with `CartridgeRegistry`, and seeds default policies.

- [ ] **Step 2: Implement employees.ts**

Follow the pattern from `apps/api/src/bootstrap/cartridges.ts` but for compiled employees. Import the Creative employee, wire real services (knowledge store, memory stores, LLM adapter) into the `EmployeeContext` factory via `createEmployeeContextFactory()`.

- [ ] **Step 3: Wire into app.ts**

Replace or add alongside the existing cartridge registration call. The existing cartridge registration can remain during migration — it's not harmful, just unused.

- [ ] **Step 4: Run, commit**

```bash
git commit -m "feat: add employee registration bootstrap"
```

### Task 16: Create content review API routes

**Files:**

- Create: `apps/api/src/routes/content-routes.ts`

- [ ] **Step 1: Define routes**

```
GET    /api/employees/:employeeId/drafts          — list drafts (filterable by status)
GET    /api/employees/:employeeId/drafts/:id       — get single draft
POST   /api/employees/:employeeId/drafts/:id/approve — approve draft, emit content.approved event
POST   /api/employees/:employeeId/drafts/:id/reject  — reject draft with feedback, emit content.rejected event
GET    /api/employees/:employeeId/skills           — list learned skills
DELETE /api/employees/:employeeId/skills/:id       — delete a learned skill
GET    /api/employees/:employeeId/performance      — performance summary
```

- [ ] **Step 2: Implement routes**

The approve/reject endpoints create `RoutedEventEnvelope` events (`content.approved` / `content.rejected`) and inject them into the event loop. This is how the dashboard drives employee behavior.

- [ ] **Step 3: Register routes in bootstrap/routes.ts**

- [ ] **Step 4: Test and commit**

```bash
git commit -m "feat: add content review and employee management API routes"
```

### Task 17: Create employee management routes

**Files:**

- Create: `apps/api/src/routes/employee-routes.ts`

- [ ] **Step 1: Define and implement routes**

```
GET    /api/employees                              — list available employees
POST   /api/employees/:employeeId/hire             — hire (register) an employee for an org
POST   /api/employees/:employeeId/pause            — pause an employee
POST   /api/employees/:employeeId/resume           — resume a paused employee
DELETE /api/employees/:employeeId                   — dismiss (deactivate) an employee
POST   /api/employees/:employeeId/onboard          — trigger onboarding (brand upload + ingestion)
```

- [ ] **Step 2: Register, test, commit**

```bash
git commit -m "feat: add employee management API routes (hire, pause, dismiss, onboard)"
```

---

## Phase 7: Domain Code Removal and Cleanup

### Task 18: Move runtime infrastructure from agents to core

**Files:**

- Move 9 files from `packages/agents/src/` to `packages/core/src/runtime/`
- Move knowledge files to `packages/core/src/knowledge/`
- Move LLM files to `packages/core/src/llm/`
- Update all import paths across the monorepo

- [ ] **Step 1: Create core/src/runtime/ directory and move files**

Move: `event-loop.ts`, `router.ts`, `handler-registry.ts`, `action-executor.ts`, `policy-bridge.ts`, `scheduled-runner.ts`, `escalation.ts`, `registry.ts`, `concurrency.ts`.

Create `packages/core/src/runtime/index.ts` with re-exports.

- [ ] **Step 2: Move knowledge/ and llm/ directories**

Move `packages/agents/src/knowledge/` → `packages/core/src/knowledge/`
Move `packages/agents/src/llm/` → `packages/core/src/llm/`

- [ ] **Step 3: Update all imports across the monorepo**

Search for all imports from `@switchboard/agents` and update to `@switchboard/core/runtime`, `@switchboard/core/knowledge`, or `@switchboard/core/llm` as appropriate.

- [ ] **Step 4: Run typecheck and all tests**

Run: `npx pnpm@9.15.4 typecheck` and `npx pnpm@9.15.4 test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: move runtime infrastructure from agents to core

Move event loop, router, handler registry, action executor, policy bridge,
scheduled runner, escalation, knowledge, and LLM adapters to core package.
Dissolves packages/agents as a standalone package.
EOF
)"
```

### Task 19: Remove domain-specific code

**Files:**

- Delete: `cartridges/` (all 5 cartridge directories)
- Delete: `skins/` (all skin configs)
- Delete: `profiles/` (all profile configs)
- Delete: `agent-roles/`
- Delete: `packages/agents/src/agents/` (5 domain agent implementations)
- Delete: domain-specific API routes
- Delete: domain-specific dashboard pages
- Modify: `packages/db/prisma/schema.prisma` (drop domain models in a separate migration)
- Modify: `apps/api/src/bootstrap/cartridges.ts` (remove or empty)
- Modify: `apps/api/src/bootstrap/routes.ts` (remove domain route registrations)

- [ ] **Step 1: Delete cartridges, skins, profiles, agent-roles directories**

```bash
rm -rf cartridges/ skins/ profiles/ agent-roles/
```

- [ ] **Step 2: Delete domain agent implementations**

```bash
rm -rf packages/agents/src/agents/
```

- [ ] **Step 3: Remove domain routes from apps/api**

Read `apps/api/src/bootstrap/routes.ts` and identify domain-specific route registrations (CRM, revenue-growth, campaigns, ads-operator, cadences, etc.). Remove them. Keep: actions, execute, approvals, policies, audit, identity, connections, organizations, governance, knowledge, conversations, agents (generic), escalations, sessions, workflows, scheduler, operator, lifecycle, deployment, test-chat.

- [ ] **Step 4: Remove domain-specific dashboard pages**

Remove CRM views, performance tabs, pipeline funnel (these are SMB-specific). Keep: the layout shell, settings pages (knowledge, channels, team), the decide (approvals) page, error boundary.

- [ ] **Step 5: Remove cartridge bootstrap**

Empty or remove `apps/api/src/bootstrap/cartridges.ts`. Update `app.ts` to call `registerEmployees()` instead.

- [ ] **Step 6: Run typecheck — fix all broken imports**

This will surface every broken import from the deletions. Fix them by removing dead code or updating to new paths. This is the largest manual step.

- [ ] **Step 7: Run tests — fix all broken tests**

Remove tests for deleted code. Fix tests for code that now imports from new locations.

- [ ] **Step 8: Create Prisma migration to drop domain models**

Create a migration that drops: `CrmContact`, `ContactAlias`, `CrmDeal`, `CrmActivity`, `RevenueEvent`, `RevenueAccount`, `RevGrowthDiagnosticCycle`, `RevGrowthIntervention`, `RevGrowthWeeklyDigest`, `ConnectorHealthLog`, `AdsOperatorConfig`, `CadenceInstance`, `RoasSnapshot`, `OptimisationProposal`, `ResponseVariantLog`, `AgentRoleOverride`, `SmbActivityLogEntry`.

Keep governance, conversation, lifecycle, agent system, connection, knowledge, workflow, session, and dashboard models — these are infrastructure.

- [ ] **Step 9: Run full test suite and typecheck**

Run: `npx pnpm@9.15.4 test` and `npx pnpm@9.15.4 typecheck`
Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: remove domain-specific code (cartridges, skins, profiles, domain agents)

Remove 5 cartridge implementations, 4 skins, 2 profiles, 5 domain agents,
and domain-specific API routes and dashboard pages. Drop domain Prisma
models. Switchboard is now an AI Workforce Platform.
EOF
)"
```

---

## Phase 8: Verification

### Task 20: End-to-end smoke test

- [ ] **Step 1: Verify the Creative employee registers and handles events**

Write an integration test or use the test-chat endpoint to:

1. Register the Creative employee for org "test-org"
2. Send a `content.requested` event
3. Verify a `content.draft_ready` event is emitted
4. Approve the draft via the API
5. Verify `content.approved` triggers the employee
6. Verify the draft status updates to "approved"

- [ ] **Step 2: Verify governance pipeline works for creative actions**

1. Submit a `creative.content.publish` action
2. Verify it hits `require_approval` policy
3. Approve it
4. Verify CompetenceTracker records the success

- [ ] **Step 3: Verify skill learning**

1. Reject a draft with feedback
2. Verify `context.learn()` was called
3. Query the skills API and verify the learned pattern exists

- [ ] **Step 4: Run full build, lint, typecheck, test**

```bash
npx pnpm@9.15.4 build && npx pnpm@9.15.4 lint && npx pnpm@9.15.4 typecheck && npx pnpm@9.15.4 test
```

- [ ] **Step 5: Commit and tag**

```bash
git commit -m "test: add Creative employee end-to-end smoke test"
git tag v2.0.0-alpha.1
```

---

## Summary

| Phase                | Tasks | What it produces                                              |
| -------------------- | ----- | ------------------------------------------------------------- |
| 1. Type Migration    | 1-3   | Shared types in schemas, backwards-compatible re-exports      |
| 2. Employee SDK      | 4-6   | `defineEmployee()` with full compilation layer                |
| 3. Memory Package    | 7-9   | Interfaces + brand memory, skill retriever, performance query |
| 4. DB Schema         | 10-11 | New Prisma models + store implementations                     |
| 5. Creative Employee | 12-14 | First AI employee, handlers + executors                       |
| 6. API Routes        | 15-17 | Employee registration, content review, management             |
| 7. Cleanup           | 18-19 | Runtime moves to core, domain code removed                    |
| 8. Verification      | 20    | End-to-end smoke test                                         |

Total: 20 tasks. Each task is independently testable and committable.

---

## Cross-Cutting Concerns

These items should be addressed during the relevant phase:

- **pnpm workspace config** — Add `employees/*` to `pnpm-workspace.yaml` during Task 12 (scaffold creative employee).
- **Dockerfile** — Update `COPY` directives for `packages/employee-sdk`, `packages/memory`, `employees/creative` and remove `cartridges/*`, `skins/`, `profiles/` during Task 19 (domain code removal).
- **ESLint + dependency-cruiser** — Update `.eslintrc.json` blocklist rules for new packages and layer constraints during Task 18 (agents dissolution). Add `employee-sdk` and `memory` to the dependency-cruiser config.
- **`URGENT_EVENT_TYPES`** — When moving `event-loop.ts` to core in Task 18, replace the hardcoded `["ad.anomaly_detected", "ad.performance_review"]` with either an empty array or a configurable registry.
- **`packages/agents` cleanup** — After Task 18 moves all runtime files and Task 19 deletes domain agents, remove `packages/agents` from `pnpm-workspace.yaml` and delete `packages/agents/package.json`.
- **Type shape verification** — The code in this plan uses field names derived from the spec. At implementation time, read the actual interfaces from the codebase (now in `packages/schemas/src/`) and adapt. Key gotchas: `ActionDefinition` uses `actionType` not `type`, `ActionRequest` uses `actionType` not `type`, `ConnectionHealth` uses `status` not `healthy`, `GuardrailConfig` uses `{ scope, maxActions, windowMs }` not `{ actionPattern, maxPerHour }`.
