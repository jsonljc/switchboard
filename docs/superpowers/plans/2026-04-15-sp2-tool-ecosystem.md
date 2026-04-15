# SP2: Tool Ecosystem for Mass Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize how conversational agents in the revenue loop are migrated into the governed skill runtime — tool registry, governance tiers, generic handler, and a website profiler proof migration.

**Architecture:** ParameterBuilder functions registered per skill slug replace bespoke handler classes. A ToolRegistry validates tool/skill dependencies at bootstrap. Governance tiers classify tool operations by risk level with a central policy table. The website profiler proves the pattern works for non-sales-pipeline domains.

**Tech Stack:** TypeScript (ESM), Vitest, Zod for validation, Anthropic SDK, `node:https` for HTTP fetching, `cheerio` for HTML parsing.

**Spec:** `docs/superpowers/specs/2026-04-15-sp2-tool-ecosystem-design.md`

---

### Task 1: Governance Types + Policy Table

**Files:**

- Create: `packages/core/src/skill-runtime/governance.ts`
- Create: `packages/core/src/skill-runtime/governance.test.ts`

The centralized governance tier system. Every subsequent task depends on these types.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/governance.test.ts
import { describe, it, expect } from "vitest";
import {
  getToolGovernanceDecision,
  GOVERNANCE_POLICY,
  type GovernanceTier,
  type GovernanceOutcome,
} from "./governance.js";
import type { SkillToolOperation } from "./types.js";

function makeOp(
  tier: GovernanceTier,
  override?: Partial<Record<string, string>>,
): SkillToolOperation {
  return {
    description: "test",
    inputSchema: { type: "object", properties: {} },
    governanceTier: tier,
    governanceOverride: override as any,
    execute: async () => ({}),
  };
}

describe("GOVERNANCE_POLICY", () => {
  it("has entries for all 4 tiers", () => {
    expect(Object.keys(GOVERNANCE_POLICY)).toEqual([
      "read",
      "internal_write",
      "external_write",
      "destructive",
    ]);
  });

  it("each tier maps all 3 trust levels", () => {
    for (const tier of Object.values(GOVERNANCE_POLICY)) {
      expect(Object.keys(tier)).toEqual(["supervised", "guided", "autonomous"]);
    }
  });
});

describe("getToolGovernanceDecision", () => {
  // read tier — always auto-approve
  it("auto-approves read ops in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("read"), "supervised")).toBe("auto-approve");
  });
  it("auto-approves read ops in autonomous mode", () => {
    expect(getToolGovernanceDecision(makeOp("read"), "autonomous")).toBe("auto-approve");
  });

  // internal_write tier
  it("requires approval for internal_write in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("internal_write"), "supervised")).toBe(
      "require-approval",
    );
  });
  it("auto-approves internal_write in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("internal_write"), "guided")).toBe("auto-approve");
  });

  // external_write tier — always require-approval
  it("requires approval for external_write in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("external_write"), "supervised")).toBe(
      "require-approval",
    );
  });
  it("requires approval for external_write in autonomous mode", () => {
    expect(getToolGovernanceDecision(makeOp("external_write"), "autonomous")).toBe(
      "require-approval",
    );
  });

  // destructive tier
  it("denies destructive ops in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("destructive"), "supervised")).toBe("deny");
  });
  it("requires approval for destructive ops in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("destructive"), "guided")).toBe("require-approval");
  });

  // override
  it("uses override when present", () => {
    const op = makeOp("internal_write", { supervised: "auto-approve" });
    expect(getToolGovernanceDecision(op, "supervised")).toBe("auto-approve");
  });
  it("falls back to tier when override does not cover trust level", () => {
    const op = makeOp("internal_write", { supervised: "auto-approve" });
    expect(getToolGovernanceDecision(op, "guided")).toBe("auto-approve");
  });
});

