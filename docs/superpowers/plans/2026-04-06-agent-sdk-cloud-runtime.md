# Agent SDK + Cloud Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `packages/sdk` package (manifest, handler, context types, test harness) and the cloud runtime orchestrator that dispatches agent handlers, manages state, evaluates Action Requests through governance, and executes approved actions.

**Architecture:** New `packages/sdk` at Layer 2 (types only, depends on `schemas`). Cloud runtime lives in `packages/core/src/agent-runtime/` — an `AgentRuntime` class that loads agent handlers, builds `AgentContext`, routes events (`onMessage`, `onTask`, `onHandoff`, `onSchedule`), and gates every action through an `ActionRequestPipeline` that evaluates trust + policy before execution. Three new Prisma models (`ActionRequest`, `AgentState`, `DeploymentConnection`) with corresponding stores in `packages/db`.

**Tech Stack:** TypeScript (ESM), Zod (schemas), Prisma (data models), Vitest (testing), pnpm workspaces

**Spec:** `docs/superpowers/specs/2026-04-06-universal-agent-runtime-design.md`

---

## File Structure

### New Package: `packages/sdk/`

| File                                         | Responsibility                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `package.json`                               | Package config — `@switchboard/sdk`, depends on `@switchboard/schemas` only                |
| `tsconfig.json`                              | Extends base config                                                                        |
| `vitest.config.ts`                           | Test config                                                                                |
| `src/index.ts`                               | Barrel — re-exports all public types                                                       |
| `src/manifest.ts`                            | `AgentManifest` Zod schema + type                                                          |
| `src/handler.ts`                             | `AgentHandler` interface (onMessage, onTask, onSetup, onSchedule, onHandoff)               |
| `src/context.ts`                             | `AgentContext`, `StateStore`, `ChatProvider`, `FileProvider`, `BrowserProvider` interfaces |
| `src/action-request.ts`                      | Re-exports `ActionRequest`, `ActionType`, `ActionStatus` from `@switchboard/schemas`       |
| `src/handoff.ts`                             | `HandoffPayload` type                                                                      |
| `src/testing/index.ts`                       | `createTestHarness`, `mockPersona` — test utilities for agent developers                   |
| `src/testing/test-session.ts`                | `TestChatSession`, `TestTaskSession` — simulated sessions                                  |
| `src/testing/mock-providers.ts`              | In-memory implementations of `StateStore`, `ChatProvider`, etc.                            |
| `src/__tests__/manifest.test.ts`             | Manifest schema validation tests                                                           |
| `src/__tests__/handler.test.ts`              | Handler type contract tests                                                                |
| `src/testing/__tests__/test-harness.test.ts` | Test harness tests                                                                         |

### New Directory: `packages/core/src/agent-runtime/`

| File                                        | Responsibility                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `index.ts`                                  | Barrel — re-exports `AgentRuntime`, pipeline, providers                            |
| `agent-runtime.ts`                          | `AgentRuntime` class — loads handlers, builds context, dispatches events           |
| `action-request-pipeline.ts`                | `ActionRequestPipeline` — evaluates trust + policy, returns execute/queue/block    |
| `context-builder.ts`                        | Builds `AgentContext` from deployment, persona, trust score, and runtime providers |
| `state-provider.ts`                         | `StateProvider` — implements `StateStore` interface backed by `AgentStateStore`    |
| `chat-provider.ts`                          | `CloudChatProvider` — implements `ChatProvider`, creates Action Requests for sends |
| `llm-provider.ts`                           | `RuntimeLLMProvider` — wraps existing `LLMAdapter` for SDK's `ctx.llm.chat()`      |
| `__tests__/agent-runtime.test.ts`           | Runtime integration tests                                                          |
| `__tests__/action-request-pipeline.test.ts` | Governance pipeline tests                                                          |
| `__tests__/context-builder.test.ts`         | Context assembly tests                                                             |
| `__tests__/helpers.ts`                      | Test factories for runtime components                                              |

### Modified: `packages/db/`

| File                                                | Change                                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                              | Add `ActionRequest`, `AgentState`, `DeploymentConnection` models; add relations to `AgentDeployment`; add `deploymentId` to `TrustScoreRecord` |
| `src/stores/prisma-action-request-store.ts`         | New — CRUD for Action Requests                                                                                                                 |
| `src/stores/prisma-agent-state-store.ts`            | New — key-value state store per deployment                                                                                                     |
| `src/stores/prisma-deployment-connection-store.ts`  | New — connection CRUD per deployment                                                                                                           |
| `src/stores/__tests__/action-request-store.test.ts` | New — store tests                                                                                                                              |
| `src/stores/__tests__/agent-state-store.test.ts`    | New — store tests                                                                                                                              |
| `src/index.ts`                                      | Re-export new stores                                                                                                                           |

### Modified: `packages/schemas/src/`

| File             | Change                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace.ts` | Add `ActionRequestStatus`, `ActionType`, `ConnectionStatus` enums; add `ActionRequestSchema`, `AgentStateSchema`, `DeploymentConnectionSchema` Zod schemas |
| `index.ts`       | Already exports `marketplace.ts` via `export *` — no change needed                                                                                         |

### Modified: `packages/core/src/marketplace/`

| File                    | Change                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `trust-score-engine.ts` | Add optional `deploymentId` to `TrustScoreStore.getOrCreate()` signature; add `getDeploymentScore()` method |
| `trust-adapter.ts`      | Support deployment-scoped trust lookups                                                                     |
| `index.ts`              | Re-export new agent-runtime module                                                                          |

---

## Tasks

### Task 1: Scaffold `packages/sdk` Package

**Files:**

- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/vitest.config.ts`
- Create: `packages/sdk/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@switchboard/sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "import": "./dist/testing/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@switchboard/schemas": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
    },
  },
});
```

- [ ] **Step 4: Create empty barrel `src/index.ts`**

```ts
// @switchboard/sdk — Agent SDK types and utilities
// Exports added as modules are built.
```

- [ ] **Step 5: Install dependencies**

Run: `npx pnpm@9.15.4 install`
Expected: Lockfile updated, no errors

- [ ] **Step 6: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk build`
Expected: Compiles successfully

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/ pnpm-lock.yaml && git commit -m "$(cat <<'EOF'
chore: scaffold packages/sdk package

New Layer 2 package for Agent SDK types and test harness.
Depends on @switchboard/schemas only.
EOF
)"
```

---

### Task 2: Agent Manifest Schema

**Files:**

- Create: `packages/sdk/src/manifest.ts`
- Create: `packages/sdk/src/__tests__/manifest.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/src/__tests__/manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AgentManifestSchema } from "../manifest.js";

describe("AgentManifestSchema", () => {
  const validManifest = {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description: "Responds to inbound leads within 60 seconds",
    version: "1.0.0",
    author: "switchboard",
    category: "sales",
    capabilities: {
      required: ["chat"],
      optional: ["browser"],
    },
    connections: {
      required: [{ type: "chat_channel", reason: "To receive and respond to leads" }],
      optional: [{ type: "google_calendar", reason: "To book meetings" }],
    },
    governance: {
      startingAutonomy: "supervised",
      escalateWhen: ["customer_frustrated", "asked_for_human"],
    },
    pricing: { model: "free" },
  };

  it("parses a valid manifest", () => {
    const result = AgentManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it("requires name, slug, description, version, author, category", () => {
    const result = AgentManifestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("defaults capabilities to empty arrays", () => {
    const minimal = {
      name: "Test",
      slug: "test",
      description: "A test agent",
      version: "0.1.0",
      author: "dev",
      category: "general",
    };
    const result = AgentManifestSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities.required).toEqual([]);
      expect(result.data.capabilities.optional).toEqual([]);
    }
  });

  it("defaults governance.startingAutonomy to supervised", () => {
    const minimal = {
      name: "Test",
      slug: "test",
      description: "A test agent",
      version: "0.1.0",
      author: "dev",
      category: "general",
    };
    const result = AgentManifestSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governance.startingAutonomy).toBe("supervised");
    }
  });

  it("rejects invalid pricing model", () => {
    const bad = { ...validManifest, pricing: { model: "premium" } };
    const result = AgentManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects invalid autonomy level", () => {
    const bad = {
      ...validManifest,
      governance: { ...validManifest.governance, startingAutonomy: "full_auto" },
    };
    const result = AgentManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk test`
Expected: FAIL — cannot find module `../manifest.js`

- [ ] **Step 3: Write the manifest schema**

Create `packages/sdk/src/manifest.ts`:

```ts
import { z } from "zod";

export const CapabilityType = z.enum(["chat", "browser", "file_system", "screen_control", "api"]);
export type CapabilityType = z.infer<typeof CapabilityType>;

export const PricingModel = z.enum(["free", "paid", "usage_based"]);
export type PricingModel = z.infer<typeof PricingModel>;

export const ConnectionRequirementSchema = z.object({
  type: z.string(),
  reason: z.string(),
});
export type ConnectionRequirement = z.infer<typeof ConnectionRequirementSchema>;

export const AgentManifestSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1),
  category: z.string().min(1),

  capabilities: z
    .object({
      required: z.array(CapabilityType).default([]),
      optional: z.array(CapabilityType).default([]),
    })
    .default({ required: [], optional: [] }),

  connections: z
    .object({
      required: z.array(ConnectionRequirementSchema).default([]),
      optional: z.array(ConnectionRequirementSchema).default([]),
    })
    .default({ required: [], optional: [] }),

  governance: z
    .object({
      startingAutonomy: z.enum(["supervised", "guided", "autonomous"]).default("supervised"),
      escalateWhen: z.array(z.string()).default([]),
    })
    .default({ startingAutonomy: "supervised", escalateWhen: [] }),

  pricing: z
    .object({
      model: PricingModel.default("free"),
      priceMonthly: z.number().optional(),
      pricePerTask: z.number().optional(),
    })
    .default({ model: "free" }),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;
```

- [ ] **Step 4: Update barrel**

Add to `packages/sdk/src/index.ts`:

```ts
export {
  AgentManifestSchema,
  CapabilityType,
  PricingModel,
  ConnectionRequirementSchema,
} from "./manifest.js";
export type { AgentManifest, ConnectionRequirement } from "./manifest.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk test`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/manifest.ts packages/sdk/src/__tests__/manifest.test.ts packages/sdk/src/index.ts && git commit -m "$(cat <<'EOF'
feat(sdk): add AgentManifest schema

Zod schema for agent manifests — name, capabilities, connections,
governance defaults, and pricing model. Validates slug format,
version semver, and autonomy levels.
EOF
)"
```

---

### Task 3: Agent Handler and Context Interfaces

**Files:**

- Create: `packages/sdk/src/handler.ts`
- Create: `packages/sdk/src/context.ts`
- Create: `packages/sdk/src/handoff.ts`
- Create: `packages/sdk/src/action-request.ts`
- Create: `packages/sdk/src/__tests__/handler.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/src/__tests__/handler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AgentHandler, AgentContext } from "../index.js";

describe("AgentHandler type contracts", () => {
  it("accepts a handler with only onMessage", () => {
    const handler: AgentHandler = {
      async onMessage(_ctx: AgentContext) {
        // no-op
      },
    };
    expect(handler.onMessage).toBeDefined();
    expect(handler.onTask).toBeUndefined();
  });

  it("accepts a handler with all methods", () => {
    const handler: AgentHandler = {
      async onMessage(_ctx: AgentContext) {},
      async onTask(_ctx: AgentContext) {},
      async onSetup(_ctx: AgentContext) {},
      async onSchedule(_ctx: AgentContext) {},
      async onHandoff(_ctx: AgentContext) {},
    };
    expect(handler.onMessage).toBeDefined();
    expect(handler.onTask).toBeDefined();
    expect(handler.onSetup).toBeDefined();
    expect(handler.onSchedule).toBeDefined();
    expect(handler.onHandoff).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk test`
Expected: FAIL — `AgentHandler` and `AgentContext` not exported

- [ ] **Step 3: Create handoff type**

Create `packages/sdk/src/handoff.ts`:

```ts
export interface HandoffPayload {
  fromAgent: string;
  reason: string;
  conversationId?: string;
  context: Record<string, unknown>;
}
```

- [ ] **Step 4: Create action request re-exports**

Create `packages/sdk/src/action-request.ts` (re-exports from schemas — single source of truth):

```ts
// Re-export action request types from schemas (Layer 1)
// SDK consumers import from here for convenience
export { ActionType, ActionStatus, ActionRequestSchema } from "@switchboard/schemas";
export type { ActionRequest } from "@switchboard/schemas";
```

- [ ] **Step 5: Create context interfaces**

Create `packages/sdk/src/context.ts`:

```ts
import type { AgentTask, AgentPersona } from "@switchboard/schemas";
import type { HandoffPayload } from "./handoff.js";

// Re-export AgentPersona so SDK consumers don't need to import schemas directly
export type { AgentPersona } from "@switchboard/schemas";

export interface StateStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
  delete(key: string): Promise<void>;
}

export interface ChatProvider {
  send(message: string): Promise<void>;
  sendToThread(threadId: string, message: string): Promise<void>;
}

export interface FileProvider {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface BrowserProvider {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  extract(selector: string): Promise<string>;
  screenshot(): Promise<Buffer>;
}

export interface LLMProvider {
  chat(params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string }>;
}

export interface StructuredNotification {
  title: string;
  body: string;
  severity?: "info" | "warning" | "critical";
  data?: Record<string, unknown>;
}

export interface AgentContext {
  state: StateStore;
  chat: ChatProvider;
  files: FileProvider;
  browser: BrowserProvider;
  llm: LLMProvider;

  notify: (message: string | StructuredNotification) => Promise<void>;
  handoff: (agentSlug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;

  persona: AgentPersona;
  conversation?: { id: string; messages: Array<{ role: string; content: string }> };
  task?: AgentTask;
  handoffPayload?: HandoffPayload;
  trust: { score: number; level: "supervised" | "guided" | "autonomous" };
}
```

- [ ] **Step 6: Create handler interface**

Create `packages/sdk/src/handler.ts`:

```ts
import type { AgentContext } from "./context.js";

export interface AgentHandler {
  onMessage?(ctx: AgentContext): Promise<void>;
  onTask?(ctx: AgentContext): Promise<void>;
  onSetup?(ctx: AgentContext): Promise<void>;
  onSchedule?(ctx: AgentContext): Promise<void>;
  onHandoff?(ctx: AgentContext): Promise<void>;
}
```

- [ ] **Step 7: Update barrel**

Update `packages/sdk/src/index.ts`:

```ts
// @switchboard/sdk — Agent SDK types and utilities

export {
  AgentManifestSchema,
  CapabilityType,
  PricingModel,
  ConnectionRequirementSchema,
} from "./manifest.js";
export type { AgentManifest, ConnectionRequirement } from "./manifest.js";

export type { AgentHandler } from "./handler.js";

export type {
  AgentContext,
  AgentPersona, // re-exported from @switchboard/schemas
  StateStore,
  ChatProvider,
  FileProvider,
  BrowserProvider,
  LLMProvider,
  StructuredNotification,
} from "./context.js";

export type { HandoffPayload } from "./handoff.js";

export { ActionType, ActionStatus, ActionRequestSchema } from "./action-request.js";
export type { ActionRequest } from "./action-request.js";
```

- [ ] **Step 8: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk test`
Expected: All tests PASS

- [ ] **Step 9: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk typecheck`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/ && git commit -m "$(cat <<'EOF'
feat(sdk): add handler, context, and action request types

AgentHandler interface with onMessage/onTask/onSetup/onSchedule/onHandoff.
AgentContext with StateStore, ChatProvider, FileProvider, BrowserProvider,
LLMProvider interfaces. ActionRequest schema for governance pipeline.
HandoffPayload for agent-to-agent transfers.
EOF
)"
```

---

### Task 4: Test Harness for Agent Developers

**Files:**

- Create: `packages/sdk/src/testing/index.ts`
- Create: `packages/sdk/src/testing/mock-providers.ts`
- Create: `packages/sdk/src/testing/test-session.ts`
- Create: `packages/sdk/src/testing/__tests__/test-harness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/src/testing/__tests__/test-harness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestHarness, mockPersona } from "../index.js";
import type { AgentHandler } from "../../handler.js";

describe("createTestHarness", () => {
  const echoHandler: AgentHandler = {
    async onMessage(ctx) {
      const lastMsg = ctx.conversation?.messages.at(-1);
      await ctx.chat.send(`Echo: ${lastMsg?.content ?? "nothing"}`);
    },
  };

  it("creates a chat session and processes messages", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona({ businessName: "Test Co" }),
    });
    const session = harness.chat();
    await session.userSays("hello");
    expect(session.lastResponse).toBe("Echo: hello");
  });

  it("tracks messages sent", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("one");
    await session.userSays("two");
    expect(session.messagesSent).toHaveLength(2);
  });

  it("provides working state store", async () => {
    const statefulHandler: AgentHandler = {
      async onMessage(ctx) {
        const count = (await ctx.state.get<number>("count")) ?? 0;
        await ctx.state.set("count", count + 1);
        await ctx.chat.send(`Count: ${count + 1}`);
      },
    };
    const harness = createTestHarness({
      handler: statefulHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("inc");
    await session.userSays("inc");
    expect(session.lastResponse).toBe("Count: 2");
    expect(await session.state.get("count")).toBe(2);
  });

  it("tracks handoffs", async () => {
    const handoffHandler: AgentHandler = {
      async onMessage(ctx) {
        await ctx.handoff("sales-closer", {
          reason: "qualified",
          context: { budget: 5000 },
        });
      },
    };
    const harness = createTestHarness({
      handler: handoffHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("I'm interested");
    expect(session.handoffs).toHaveLength(1);
    expect(session.handoffs[0]).toMatchObject({
      to: "sales-closer",
      reason: "qualified",
    });
  });

  it("tracks notifications", async () => {
    const notifyHandler: AgentHandler = {
      async onMessage(ctx) {
        await ctx.notify("Lead flagged for review");
      },
    };
    const harness = createTestHarness({
      handler: notifyHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("trigger");
    expect(session.notifications).toEqual(["Lead flagged for review"]);
  });

  it("simulates governance — supervised queues actions", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona(),
    });
    const session = harness.chat({ trustLevel: "supervised" });
    await session.userSays("hello");
    expect(session.pendingApprovals).toHaveLength(1);
    expect(session.messagesSent).toHaveLength(0);
  });

  it("simulates governance — autonomous executes immediately", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona(),
    });
    const session = harness.chat({ trustLevel: "autonomous" });
    await session.userSays("hello");
    expect(session.pendingApprovals).toHaveLength(0);
    expect(session.messagesSent).toHaveLength(1);
  });
});

describe("mockPersona", () => {
  it("returns a valid persona with defaults", () => {
    const persona = mockPersona();
    expect(persona.businessName).toBe("Test Business");
    expect(persona.tone).toBe("professional");
  });

  it("accepts overrides", () => {
    const persona = mockPersona({ businessName: "Bloom Flowers", tone: "warm" });
    expect(persona.businessName).toBe("Bloom Flowers");
    expect(persona.tone).toBe("warm");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk test`
Expected: FAIL — cannot find module `../index.js`

- [ ] **Step 3: Create mock providers**

Create `packages/sdk/src/testing/mock-providers.ts`:

```ts
import type {
  StateStore,
  ChatProvider,
  FileProvider,
  BrowserProvider,
  LLMProvider,
  StructuredNotification,
} from "../context.js";
import type { HandoffPayload } from "../handoff.js";

export class InMemoryStateStore implements StateStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    const results: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of this.data) {
      if (key.startsWith(prefix)) {
        results.push({ key, value });
      }
    }
    return results;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export interface GoverningChatProvider extends ChatProvider {
  messagesSent: string[];
  pendingApprovals: Array<{ type: "send_message"; content: string }>;
}

export function createGoverningChatProvider(
  trustLevel: "supervised" | "guided" | "autonomous",
): GoverningChatProvider {
  const messagesSent: string[] = [];
  const pendingApprovals: Array<{ type: "send_message"; content: string }> = [];

  return {
    messagesSent,
    pendingApprovals,
    async send(message: string) {
      if (trustLevel === "supervised") {
        pendingApprovals.push({ type: "send_message", content: message });
      } else {
        messagesSent.push(message);
      }
    },
    async sendToThread(_threadId: string, message: string) {
      if (trustLevel === "supervised") {
        pendingApprovals.push({ type: "send_message", content: message });
      } else {
        messagesSent.push(message);
      }
    },
  };
}

export class MockFileProvider implements FileProvider {
  files = new Map<string, string>();
  filesWritten: string[] = [];

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.filesWritten.push(path);
  }
}

export class MockBrowserProvider implements BrowserProvider {
  async navigate(_url: string): Promise<void> {}
  async click(_selector: string): Promise<void> {}
  async extract(_selector: string): Promise<string> {
    return "";
  }
  async screenshot(): Promise<Buffer> {
    return Buffer.from("");
  }
}

export class MockLLMProvider implements LLMProvider {
  async chat(_params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string }> {
    return { text: "Mock LLM response" };
  }
}

export interface TrackedHandoff {
  to: string;
  reason: string;
  context: Record<string, unknown>;
}

export function createHandoffTracker(): {
  handoffs: TrackedHandoff[];
  handoff: (agentSlug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;
} {
  const handoffs: TrackedHandoff[] = [];
  return {
    handoffs,
    async handoff(agentSlug, payload) {
      handoffs.push({ to: agentSlug, reason: payload.reason, context: payload.context });
    },
  };
}

export function createNotifyTracker(): {
  notifications: Array<string | StructuredNotification>;
  notify: (message: string | StructuredNotification) => Promise<void>;
} {
  const notifications: Array<string | StructuredNotification> = [];
  return {
    notifications,
    async notify(message) {
      notifications.push(message);
    },
  };
}
```

- [ ] **Step 4: Create test session**

Create `packages/sdk/src/testing/test-session.ts`:

```ts
import type { AgentHandler } from "../handler.js";
import type { AgentContext, AgentPersona, StructuredNotification } from "../context.js";
import type { HandoffPayload } from "../handoff.js";
import {
  InMemoryStateStore,
  createGoverningChatProvider,
  MockFileProvider,
  MockBrowserProvider,
  MockLLMProvider,
  createHandoffTracker,
  createNotifyTracker,
} from "./mock-providers.js";
import type { TrackedHandoff, GoverningChatProvider } from "./mock-providers.js";

export interface ChatSessionOptions {
  trustLevel?: "supervised" | "guided" | "autonomous";
}

export class TestChatSession {
  private _state: InMemoryStateStore;
  private _chat: GoverningChatProvider;
  private _files: MockFileProvider;
  private _handoffTracker: {
    handoffs: TrackedHandoff[];
    handoff: (slug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;
  };
  private _notifyTracker: {
    notifications: Array<string | StructuredNotification>;
    notify: (msg: string | StructuredNotification) => Promise<void>;
  };
  private _messages: Array<{ role: string; content: string }> = [];
  private _trustLevel: "supervised" | "guided" | "autonomous";

  constructor(
    private handler: AgentHandler,
    private persona: AgentPersona,
    options: ChatSessionOptions = {},
  ) {
    this._trustLevel = options.trustLevel ?? "autonomous";
    this._state = new InMemoryStateStore();
    this._chat = createGoverningChatProvider(this._trustLevel);
    this._files = new MockFileProvider();
    this._handoffTracker = createHandoffTracker();
    this._notifyTracker = createNotifyTracker();
  }

  async userSays(message: string): Promise<void> {
    this._messages.push({ role: "user", content: message });
    const ctx = this.buildContext();
    if (this.handler.onMessage) {
      await this.handler.onMessage(ctx);
    }
  }

  get lastResponse(): string | undefined {
    if (this._trustLevel === "supervised") {
      const last = this._chat.pendingApprovals.at(-1);
      return last?.content;
    }
    return this._chat.messagesSent.at(-1);
  }

  get messagesSent(): string[] {
    return this._chat.messagesSent;
  }

  get pendingApprovals(): Array<{ type: string; content: string }> {
    return this._chat.pendingApprovals;
  }

  get handoffs(): TrackedHandoff[] {
    return this._handoffTracker.handoffs;
  }

  get notifications(): Array<string | StructuredNotification> {
    return this._notifyTracker.notifications;
  }

  get state(): InMemoryStateStore {
    return this._state;
  }

  get filesWritten(): string[] {
    return this._files.filesWritten;
  }

  private buildContext(): AgentContext {
    return {
      state: this._state,
      chat: this._chat,
      files: this._files,
      browser: new MockBrowserProvider(),
      llm: new MockLLMProvider(),
      notify: this._notifyTracker.notify,
      handoff: this._handoffTracker.handoff,
      persona: this.persona,
      conversation: { id: "test-conversation", messages: [...this._messages] },
      trust: {
        score: this._trustLevel === "supervised" ? 0 : this._trustLevel === "guided" ? 40 : 80,
        level: this._trustLevel,
      },
    };
  }
}
```

- [ ] **Step 5: Create test harness entry point**

Create `packages/sdk/src/testing/index.ts`:

```ts
import type { AgentHandler } from "../handler.js";
import type { AgentPersona } from "../context.js";
import { TestChatSession } from "./test-session.js";
import type { ChatSessionOptions } from "./test-session.js";

export interface TestHarnessConfig {
  handler: AgentHandler;
  persona: AgentPersona;
}

export interface TestHarness {
  chat(options?: ChatSessionOptions): TestChatSession;
}

export function createTestHarness(config: TestHarnessConfig): TestHarness {
  return {
    chat(options?: ChatSessionOptions): TestChatSession {
      return new TestChatSession(config.handler, config.persona, options);
    },
  };
}

export function mockPersona(overrides?: Partial<AgentPersona>): AgentPersona {
  return {
    id: "test-persona",
    organizationId: "test-org",
    businessName: "Test Business",
    businessType: "small_business",
    productService: "Test products and services",
    valueProposition: "The best test business",
    tone: "professional",
    qualificationCriteria: {},
    disqualificationCriteria: {},
    bookingLink: null,
    escalationRules: {},
    customInstructions: null,
    ...overrides,
  };
}

export { TestChatSession } from "./test-session.js";
export type { ChatSessionOptions } from "./test-session.js";
export {
  InMemoryStateStore,
  MockFileProvider,
  MockBrowserProvider,
  MockLLMProvider,
} from "./mock-providers.js";
```

- [ ] **Step 6: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/sdk test`
Expected: All tests PASS (manifest + handler + test harness)

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/testing/ packages/sdk/src/handler.ts packages/sdk/src/context.ts packages/sdk/src/handoff.ts packages/sdk/src/action-request.ts packages/sdk/src/__tests__/handler.test.ts packages/sdk/src/index.ts && git commit -m "$(cat <<'EOF'
feat(sdk): add handler, context types, and test harness

AgentHandler interface, AgentContext with provider interfaces,
and createTestHarness() for agent developers to test against
simulated sessions with governance simulation.
EOF
)"
```

---

### Task 5: Add Prisma Models (ActionRequest, AgentState, DeploymentConnection)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/schemas/src/marketplace.ts`
- Modify: `packages/schemas/src/__tests__/marketplace.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add to `packages/schemas/src/__tests__/marketplace.test.ts`:

```ts
import {
  ActionRequestSchema,
  AgentStateSchema,
  DeploymentConnectionSchema,
  ActionType,
  ActionStatus,
  ConnectionStatus,
} from "../marketplace.js";

describe("ActionRequestSchema", () => {
  it("parses a valid action request", () => {
    const result = ActionRequestSchema.safeParse({
      id: "ar_1",
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
      status: "pending",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("defaults status to pending", () => {
    const result = ActionRequestSchema.safeParse({
      id: "ar_1",
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: {},
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("pending");
  });
});

describe("AgentStateSchema", () => {
  it("parses valid state entry", () => {
    const result = AgentStateSchema.safeParse({
      id: "st_1",
      deploymentId: "dep_1",
      key: "leads:count",
      value: 42,
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});

describe("DeploymentConnectionSchema", () => {
  it("parses valid connection", () => {
    const result = DeploymentConnectionSchema.safeParse({
      id: "conn_1",
      deploymentId: "dep_1",
      type: "telegram",
      slot: "default",
      status: "active",
      credentials: "encrypted-token",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("defaults slot to default", () => {
    const result = DeploymentConnectionSchema.safeParse({
      id: "conn_1",
      deploymentId: "dep_1",
      type: "telegram",
      status: "active",
      credentials: "encrypted-token",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slot).toBe("default");
  });
});

describe("ActionType enum", () => {
  it("has expected values", () => {
    expect(ActionType.options).toEqual([
      "send_message",
      "browse_url",
      "read_file",
      "write_file",
      "api_call",
    ]);
  });
});

describe("ActionStatus enum", () => {
  it("has expected values", () => {
    expect(ActionStatus.options).toEqual([
      "pending",
      "approved",
      "rejected",
      "executed",
      "blocked",
    ]);
  });
});

describe("ConnectionStatus enum", () => {
  it("has expected values", () => {
    expect(ConnectionStatus.options).toEqual(["active", "expired", "revoked"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test`
Expected: FAIL — imports not found

- [ ] **Step 3: Add Zod schemas to marketplace.ts**

Add to the end of `packages/schemas/src/marketplace.ts`:

```ts
// --- Action Request ---

export const ActionType = z.enum([
  "send_message",
  "browse_url",
  "read_file",
  "write_file",
  "api_call",
]);
export type ActionType = z.infer<typeof ActionType>;

export const ActionStatus = z.enum(["pending", "approved", "rejected", "executed", "blocked"]);
export type ActionStatus = z.infer<typeof ActionStatus>;

export const ActionRequestSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  type: ActionType,
  surface: z.string(),
  payload: z.record(z.unknown()),
  status: ActionStatus.default("pending"),
  governanceResult: z.record(z.unknown()).nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
  executedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

// --- Agent State ---

export const AgentStateSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.coerce.date(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

// --- Deployment Connection ---

export const ConnectionStatus = z.enum(["active", "expired", "revoked"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const DeploymentConnectionSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  type: z.string(),
  slot: z.string().default("default"),
  status: ConnectionStatus,
  credentials: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DeploymentConnection = z.infer<typeof DeploymentConnectionSchema>;
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test`
Expected: All tests PASS

- [ ] **Step 5: Add Prisma models**

Add to `packages/db/prisma/schema.prisma` (after the existing marketplace models):

```prisma
model ActionRequest {
  id               String    @id @default(cuid())
  deploymentId     String
  type             String    // send_message, browse_url, write_file, api_call
  surface          String    // telegram, web_widget, google_drive, browser
  payload          Json
  status           String    @default("pending") // pending, approved, rejected, executed, blocked
  governanceResult Json?
  reviewedBy       String?
  reviewedAt       DateTime?
  executedAt       DateTime?
  createdAt        DateTime  @default(now())

  deployment AgentDeployment @relation(fields: [deploymentId], references: [id])

  @@index([deploymentId, status])
  @@index([status, createdAt])
}

model AgentState {
  id           String   @id @default(cuid())
  deploymentId String
  key          String
  value        Json
  updatedAt    DateTime @updatedAt

  deployment AgentDeployment @relation(fields: [deploymentId], references: [id])

  @@unique([deploymentId, key])
  @@index([deploymentId])
}

model DeploymentConnection {
  id           String   @id @default(cuid())
  deploymentId String
  type         String
  slot         String   @default("default")
  status       String   @default("active") // active, expired, revoked
  credentials  String   // encrypted
  metadata     Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  deployment AgentDeployment @relation(fields: [deploymentId], references: [id])

  @@unique([deploymentId, type, slot])
  @@index([deploymentId])
}
```

- [ ] **Step 6: Add relations to AgentDeployment model**

In `packages/db/prisma/schema.prisma`, add these fields to the existing `AgentDeployment` model:

```prisma
  actionRequests        ActionRequest[]
  agentStates           AgentState[]
  deploymentConnections DeploymentConnection[]
```

- [ ] **Step 7: Add deploymentId to TrustScoreRecord**

In `packages/db/prisma/schema.prisma`, add to the existing `TrustScoreRecord` model:

```prisma
  deploymentId String?
```

And update the `@@unique` to keep the existing one but add a new index:

```prisma
  @@index([deploymentId])
```

- [ ] **Step 8: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`
Expected: Prisma client generated successfully

- [ ] **Step 9: Create migration**

Run: `cd packages/db && npx prisma migrate dev --name add_action_request_agent_state_deployment_connection`
Expected: Migration created and applied

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/ packages/schemas/src/marketplace.ts packages/schemas/src/__tests__/marketplace.test.ts && git commit -m "$(cat <<'EOF'
feat(db): add ActionRequest, AgentState, DeploymentConnection models

New Prisma models for agent runtime: ActionRequest (governance pipeline),
AgentState (per-deployment key-value store), DeploymentConnection
(typed connections with slot discriminator). Adds deployment-scoped
trust via TrustScoreRecord.deploymentId.
EOF
)"
```

---

### Task 6: Prisma Stores for New Models

**Files:**

- Create: `packages/db/src/stores/prisma-action-request-store.ts`
- Create: `packages/db/src/stores/prisma-agent-state-store.ts`
- Create: `packages/db/src/stores/prisma-deployment-connection-store.ts`
- Create: `packages/db/src/stores/__tests__/action-request-store.test.ts`
- Create: `packages/db/src/stores/__tests__/agent-state-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing test for ActionRequestStore**

Create `packages/db/src/stores/__tests__/action-request-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaActionRequestStore } from "../prisma-action-request-store.js";

function createMockPrisma() {
  return {
    actionRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaActionRequestStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaActionRequestStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaActionRequestStore(prisma as never);
  });

  it("creates an action request", async () => {
    const input = {
      deploymentId: "dep_1",
      type: "send_message" as const,
      surface: "telegram",
      payload: { content: "Hello" },
    };
    const expected = { id: "ar_1", ...input, status: "pending", createdAt: new Date() };
    prisma.actionRequest.create.mockResolvedValue(expected);

    const result = await store.create(input);
    expect(result).toEqual(expected);
    expect(prisma.actionRequest.create).toHaveBeenCalledWith({
      data: input,
    });
  });

  it("lists pending by deployment", async () => {
    prisma.actionRequest.findMany.mockResolvedValue([]);
    await store.listByDeployment("dep_1", "pending");
    expect(prisma.actionRequest.findMany).toHaveBeenCalledWith({
      where: { deploymentId: "dep_1", status: "pending" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("updates status with review info", async () => {
    const updated = { id: "ar_1", status: "approved" };
    prisma.actionRequest.update.mockResolvedValue(updated);

    await store.updateStatus("ar_1", "approved", { reviewedBy: "user_1" });
    expect(prisma.actionRequest.update).toHaveBeenCalledWith({
      where: { id: "ar_1" },
      data: {
        status: "approved",
        reviewedBy: "user_1",
        reviewedAt: expect.any(Date),
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --grep "ActionRequestStore"`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement ActionRequestStore**

Create `packages/db/src/stores/prisma-action-request-store.ts`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { ActionRequest, ActionStatus } from "@switchboard/schemas";

interface CreateActionRequestInput {
  deploymentId: string;
  type: string;
  surface: string;
  payload: Record<string, unknown>;
}

export class PrismaActionRequestStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateActionRequestInput): Promise<ActionRequest> {
    return this.prisma.actionRequest.create({
      data: input,
    }) as unknown as ActionRequest;
  }

  async findById(id: string): Promise<ActionRequest | null> {
    return this.prisma.actionRequest.findUnique({
      where: { id },
    }) as unknown as ActionRequest | null;
  }

  async listByDeployment(deploymentId: string, status?: ActionStatus): Promise<ActionRequest[]> {
    return this.prisma.actionRequest.findMany({
      where: { deploymentId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
    }) as unknown as ActionRequest[];
  }

  async updateStatus(
    id: string,
    status: ActionStatus,
    review?: { reviewedBy: string },
  ): Promise<ActionRequest> {
    return this.prisma.actionRequest.update({
      where: { id },
      data: {
        status,
        ...(review ? { reviewedBy: review.reviewedBy, reviewedAt: new Date() } : {}),
        ...(status === "executed" ? { executedAt: new Date() } : {}),
      },
    }) as unknown as ActionRequest;
  }

  async countPending(deploymentId: string): Promise<number> {
    return this.prisma.actionRequest.count({
      where: { deploymentId, status: "pending" },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --grep "ActionRequestStore"`
Expected: PASS

- [ ] **Step 5: Write failing test for AgentStateStore**

Create `packages/db/src/stores/__tests__/agent-state-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAgentStateStore } from "../prisma-agent-state-store.js";

function createMockPrisma() {
  return {
    agentState: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaAgentStateStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAgentStateStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAgentStateStore(prisma as never);
  });

  it("gets a state value", async () => {
    prisma.agentState.findUnique.mockResolvedValue({
      id: "st_1",
      deploymentId: "dep_1",
      key: "count",
      value: 42,
      updatedAt: new Date(),
    });

    const result = await store.get("dep_1", "count");
    expect(result).toBe(42);
  });

  it("returns null for missing key", async () => {
    prisma.agentState.findUnique.mockResolvedValue(null);
    const result = await store.get("dep_1", "missing");
    expect(result).toBeNull();
  });

  it("sets a state value via upsert", async () => {
    prisma.agentState.upsert.mockResolvedValue({});
    await store.set("dep_1", "count", 42);
    expect(prisma.agentState.upsert).toHaveBeenCalledWith({
      where: { deploymentId_key: { deploymentId: "dep_1", key: "count" } },
      create: { deploymentId: "dep_1", key: "count", value: 42 },
      update: { value: 42 },
    });
  });

  it("lists by prefix", async () => {
    prisma.agentState.findMany.mockResolvedValue([
      { key: "leads:a", value: 1 },
      { key: "leads:b", value: 2 },
    ]);
    const result = await store.list("dep_1", "leads:");
    expect(result).toEqual([
      { key: "leads:a", value: 1 },
      { key: "leads:b", value: 2 },
    ]);
  });

  it("deletes a key", async () => {
    prisma.agentState.delete.mockResolvedValue({});
    await store.delete("dep_1", "count");
    expect(prisma.agentState.delete).toHaveBeenCalledWith({
      where: { deploymentId_key: { deploymentId: "dep_1", key: "count" } },
    });
  });
});
```

- [ ] **Step 6: Implement AgentStateStore**

Create `packages/db/src/stores/prisma-agent-state-store.ts`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";

export class PrismaAgentStateStore {
  constructor(private prisma: PrismaDbClient) {}

  async get(deploymentId: string, key: string): Promise<unknown | null> {
    const record = await this.prisma.agentState.findUnique({
      where: { deploymentId_key: { deploymentId, key } },
    });
    return record?.value ?? null;
  }

  async set(deploymentId: string, key: string, value: unknown): Promise<void> {
    await this.prisma.agentState.upsert({
      where: { deploymentId_key: { deploymentId, key } },
      create: { deploymentId, key, value: value as object },
      update: { value: value as object },
    });
  }

  async list(
    deploymentId: string,
    prefix: string,
  ): Promise<Array<{ key: string; value: unknown }>> {
    const records = await this.prisma.agentState.findMany({
      where: { deploymentId, key: { startsWith: prefix } },
    });
    return records.map((r) => ({ key: r.key, value: r.value }));
  }

  async delete(deploymentId: string, key: string): Promise<void> {
    await this.prisma.agentState.delete({
      where: { deploymentId_key: { deploymentId, key } },
    });
  }
}
```

- [ ] **Step 7: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --grep "AgentStateStore"`
Expected: PASS

- [ ] **Step 8: Implement DeploymentConnectionStore**

Create `packages/db/src/stores/prisma-deployment-connection-store.ts`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { DeploymentConnection, ConnectionStatus } from "@switchboard/schemas";

interface CreateConnectionInput {
  deploymentId: string;
  type: string;
  slot?: string;
  credentials: string;
  metadata?: Record<string, unknown>;
}

export class PrismaDeploymentConnectionStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateConnectionInput): Promise<DeploymentConnection> {
    return this.prisma.deploymentConnection.create({
      data: {
        deploymentId: input.deploymentId,
        type: input.type,
        slot: input.slot ?? "default",
        credentials: input.credentials,
        metadata: (input.metadata as object) ?? undefined,
      },
    }) as unknown as DeploymentConnection;
  }

  async listByDeployment(deploymentId: string): Promise<DeploymentConnection[]> {
    return this.prisma.deploymentConnection.findMany({
      where: { deploymentId },
    }) as unknown as DeploymentConnection[];
  }

  async updateStatus(id: string, status: ConnectionStatus): Promise<DeploymentConnection> {
    return this.prisma.deploymentConnection.update({
      where: { id },
      data: { status },
    }) as unknown as DeploymentConnection;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.deploymentConnection.delete({ where: { id } });
  }
}
```

- [ ] **Step 9: Re-export stores from db index**

Add to `packages/db/src/index.ts`:

```ts
export { PrismaActionRequestStore } from "./stores/prisma-action-request-store.js";
export { PrismaAgentStateStore } from "./stores/prisma-agent-state-store.js";
export { PrismaDeploymentConnectionStore } from "./stores/prisma-deployment-connection-store.js";
```

- [ ] **Step 10: Run all db tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/stores/ packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat(db): add stores for ActionRequest, AgentState, DeploymentConnection

PrismaActionRequestStore — create, list, update status for governance.
PrismaAgentStateStore — key-value state per deployment (get/set/list/delete).
PrismaDeploymentConnectionStore — typed connections with slot discriminator.
EOF
)"
```

---

### Task 7: Action Request Pipeline (Governance)

**Files:**

- Modify: `packages/core/package.json` (add `@switchboard/sdk` dependency)
- Create: `packages/core/src/agent-runtime/action-request-pipeline.ts`
- Create: `packages/core/src/agent-runtime/__tests__/action-request-pipeline.test.ts`

- [ ] **Step 0: Add SDK dependency to core**

Add `"@switchboard/sdk": "workspace:*"` to `packages/core/package.json` dependencies, then run:

Run: `npx pnpm@9.15.4 install`
Expected: Lockfile updated, no errors

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agent-runtime/__tests__/action-request-pipeline.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ActionRequestPipeline } from "../action-request-pipeline.js";
import type { ActionRequestPipelineConfig } from "../action-request-pipeline.js";

function makeConfig(overrides?: Partial<ActionRequestPipelineConfig>): ActionRequestPipelineConfig {
  return {
    trustScore: 0,
    trustLevel: "supervised",
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
      updateStatus: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

describe("ActionRequestPipeline", () => {
  it("queues actions when supervised", async () => {
    const config = makeConfig({ trustLevel: "supervised", trustScore: 10 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("queue");
    expect(config.actionRequestStore.create).toHaveBeenCalled();
  });

  it("executes actions when autonomous", async () => {
    const config = makeConfig({ trustLevel: "autonomous", trustScore: 80 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("execute");
  });

  it("executes actions when guided", async () => {
    const config = makeConfig({ trustLevel: "guided", trustScore: 40 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("execute");
  });

  it("always executes in sandbox surface", async () => {
    const config = makeConfig({ trustLevel: "supervised", trustScore: 0 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "test_chat",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("execute");
  });

  it("always allows file reads regardless of trust", async () => {
    const config = makeConfig({ trustLevel: "supervised", trustScore: 0 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "read_file",
      surface: "google_drive",
      payload: { path: "doc.md" },
    });

    expect(result.decision).toBe("execute");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "ActionRequestPipeline"`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement ActionRequestPipeline**

Create `packages/core/src/agent-runtime/action-request-pipeline.ts`:

```ts
export interface ActionRequestStore {
  create(input: {
    deploymentId: string;
    type: string;
    surface: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: string; status: string }>;
  updateStatus(id: string, status: string, review?: { reviewedBy: string }): Promise<unknown>;
}

export interface ActionRequestPipelineConfig {
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  actionRequestStore: ActionRequestStore;
}

export interface EvaluationInput {
  deploymentId: string;
  type: string;
  surface: string;
  payload: Record<string, unknown>;
}

export interface EvaluationResult {
  decision: "execute" | "queue" | "block";
  actionRequestId?: string;
  reason: string;
}

const SANDBOX_SURFACES = new Set(["test_chat"]);
const READ_ONLY_TYPES = new Set(["read_file"]);

export class ActionRequestPipeline {
  constructor(private config: ActionRequestPipelineConfig) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    // Sandbox surfaces always execute
    if (SANDBOX_SURFACES.has(input.surface)) {
      return { decision: "execute", reason: "sandbox_surface" };
    }

    // Read-only actions always execute
    if (READ_ONLY_TYPES.has(input.type)) {
      return { decision: "execute", reason: "read_only_action" };
    }

    // Supervised: queue for approval
    if (this.config.trustLevel === "supervised") {
      const actionRequest = await this.config.actionRequestStore.create(input);
      return {
        decision: "queue",
        actionRequestId: actionRequest.id,
        reason: "supervised_requires_approval",
      };
    }

    // Guided and Autonomous: execute immediately
    return { decision: "execute", reason: `trust_level_${this.config.trustLevel}` };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "ActionRequestPipeline"`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runtime/ && git commit -m "$(cat <<'EOF'
feat(core): add ActionRequestPipeline for governance

Evaluates agent actions against trust level: supervised queues for
approval, guided/autonomous execute immediately. Sandbox surfaces
and read-only actions always execute regardless of trust.
EOF
)"
```

---

### Task 8: State Provider (Bridge SDK StateStore to Prisma)

**Files:**

- Create: `packages/core/src/agent-runtime/state-provider.ts`
- Create: `packages/core/src/agent-runtime/__tests__/state-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agent-runtime/__tests__/state-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateProvider } from "../state-provider.js";

function createMockStore() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
}

describe("StateProvider", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let provider: StateProvider;

  beforeEach(() => {
    mockStore = createMockStore();
    provider = new StateProvider("dep_1", mockStore);
  });

  it("delegates get with deploymentId", async () => {
    mockStore.get.mockResolvedValue(42);
    const result = await provider.get("count");
    expect(result).toBe(42);
    expect(mockStore.get).toHaveBeenCalledWith("dep_1", "count");
  });

  it("delegates set with deploymentId", async () => {
    mockStore.set.mockResolvedValue(undefined);
    await provider.set("count", 42);
    expect(mockStore.set).toHaveBeenCalledWith("dep_1", "count", 42);
  });

  it("delegates list with deploymentId", async () => {
    mockStore.list.mockResolvedValue([{ key: "a", value: 1 }]);
    const result = await provider.list("prefix:");
    expect(result).toEqual([{ key: "a", value: 1 }]);
    expect(mockStore.list).toHaveBeenCalledWith("dep_1", "prefix:");
  });

  it("delegates delete with deploymentId", async () => {
    mockStore.delete.mockResolvedValue(undefined);
    await provider.delete("count");
    expect(mockStore.delete).toHaveBeenCalledWith("dep_1", "count");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "StateProvider"`
Expected: FAIL

- [ ] **Step 3: Implement StateProvider**

Create `packages/core/src/agent-runtime/state-provider.ts`:

```ts
import type { StateStore } from "@switchboard/sdk";

export interface AgentStateStoreInterface {
  get(deploymentId: string, key: string): Promise<unknown | null>;
  set(deploymentId: string, key: string, value: unknown): Promise<void>;
  list(deploymentId: string, prefix: string): Promise<Array<{ key: string; value: unknown }>>;
  delete(deploymentId: string, key: string): Promise<void>;
}

export class StateProvider implements StateStore {
  constructor(
    private deploymentId: string,
    private store: AgentStateStoreInterface,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    return (await this.store.get(this.deploymentId, key)) as T | null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.store.set(this.deploymentId, key, value);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    return this.store.list(this.deploymentId, prefix);
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(this.deploymentId, key);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "StateProvider"`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runtime/state-provider.ts packages/core/src/agent-runtime/__tests__/state-provider.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add StateProvider bridging SDK StateStore to Prisma

Scopes all state operations to a deployment ID, delegating to
the underlying PrismaAgentStateStore.
EOF
)"
```

---

### Task 9: Cloud Chat Provider

**Files:**

- Create: `packages/core/src/agent-runtime/chat-provider.ts`
- Create: `packages/core/src/agent-runtime/__tests__/chat-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agent-runtime/__tests__/chat-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudChatProvider } from "../chat-provider.js";
import type { ActionRequestPipeline, EvaluationResult } from "../action-request-pipeline.js";

function createMockPipeline(decision: "execute" | "queue" = "execute") {
  return {
    evaluate: vi.fn().mockResolvedValue({
      decision,
      reason: decision === "execute" ? "autonomous" : "supervised",
      actionRequestId: decision === "queue" ? "ar_1" : undefined,
    } satisfies EvaluationResult),
  } as unknown as ActionRequestPipeline;
}

describe("CloudChatProvider", () => {
  it("sends message when pipeline says execute", async () => {
    const pipeline = createMockPipeline("execute");
    const onExecute = vi.fn();
    const provider = new CloudChatProvider({
      deploymentId: "dep_1",
      surface: "telegram",
      pipeline,
      onExecute,
    });

    await provider.send("Hello");

    expect(pipeline.evaluate).toHaveBeenCalledWith({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });
    expect(onExecute).toHaveBeenCalledWith("Hello");
  });

  it("does not execute when pipeline says queue", async () => {
    const pipeline = createMockPipeline("queue");
    const onExecute = vi.fn();
    const provider = new CloudChatProvider({
      deploymentId: "dep_1",
      surface: "telegram",
      pipeline,
      onExecute,
    });

    await provider.send("Hello");

    expect(onExecute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "CloudChatProvider"`
Expected: FAIL

- [ ] **Step 3: Implement CloudChatProvider**

Create `packages/core/src/agent-runtime/chat-provider.ts`:

```ts
import type { ChatProvider } from "@switchboard/sdk";
import type { ActionRequestPipeline } from "./action-request-pipeline.js";

export interface CloudChatProviderConfig {
  deploymentId: string;
  surface: string;
  pipeline: ActionRequestPipeline;
  onExecute: (message: string) => Promise<void> | void;
}

export class CloudChatProvider implements ChatProvider {
  constructor(private config: CloudChatProviderConfig) {}

  async send(message: string): Promise<void> {
    const result = await this.config.pipeline.evaluate({
      deploymentId: this.config.deploymentId,
      type: "send_message",
      surface: this.config.surface,
      payload: { content: message },
    });

    if (result.decision === "execute") {
      await this.config.onExecute(message);
    }
    // If "queue", the pipeline already persisted the ActionRequest.
    // The message will be sent when the founder approves.
  }

  async sendToThread(threadId: string, message: string): Promise<void> {
    const result = await this.config.pipeline.evaluate({
      deploymentId: this.config.deploymentId,
      type: "send_message",
      surface: this.config.surface,
      payload: { content: message, threadId },
    });

    if (result.decision === "execute") {
      await this.config.onExecute(message);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "CloudChatProvider"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runtime/chat-provider.ts packages/core/src/agent-runtime/__tests__/chat-provider.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add CloudChatProvider with governance integration

ChatProvider implementation that evaluates every send through
the ActionRequestPipeline. Supervised agents queue messages for
approval; autonomous agents send immediately.
EOF
)"
```

---

### Task 10: LLM Provider (Wraps Existing LLMAdapter)

**Files:**

- Create: `packages/core/src/agent-runtime/llm-provider.ts`
- Create: `packages/core/src/agent-runtime/__tests__/llm-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agent-runtime/__tests__/llm-provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { RuntimeLLMProvider } from "../llm-provider.js";
import type { LLMAdapter } from "../../llm-adapter.js";

describe("RuntimeLLMProvider", () => {
  it("translates SDK chat() call to LLMAdapter generateReply()", async () => {
    const mockAdapter: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: "I can help with that!",
        confidence: 0.95,
      }),
    };

    const provider = new RuntimeLLMProvider(mockAdapter);

    const result = await provider.chat({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.text).toBe("I can help with that!");
    expect(mockAdapter.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "You are a helpful assistant.",
        conversationHistory: [
          expect.objectContaining({
            direction: "inbound",
            content: "Hello",
            channel: "dashboard",
          }),
        ],
      }),
      undefined,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "RuntimeLLMProvider"`
Expected: FAIL

- [ ] **Step 3: Implement RuntimeLLMProvider**

Create `packages/core/src/agent-runtime/llm-provider.ts`:

```ts
import type { LLMProvider } from "@switchboard/sdk";
import type { LLMAdapter, ModelConfig } from "../llm-adapter.js";
import type { Message } from "../conversation-store.js";

let messageCounter = 0;

function toConversationMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Message[] {
  return messages.map((msg) => ({
    id: `sdk-msg-${++messageCounter}`,
    contactId: "sdk-contact",
    direction: msg.role === "user" ? ("inbound" as const) : ("outbound" as const),
    content: msg.content,
    timestamp: new Date().toISOString(),
    channel: "dashboard" as const,
  }));
}

export class RuntimeLLMProvider implements LLMProvider {
  constructor(
    private adapter: LLMAdapter,
    private modelConfig?: ModelConfig,
  ) {}

  async chat(params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string }> {
    const result = await this.adapter.generateReply(
      {
        systemPrompt: params.system,
        conversationHistory: toConversationMessages(params.messages),
        retrievedContext: [],
        agentInstructions: "",
      },
      this.modelConfig,
    );

    return { text: result.reply };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "RuntimeLLMProvider"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runtime/llm-provider.ts packages/core/src/agent-runtime/__tests__/llm-provider.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add RuntimeLLMProvider wrapping existing LLMAdapter

Translates SDK's ctx.llm.chat() interface to the existing
LLMAdapter.generateReply() used throughout the codebase.
EOF
)"
```

---

### Task 11: Context Builder

**Files:**

- Create: `packages/core/src/agent-runtime/context-builder.ts`
- Create: `packages/core/src/agent-runtime/__tests__/context-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agent-runtime/__tests__/context-builder.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ContextBuilder } from "../context-builder.js";
import type { ContextBuilderConfig } from "../context-builder.js";

function makeConfig(overrides?: Partial<ContextBuilderConfig>): ContextBuilderConfig {
  return {
    deploymentId: "dep_1",
    surface: "test_chat",
    trustScore: 80,
    trustLevel: "autonomous",
    persona: {
      id: "p_1",
      organizationId: "org_1",
      businessName: "Test Co",
      businessType: "small_business",
      productService: "Testing",
      valueProposition: "Best tests",
      tone: "professional",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      bookingLink: null,
      escalationRules: {},
      customInstructions: null,
    },
    stateStore: {
      get: vi.fn(),
      set: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    },
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
      updateStatus: vi.fn(),
    },
    llmAdapter: {
      generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
    },
    onChatExecute: vi.fn(),
    ...overrides,
  };
}

describe("ContextBuilder", () => {
  it("builds a valid AgentContext", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const ctx = builder.build();

    expect(ctx.persona.businessName).toBe("Test Co");
    expect(ctx.trust.score).toBe(80);
    expect(ctx.trust.level).toBe("autonomous");
    expect(ctx.state).toBeDefined();
    expect(ctx.chat).toBeDefined();
    expect(ctx.llm).toBeDefined();
    expect(ctx.notify).toBeTypeOf("function");
    expect(ctx.handoff).toBeTypeOf("function");
  });

  it("includes conversation when provided", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const ctx = builder.build({
      conversation: {
        id: "conv_1",
        messages: [{ role: "user", content: "hi" }],
      },
    });

    expect(ctx.conversation?.id).toBe("conv_1");
    expect(ctx.conversation?.messages).toHaveLength(1);
  });

  it("includes handoff payload when provided", () => {
    const config = makeConfig();
    const builder = new ContextBuilder(config);
    const ctx = builder.build({
      handoffPayload: {
        fromAgent: "speed-to-lead",
        reason: "qualified",
        context: { budget: 5000 },
      },
    });

    expect(ctx.handoffPayload?.fromAgent).toBe("speed-to-lead");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "ContextBuilder"`
Expected: FAIL

- [ ] **Step 3: Implement ContextBuilder**

Create `packages/core/src/agent-runtime/context-builder.ts`:

```ts
import type { AgentContext, AgentPersona, StructuredNotification } from "@switchboard/sdk";
import type { HandoffPayload } from "@switchboard/sdk";
import type { LLMAdapter } from "../llm-adapter.js";
import { ActionRequestPipeline } from "./action-request-pipeline.js";
import type { ActionRequestStore } from "./action-request-pipeline.js";
import { StateProvider } from "./state-provider.js";
import type { AgentStateStoreInterface } from "./state-provider.js";
import { CloudChatProvider } from "./chat-provider.js";
import { RuntimeLLMProvider } from "./llm-provider.js";

export interface ContextBuilderConfig {
  deploymentId: string;
  surface: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  persona: AgentPersona;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapter: LLMAdapter;
  onChatExecute: (message: string) => Promise<void> | void;
}

interface BuildOptions {
  conversation?: { id: string; messages: Array<{ role: string; content: string }> };
  handoffPayload?: HandoffPayload;
}

export class ContextBuilder {
  private pipeline: ActionRequestPipeline;

  constructor(private config: ContextBuilderConfig) {
    this.pipeline = new ActionRequestPipeline({
      trustScore: config.trustScore,
      trustLevel: config.trustLevel,
      actionRequestStore: config.actionRequestStore,
    });
  }

  build(options?: BuildOptions): AgentContext {
    const notifications: Array<string | StructuredNotification> = [];
    const handoffs: Array<{ to: string; payload: Omit<HandoffPayload, "fromAgent"> }> = [];

    return {
      state: new StateProvider(this.config.deploymentId, this.config.stateStore),
      chat: new CloudChatProvider({
        deploymentId: this.config.deploymentId,
        surface: this.config.surface,
        pipeline: this.pipeline,
        onExecute: this.config.onChatExecute,
      }),
      files: {
        async read(_path: string) {
          throw new Error("FileProvider not configured — add a file connection");
        },
        async write(_path: string, _content: string) {
          throw new Error("FileProvider not configured — add a file connection");
        },
      },
      browser: {
        async navigate(_url: string) {
          throw new Error("BrowserProvider not configured — add browser capability");
        },
        async click(_selector: string) {
          throw new Error("BrowserProvider not configured");
        },
        async extract(_selector: string): Promise<string> {
          throw new Error("BrowserProvider not configured");
        },
        async screenshot(): Promise<Buffer> {
          throw new Error("BrowserProvider not configured");
        },
      },
      llm: new RuntimeLLMProvider(this.config.llmAdapter),
      notify: async (message) => {
        notifications.push(message);
      },
      handoff: async (agentSlug, payload) => {
        handoffs.push({ to: agentSlug, payload });
      },
      persona: this.config.persona,
      conversation: options?.conversation,
      handoffPayload: options?.handoffPayload,
      trust: {
        score: this.config.trustScore,
        level: this.config.trustLevel,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "ContextBuilder"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runtime/context-builder.ts packages/core/src/agent-runtime/__tests__/context-builder.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add ContextBuilder assembling AgentContext

Builds a fully wired AgentContext from deployment config —
StateProvider, CloudChatProvider (governance-aware), RuntimeLLMProvider,
with stub file/browser providers that throw when not configured.
EOF
)"
```

---

### Task 12: Agent Runtime (Top-Level Orchestrator)

**Files:**

- Create: `packages/core/src/agent-runtime/agent-runtime.ts`
- Create: `packages/core/src/agent-runtime/__tests__/agent-runtime.test.ts`
- Create: `packages/core/src/agent-runtime/index.ts`
- Modify: `packages/core/package.json` (add export)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agent-runtime/__tests__/agent-runtime.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";
import type { AgentHandler } from "@switchboard/sdk";
import type { AgentRuntimeConfig } from "../agent-runtime.js";

function makeRuntimeConfig(
  handler: AgentHandler,
  overrides?: Partial<AgentRuntimeConfig>,
): AgentRuntimeConfig {
  return {
    handler,
    deploymentId: "dep_1",
    surface: "test_chat",
    trustScore: 80,
    trustLevel: "autonomous",
    persona: {
      id: "p_1",
      organizationId: "org_1",
      businessName: "Test Co",
      businessType: "small_business",
      productService: "Testing",
      valueProposition: "Best",
      tone: "professional",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      bookingLink: null,
      escalationRules: {},
      customInstructions: null,
    },
    stateStore: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() },
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
      updateStatus: vi.fn(),
    },
    llmAdapter: {
      generateReply: vi.fn().mockResolvedValue({ reply: "Hello!", confidence: 0.9 }),
    },
    onChatExecute: vi.fn(),
    ...overrides,
  };
}

describe("AgentRuntime", () => {
  it("dispatches onMessage event", async () => {
    const onMessage = vi.fn();
    const handler: AgentHandler = { onMessage };
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    const ctx = onMessage.mock.calls[0][0];
    expect(ctx.persona.businessName).toBe("Test Co");
    expect(ctx.conversation?.messages).toHaveLength(1);
  });

  it("dispatches onHandoff event", async () => {
    const onHandoff = vi.fn();
    const handler: AgentHandler = { onHandoff };
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await runtime.handleHandoff({
      fromAgent: "speed-to-lead",
      reason: "qualified",
      context: { budget: 5000 },
    });

    expect(onHandoff).toHaveBeenCalledTimes(1);
    const ctx = onHandoff.mock.calls[0][0];
    expect(ctx.handoffPayload?.fromAgent).toBe("speed-to-lead");
  });

  it("dispatches onSchedule event", async () => {
    const onSchedule = vi.fn();
    const handler: AgentHandler = { onSchedule };
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await runtime.handleSchedule();

    expect(onSchedule).toHaveBeenCalledTimes(1);
  });

  it("throws if handler method is not defined for event", async () => {
    const handler: AgentHandler = {};
    const runtime = new AgentRuntime(makeRuntimeConfig(handler));

    await expect(
      runtime.handleMessage({
        conversationId: "conv_1",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("does not implement onMessage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "AgentRuntime"`
Expected: FAIL

- [ ] **Step 3: Implement AgentRuntime**

Create `packages/core/src/agent-runtime/agent-runtime.ts`:

```ts
import type { AgentHandler, AgentPersona } from "@switchboard/sdk";
import type { HandoffPayload } from "@switchboard/sdk";
import type { LLMAdapter } from "../llm-adapter.js";
import { ContextBuilder } from "./context-builder.js";
import type { ActionRequestStore } from "./action-request-pipeline.js";
import type { AgentStateStoreInterface } from "./state-provider.js";

export interface AgentRuntimeConfig {
  handler: AgentHandler;
  deploymentId: string;
  surface: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  persona: AgentPersona;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapter: LLMAdapter;
  onChatExecute: (message: string) => Promise<void> | void;
}

export interface MessageEvent {
  conversationId: string;
  messages: Array<{ role: string; content: string }>;
}

export class AgentRuntime {
  private contextBuilder: ContextBuilder;

  constructor(private config: AgentRuntimeConfig) {
    this.contextBuilder = new ContextBuilder({
      deploymentId: config.deploymentId,
      surface: config.surface,
      trustScore: config.trustScore,
      trustLevel: config.trustLevel,
      persona: config.persona,
      stateStore: config.stateStore,
      actionRequestStore: config.actionRequestStore,
      llmAdapter: config.llmAdapter,
      onChatExecute: config.onChatExecute,
    });
  }

  async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.config.handler.onMessage) {
      throw new Error("Agent does not implement onMessage");
    }

    const ctx = this.contextBuilder.build({
      conversation: {
        id: event.conversationId,
        messages: event.messages,
      },
    });

    await this.config.handler.onMessage(ctx);
  }

  async handleHandoff(payload: HandoffPayload): Promise<void> {
    if (!this.config.handler.onHandoff) {
      throw new Error("Agent does not implement onHandoff");
    }

    const ctx = this.contextBuilder.build({
      handoffPayload: {
        fromAgent: payload.fromAgent,
        reason: payload.reason,
        context: payload.context,
      },
    });

    await this.config.handler.onHandoff(ctx);
  }

  async handleSchedule(): Promise<void> {
    if (!this.config.handler.onSchedule) {
      throw new Error("Agent does not implement onSchedule");
    }

    const ctx = this.contextBuilder.build();
    await this.config.handler.onSchedule(ctx);
  }

  async handleTask(task: { type: string; input: Record<string, unknown> }): Promise<void> {
    if (!this.config.handler.onTask) {
      throw new Error("Agent does not implement onTask");
    }

    const ctx = this.contextBuilder.build();
    // Attach task to context (cast to AgentTask shape)
    (ctx as { task: unknown }).task = task;
    await this.config.handler.onTask(ctx);
  }

  async handleSetup(): Promise<void> {
    if (!this.config.handler.onSetup) {
      throw new Error("Agent does not implement onSetup");
    }

    const ctx = this.contextBuilder.build();
    await this.config.handler.onSetup(ctx);
  }
}
```

- [ ] **Step 4: Create barrel file**

Create `packages/core/src/agent-runtime/index.ts`:

```ts
export { AgentRuntime } from "./agent-runtime.js";
export type { AgentRuntimeConfig, MessageEvent } from "./agent-runtime.js";

export { ActionRequestPipeline } from "./action-request-pipeline.js";
export type {
  ActionRequestStore,
  ActionRequestPipelineConfig,
  EvaluationInput,
  EvaluationResult,
} from "./action-request-pipeline.js";

export { ContextBuilder } from "./context-builder.js";
export type { ContextBuilderConfig } from "./context-builder.js";

export { StateProvider } from "./state-provider.js";
export type { AgentStateStoreInterface } from "./state-provider.js";

export { CloudChatProvider } from "./chat-provider.js";
export type { CloudChatProviderConfig } from "./chat-provider.js";

export { RuntimeLLMProvider } from "./llm-provider.js";
```

- [ ] **Step 5: Add export to core package.json**

Add to `packages/core/package.json` exports:

```json
"./agent-runtime": {
  "types": "./dist/agent-runtime/index.d.ts",
  "import": "./dist/agent-runtime/index.js"
}
```

- [ ] **Step 6: Run all tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All tests PASS

- [ ] **Step 7: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: No errors

- [ ] **Step 8: Run full build**

Run: `npx pnpm@9.15.4 build`
Expected: All packages build successfully

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/agent-runtime/ packages/core/package.json && git commit -m "$(cat <<'EOF'
feat(core): add AgentRuntime top-level orchestrator

AgentRuntime dispatches events (message, handoff, schedule, setup)
to agent handlers with a fully-wired AgentContext. Barrel file
exports all agent-runtime components.
EOF
)"
```

---

### Task 13: Update Trust Score Engine for Deployment Scoping

**Files:**

- Modify: `packages/core/src/marketplace/trust-score-engine.ts`
- Modify: `packages/core/src/marketplace/__tests__/trust-score-engine.test.ts`

- [ ] **Step 1: Write failing test for deployment-scoped trust**

Add to `packages/core/src/marketplace/__tests__/trust-score-engine.test.ts`:

```ts
describe("deployment-scoped trust", () => {
  it("records approval with deploymentId", async () => {
    const store = createInMemoryStore(); // use existing test helper
    const engine = new TrustScoreEngine(store);

    await engine.recordApproval("listing_1", "general", "dep_1");

    // Verify store was called with deploymentId
    const record = await store.getOrCreate("listing_1", "general", "dep_1");
    expect(record.totalApprovals).toBe(1);
  });

  it("keeps deployment trust separate from global", async () => {
    const store = createInMemoryStore();
    const engine = new TrustScoreEngine(store);

    // Approve under deployment
    await engine.recordApproval("listing_1", "general", "dep_1");

    // Global trust unchanged
    const globalRecord = await store.getOrCreate("listing_1", "general");
    expect(globalRecord.totalApprovals).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "deployment-scoped"`
Expected: FAIL — `recordApproval` doesn't accept `deploymentId`

- [ ] **Step 3: Update TrustScoreStore interface**

In `packages/core/src/marketplace/trust-score-engine.ts`, update the `TrustScoreStore` interface:

```ts
export interface TrustScoreStore {
  getOrCreate(
    listingId: string,
    taskCategory: string,
    deploymentId?: string,
  ): Promise<TrustScoreRecord>;
  update(
    id: string,
    data: Partial<
      Pick<
        TrustScoreRecord,
        "score" | "totalApprovals" | "totalRejections" | "consecutiveApprovals" | "lastActivityAt"
      >
    >,
  ): Promise<TrustScoreRecord>;
  listByListing(listingId: string): Promise<TrustScoreRecord[]>;
  getAggregateScore(listingId: string): Promise<number>;
  getDeploymentScore?(deploymentId: string): Promise<number>;
}
```

- [ ] **Step 4: Update recordApproval and recordRejection**

Add optional `deploymentId` parameter to `recordApproval` and `recordRejection` methods:

```ts
async recordApproval(listingId: string, taskCategory: string, deploymentId?: string): Promise<TrustScoreRecord> {
  const record = await this.store.getOrCreate(listingId, taskCategory, deploymentId);
  // ... existing logic unchanged
}

async recordRejection(listingId: string, taskCategory: string, deploymentId?: string): Promise<TrustScoreRecord> {
  const record = await this.store.getOrCreate(listingId, taskCategory, deploymentId);
  // ... existing logic unchanged
}
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "TrustScoreEngine"`
Expected: All tests PASS (existing + new)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/marketplace/ && git commit -m "$(cat <<'EOF'
feat(core): add deployment-scoped trust scoring

TrustScoreStore.getOrCreate and recordApproval/recordRejection
now accept optional deploymentId for per-deployment trust tracking.
Global marketplace reputation preserved when deploymentId omitted.
EOF
)"
```

---

### Task 14: Final Integration Test + Cleanup

**Files:**

- Create: `packages/core/src/agent-runtime/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `packages/core/src/agent-runtime/__tests__/integration.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";
import type { AgentHandler, AgentContext } from "@switchboard/sdk";

describe("AgentRuntime integration", () => {
  it("full message flow: handler receives context, sends response, governed by trust", async () => {
    const sentMessages: string[] = [];

    const handler: AgentHandler = {
      async onMessage(ctx: AgentContext) {
        const lastMsg = ctx.conversation?.messages.at(-1);
        const name = ctx.persona.businessName;
        await ctx.chat.send(`Welcome to ${name}! You said: ${lastMsg?.content}`);
      },
    };

    const runtime = new AgentRuntime({
      handler,
      deploymentId: "dep_1",
      surface: "test_chat",
      trustScore: 80,
      trustLevel: "autonomous",
      persona: {
        id: "p_1",
        organizationId: "org_1",
        businessName: "Bloom Flowers",
        businessType: "small_business",
        productService: "Wedding flowers",
        valueProposition: "Beautiful arrangements",
        tone: "warm",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        bookingLink: null,
        escalationRules: {},
        customInstructions: null,
      },
      stateStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
      actionRequestStore: {
        create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
        updateStatus: vi.fn(),
      },
      llmAdapter: {
        generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
      },
      onChatExecute: (msg) => {
        sentMessages.push(msg);
      },
    });

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "I need flowers" }],
    });

    expect(sentMessages).toEqual(["Welcome to Bloom Flowers! You said: I need flowers"]);
  });

  it("supervised agent queues message instead of sending", async () => {
    const sentMessages: string[] = [];
    const createdRequests: unknown[] = [];

    const handler: AgentHandler = {
      async onMessage(ctx: AgentContext) {
        await ctx.chat.send("Response that needs approval");
      },
    };

    const runtime = new AgentRuntime({
      handler,
      deploymentId: "dep_1",
      surface: "telegram",
      trustScore: 10,
      trustLevel: "supervised",
      persona: {
        id: "p_1",
        organizationId: "org_1",
        businessName: "Test",
        businessType: "small_business",
        productService: "Test",
        valueProposition: "Test",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        bookingLink: null,
        escalationRules: {},
        customInstructions: null,
      },
      stateStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
      actionRequestStore: {
        create: vi.fn().mockImplementation((input) => {
          createdRequests.push(input);
          return Promise.resolve({ id: "ar_1", status: "pending" });
        }),
        updateStatus: vi.fn(),
      },
      llmAdapter: {
        generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
      },
      onChatExecute: (msg) => {
        sentMessages.push(msg);
      },
    });

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "hello" }],
    });

    // Message NOT sent — queued for approval
    expect(sentMessages).toHaveLength(0);
    // Action request created
    expect(createdRequests).toHaveLength(1);
    expect(createdRequests[0]).toMatchObject({
      type: "send_message",
      surface: "telegram",
      payload: { content: "Response that needs approval" },
    });
  });

  it("stateful agent persists across handler calls", async () => {
    const stateData = new Map<string, unknown>();

    const handler: AgentHandler = {
      async onMessage(ctx: AgentContext) {
        const count = (await ctx.state.get<number>("msg_count")) ?? 0;
        await ctx.state.set("msg_count", count + 1);
        await ctx.chat.send(`Message #${count + 1}`);
      },
    };

    const stateStore = {
      get: vi
        .fn()
        .mockImplementation((_depId: string, key: string) =>
          Promise.resolve(stateData.get(key) ?? null),
        ),
      set: vi.fn().mockImplementation((_depId: string, key: string, value: unknown) => {
        stateData.set(key, value);
        return Promise.resolve();
      }),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    };

    const sentMessages: string[] = [];

    const runtime = new AgentRuntime({
      handler,
      deploymentId: "dep_1",
      surface: "test_chat",
      trustScore: 80,
      trustLevel: "autonomous",
      persona: {
        id: "p_1",
        organizationId: "org_1",
        businessName: "Test",
        businessType: "small_business",
        productService: "Test",
        valueProposition: "Test",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        bookingLink: null,
        escalationRules: {},
        customInstructions: null,
      },
      stateStore,
      actionRequestStore: {
        create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
        updateStatus: vi.fn(),
      },
      llmAdapter: {
        generateReply: vi.fn().mockResolvedValue({ reply: "ok", confidence: 0.9 }),
      },
      onChatExecute: (msg) => {
        sentMessages.push(msg);
      },
    });

    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "first" }],
    });
    await runtime.handleMessage({
      conversationId: "conv_1",
      messages: [{ role: "user", content: "second" }],
    });

    expect(sentMessages).toEqual(["Message #1", "Message #2"]);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests across all packages PASS

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-runtime/__tests__/integration.test.ts && git commit -m "$(cat <<'EOF'
test(core): add AgentRuntime integration tests

End-to-end tests: autonomous message flow, supervised governance
queuing, and stateful agent persisting across handler calls.
EOF
)"
```

- [ ] **Step 6: Final build**

Run: `npx pnpm@9.15.4 build`
Expected: All packages build successfully