describe("mapDecisionToOutcome", () => {
  it("maps auto-approve to auto-approved", async () => {
    const { mapDecisionToOutcome } = await import("./governance.js");
    expect(mapDecisionToOutcome("auto-approve")).toBe("auto-approved");
  });
  it("maps require-approval to require-approval", async () => {
    const { mapDecisionToOutcome } = await import("./governance.js");
    expect(mapDecisionToOutcome("require-approval")).toBe("require-approval");
  });
  it("maps deny to denied", async () => {
    const { mapDecisionToOutcome } = await import("./governance.js");
    expect(mapDecisionToOutcome("deny")).toBe("denied");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/governance.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/governance.ts
import type { SkillToolOperation } from "./types.js";

export type GovernanceTier = "read" | "internal_write" | "external_write" | "destructive";
export type TrustLevel = "supervised" | "guided" | "autonomous";
export type GovernanceDecision = "auto-approve" | "require-approval" | "deny";
export type GovernanceOutcome = "auto-approved" | "require-approval" | "denied";

export const GOVERNANCE_POLICY: Record<GovernanceTier, Record<TrustLevel, GovernanceDecision>> = {
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

export function getToolGovernanceDecision(
  op: SkillToolOperation,
  trustLevel: TrustLevel,
): GovernanceDecision {
  if (op.governanceOverride?.[trustLevel]) {
    return op.governanceOverride[trustLevel]!;
  }
  return GOVERNANCE_POLICY[op.governanceTier][trustLevel];
}

export function mapDecisionToOutcome(decision: GovernanceDecision): GovernanceOutcome {
  switch (decision) {
    case "auto-approve":
      return "auto-approved";
    case "require-approval":
      return "require-approval";
    case "deny":
      return "denied";
  }
}

export interface GovernanceLogEntry {
  operationId: string;
  tier: GovernanceTier;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
```

- [ ] **Step 4: Update `SkillToolOperation` in types.ts**

In `packages/core/src/skill-runtime/types.ts`, update the `SkillToolOperation` interface and `ToolCallRecord`:

```typescript
// Add imports at top
import type {
  GovernanceTier,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
} from "./governance.js";

// Replace the existing SkillToolOperation interface:
export interface SkillToolOperation {
  description: string;
  inputSchema: Record<string, unknown>;
  governanceTier: GovernanceTier;
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
  idempotent?: boolean;
  execute(params: unknown): Promise<unknown>;
}

// Update ToolCallRecord.governanceDecision type:
export interface ToolCallRecord {
  toolId: string;
  operation: string;
  params: unknown;
  result: unknown;
  durationMs: number;
  governanceDecision: GovernanceOutcome;
}
```

Remove the old `getToolGovernanceDecision` function and `ToolGovernanceDecision` type from `types.ts` — they are replaced by `governance.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/governance.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/governance.ts packages/core/src/skill-runtime/governance.test.ts packages/core/src/skill-runtime/types.ts
git commit -m "feat: add governance tier system with central policy table"
```

---

### Task 2: Reclassify SP1 Tools with Governance Tiers

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/crm-query.ts`
- Modify: `packages/core/src/skill-runtime/tools/crm-write.ts`
- Modify: `packages/core/src/skill-runtime/tools/pipeline-handoff.ts`

Add `governanceTier` to every existing tool operation. No new logic — just classification.

- [ ] **Step 1: Update crm-query.ts operations**

Add `governanceTier: "read" as const` to both `contact.get` and `activity.list` operations.

```typescript
// In crm-query.ts, each operation gets:
"contact.get": {
  description: "Get a contact by ID. Returns name, phone, email, stage, source.",
  governanceTier: "read" as const,
  inputSchema: { ... },
  execute: async (params: unknown) => { ... },
},
"activity.list": {
  description: "List recent activity logs for a deployment.",
  governanceTier: "read" as const,
  inputSchema: { ... },
  execute: async (params: unknown) => { ... },
},
```

- [ ] **Step 2: Update crm-write.ts operations**

Add `governanceTier: "internal_write" as const` and `idempotent` to both operations.

```typescript
"stage.update": {
  description: "Update an opportunity's pipeline stage.",
  governanceTier: "internal_write" as const,
  idempotent: true,
  inputSchema: { ... },
  execute: async (params: unknown) => { ... },
},
"activity.log": {
  description: "Log an activity event.",
  governanceTier: "internal_write" as const,
  idempotent: false,
  inputSchema: { ... },
  execute: async (params: unknown) => { ... },
},
```

- [ ] **Step 3: Update pipeline-handoff.ts operations**

Add `governanceTier: "read" as const` to the `determine` operation.

```typescript
determine: {
  description: "Check if a lead should be handed off...",
  governanceTier: "read" as const,
  idempotent: true,
  inputSchema: { ... },
  execute: async (params: unknown) => determine(params as HandoffInput),
},
```

- [ ] **Step 4: Run existing tool tests to verify nothing broke**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/`
Expected: PASS (all existing tool tests still pass)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/
git commit -m "feat: reclassify SP1 tools with governance tiers"
```

---

### Task 3: Tool Registry

**Files:**

- Create: `packages/core/src/skill-runtime/tool-registry.ts`
- Create: `packages/core/src/skill-runtime/tool-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/tool-registry.test.ts
import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "./tool-registry.js";
import type { SkillTool, SkillDefinition } from "./types.js";

function makeTool(id: string, ops?: Record<string, { governanceTier: string }>): SkillTool {
  const operations: Record<string, any> = {};
  for (const [name, config] of Object.entries(
    ops ?? { "default-op": { governanceTier: "read" } },
  )) {
    operations[name] = {
      description: `${name} op`,
      inputSchema: { type: "object", properties: {} },
      governanceTier: config.governanceTier,
      execute: async () => ({}),
    };
  }
  return { id, operations };
}

function makeSkill(tools: string[]): SkillDefinition {
  return {
    name: "test",
    slug: "test",
    version: "1.0.0",
    description: "test",
    author: "test",
    parameters: [],
    tools,
    body: "test body",
  };
}

describe("ToolRegistry", () => {
  describe("register", () => {
    it("registers a tool successfully", () => {
      const registry = new ToolRegistry();
      const tool = makeTool("crm-query");
      registry.register(tool);
      const resolved = registry.resolve(["crm-query"]);
      expect(resolved.get("crm-query")).toBe(tool);
    });

    it("throws on duplicate tool ID", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      expect(() => registry.register(makeTool("crm-query"))).toThrow(
        "Duplicate tool registration: crm-query",
      );
    });

    it("throws when operation missing governanceTier", () => {
      const registry = new ToolRegistry();
      const tool: SkillTool = {
        id: "bad-tool",
        operations: {
          "do-thing": {
            description: "missing tier",
            inputSchema: { type: "object", properties: {} },
            execute: async () => ({}),
          } as any,
        },
      };
      expect(() => registry.register(tool)).toThrow("missing governanceTier");
    });
  });

  describe("resolve", () => {
    it("resolves multiple tools", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      registry.register(makeTool("crm-write"));
      const resolved = registry.resolve(["crm-query", "crm-write"]);
      expect(resolved.size).toBe(2);
    });

    it("throws for unknown tool ID", () => {
      const registry = new ToolRegistry();
      expect(() => registry.resolve(["nonexistent"])).toThrow("Unknown tool: nonexistent");
    });
  });

  describe("validateSkillDependencies", () => {
    it("passes when all declared tools exist", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      registry.register(makeTool("crm-write"));
      expect(() =>
        registry.validateSkillDependencies([makeSkill(["crm-query", "crm-write"])]),
      ).not.toThrow();
    });

    it("throws when a skill references an unregistered tool", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      expect(() =>
        registry.validateSkillDependencies([makeSkill(["crm-query", "web-scanner"])]),
      ).toThrow('Skill declares tool "web-scanner" but it is not registered');
    });

    it("warns about orphan tools (registered but not referenced)", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      registry.register(makeTool("orphan-tool"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      registry.validateSkillDependencies([makeSkill(["crm-query"])]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("orphan-tool"));
      warnSpy.mockRestore();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tool-registry.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/tool-registry.ts
import type { SkillTool, SkillDefinition } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, SkillTool>();

  register(tool: SkillTool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate tool registration: ${tool.id}`);
    }
    for (const [opName, op] of Object.entries(tool.operations)) {
      if (!op.governanceTier) {
        throw new Error(`Operation ${tool.id}.${opName} missing governanceTier`);
      }
    }
    this.tools.set(tool.id, tool);
  }

  validateSkillDependencies(skills: SkillDefinition[]): void {
    const declaredToolIds = new Set(skills.flatMap((s) => s.tools));
    const registeredToolIds = new Set(this.tools.keys());

    for (const id of declaredToolIds) {
      if (!registeredToolIds.has(id)) {
        throw new Error(`Skill declares tool "${id}" but it is not registered`);
      }
    }

    for (const id of registeredToolIds) {
      if (!declaredToolIds.has(id)) {
        console.warn(`Tool "${id}" is registered but no loaded skill references it`);
      }
    }
  }

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tool-registry.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tool-registry.ts packages/core/src/skill-runtime/tool-registry.test.ts
git commit -m "feat: add ToolRegistry with bootstrap validation"
```

---

### Task 4: ParameterBuilder Types + ParameterResolutionError

**Files:**

- Create: `packages/core/src/skill-runtime/parameter-builder.ts`
- Create: `packages/core/src/skill-runtime/parameter-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/parameter-builder.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  ParameterResolutionError,
  validateBuilderRegistration,
  type ParameterBuilder,
} from "./parameter-builder.js";

describe("ParameterResolutionError", () => {
  it("has code and userMessage", () => {
    const err = new ParameterResolutionError("no-opportunity", "No active deal found.");
    expect(err.code).toBe("no-opportunity");
    expect(err.userMessage).toBe("No active deal found.");
    expect(err.name).toBe("ParameterResolutionError");
    expect(err.message).toBe("No active deal found.");
  });
});

describe("validateBuilderRegistration", () => {
  it("passes when all skill slugs have builders", () => {
    const deployments = [{ skillSlug: "sales-pipeline" }, { skillSlug: "website-profiler" }];
    const builders = new Map<string, ParameterBuilder>([
      ["sales-pipeline", vi.fn()],
      ["website-profiler", vi.fn()],
    ]);
    expect(() => validateBuilderRegistration(deployments, builders)).not.toThrow();
  });

  it("throws when a deployment references a skill without a builder", () => {
    const deployments = [{ skillSlug: "unknown-skill" }];
    const builders = new Map<string, ParameterBuilder>();
    expect(() => validateBuilderRegistration(deployments, builders)).toThrow(
      'Deployment references skill "unknown-skill" but no ParameterBuilder is registered',
    );
  });

  it("ignores deployments with null skillSlug", () => {
    const deployments = [{ skillSlug: null }, { skillSlug: "sales-pipeline" }];
    const builders = new Map<string, ParameterBuilder>([["sales-pipeline", vi.fn()]]);
    expect(() => validateBuilderRegistration(deployments, builders)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/parameter-builder.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/parameter-builder.ts
import type { AgentContext } from "@switchboard/sdk";

export interface SkillStores {
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
export type ParameterBuilder = (
  ctx: AgentContext,
  config: { deploymentId: string; orgId: string },
  stores: SkillStores,
) => Promise<Record<string, unknown>>;

export class ParameterResolutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "ParameterResolutionError";
  }
}

export function validateBuilderRegistration(
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/parameter-builder.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/parameter-builder.ts packages/core/src/skill-runtime/parameter-builder.test.ts
git commit -m "feat: add ParameterBuilder type, ParameterResolutionError, and bootstrap validation"
```

---

### Task 5: Sales Pipeline ParameterBuilder (Extract from SkillHandler)

**Files:**

- Create: `packages/core/src/skill-runtime/builders/sales-pipeline.ts`
- Create: `packages/core/src/skill-runtime/builders/sales-pipeline.test.ts`
- Create: `packages/core/src/skill-runtime/builders/index.ts`

Extract the parameter-building logic from the current `SkillHandler` into a standalone builder function.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/builders/sales-pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { salesPipelineBuilder } from "./sales-pipeline.js";
import { ParameterResolutionError } from "../parameter-builder.js";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    persona: {
      businessName: "TestBiz",
      tone: "friendly",
      qualificationCriteria: { budget: "has budget" },
      disqualificationCriteria: { location: "wrong country" },
      escalationRules: { pricing: true },
      bookingLink: "https://book.test",
      customInstructions: "Be nice",
    },
    conversation: { messages: [{ role: "user", content: "hi" }] },
    trust: { score: 50, level: "guided" },
    ...overrides,
  } as any;
}

const mockStores = {
  opportunityStore: {
    findActiveByContact: vi.fn(),
  },
  contactStore: {
    findById: vi.fn(),
  },
  activityStore: {
    listByDeployment: vi.fn(),
  },
};

const config = { deploymentId: "d1", orgId: "org1" };

describe("salesPipelineBuilder", () => {
  it("throws ParameterResolutionError when no active opportunities", async () => {
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([]);
    await expect(salesPipelineBuilder(makeCtx(), config, mockStores)).rejects.toThrow(
      ParameterResolutionError,
    );
  });

  it("resolves parameters from most recent opportunity", async () => {
    const older = { id: "opp1", stage: "interested", createdAt: new Date("2025-01-01") };
    const newer = { id: "opp2", stage: "qualified", createdAt: new Date("2026-01-01") };
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([older, newer]);
    mockStores.contactStore.findById.mockResolvedValue({ id: "c1", name: "Alice" });

    const result = await salesPipelineBuilder(makeCtx(), config, mockStores);

    expect(result.BUSINESS_NAME).toBe("TestBiz");
    expect(result.PIPELINE_STAGE).toBe("qualified");
    expect(result.OPPORTUNITY_ID).toBe("opp2");
    expect(result.LEAD_PROFILE).toEqual({ id: "c1", name: "Alice" });
    expect((result.PERSONA_CONFIG as any).tone).toBe("friendly");
    expect((result.PERSONA_CONFIG as any).bookingLink).toBe("https://book.test");
  });

  it("uses sessionId as contactId", async () => {
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([
      { id: "opp1", stage: "interested", createdAt: new Date() },
    ]);
    mockStores.contactStore.findById.mockResolvedValue(null);

    await salesPipelineBuilder(makeCtx({ sessionId: "phone-123" }), config, mockStores);

    expect(mockStores.opportunityStore.findActiveByContact).toHaveBeenCalledWith(
      "org1",
      "phone-123",
    );
    expect(mockStores.contactStore.findById).toHaveBeenCalledWith("org1", "phone-123");
  });

  it("handles null bookingLink and customInstructions", async () => {
    mockStores.opportunityStore.findActiveByContact.mockResolvedValue([
      { id: "opp1", stage: "interested", createdAt: new Date() },
    ]);
    mockStores.contactStore.findById.mockResolvedValue(null);

    const ctx = makeCtx();
    ctx.persona.bookingLink = null;
    ctx.persona.customInstructions = null;

    const result = await salesPipelineBuilder(ctx, config, mockStores);
    expect((result.PERSONA_CONFIG as any).bookingLink).toBe("");
    expect((result.PERSONA_CONFIG as any).customInstructions).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/builders/sales-pipeline.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/builders/sales-pipeline.ts
import type { ParameterBuilder } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";

export const salesPipelineBuilder: ParameterBuilder = async (ctx, config, stores) => {
  const contactId = ctx.sessionId;

  const opportunities = await stores.opportunityStore.findActiveByContact(config.orgId, contactId);

  if (opportunities.length === 0) {
    throw new ParameterResolutionError(
      "no-active-opportunity",
      "I'd like to help, but there's no active deal found for this conversation. " +
        "Let me connect you with the team to get things started.",
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

- [ ] **Step 4: Write the barrel export**

```typescript
// packages/core/src/skill-runtime/builders/index.ts
export { salesPipelineBuilder } from "./sales-pipeline.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/builders/sales-pipeline.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/builders/
git commit -m "feat: extract sales-pipeline ParameterBuilder from SkillHandler"
```

---

### Task 6: Generic SkillHandler

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-handler.ts`
- Modify: `packages/core/src/skill-runtime/skill-handler.test.ts`

Replace the hardcoded sales-pipeline logic with generic ParameterBuilder dispatch.

- [ ] **Step 1: Rewrite skill-handler.ts**

```typescript
// packages/core/src/skill-runtime/skill-handler.ts
import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type { SkillDefinition, SkillExecutor } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";
import { ParameterResolutionError } from "./parameter-builder.js";

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private builderMap: Map<string, ParameterBuilder>,
    private stores: SkillStores,
    private config: SkillHandlerConfig,
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    const builder = this.builderMap.get(this.skill.slug);
    if (!builder) {
      throw new Error(`No parameter builder registered for skill: ${this.skill.slug}`);
    }

    let parameters: Record<string, unknown>;
    try {
      parameters = await builder(ctx, this.config, this.stores);
    } catch (err) {
      if (err instanceof ParameterResolutionError) {
        await ctx.chat.send(err.userMessage);
        return;
      }
      throw err;
    }

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
}
```

- [ ] **Step 2: Rewrite skill-handler.test.ts**

```typescript
// packages/core/src/skill-runtime/skill-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { SkillHandler } from "./skill-handler.js";
import { ParameterResolutionError } from "./parameter-builder.js";
import type { SkillDefinition } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test-skill",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "NAME", type: "string", required: true }],
  tools: [],
  body: "Hello {{NAME}}",
};

const mockStores: SkillStores = {
  opportunityStore: { findActiveByContact: vi.fn() },
  contactStore: { findById: vi.fn() },
  activityStore: { listByDeployment: vi.fn() },
};

function makeCtx() {
  return {
    sessionId: "s1",
    persona: { businessName: "Biz" },
    conversation: { messages: [{ role: "user", content: "hi" }] },
    trust: { score: 50, level: "guided" as const },
    chat: { send: vi.fn() },
  } as any;
}

describe("SkillHandler (generic)", () => {
  it("throws when no builder registered for slug", async () => {
    const handler = new SkillHandler(
      mockSkill,
      { execute: vi.fn() } as any,
      new Map(),
      mockStores,
      { deploymentId: "d1", orgId: "org1" },
    );
    await expect(handler.onMessage(makeCtx())).rejects.toThrow("No parameter builder registered");
  });

  it("calls builder and executor, sends response", async () => {
    const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
    const executor = {
      execute: vi.fn().mockResolvedValue({
        response: "Hello Alice",
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
      }),
    };
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(mockSkill, executor as any, builderMap, mockStores, {
      deploymentId: "d1",
      orgId: "org1",
    });

    const ctx = makeCtx();
    await handler.onMessage(ctx);

    expect(builder).toHaveBeenCalledWith(ctx, { deploymentId: "d1", orgId: "org1" }, mockStores);
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(ctx.chat.send).toHaveBeenCalledWith("Hello Alice");
  });

  it("catches ParameterResolutionError and sends userMessage", async () => {
    const builder: ParameterBuilder = vi
      .fn()
      .mockRejectedValue(new ParameterResolutionError("no-opp", "No active deal found."));
    const executor = { execute: vi.fn() };
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(mockSkill, executor as any, builderMap, mockStores, {
      deploymentId: "d1",
      orgId: "org1",
    });

    const ctx = makeCtx();
    await handler.onMessage(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith("No active deal found.");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("re-throws non-ParameterResolutionError errors", async () => {
    const builder: ParameterBuilder = vi.fn().mockRejectedValue(new Error("DB down"));
    const builderMap = new Map([["test-skill", builder]]);
    const handler = new SkillHandler(
      mockSkill,
      { execute: vi.fn() } as any,
      builderMap,
      mockStores,
      { deploymentId: "d1", orgId: "org1" },
    );
    await expect(handler.onMessage(makeCtx())).rejects.toThrow("DB down");
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-handler.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/skill-handler.ts packages/core/src/skill-runtime/skill-handler.test.ts
git commit -m "feat: genericize SkillHandler with ParameterBuilder dispatch"
```

---

### Task 7: Update Executor for Tier-Based Governance + Deny Handling

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.test.ts`

Replace the hardcoded `getToolGovernanceDecision(toolName, trustLevel)` call with the new tier-based `getToolGovernanceDecision(operation, trustLevel)`. Add `deny` code path.

- [ ] **Step 1: Add deny test to skill-executor.test.ts**

Add to the existing test file:

```typescript
// Add import
import { type GovernanceTier } from "./governance.js";

// Add this test:
it("handles deny governance decision", async () => {
  const toolSkill: SkillDefinition = {
    ...mockSkill,
    tools: ["dangerous-tool"],
    body: "Use dangerous-tool.delete {{NAME}}",
  };
  const dangerousTool: SkillTool = {
    id: "dangerous-tool",
    operations: {
      delete: {
        description: "delete something",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "destructive" as GovernanceTier,
        execute: vi.fn().mockResolvedValue({ deleted: true }),
      },
    },
  };

  const adapter = createMockAdapter([
    {
      content: [{ type: "tool_use", id: "t1", name: "dangerous-tool.delete", input: {} }],
      stop_reason: "tool_use",
    },
    {
      content: [{ type: "text", text: "Cannot delete." }],
      stop_reason: "end_turn",
    },
  ]);

  const executor = new SkillExecutorImpl(adapter, new Map([["dangerous-tool", dangerousTool]]));
  const result = await executor.execute({
    skill: toolSkill,
    parameters: { NAME: "X" },
    messages: [{ role: "user", content: "delete it" }],
    deploymentId: "d1",
    orgId: "org1",
    trustScore: 10,
    trustLevel: "supervised",
  });

  // Tool should NOT have been executed
  expect(dangerousTool.operations["delete"]!.execute).not.toHaveBeenCalled();
  // Record should show denied
  expect(result.toolCalls[0]!.governanceDecision).toBe("denied");
});
```

- [ ] **Step 2: Update executor imports and governance call**

In `skill-executor.ts`:

Replace the import:

```typescript
// Old:
import { SkillExecutionBudgetError, getToolGovernanceDecision } from "./types.js";
// New:
import { SkillExecutionBudgetError } from "./types.js";
import { getToolGovernanceDecision, mapDecisionToOutcome } from "./governance.js";
```

Update the tool execution block (around line 108) to resolve the operation object and handle deny:

```typescript
const op = tool?.operations[operation];

const governanceDecision = op ? getToolGovernanceDecision(op, params.trustLevel) : "auto-approve";

let result: unknown;
if (governanceDecision === "deny") {
  result = {
    status: "denied",
    message: "This action is not permitted at your current trust level.",
  };
} else if (governanceDecision === "require-approval") {
  result = {
    status: "pending_approval",
    message: "This action requires human approval.",
  };
} else if (op) {
  result = await op.execute(toolUse.input);
} else {
  result = { error: `Unknown tool: ${toolUse.name}` };
}

toolCallRecords.push({
  toolId: toolId!,
  operation,
  params: toolUse.input,
  result,
  durationMs: Date.now() - start,
  governanceDecision: mapDecisionToOutcome(governanceDecision),
});
```

- [ ] **Step 3: Update existing tests to add governanceTier to mock tools**

All existing mock tools in `skill-executor.test.ts` need `governanceTier: "read" as const` on their operations so the new governance function works. Also update the governance decision test to use `"auto-approved"` and `"require-approval"` (outcome strings) instead of the old decision strings.

- [ ] **Step 4: Run all executor tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-executor.test.ts`
Expected: PASS (all tests including new deny test)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat: update executor for tier-based governance with deny handling"
```

---

### Task 8: Update Barrel Export + Channel Gateway Wiring

**Files:**

- Modify: `packages/core/src/skill-runtime/index.ts`
- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`

Wire the new modules into the export surface and update channel gateway to use ToolRegistry + builder map.

- [ ] **Step 1: Update barrel export**

```typescript
// packages/core/src/skill-runtime/index.ts
export { loadSkill } from "./skill-loader.js";
export { SkillExecutorImpl } from "./skill-executor.js";
export { SkillHandler } from "./skill-handler.js";
export { AnthropicToolCallingAdapter } from "./tool-calling-adapter.js";
export { interpolate } from "./template-engine.js";
export { getGovernanceConstraints } from "./governance-injector.js";
export { ToolRegistry } from "./tool-registry.js";
export {
  getToolGovernanceDecision,
  mapDecisionToOutcome,
  GOVERNANCE_POLICY,
} from "./governance.js";
export { ParameterResolutionError, validateBuilderRegistration } from "./parameter-builder.js";
export {
  createCrmQueryTool,
  createCrmWriteTool,
  createPipelineHandoffTool,
} from "./tools/index.js";
export { salesPipelineBuilder } from "./builders/index.js";

// Types
export type {
  SkillDefinition,
  ParameterDeclaration,
  ParameterType,
  SkillExecutionParams,
  SkillExecutionResult,
  ToolCallRecord,
  SkillTool,
  SkillToolOperation,
  SkillExecutor,
} from "./types.js";
export {
  SkillParseError,
  SkillValidationError,
  SkillParameterError,
  SkillExecutionBudgetError,
} from "./types.js";
export type {
  GovernanceTier,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
  GovernanceLogEntry,
} from "./governance.js";
export type { ParameterBuilder, SkillStores } from "./parameter-builder.js";
```

- [ ] **Step 2: Update SkillRuntimeDeps in channel-gateway/types.ts**

Replace the `createHandler` factory to accept builder map and stores:

```typescript
export interface SkillRuntimeDeps {
  skillsDir: string;
  loadSkill: (slug: string, skillsDir: string) => SkillDefinition;
  createExecutor: () => SkillExecutor;
  builderMap: Map<string, ParameterBuilder>;
  stores: SkillStores;
}
```

Add the necessary imports at the top of `types.ts`:

```typescript
import type { ParameterBuilder, SkillStores } from "../skill-runtime/parameter-builder.js";
```

- [ ] **Step 3: Update resolveHandler in channel-gateway.ts**

```typescript
private resolveHandler(
  info: { deployment: { id: string; organizationId: string; skillSlug?: string | null } },
  _message: IncomingChannelMessage,
): AgentHandler {
  const { skillRuntime } = this.config;
  const { skillSlug } = info.deployment;

  if (skillSlug && skillRuntime) {
    const skill = skillRuntime.loadSkill(skillSlug, skillRuntime.skillsDir);
    const executor = skillRuntime.createExecutor();
    return new SkillHandler(skill, executor, skillRuntime.builderMap, skillRuntime.stores, {
      deploymentId: info.deployment.id,
      orgId: info.deployment.organizationId,
    });
  }

  return DefaultChatHandler;
}
```

Add the `SkillHandler` import at the top of `channel-gateway.ts`:

```typescript
import { SkillHandler } from "../skill-runtime/skill-handler.js";
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/index.ts packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts
git commit -m "feat: wire ToolRegistry and ParameterBuilder into channel gateway"
```

---

### Task 9: Update Skill Loader for Output Schema

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-loader.ts`
- Modify: `packages/core/src/skill-runtime/skill-loader.test.ts`
- Modify: `packages/core/src/skill-runtime/types.ts`

Add optional `output` section parsing to the skill loader. Validated for well-formedness, not enforced at runtime.

- [ ] **Step 1: Add `output` to SkillDefinition in types.ts**

```typescript
export interface OutputFieldDeclaration {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  required: boolean;
  description?: string;
  values?: string[];
  items?: { type: string };
}

export interface SkillDefinition {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  parameters: ParameterDeclaration[];
  tools: string[];
  body: string;
  output?: { fields: OutputFieldDeclaration[] };
}
```

- [ ] **Step 2: Add output schema tests to skill-loader.test.ts**

```typescript
it("loads a skill with output schema", () => {
  writeSkill(
    "with-output",
    `---
name: test
slug: with-output
version: 1.0.0
description: test
author: test
parameters: []
tools: []
output:
  fields:
    - name: summary
      type: string
      required: true
    - name: confidence
      type: enum
      values: [high, medium, low]
      required: true
    - name: items
      type: array
      items: { type: string }
      required: false
---
Body here`,
  );
  const skill = loadSkill("with-output", TEST_DIR);
  expect(skill.output).toBeDefined();
  expect(skill.output!.fields).toHaveLength(3);
  expect(skill.output!.fields[0]!.name).toBe("summary");
  expect(skill.output!.fields[2]!.items).toEqual({ type: "string" });
});

it("loads a skill without output schema (optional)", () => {
  // The existing "valid" test already covers this — just verify output is undefined
  writeSkill(
    "no-output",
    `---
name: test
slug: no-output
version: 1.0.0
description: test
author: test
parameters: []
tools: []
---
Body`,
  );
  const skill = loadSkill("no-output", TEST_DIR);
  expect(skill.output).toBeUndefined();
});
```

- [ ] **Step 3: Update skill-loader.ts to parse output section**

Add to the Zod schema in `skill-loader.ts`:

```typescript
const OutputFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "enum", "array"]),
  required: z.boolean(),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  items: z.record(z.string()).optional(),
});

const SkillFrontmatterSchema = z.object({
  // ... existing fields ...
  output: z
    .object({
      fields: z.array(OutputFieldSchema),
    })
    .optional(),
});
```

In the `loadSkill` function return, add:

```typescript
output: frontmatter.output,
```

- [ ] **Step 4: Run loader tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-loader.test.ts`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/skill-loader.ts packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "feat: add optional output schema parsing to skill loader"
```

---

### Task 10: Web Scanner Tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/web-scanner.ts`
- Create: `packages/core/src/skill-runtime/tools/web-scanner.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`

Four operations wrapping existing `website-scanner/` functions + one new cheerio-based operation. All `read` tier, all idempotent.

**Key decision:** Operations 1-3 wrap existing tested pure functions from `packages/core/src/website-scanner/` (SSRF protections, private IP detection, HTML stripping preserved). Only `extract-business-info` is new code using cheerio.

- [ ] **Step 1: Install cheerio dependency (for extract-business-info only)**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core add cheerio`

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/tools/web-scanner.test.ts
import { describe, it, expect, vi } from "vitest";
import { createWebScannerTool } from "./web-scanner.js";

describe("web-scanner tool", () => {
  const tool = createWebScannerTool();

  it("has correct id", () => {
    expect(tool.id).toBe("web-scanner");
  });

  it("has 4 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "validate-url",
      "fetch-pages",
      "detect-platform",
      "extract-business-info",
    ]);
  });

  it("all operations have governanceTier read", () => {
    for (const op of Object.values(tool.operations)) {
      expect(op.governanceTier).toBe("read");
    }
  });

  describe("validate-url", () => {
    // Wraps validateScanUrl() + assertPublicHostname() from website-scanner/url-validator.ts

    it("validates a well-formed HTTPS URL", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "https://example.com",
      });
      const r = result as { valid: boolean; validatedUrl: string };
      expect(r.valid).toBe(true);
      expect(r.validatedUrl).toBe("https://example.com/");
    });

    it("rejects non-HTTP URLs", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "ftp://example.com",
      });
      expect((result as any).valid).toBe(false);
      expect((result as any).error).toContain("scheme");
    });

    it("rejects empty string", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "" });
      expect((result as any).valid).toBe(false);
    });

    it("rejects URLs with credentials", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "https://user:pass@example.com",
      });
      expect((result as any).valid).toBe(false);
      expect((result as any).error).toContain("credentials");
    });

    it("rejects IP address hostnames", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "https://127.0.0.1",
      });
      expect((result as any).valid).toBe(false);
      expect((result as any).error).toContain("IP");
    });
  });

  describe("detect-platform", () => {
    // Wraps detectPlatform() from website-scanner/platform-detector.ts

    it("detects Shopify from HTML signatures", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<link rel="stylesheet" href="//cdn.shopify.com/s/files/1/theme.css">',
      });
      const r = result as { platform: string; confidence: string };
      expect(r.platform).toBe("shopify");
      expect(r.confidence).toBe("regex-match");
    });

    it("detects WordPress from HTML signatures", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<meta name="generator" content="WordPress 6.4">',
      });
      expect((result as any).platform).toBe("wordpress");
    });

    it("detects Wix from HTML signatures", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<meta content="Wix.com" name="generator">',
      });
      expect((result as any).platform).toBe("wix");
    });

    it("detects Squarespace from HTML signatures", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<script src="https://static1.squarespace.com/static/vta/main.js"></script>',
      });
      expect((result as any).platform).toBe("squarespace");
    });

    it("returns null for unrecognized HTML", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: "<html><body>Hello</body></html>",
      });
      expect((result as any).platform).toBeNull();
      expect((result as any).confidence).toBe("none");
    });
  });

  describe("extract-business-info", () => {
    // New operation — cheerio-based JSON-LD + OG parsing

    it("extracts JSON-LD structured data", async () => {
      const html = `<html><head>
        <script type="application/ld+json">
        {"@type": "LocalBusiness", "name": "Test Biz", "telephone": "+1234"}
        </script>
      </head><body></body></html>`;
      const result = await tool.operations["extract-business-info"]!.execute({ html });
      const r = result as { structuredData: unknown[] };
      expect(r.structuredData).toHaveLength(1);
      expect((r.structuredData[0] as any).name).toBe("Test Biz");
    });

    it("extracts Open Graph meta tags", async () => {
      const html = `<html><head>
        <meta property="og:title" content="My Business">
        <meta property="og:description" content="We do things">
      </head><body></body></html>`;
      const result = await tool.operations["extract-business-info"]!.execute({ html });
      const r = result as { openGraph: Record<string, string> };
      expect(r.openGraph["og:title"]).toBe("My Business");
    });

    it("returns empty results for plain HTML", async () => {
      const result = await tool.operations["extract-business-info"]!.execute({
        html: "<html><body>Hello</body></html>",
      });
      const r = result as { structuredData: unknown[]; openGraph: Record<string, string> };
      expect(r.structuredData).toHaveLength(0);
      expect(Object.keys(r.openGraph)).toHaveLength(0);
    });
  });
});
```

Note: `fetch-pages` tests are skipped in unit tests because they make real HTTP requests. The eval suite (Task 12) uses mock responses.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/web-scanner.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/skill-runtime/tools/web-scanner.ts
//
// Wraps existing website-scanner/ pure functions for operations 1-3.
// Only extract-business-info is new code (cheerio-based).
//
import * as cheerio from "cheerio";
import type { SkillTool } from "../types.js";
import type { GovernanceTier } from "../governance.js";
import { validateScanUrl, assertPublicHostname } from "../../website-scanner/url-validator.js";
import { fetchPages, stripHtml } from "../../website-scanner/page-fetcher.js";
import { detectPlatform } from "../../website-scanner/platform-detector.js";

const TIER: GovernanceTier = "read";
const DEFAULT_PATHS = ["/", "/about", "/pricing", "/faq", "/contact", "/services"];
const MAX_HOMEPAGE_HTML = 50_000;

export function createWebScannerTool(): SkillTool {
  return {
    id: "web-scanner",
    operations: {
      "validate-url": {
        description:
          "Validate and normalize a URL. Checks scheme, credentials, and private IP. Returns { valid, validatedUrl, error }.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to validate" },
          },
          required: ["url"],
        },
        execute: async (params: unknown) => {
          const { url } = params as { url: string };
          if (!url || typeof url !== "string") {
            return { valid: false, validatedUrl: null, error: "URL is empty" };
          }
          try {
            const validatedUrl = validateScanUrl(url);
            // DNS check for private IP (SSRF protection)
            const hostname = new URL(validatedUrl).hostname;
            await assertPublicHostname(hostname);
            return { valid: true, validatedUrl, error: null };
          } catch (err) {
            return { valid: false, validatedUrl: null, error: (err as Error).message };
          }
        },
      },

      "fetch-pages": {
        description:
          "Fetch homepage + key pages, strip HTML to text. Returns stripped text per page (max 8KB) + homepageHtml (raw, max 50KB) for platform detection.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            baseUrl: { type: "string", description: "Validated base URL" },
            paths: {
              type: "array",
              items: { type: "string" },
              description:
                "Page paths to fetch (defaults to /, /about, /pricing, /faq, /contact, /services)",
            },
            timeoutMs: { type: "number", description: "Per-page timeout in ms (default 10000)" },
          },
          required: ["baseUrl"],
        },
        execute: async (params: unknown) => {
          const { baseUrl, paths, timeoutMs } = params as {
            baseUrl: string;
            paths?: string[];
            timeoutMs?: number;
          };
          const pagePaths = paths ?? DEFAULT_PATHS;
          const fetched = await fetchPages(baseUrl, pagePaths, { timeoutMs });

          // Extract homepageHtml from the homepage result (for detect-platform)
          const homepageFetched = fetched.find((p) => p.path === "/");
          const homepageHtml = homepageFetched?.rawHtml?.slice(0, MAX_HOMEPAGE_HTML) ?? "";

          // Strip rawHtml from all results — only return text to the LLM
          const pages = fetched.map((p) => ({
            path: p.path,
            text: p.text,
            status: "ok" as const,
          }));

          const fetchedPaths = new Set(fetched.map((p) => p.path));
          const failedPaths = pagePaths.filter((p) => !fetchedPaths.has(p));

          return {
            pages,
            homepageHtml,
            fetchedCount: pages.length,
            failedPaths,
          };
        },
      },

      "detect-platform": {
        description:
          "Detect website platform from HTML signatures (Shopify, WordPress, Wix, Squarespace). Returns { platform, confidence } as a hint — LLM makes final judgment.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            html: {
              type: "string",
              description: "Raw HTML content (homepageHtml from fetch-pages)",
            },
          },
          required: ["html"],
        },
        execute: async (params: unknown) => {
          const { html } = params as { html: string };
          const platform = detectPlatform(html);
          return {
            platform: platform ?? null,
            confidence: platform ? ("regex-match" as const) : ("none" as const),
          };
        },
      },

      "extract-business-info": {
        description:
          "Parse structured data (JSON-LD, Open Graph, meta tags) from HTML. Returns factual fields only — no inference.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            html: { type: "string", description: "Raw HTML content to parse" },
          },
          required: ["html"],
        },
        execute: async (params: unknown) => {
          const { html } = params as { html: string };
          const $ = cheerio.load(html);

          const structuredData: unknown[] = [];
          $('script[type="application/ld+json"]').each((_i, el) => {
            try {
              structuredData.push(JSON.parse($(el).html() ?? ""));
            } catch {
              // Skip malformed JSON-LD
            }
          });

          const openGraph: Record<string, string> = {};
          $("meta[property^='og:']").each((_i, el) => {
            const prop = $(el).attr("property");
            const content = $(el).attr("content");
            if (prop && content) openGraph[prop] = content;
          });

          const meta: Record<string, string> = {};
          $("meta[name]").each((_i, el) => {
            const name = $(el).attr("name");
            const content = $(el).attr("content");
            if (name && content) meta[name] = content;
          });

          return { structuredData, openGraph, meta };
        },
      },
    },
  };
}
```

- [ ] **Step 5: Update tools barrel export**

```typescript
// packages/core/src/skill-runtime/tools/index.ts
export { createCrmQueryTool } from "./crm-query.js";
export { createCrmWriteTool } from "./crm-write.js";
export { createPipelineHandoffTool } from "./pipeline-handoff.js";
export { createWebScannerTool } from "./web-scanner.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/web-scanner.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/
git commit -m "feat: add web-scanner tool wrapping existing website-scanner functions + cheerio extract"
```

---

### Task 11: Website Profiler Skill File + ParameterBuilder

**Files:**

- Create: `skills/website-profiler.md`
- Create: `packages/core/src/skill-runtime/builders/website-profiler.ts`
- Create: `packages/core/src/skill-runtime/builders/website-profiler.test.ts`
- Modify: `packages/core/src/skill-runtime/builders/index.ts`

- [ ] **Step 1: Create the skill file**

Create `skills/website-profiler.md` with full frontmatter and skill body. Use the frontmatter from the spec (parameters: TARGET_URL, BUSINESS_NAME, PERSONA_CONFIG; tools: web-scanner; output fields for profile_summary, business_model, price_positioning, primary_cta, lead_intent_type, platform, platform_confidence, confidence, data_completeness, missing_fields).

Skill body should define the 5-step process:

1. Validate URL via `web-scanner.validate-url`
2. Fetch key pages via `web-scanner.fetch-pages`
3. Detect platform via `web-scanner.detect-platform` (tool gives hint, LLM confirms)
4. Extract + interpret: 4A factual data via `web-scanner.extract-business-info`, 4B interpret business model (LLM judgment), 4C confirm platform (handle contradictions)
5. Produce final profile with confidence and completeness signals

- [ ] **Step 2: Write the builder tests**

```typescript
// packages/core/src/skill-runtime/builders/website-profiler.test.ts
import { describe, it, expect, vi } from "vitest";
import { websiteProfilerBuilder } from "./website-profiler.js";

function makeCtx(lastMessage = "Check out https://example.com") {
  return {
    sessionId: "s1",
    persona: {
      businessName: "TestBiz",
      tone: "professional",
      customInstructions: "Be thorough",
    },
    conversation: {
      messages: [{ role: "user", content: lastMessage }],
    },
    trust: { score: 50, level: "guided" },
  } as any;
}

const config = { deploymentId: "d1", orgId: "org1" };
const mockStores = {
  opportunityStore: { findActiveByContact: vi.fn() },
  contactStore: { findById: vi.fn() },
  activityStore: { listByDeployment: vi.fn() },
};

describe("websiteProfilerBuilder", () => {
  it("extracts URL from last message", async () => {
    const result = await websiteProfilerBuilder(makeCtx(), config, mockStores);
    expect(result.TARGET_URL).toBe("https://example.com");
  });

  it("maps persona fields", async () => {
    const result = await websiteProfilerBuilder(makeCtx(), config, mockStores);
    expect(result.BUSINESS_NAME).toBe("TestBiz");
    expect((result.PERSONA_CONFIG as any).tone).toBe("professional");
  });

  it("extracts URL with path", async () => {
    const result = await websiteProfilerBuilder(
      makeCtx("Profile this: https://shop.example.com/about"),
      config,
      mockStores,
    );
    expect(result.TARGET_URL).toBe("https://shop.example.com/about");
  });

  it("returns empty TARGET_URL when no URL in message", async () => {
    const result = await websiteProfilerBuilder(makeCtx("No URL here"), config, mockStores);
    expect(result.TARGET_URL).toBe("");
  });

  it("handles null customInstructions", async () => {
    const ctx = makeCtx();
    ctx.persona.customInstructions = null;
    const result = await websiteProfilerBuilder(ctx, config, mockStores);
    expect((result.PERSONA_CONFIG as any).customInstructions).toBe("");
  });
});
```

- [ ] **Step 3: Write the builder implementation**

```typescript
// packages/core/src/skill-runtime/builders/website-profiler.ts
import type { ParameterBuilder } from "../parameter-builder.js";

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

function extractUrl(text: string): string {
  const match = text.match(URL_REGEX);
  return match ? match[0] : "";
}

export const websiteProfilerBuilder: ParameterBuilder = async (ctx, _config, _stores) => {
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

- [ ] **Step 4: Update builders barrel export**

```typescript
// packages/core/src/skill-runtime/builders/index.ts
export { salesPipelineBuilder } from "./sales-pipeline.js";
export { websiteProfilerBuilder } from "./website-profiler.js";
```

- [ ] **Step 5: Verify skill loads via loader integration test**

Add to `skill-loader.test.ts`:

```typescript
it("loads the website-profiler skill file", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
  const skill = loadSkill("website-profiler", join(repoRoot, "skills"));
  expect(skill.slug).toBe("website-profiler");
  expect(skill.tools).toEqual(["web-scanner"]);
  expect(skill.output).toBeDefined();
  expect(skill.output!.fields.length).toBeGreaterThan(0);
});
```

- [ ] **Step 6: Run all builder and loader tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/builders/ src/skill-runtime/skill-loader.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add skills/website-profiler.md packages/core/src/skill-runtime/builders/ packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "feat: add website-profiler skill file and ParameterBuilder"
```

---

### Task 12: Website Profiler Eval Suite

**Files:**

- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-01-valid-full-profile.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-02-invalid-url.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-03-sparse-content.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-04-platform-contradiction.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-05-multiple-ctas.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-06-no-pricing.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-07-non-english.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/wp-08-fetch-timeout.json`
- Modify: `packages/core/src/skill-runtime/__tests__/eval-suite.test.ts`

Each fixture follows the same JSON format as the SP1 eval suite — parameters, messages, mockResponses, assertions.

- [ ] **Step 1: Create 8 JSON fixture files**

Each fixture has: `name`, `parameters` (TARGET_URL, BUSINESS_NAME, PERSONA_CONFIG), `messages`, `mockResponses` (scripted tool-call loops), `assertions`.

Example — `wp-01-valid-full-profile.json`:

```json
{
  "name": "Valid URL, full profile",
  "parameters": {
    "TARGET_URL": "https://example.com",
    "BUSINESS_NAME": "TestBiz",
    "PERSONA_CONFIG": { "tone": "professional", "customInstructions": "" }
  },
  "messages": [{ "role": "user", "content": "Profile https://example.com" }],
  "mockResponses": [
    {
      "content": [
        {
          "type": "tool_use",
          "id": "t1",
          "name": "web-scanner.validate-url",
          "input": { "url": "https://example.com" }
        }
      ],
      "stop_reason": "tool_use"
    },
    {
      "content": [
        {
          "type": "tool_use",
          "id": "t2",
          "name": "web-scanner.fetch-pages",
          "input": { "baseUrl": "https://example.com" }
        }
      ],
      "stop_reason": "tool_use"
    },
    {
      "content": [
        {
          "type": "tool_use",
          "id": "t3",
          "name": "web-scanner.detect-platform",
          "input": { "html": "<html>test</html>" }
        }
      ],
      "stop_reason": "tool_use"
    },
    {
      "content": [
        {
          "type": "text",
          "text": "## Business Profile\n\n**Summary:** Example.com is a service business.\n**Business Model:** service\n**Confidence:** high\n**Data Completeness:** high"
        }
      ],
      "stop_reason": "end_turn"
    }
  ],
  "assertions": [
    { "type": "tool_called", "toolName": "web-scanner.validate-url" },
    { "type": "tool_called", "toolName": "web-scanner.fetch-pages" },
    { "type": "tool_called", "toolName": "web-scanner.detect-platform" },
    { "type": "response_contains", "substring": "Business Profile" }
  ]
}
```

Example — `wp-02-invalid-url.json`:

```json
{
  "name": "Invalid URL",
  "parameters": {
    "TARGET_URL": "not-a-url",
    "BUSINESS_NAME": "TestBiz",
    "PERSONA_CONFIG": { "tone": "professional", "customInstructions": "" }
  },
  "messages": [{ "role": "user", "content": "Profile not-a-url" }],
  "mockResponses": [
    {
      "content": [
        {
          "type": "tool_use",
          "id": "t1",
          "name": "web-scanner.validate-url",
          "input": { "url": "not-a-url" }
        }
      ],
      "stop_reason": "tool_use"
    },
    {
      "content": [
        {
          "type": "text",
          "text": "The URL you provided is not valid. Please provide a valid website URL starting with https://."
        }
      ],
      "stop_reason": "end_turn"
    }
  ],
  "assertions": [
    { "type": "tool_called", "toolName": "web-scanner.validate-url" },
    { "type": "tool_not_called", "toolName": "web-scanner.fetch-pages" },
    { "type": "response_contains", "substring": "not valid" }
  ]
}
```

Create all 8 fixtures following the spec's eval table (Task 12 in the spec).

- [ ] **Step 2: Update eval-suite.test.ts to include website-profiler fixtures**

Add to the fixtures array in the existing eval suite:

```typescript
const wpFixtures = [
  "wp-01-valid-full-profile",
  "wp-02-invalid-url",
  "wp-03-sparse-content",
  "wp-04-platform-contradiction",
  "wp-05-multiple-ctas",
  "wp-06-no-pricing",
  "wp-07-non-english",
  "wp-08-fetch-timeout",
];
```

Update `createMockTools()` to include the web-scanner tool:

```typescript
tools.set("web-scanner", {
  id: "web-scanner",
  operations: {
    "validate-url": {
      description: "Validate URL",
      governanceTier: "read" as GovernanceTier,
      inputSchema: { type: "object", properties: {} },
      execute: async (params: any) => {
        try {
          const url = new URL(params.url);
          return { valid: ["http:", "https:"].includes(url.protocol), normalizedUrl: params.url };
        } catch {
          return { valid: false, normalizedUrl: "", error: "Invalid URL" };
        }
      },
    },
    "fetch-pages": {
      description: "Fetch pages",
      governanceTier: "read" as GovernanceTier,
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ pages: [{ path: "/", text: "Example content", status: "ok" }] }),
    },
    "detect-platform": {
      description: "Detect platform",
      governanceTier: "read" as GovernanceTier,
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ platform: "unknown", confidence: "low", reasoning: "No signatures" }),
    },
    "extract-business-info": {
      description: "Extract business info",
      governanceTier: "read" as GovernanceTier,
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ structuredData: [], openGraph: {}, meta: {} }),
    },
  },
});
```

- [ ] **Step 3: Run eval suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/__tests__/eval-suite.test.ts`
Expected: PASS (16 SP1 + 8 WP = 24 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/
git commit -m "feat: add website-profiler eval suite with 8 fixture scenarios"
```

---

### Task 13: Update Barrel Export + Typecheck + Lint + Full Test Suite

**Files:**

- Modify: `packages/core/src/skill-runtime/index.ts` (add websiteProfilerBuilder export)
- No new files — verification only

- [ ] **Step 1: Update barrel export for websiteProfilerBuilder**

In `packages/core/src/skill-runtime/index.ts`, update the builders import:

```typescript
export { salesPipelineBuilder, websiteProfilerBuilder } from "./builders/index.js";
```

- [ ] **Step 2: Remove old governance code from types.ts**

Verify that `getToolGovernanceDecision` and `ToolGovernanceDecision` are removed from `types.ts` (done in Task 1 Step 4). Also clean up any old imports referencing them across the codebase.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint`
Expected: PASS (fix any issues)

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: PASS (all existing + new tests)

- [ ] **Step 6: Commit any fixes**

```bash
git commit -m "fix: resolve lint/type issues from SP2 integration"
```

---

### Summary

| Task      | What It Builds                              | Files            | Tests             |
| --------- | ------------------------------------------- | ---------------- | ----------------- |
| 1         | Governance types + policy table             | 2 new + 1 modify | 13                |
| 2         | SP1 tools reclassified                      | 3 modify         | 0 (existing pass) |
| 3         | Tool registry                               | 2 new            | 7                 |
| 4         | ParameterBuilder types                      | 2 new            | 4                 |
| 5         | Sales-pipeline builder                      | 3 new            | 4                 |
| 6         | Generic SkillHandler                        | 2 modify         | 4                 |
| 7         | Executor governance + deny                  | 2 modify         | 1 new + existing  |
| 8         | Barrel export + gateway wiring              | 3 modify         | 0 (typecheck)     |
| 9         | Skill loader output schema                  | 3 modify         | 2                 |
| 10        | Web scanner tool (wraps existing + cheerio) | 2 new + 1 modify | ~15               |
| 11        | Website profiler skill + builder            | 4 new + 2 modify | 5 + 1 loader      |
| 12        | Website profiler eval suite                 | 8 new + 1 modify | 8                 |
| 13        | Integration verification                    | 1 modify         | 0 (full suite)    |
| **Total** |                                             | **~30 files**    | **~65 tests**     |

Tasks 1-8 are the infrastructure (registry, governance, generic handler). Tasks 9-12 are the proof migration (website profiler). Task 13 is final verification.
