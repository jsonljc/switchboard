# Phase 5: Operator Chat + Command Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class operator control surface — founders/admins issue natural-language commands via chat (Telegram, WhatsApp, dashboard) that are parsed into structured `OperatorCommand`s, guardrail-checked, routed to domain agents or workflows, and formatted back for the operator's channel.

**Architecture:** OperatorCommand schemas live in `packages/schemas`. CommandInterpreter (LLM-powered NL parsing), CommandGuardrailEvaluator (risk/ambiguity/confidence), CommandRouter (dispatch to agents or WorkflowEngine), and SummaryFormatter (channel-aware output) live in `packages/agents/src/operator/`. Operator identity detection uses the existing `Principal.roles` array (contains `"operator"`) and a new `operator-handler.ts` in the chat app. API routes expose command submission and history. Dashboard gets an embedded operator chat widget.

**Tech Stack:** TypeScript, Zod, Prisma, Fastify, Next.js, ClaudeLLMAdapter, Vitest

---

## File Structure

### New Files

| File                                                                                  | Responsibility                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/schemas/src/operator-command.ts`                                            | Zod schemas for OperatorRequest, OperatorCommand, GuardrailResult, CommandStatus |
| `packages/schemas/src/__tests__/operator-command.test.ts`                             | Schema validation tests                                                          |
| `packages/agents/src/operator/command-interpreter.ts`                                 | LLM-powered NL to structured OperatorCommand parsing                             |
| `packages/agents/src/operator/command-guardrail-evaluator.ts`                         | Confidence, ambiguity, risk, preview, missing-entity checks                      |
| `packages/agents/src/operator/command-router.ts`                                      | Routes command to domain agent handler or spawns WorkflowExecution               |
| `packages/agents/src/operator/summary-formatter.ts`                                   | Formats results for Telegram (compact), WhatsApp (compact), dashboard (rich)     |
| `packages/agents/src/operator/operator-types.ts`                                      | Shared types and constants (intent catalog, channel types)                       |
| `packages/agents/src/operator/index.ts`                                               | Barrel re-exports                                                                |
| `packages/agents/src/operator/__tests__/command-interpreter.test.ts`                  | Interpreter tests with mock LLM                                                  |
| `packages/agents/src/operator/__tests__/command-guardrail-evaluator.test.ts`          | Guardrail evaluator tests                                                        |
| `packages/agents/src/operator/__tests__/command-router.test.ts`                       | Router dispatch tests                                                            |
| `packages/agents/src/operator/__tests__/summary-formatter.test.ts`                    | Formatter output tests                                                           |
| `packages/core/src/operator/command-store.ts`                                         | `OperatorCommandStore` persistence interface                                     |
| `packages/core/src/operator/index.ts`                                                 | Barrel re-exports                                                                |
| `packages/db/src/stores/prisma-command-store.ts`                                      | `PrismaOperatorCommandStore` implementation                                      |
| `packages/db/src/stores/__tests__/prisma-command-store.test.ts`                       | Store tests                                                                      |
| `apps/api/src/routes/operator.ts`                                                     | REST endpoints for command submission and history                                |
| `apps/api/src/routes/__tests__/operator.test.ts`                                      | Route handler tests                                                              |
| `apps/api/src/bootstrap/operator-deps.ts`                                             | Bootstrap factory for operator wiring                                            |
| `apps/chat/src/handlers/operator-handler.ts`                                          | Operator identity detection + delegation to API                                  |
| `apps/chat/src/handlers/__tests__/operator-handler.test.ts`                           | Handler tests                                                                    |
| `apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx`                | Embedded chat widget component                                                   |
| `apps/dashboard/src/components/operator-chat/message-bubble.tsx`                      | Individual message display                                                       |
| `apps/dashboard/src/components/operator-chat/use-operator-chat.ts`                    | React hook for chat state + API calls                                            |
| `apps/dashboard/src/components/operator-chat/__tests__/operator-chat-widget.test.tsx` | Widget render tests                                                              |

### Modified Files

| File                                     | Change                                                   |
| ---------------------------------------- | -------------------------------------------------------- |
| `packages/schemas/src/index.ts`          | Add operator-command re-exports                          |
| `packages/core/src/index.ts`             | Add operator module re-exports                           |
| `packages/agents/src/index.ts`           | Add operator module re-exports                           |
| `packages/db/prisma/schema.prisma`       | Add `OperatorRequest` and `OperatorCommandRecord` models |
| `packages/db/src/index.ts`               | Add `PrismaOperatorCommandStore` re-export               |
| `apps/api/src/app.ts`                    | Add `operatorDeps` to Fastify instance declaration       |
| `apps/api/src/bootstrap/routes.ts`       | Register operator routes                                 |
| `apps/chat/src/handlers/lead-handler.ts` | Add operator identity check before lead routing          |
| `apps/dashboard/src/app/page.tsx`        | Mount operator chat widget                               |

---

## Task 1: Operator Command Zod Schemas

**Files:**

- Create: `packages/schemas/src/operator-command.ts`
- Create: `packages/schemas/src/__tests__/operator-command.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/operator-command.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  OperatorChannelSchema,
  CommandStatusSchema,
  CommandIntentSchema,
  GuardrailResultSchema,
  OperatorRequestSchema,
  OperatorCommandSchema,
  LAUNCH_INTENTS,
  TERMINAL_COMMAND_STATUSES,
} from "../operator-command.js";

describe("OperatorCommand schemas", () => {
  describe("OperatorChannelSchema", () => {
    it("accepts valid channels", () => {
      expect(OperatorChannelSchema.parse("telegram")).toBe("telegram");
      expect(OperatorChannelSchema.parse("whatsapp")).toBe("whatsapp");
      expect(OperatorChannelSchema.parse("dashboard")).toBe("dashboard");
    });

    it("rejects invalid channel", () => {
      expect(() => OperatorChannelSchema.parse("email")).toThrow();
    });
  });

  describe("CommandStatusSchema", () => {
    it("accepts all 6 statuses", () => {
      const statuses = ["parsed", "confirmed", "executing", "completed", "failed", "rejected"];
      for (const s of statuses) {
        expect(CommandStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe("TERMINAL_COMMAND_STATUSES", () => {
    it("contains completed, failed, rejected", () => {
      expect(TERMINAL_COMMAND_STATUSES).toContain("completed");
      expect(TERMINAL_COMMAND_STATUSES).toContain("failed");
      expect(TERMINAL_COMMAND_STATUSES).toContain("rejected");
      expect(TERMINAL_COMMAND_STATUSES).not.toContain("parsed");
    });
  });

  describe("LAUNCH_INTENTS", () => {
    it("contains the initial operator intent vocabulary", () => {
      expect(LAUNCH_INTENTS).toContain("follow_up_leads");
      expect(LAUNCH_INTENTS).toContain("pause_campaigns");
      expect(LAUNCH_INTENTS).toContain("show_pipeline");
      expect(LAUNCH_INTENTS).toContain("reassign_leads");
      expect(LAUNCH_INTENTS).toContain("query_lead_history");
    });
  });

  describe("GuardrailResultSchema", () => {
    it("validates a passing guardrail result", () => {
      const result = GuardrailResultSchema.parse({
        canExecute: true,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings: [],
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: [],
      });
      expect(result.canExecute).toBe(true);
    });

    it("validates a guardrail result with warnings", () => {
      const result = GuardrailResultSchema.parse({
        canExecute: true,
        requiresConfirmation: true,
        requiresPreview: true,
        warnings: ["High budget change"],
        missingEntities: ["campaign_id"],
        riskLevel: "high",
        ambiguityFlags: ["multiple_campaigns_match"],
      });
      expect(result.requiresConfirmation).toBe(true);
      expect(result.riskLevel).toBe("high");
    });
  });

  describe("OperatorRequestSchema", () => {
    it("validates a minimal operator request", () => {
      const request = OperatorRequestSchema.parse({
        id: "req-1",
        organizationId: "org-1",
        operatorId: "op-1",
        channel: "telegram",
        rawInput: "follow up with hot leads",
        receivedAt: new Date(),
      });
      expect(request.channel).toBe("telegram");
    });
  });

  describe("OperatorCommandSchema", () => {
    it("validates a full operator command", () => {
      const command = OperatorCommandSchema.parse({
        id: "cmd-1",
        requestId: "req-1",
        organizationId: "org-1",
        intent: "follow_up_leads",
        entities: [{ type: "lead_segment", filter: { score: { gte: 70 } } }],
        parameters: { urgency: "high" },
        parseConfidence: 0.92,
        guardrailResult: {
          canExecute: true,
          requiresConfirmation: false,
          requiresPreview: false,
          warnings: [],
          missingEntities: [],
          riskLevel: "low",
          ambiguityFlags: [],
        },
        status: "parsed",
        workflowIds: [],
        resultSummary: null,
        createdAt: new Date(),
        completedAt: null,
      });
      expect(command.intent).toBe("follow_up_leads");
      expect(command.parseConfidence).toBeGreaterThan(0.9);
    });

    it("rejects command with missing required fields", () => {
      expect(() =>
        OperatorCommandSchema.parse({ id: "cmd-1", intent: "follow_up_leads" }),
      ).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- --run operator-command`
Expected: FAIL — module `../operator-command.js` not found

- [ ] **Step 3: Write the schema implementation**

Create `packages/schemas/src/operator-command.ts`:

```typescript
import { z } from "zod";
import { RiskLevelSchema } from "./workflow.js";

// ---------------------------------------------------------------------------
// Operator Channel
// ---------------------------------------------------------------------------

export const OperatorChannelSchema = z.enum(["telegram", "whatsapp", "dashboard"]);
export type OperatorChannel = z.infer<typeof OperatorChannelSchema>;

// ---------------------------------------------------------------------------
// Command Status
// ---------------------------------------------------------------------------

export const CommandStatusSchema = z.enum([
  "parsed",
  "confirmed",
  "executing",
  "completed",
  "failed",
  "rejected",
]);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

export const TERMINAL_COMMAND_STATUSES: CommandStatus[] = ["completed", "failed", "rejected"];

// ---------------------------------------------------------------------------
// Intent Catalog (narrow launch vocabulary)
// ---------------------------------------------------------------------------

export const CommandIntentSchema = z.string().min(1);
export type CommandIntent = z.infer<typeof CommandIntentSchema>;

export const LAUNCH_INTENTS = [
  "follow_up_leads",
  "pause_campaigns",
  "show_pipeline",
  "reassign_leads",
  "draft_campaign",
  "query_lead_history",
  "show_status",
  "resume_campaigns",
] as const;

// ---------------------------------------------------------------------------
// Command Entity (target of the command)
// ---------------------------------------------------------------------------

export const CommandEntitySchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  filter: z.record(z.unknown()).optional(),
});
export type CommandEntity = z.infer<typeof CommandEntitySchema>;

// ---------------------------------------------------------------------------
// Guardrail Result
// ---------------------------------------------------------------------------

export const GuardrailResultSchema = z.object({
  canExecute: z.boolean(),
  requiresConfirmation: z.boolean(),
  requiresPreview: z.boolean(),
  warnings: z.array(z.string()),
  missingEntities: z.array(z.string()),
  riskLevel: RiskLevelSchema,
  ambiguityFlags: z.array(z.string()),
});
export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;

// ---------------------------------------------------------------------------
// Operator Request (raw input)
// ---------------------------------------------------------------------------

export const OperatorRequestSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  operatorId: z.string(),
  channel: OperatorChannelSchema,
  rawInput: z.string(),
  receivedAt: z.coerce.date(),
});
export type OperatorRequest = z.infer<typeof OperatorRequestSchema>;

// ---------------------------------------------------------------------------
// Operator Command (parsed + evaluated)
// ---------------------------------------------------------------------------

export const OperatorCommandSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  organizationId: z.string(),
  intent: CommandIntentSchema,
  entities: z.array(CommandEntitySchema),
  parameters: z.record(z.unknown()),
  parseConfidence: z.number().min(0).max(1),
  guardrailResult: GuardrailResultSchema,
  status: CommandStatusSchema,
  workflowIds: z.array(z.string()),
  resultSummary: z.string().nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;
```

- [ ] **Step 4: Add re-export to schemas barrel**

In `packages/schemas/src/index.ts`, add at the end:

```typescript
// Operator command types
export * from "./operator-command.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- --run operator-command`
Expected: PASS (all tests green)

- [ ] **Step 6: Commit**

```
feat(schemas): add OperatorCommand Zod schemas for Phase 5
```

---

## Task 2: Operator Types and Constants

**Files:**

- Create: `packages/agents/src/operator/operator-types.ts`
- Create: `packages/agents/src/operator/index.ts`

- [ ] **Step 1: Create operator-types.ts**

Create `packages/agents/src/operator/operator-types.ts`:

```typescript
import type {
  OperatorRequest,
  OperatorCommand,
  OperatorChannel,
  GuardrailResult,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Intent → Agent Mapping
// ---------------------------------------------------------------------------

export const INTENT_AGENT_MAP: Record<string, string> = {
  follow_up_leads: "lead-responder",
  pause_campaigns: "ad-optimizer",
  resume_campaigns: "ad-optimizer",
  draft_campaign: "ad-optimizer",
  show_pipeline: "revenue-tracker",
  reassign_leads: "lead-responder",
  query_lead_history: "lead-responder",
  show_status: "revenue-tracker",
};

// ---------------------------------------------------------------------------
// Read-only intents (do not spawn workflows, just query + format)
// ---------------------------------------------------------------------------

export const READ_ONLY_INTENTS = new Set(["show_pipeline", "query_lead_history", "show_status"]);

// ---------------------------------------------------------------------------
// Interpreter Result (output of NL parsing)
// ---------------------------------------------------------------------------

export interface InterpretResult {
  intent: string;
  entities: { type: string; id?: string; filter?: Record<string, unknown> }[];
  parameters: Record<string, unknown>;
  confidence: number;
  ambiguityFlags: string[];
}

// ---------------------------------------------------------------------------
// Router Result (what happened after dispatching)
// ---------------------------------------------------------------------------

export interface CommandRouterResult {
  success: boolean;
  workflowIds: string[];
  resultSummary: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// LLM adapter interface for the interpreter
// ---------------------------------------------------------------------------

export interface CommandLLM {
  parseCommand(
    rawInput: string,
    context: { organizationId: string; channel: OperatorChannel },
  ): Promise<InterpretResult>;
}
```

- [ ] **Step 2: Create barrel file**

Create `packages/agents/src/operator/index.ts`:

```typescript
export {
  INTENT_AGENT_MAP,
  READ_ONLY_INTENTS,
  type InterpretResult,
  type CommandRouterResult,
  type CommandLLM,
} from "./operator-types.js";
```

- [ ] **Step 3: Write test for constants**

Create `packages/agents/src/operator/__tests__/operator-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { INTENT_AGENT_MAP, READ_ONLY_INTENTS } from "../operator-types.js";
import { LAUNCH_INTENTS } from "@switchboard/schemas";

describe("operator-types constants", () => {
  it("INTENT_AGENT_MAP maps all launch intents to known agents", () => {
    const knownAgents = [
      "lead-responder",
      "sales-closer",
      "nurture",
      "ad-optimizer",
      "revenue-tracker",
      "operator",
    ];
    for (const agent of Object.values(INTENT_AGENT_MAP)) {
      expect(knownAgents).toContain(agent);
    }
  });

  it("READ_ONLY_INTENTS are a subset of LAUNCH_INTENTS", () => {
    for (const intent of READ_ONLY_INTENTS) {
      expect(LAUNCH_INTENTS).toContain(intent);
    }
  });

  it("READ_ONLY_INTENTS does not contain write intents", () => {
    expect(READ_ONLY_INTENTS.has("pause_campaigns")).toBe(false);
    expect(READ_ONLY_INTENTS.has("reassign_leads")).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/agents test -- --run operator-types`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(agents): add operator types and intent catalog
```

---

## Task 3: CommandInterpreter (LLM-powered NL parsing)

**Files:**

- Create: `packages/agents/src/operator/__tests__/command-interpreter.test.ts`
- Create: `packages/agents/src/operator/command-interpreter.ts`
- Modify: `packages/agents/src/operator/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/operator/__tests__/command-interpreter.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { CommandInterpreter } from "../command-interpreter.js";
import type { CommandLLM, InterpretResult } from "../operator-types.js";

function mockLLM(result: InterpretResult): CommandLLM {
  return {
    parseCommand: vi.fn().mockResolvedValue(result),
  };
}

describe("CommandInterpreter", () => {
  const baseContext = { organizationId: "org-1", channel: "telegram" as const };

  it("parses a high-confidence command via LLM", async () => {
    const llm = mockLLM({
      intent: "follow_up_leads",
      entities: [{ type: "lead_segment", filter: { score: { gte: 70 } } }],
      parameters: {},
      confidence: 0.95,
      ambiguityFlags: [],
    });

    const interpreter = new CommandInterpreter({ llm });
    const result = await interpreter.interpret("follow up with hot leads", baseContext);

    expect(result.intent).toBe("follow_up_leads");
    expect(result.confidence).toBe(0.95);
    expect(result.ambiguityFlags).toHaveLength(0);
    expect(llm.parseCommand).toHaveBeenCalledWith("follow up with hot leads", baseContext);
  });

  it("returns low confidence when LLM is uncertain", async () => {
    const llm = mockLLM({
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      confidence: 0.3,
      ambiguityFlags: ["vague_input"],
    });

    const interpreter = new CommandInterpreter({ llm });
    const result = await interpreter.interpret("what's going on", baseContext);

    expect(result.confidence).toBeLessThan(0.5);
    expect(result.ambiguityFlags).toContain("vague_input");
  });

  it("catches LLM errors and returns a safe fallback", async () => {
    const llm: CommandLLM = {
      parseCommand: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };

    const interpreter = new CommandInterpreter({ llm });
    const result = await interpreter.interpret("do something", baseContext);

    expect(result.confidence).toBe(0);
    expect(result.intent).toBe("unknown");
    expect(result.ambiguityFlags).toContain("llm_error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run command-interpreter`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CommandInterpreter**

Create `packages/agents/src/operator/command-interpreter.ts`:

```typescript
import type { OperatorChannel } from "@switchboard/schemas";
import type { CommandLLM, InterpretResult } from "./operator-types.js";

export interface CommandInterpreterDeps {
  llm: CommandLLM;
}

const FALLBACK_RESULT: InterpretResult = {
  intent: "unknown",
  entities: [],
  parameters: {},
  confidence: 0,
  ambiguityFlags: ["llm_error"],
};

export class CommandInterpreter {
  private readonly llm: CommandLLM;

  constructor(deps: CommandInterpreterDeps) {
    this.llm = deps.llm;
  }

  async interpret(
    rawInput: string,
    context: { organizationId: string; channel: OperatorChannel },
  ): Promise<InterpretResult> {
    try {
      return await this.llm.parseCommand(rawInput, context);
    } catch (err) {
      console.error("[CommandInterpreter] LLM parse error:", err);
      return { ...FALLBACK_RESULT };
    }
  }
}
```

- [ ] **Step 4: Add to barrel**

In `packages/agents/src/operator/index.ts`, add:

```typescript
export { CommandInterpreter, type CommandInterpreterDeps } from "./command-interpreter.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run command-interpreter`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(agents): add CommandInterpreter for NL-to-command parsing
```

---

## Task 4: CommandGuardrailEvaluator

**Files:**

- Create: `packages/agents/src/operator/__tests__/command-guardrail-evaluator.test.ts`
- Create: `packages/agents/src/operator/command-guardrail-evaluator.ts`
- Modify: `packages/agents/src/operator/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/operator/__tests__/command-guardrail-evaluator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CommandGuardrailEvaluator } from "../command-guardrail-evaluator.js";
import type { InterpretResult } from "../operator-types.js";

describe("CommandGuardrailEvaluator", () => {
  const evaluator = new CommandGuardrailEvaluator();

  it("allows high-confidence read-only commands without confirmation", () => {
    const input: InterpretResult = {
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      confidence: 0.95,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.riskLevel).toBe("low");
  });

  it("requires confirmation for write intents", () => {
    const input: InterpretResult = {
      intent: "pause_campaigns",
      entities: [{ type: "campaign", id: "camp-1" }],
      parameters: {},
      confidence: 0.9,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.riskLevel).toBe("medium");
  });

  it("blocks execution when confidence is too low", () => {
    const input: InterpretResult = {
      intent: "pause_campaigns",
      entities: [],
      parameters: {},
      confidence: 0.3,
      ambiguityFlags: ["vague_input"],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("flags missing entities", () => {
    const input: InterpretResult = {
      intent: "reassign_leads",
      entities: [],
      parameters: {},
      confidence: 0.85,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.missingEntities.length).toBeGreaterThan(0);
    expect(result.requiresConfirmation).toBe(true);
  });

  it("marks unknown intents as non-executable", () => {
    const input: InterpretResult = {
      intent: "unknown",
      entities: [],
      parameters: {},
      confidence: 0,
      ambiguityFlags: ["llm_error"],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(false);
  });

  it("requires preview for high-risk intents", () => {
    const input: InterpretResult = {
      intent: "pause_campaigns",
      entities: [{ type: "campaign", filter: { status: "active" } }],
      parameters: { scope: "all" },
      confidence: 0.92,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.requiresPreview).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run command-guardrail-evaluator`
Expected: FAIL

- [ ] **Step 3: Implement CommandGuardrailEvaluator**

Create `packages/agents/src/operator/command-guardrail-evaluator.ts`:

```typescript
import type { GuardrailResult, RiskLevel } from "@switchboard/schemas";
import { READ_ONLY_INTENTS } from "./operator-types.js";
import type { InterpretResult } from "./operator-types.js";

const MIN_CONFIDENCE_THRESHOLD = 0.5;

const WRITE_INTENTS_REQUIRING_ENTITIES: Record<string, string[]> = {
  pause_campaigns: ["campaign"],
  resume_campaigns: ["campaign"],
  reassign_leads: ["lead_segment"],
  draft_campaign: ["product"],
};

const HIGH_RISK_INTENTS = new Set(["pause_campaigns", "resume_campaigns"]);

export class CommandGuardrailEvaluator {
  evaluate(input: InterpretResult): GuardrailResult {
    const warnings: string[] = [];
    const missingEntities: string[] = [];
    let canExecute = true;
    let requiresConfirmation = false;
    let requiresPreview = false;
    let riskLevel: RiskLevel = "low";

    // Unknown intent — cannot execute
    if (input.intent === "unknown") {
      return {
        canExecute: false,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings: ["Could not understand the command"],
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: input.ambiguityFlags,
      };
    }

    // Low confidence — block execution
    if (input.confidence < MIN_CONFIDENCE_THRESHOLD) {
      canExecute = false;
      warnings.push(`Low confidence (${(input.confidence * 100).toFixed(0)}%) — please rephrase`);
    }

    // Ambiguity flags from LLM
    if (input.ambiguityFlags.length > 0) {
      warnings.push(`Ambiguous input: ${input.ambiguityFlags.join(", ")}`);
    }

    // Read-only intents are low-risk, no confirmation needed
    if (READ_ONLY_INTENTS.has(input.intent)) {
      return {
        canExecute,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings,
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: input.ambiguityFlags,
      };
    }

    // Write intents require confirmation
    requiresConfirmation = true;
    riskLevel = "medium";

    // High-risk intents require preview
    if (HIGH_RISK_INTENTS.has(input.intent)) {
      requiresPreview = true;
    }

    // Check for missing required entities
    const requiredTypes = WRITE_INTENTS_REQUIRING_ENTITIES[input.intent];
    if (requiredTypes) {
      for (const requiredType of requiredTypes) {
        const found = input.entities.some((e) => e.type === requiredType);
        if (!found) {
          missingEntities.push(requiredType);
        }
      }
      if (missingEntities.length > 0) {
        warnings.push(`Missing context: ${missingEntities.join(", ")}`);
      }
    }

    // Broad scope detection (filter without specific ID = potentially many targets)
    const hasBroadScope = input.entities.some((e) => !e.id && e.filter);
    if (hasBroadScope && HIGH_RISK_INTENTS.has(input.intent)) {
      riskLevel = "high";
      requiresPreview = true;
      warnings.push("Command targets multiple items — preview recommended");
    }

    return {
      canExecute,
      requiresConfirmation,
      requiresPreview,
      warnings,
      missingEntities,
      riskLevel,
      ambiguityFlags: input.ambiguityFlags,
    };
  }
}
```

- [ ] **Step 4: Add to barrel**

In `packages/agents/src/operator/index.ts`, add:

```typescript
export { CommandGuardrailEvaluator } from "./command-guardrail-evaluator.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run command-guardrail-evaluator`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(agents): add CommandGuardrailEvaluator for operator safety checks
```

---

## Task 5: SummaryFormatter (channel-aware output)

**Files:**

- Create: `packages/agents/src/operator/__tests__/summary-formatter.test.ts`
- Create: `packages/agents/src/operator/summary-formatter.ts`
- Modify: `packages/agents/src/operator/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/operator/__tests__/summary-formatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SummaryFormatter } from "../summary-formatter.js";

describe("SummaryFormatter", () => {
  const formatter = new SummaryFormatter();

  describe("formatSuccess", () => {
    it("formats compact for telegram", () => {
      const result = formatter.formatSuccess("follow_up_leads", { leadsContacted: 5 }, "telegram");
      expect(result).toContain("5");
      expect(result.length).toBeLessThan(500);
    });

    it("formats compact for whatsapp", () => {
      const result = formatter.formatSuccess("pause_campaigns", { campaignsPaused: 3 }, "whatsapp");
      expect(result).toContain("3");
    });

    it("formats rich for dashboard", () => {
      const result = formatter.formatSuccess(
        "show_pipeline",
        { totalDeals: 12, totalValue: 45000 },
        "dashboard",
      );
      expect(result).toContain("12");
      expect(result).toContain("45000");
    });
  });

  describe("formatError", () => {
    it("formats error message for any channel", () => {
      const result = formatter.formatError("Command failed: timeout", "telegram");
      expect(result).toContain("failed");
    });
  });

  describe("formatConfirmationPrompt", () => {
    it("asks for confirmation with command summary", () => {
      const result = formatter.formatConfirmationPrompt(
        "pause_campaigns",
        [{ type: "campaign", id: "camp-1" }],
        "telegram",
      );
      expect(result).toContain("pause");
      expect(result).toContain("confirm");
    });
  });

  describe("formatClarificationPrompt", () => {
    it("asks for clarification with missing entity hints", () => {
      const result = formatter.formatClarificationPrompt(["campaign"], "telegram");
      expect(result).toContain("campaign");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run summary-formatter`
Expected: FAIL

- [ ] **Step 3: Implement SummaryFormatter**

Create `packages/agents/src/operator/summary-formatter.ts`:

```typescript
import type { OperatorChannel, CommandEntity } from "@switchboard/schemas";

export class SummaryFormatter {
  formatSuccess(
    intent: string,
    resultData: Record<string, unknown>,
    channel: OperatorChannel,
  ): string {
    const summary = this.buildSuccessSummary(intent, resultData);
    return channel === "dashboard" ? this.wrapRich(summary, resultData) : summary;
  }

  formatError(error: string, _channel: OperatorChannel): string {
    return `Something failed: ${error}`;
  }

  formatConfirmationPrompt(
    intent: string,
    entities: CommandEntity[],
    _channel: OperatorChannel,
  ): string {
    const targetDesc =
      entities.length > 0
        ? entities.map((e) => (e.id ? `${e.type} ${e.id}` : e.type)).join(", ")
        : "the selected items";
    return `I'll ${this.intentToVerb(intent)} ${targetDesc}. Reply "confirm" to proceed or "cancel" to abort.`;
  }

  formatClarificationPrompt(missingEntities: string[], _channel: OperatorChannel): string {
    return `I need a bit more detail. Which ${missingEntities.join(" and ")} should I target?`;
  }

  private buildSuccessSummary(intent: string, data: Record<string, unknown>): string {
    const verb = this.intentToVerb(intent);
    const details = Object.entries(data)
      .map(([k, v]) => `${this.camelToWords(k)}: ${String(v)}`)
      .join(", ");
    return details ? `Done — ${verb}. ${details}.` : `Done — ${verb}.`;
  }

  private wrapRich(summary: string, data: Record<string, unknown>): string {
    const lines = Object.entries(data).map(
      ([k, v]) => `- **${this.camelToWords(k)}**: ${String(v)}`,
    );
    return `${summary}\n\n${lines.join("\n")}`;
  }

  private intentToVerb(intent: string): string {
    const map: Record<string, string> = {
      follow_up_leads: "followed up with leads",
      pause_campaigns: "paused campaigns",
      resume_campaigns: "resumed campaigns",
      show_pipeline: "pipeline summary",
      reassign_leads: "reassigned leads",
      draft_campaign: "drafted campaign",
      query_lead_history: "lead history",
      show_status: "status overview",
    };
    return map[intent] ?? intent.replace(/_/g, " ");
  }

  private camelToWords(s: string): string {
    return s
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }
}
```

- [ ] **Step 4: Add to barrel**

In `packages/agents/src/operator/index.ts`, add:

```typescript
export { SummaryFormatter } from "./summary-formatter.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run summary-formatter`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(agents): add SummaryFormatter for channel-aware command output
```

---

## Task 6: CommandRouter (dispatch to agents or workflows)

**Files:**

- Create: `packages/agents/src/operator/__tests__/command-router.test.ts`
- Create: `packages/agents/src/operator/command-router.ts`
- Modify: `packages/agents/src/operator/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/operator/__tests__/command-router.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { CommandRouter } from "../command-router.js";
import type { CommandRouterDeps } from "../command-router.js";
import type { OperatorCommand } from "@switchboard/schemas";

function makeCommand(overrides: Partial<OperatorCommand> = {}): OperatorCommand {
  return {
    id: "cmd-1",
    requestId: "req-1",
    organizationId: "org-1",
    intent: "show_pipeline",
    entities: [],
    parameters: {},
    parseConfidence: 0.9,
    guardrailResult: {
      canExecute: true,
      requiresConfirmation: false,
      requiresPreview: false,
      warnings: [],
      missingEntities: [],
      riskLevel: "low",
      ambiguityFlags: [],
    },
    status: "confirmed",
    workflowIds: [],
    resultSummary: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

describe("CommandRouter", () => {
  it("routes read-only intents directly to agent query handler", async () => {
    const queryHandler = vi.fn().mockResolvedValue({ totalDeals: 12 });
    const deps: CommandRouterDeps = {
      agentQueryHandlers: { show_pipeline: queryHandler },
    };

    const router = new CommandRouter(deps);
    const result = await router.dispatch(makeCommand({ intent: "show_pipeline" }));

    expect(result.success).toBe(true);
    expect(result.workflowIds).toHaveLength(0);
    expect(queryHandler).toHaveBeenCalledWith("org-1", {}, []);
  });

  it("routes write intents to workflow creation", async () => {
    const workflowSpawner = vi.fn().mockResolvedValue("wf-1");
    const deps: CommandRouterDeps = {
      workflowSpawner,
    };

    const router = new CommandRouter(deps);
    const result = await router.dispatch(
      makeCommand({ intent: "pause_campaigns", entities: [{ type: "campaign", id: "c-1" }] }),
    );

    expect(result.success).toBe(true);
    expect(result.workflowIds).toContain("wf-1");
    expect(workflowSpawner).toHaveBeenCalled();
  });

  it("returns error when no handler found for read-only intent", async () => {
    const router = new CommandRouter({});
    const result = await router.dispatch(makeCommand({ intent: "show_pipeline" }));

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when workflow spawner not available for write intent", async () => {
    const router = new CommandRouter({});
    const result = await router.dispatch(makeCommand({ intent: "pause_campaigns" }));

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run command-router`
Expected: FAIL

- [ ] **Step 3: Implement CommandRouter**

Create `packages/agents/src/operator/command-router.ts`:

```typescript
import type { OperatorCommand } from "@switchboard/schemas";
import { READ_ONLY_INTENTS, INTENT_AGENT_MAP } from "./operator-types.js";
import type { CommandRouterResult } from "./operator-types.js";

export type AgentQueryHandler = (
  organizationId: string,
  parameters: Record<string, unknown>,
  entities: { type: string; id?: string; filter?: Record<string, unknown> }[],
) => Promise<Record<string, unknown>>;

export type WorkflowSpawner = (
  organizationId: string,
  intent: string,
  sourceAgent: string,
  entities: { type: string; id?: string; filter?: Record<string, unknown> }[],
  parameters: Record<string, unknown>,
) => Promise<string>;

export interface CommandRouterDeps {
  agentQueryHandlers?: Record<string, AgentQueryHandler>;
  workflowSpawner?: WorkflowSpawner;
}

export class CommandRouter {
  private readonly queryHandlers: Record<string, AgentQueryHandler>;
  private readonly workflowSpawner?: WorkflowSpawner;

  constructor(deps: CommandRouterDeps) {
    this.queryHandlers = deps.agentQueryHandlers ?? {};
    this.workflowSpawner = deps.workflowSpawner;
  }

  async dispatch(command: OperatorCommand): Promise<CommandRouterResult> {
    if (READ_ONLY_INTENTS.has(command.intent)) {
      return this.handleReadOnly(command);
    }
    return this.handleWriteCommand(command);
  }

  private async handleReadOnly(command: OperatorCommand): Promise<CommandRouterResult> {
    const handler = this.queryHandlers[command.intent];
    if (!handler) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: `No query handler for intent: ${command.intent}`,
      };
    }

    try {
      const data = await handler(command.organizationId, command.parameters, command.entities);
      const summary = JSON.stringify(data);
      return { success: true, workflowIds: [], resultSummary: summary };
    } catch (err) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleWriteCommand(command: OperatorCommand): Promise<CommandRouterResult> {
    if (!this.workflowSpawner) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: "Workflow execution not available",
      };
    }

    const sourceAgent = INTENT_AGENT_MAP[command.intent] ?? "operator";

    try {
      const workflowId = await this.workflowSpawner(
        command.organizationId,
        command.intent,
        sourceAgent,
        command.entities,
        command.parameters,
      );
      return {
        success: true,
        workflowIds: [workflowId],
        resultSummary: `Workflow ${workflowId} started for ${command.intent}`,
      };
    } catch (err) {
      return {
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
```

- [ ] **Step 4: Add to barrel**

In `packages/agents/src/operator/index.ts`, add:

```typescript
export {
  CommandRouter,
  type CommandRouterDeps,
  type AgentQueryHandler,
  type WorkflowSpawner,
} from "./command-router.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run command-router`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(agents): add CommandRouter for intent dispatch
```

---

## Task 7: OperatorCommandStore (persistence interface + Prisma model)

**Files:**

- Create: `packages/core/src/operator/command-store.ts`
- Create: `packages/core/src/operator/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/stores/prisma-command-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-command-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create the store interface**

Create `packages/core/src/operator/command-store.ts`:

```typescript
import type { OperatorRequest, OperatorCommand, CommandStatus } from "@switchboard/schemas";

export interface OperatorCommandStore {
  saveRequest(request: OperatorRequest): Promise<void>;
  saveCommand(command: OperatorCommand): Promise<void>;
  updateCommandStatus(
    commandId: string,
    status: CommandStatus,
    updates?: Partial<Pick<OperatorCommand, "resultSummary" | "completedAt" | "workflowIds">>,
  ): Promise<void>;
  getCommandById(commandId: string): Promise<OperatorCommand | null>;
  listCommands(filters: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }): Promise<OperatorCommand[]>;
  getRequestById(requestId: string): Promise<OperatorRequest | null>;
}
```

- [ ] **Step 2: Create barrel and add to core index**

Create `packages/core/src/operator/index.ts`:

```typescript
export type { OperatorCommandStore } from "./command-store.js";
```

In `packages/core/src/index.ts`, add at the end:

```typescript
// Operator Command Store
export * from "./operator/index.js";
```

- [ ] **Step 3: Add Prisma models**

In `packages/db/prisma/schema.prisma`, add the two new models:

```prisma
model OperatorRequestRecord {
  id             String   @id @default(uuid())
  organizationId String
  operatorId     String
  channel        String
  rawInput       String
  receivedAt     DateTime
  createdAt      DateTime @default(now())

  @@index([organizationId])
}

model OperatorCommandRecord {
  id              String    @id @default(uuid())
  requestId       String
  organizationId  String
  intent          String
  entities        Json      @default("[]")
  parameters      Json      @default("{}")
  parseConfidence Float
  guardrailResult Json
  status          String    @default("parsed")
  workflowIds     Json      @default("[]")
  resultSummary   String?
  createdAt       DateTime  @default(now())
  completedAt     DateTime?

  @@index([organizationId])
  @@index([requestId])
  @@index([status])
}
```

- [ ] **Step 4: Generate Prisma client and create migration**

Run: `pnpm db:generate && cd packages/db && npx prisma migrate dev --name add_operator_command_tables`
Expected: Prisma client regenerated, migration file created

- [ ] **Step 5: Write the Prisma store test**

Create `packages/db/src/stores/__tests__/prisma-command-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOperatorCommandStore } from "../prisma-command-store.js";
import type { OperatorCommand, OperatorRequest } from "@switchboard/schemas";

function makeMockPrisma() {
  return {
    operatorRequestRecord: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    operatorCommandRecord: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("PrismaOperatorCommandStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaOperatorCommandStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaOperatorCommandStore(prisma as never);
  });

  it("saves an operator request", async () => {
    const request: OperatorRequest = {
      id: "req-1",
      organizationId: "org-1",
      operatorId: "op-1",
      channel: "telegram",
      rawInput: "show pipeline",
      receivedAt: new Date(),
    };

    await store.saveRequest(request);
    expect(prisma.operatorRequestRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "req-1", organizationId: "org-1" }),
    });
  });

  it("saves an operator command", async () => {
    const command: OperatorCommand = {
      id: "cmd-1",
      requestId: "req-1",
      organizationId: "org-1",
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      parseConfidence: 0.95,
      guardrailResult: {
        canExecute: true,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings: [],
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: [],
      },
      status: "parsed",
      workflowIds: [],
      resultSummary: null,
      createdAt: new Date(),
      completedAt: null,
    };

    await store.saveCommand(command);
    expect(prisma.operatorCommandRecord.create).toHaveBeenCalled();
  });

  it("updates command status", async () => {
    await store.updateCommandStatus("cmd-1", "completed", {
      resultSummary: "Done",
      completedAt: new Date(),
    });
    expect(prisma.operatorCommandRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cmd-1" } }),
    );
  });

  it("lists commands by org", async () => {
    await store.listCommands({ organizationId: "org-1", limit: 20 });
    expect(prisma.operatorCommandRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
        take: 20,
      }),
    );
  });
});
```

- [ ] **Step 6: Implement PrismaOperatorCommandStore**

Create `packages/db/src/stores/prisma-command-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type {
  OperatorRequest,
  OperatorCommand,
  CommandStatus,
  GuardrailResult,
  CommandEntity,
} from "@switchboard/schemas";
import type { OperatorCommandStore } from "@switchboard/core";

export class PrismaOperatorCommandStore implements OperatorCommandStore {
  constructor(private readonly prisma: PrismaClient) {}

  async saveRequest(request: OperatorRequest): Promise<void> {
    await this.prisma.operatorRequestRecord.create({
      data: {
        id: request.id,
        organizationId: request.organizationId,
        operatorId: request.operatorId,
        channel: request.channel,
        rawInput: request.rawInput,
        receivedAt: request.receivedAt,
      },
    });
  }

  async saveCommand(command: OperatorCommand): Promise<void> {
    await this.prisma.operatorCommandRecord.create({
      data: {
        id: command.id,
        requestId: command.requestId,
        organizationId: command.organizationId,
        intent: command.intent,
        entities: JSON.parse(JSON.stringify(command.entities)),
        parameters: JSON.parse(JSON.stringify(command.parameters)),
        parseConfidence: command.parseConfidence,
        guardrailResult: JSON.parse(JSON.stringify(command.guardrailResult)),
        status: command.status,
        workflowIds: JSON.parse(JSON.stringify(command.workflowIds)),
        resultSummary: command.resultSummary,
        completedAt: command.completedAt,
      },
    });
  }

  async updateCommandStatus(
    commandId: string,
    status: CommandStatus,
    updates?: Partial<Pick<OperatorCommand, "resultSummary" | "completedAt" | "workflowIds">>,
  ): Promise<void> {
    await this.prisma.operatorCommandRecord.update({
      where: { id: commandId },
      data: {
        status,
        ...(updates?.resultSummary !== undefined ? { resultSummary: updates.resultSummary } : {}),
        ...(updates?.completedAt !== undefined ? { completedAt: updates.completedAt } : {}),
        ...(updates?.workflowIds !== undefined
          ? { workflowIds: JSON.parse(JSON.stringify(updates.workflowIds)) }
          : {}),
      },
    });
  }

  async getCommandById(commandId: string): Promise<OperatorCommand | null> {
    const row = await this.prisma.operatorCommandRecord.findUnique({
      where: { id: commandId },
    });
    return row ? this.toCommand(row) : null;
  }

  async listCommands(filters: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }): Promise<OperatorCommand[]> {
    const rows = await this.prisma.operatorCommandRecord.findMany({
      where: { organizationId: filters.organizationId },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    });
    return rows.map((r) => this.toCommand(r));
  }

  async getRequestById(requestId: string): Promise<OperatorRequest | null> {
    const row = await this.prisma.operatorRequestRecord.findUnique({
      where: { id: requestId },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      operatorId: row.operatorId,
      channel: row.channel as OperatorRequest["channel"],
      rawInput: row.rawInput,
      receivedAt: row.receivedAt,
    };
  }

  private toCommand(row: Record<string, unknown>): OperatorCommand {
    return {
      id: row.id as string,
      requestId: row.requestId as string,
      organizationId: row.organizationId as string,
      intent: row.intent as string,
      entities: row.entities as CommandEntity[],
      parameters: row.parameters as Record<string, unknown>,
      parseConfidence: row.parseConfidence as number,
      guardrailResult: row.guardrailResult as GuardrailResult,
      status: row.status as CommandStatus,
      workflowIds: row.workflowIds as string[],
      resultSummary: (row.resultSummary as string) ?? null,
      createdAt: row.createdAt as Date,
      completedAt: (row.completedAt as Date) ?? null,
    };
  }
}
```

- [ ] **Step 7: Add to db barrel**

In `packages/db/src/index.ts`, add:

```typescript
export { PrismaOperatorCommandStore } from "./stores/prisma-command-store.js";
```

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @switchboard/db test -- --run prisma-command-store`
Expected: PASS

- [ ] **Step 9: Commit**

```
feat(core,db): add OperatorCommandStore interface and Prisma implementation
```

---

## Task 8: Operator API Routes

**Files:**

- Create: `apps/api/src/routes/operator.ts`
- Create: `apps/api/src/routes/__tests__/operator.test.ts`
- Create: `apps/api/src/bootstrap/operator-deps.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/routes/__tests__/operator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { operatorRoutes } from "../operator.js";

describe("operatorRoutes", () => {
  let app: FastifyInstance;
  const mockInterpret = vi.fn();
  const mockEvaluate = vi.fn();
  const mockDispatch = vi.fn();
  const mockFormat = vi.fn();
  const mockSaveRequest = vi.fn();
  const mockSaveCommand = vi.fn();
  const mockUpdateStatus = vi.fn();
  const mockListCommands = vi.fn();

  beforeEach(async () => {
    app = Fastify();
    // Mock operator deps on Fastify instance
    (app as Record<string, unknown>).operatorDeps = {
      interpreter: { interpret: mockInterpret },
      guardrailEvaluator: { evaluate: mockEvaluate },
      router: { dispatch: mockDispatch },
      formatter: {
        formatSuccess: mockFormat.mockReturnValue("Done"),
        formatError: vi.fn().mockReturnValue("Error"),
        formatConfirmationPrompt: vi.fn().mockReturnValue("Confirm?"),
        formatClarificationPrompt: vi.fn().mockReturnValue("Which one?"),
      },
      commandStore: {
        saveRequest: mockSaveRequest.mockResolvedValue(undefined),
        saveCommand: mockSaveCommand.mockResolvedValue(undefined),
        updateCommandStatus: mockUpdateStatus.mockResolvedValue(undefined),
        listCommands: mockListCommands.mockResolvedValue([]),
      },
    };
    // Mock auth
    app.decorateRequest("organizationIdFromAuth", null);
    app.addHook("onRequest", async (req) => {
      (req as Record<string, unknown>).organizationIdFromAuth = "org-1";
    });

    await app.register(operatorRoutes, { prefix: "/api/operator" });
    await app.ready();

    vi.clearAllMocks();
  });

  it("POST /command — processes a command end-to-end", async () => {
    mockInterpret.mockResolvedValue({
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      confidence: 0.95,
      ambiguityFlags: [],
    });
    mockEvaluate.mockReturnValue({
      canExecute: true,
      requiresConfirmation: false,
      requiresPreview: false,
      warnings: [],
      missingEntities: [],
      riskLevel: "low",
      ambiguityFlags: [],
    });
    mockDispatch.mockResolvedValue({
      success: true,
      workflowIds: [],
      resultSummary: '{"totalDeals":12}',
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/operator/command",
      payload: {
        rawInput: "show me pipeline",
        channel: "telegram",
        operatorId: "op-1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("completed");
  });

  it("POST /command — blocks when guardrails fail", async () => {
    mockInterpret.mockResolvedValue({
      intent: "unknown",
      entities: [],
      parameters: {},
      confidence: 0,
      ambiguityFlags: ["llm_error"],
    });
    mockEvaluate.mockReturnValue({
      canExecute: false,
      requiresConfirmation: false,
      requiresPreview: false,
      warnings: ["Could not understand"],
      missingEntities: [],
      riskLevel: "low",
      ambiguityFlags: ["llm_error"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/operator/command",
      payload: {
        rawInput: "asdfgh",
        channel: "telegram",
        operatorId: "op-1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("rejected");
  });

  it("GET /commands — lists command history", async () => {
    mockListCommands.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/operator/commands",
    });

    expect(res.statusCode).toBe(200);
  });

  it("POST /command — returns 401 without org context", async () => {
    // Override the hook to not set orgId
    const app2 = Fastify();
    (app2 as Record<string, unknown>).operatorDeps = (app as Record<string, unknown>).operatorDeps;
    app2.decorateRequest("organizationIdFromAuth", null);
    await app2.register(operatorRoutes, { prefix: "/api/operator" });
    await app2.ready();

    const res = await app2.inject({
      method: "POST",
      url: "/api/operator/command",
      payload: {
        rawInput: "show pipeline",
        channel: "telegram",
        operatorId: "op-1",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- --run operator`
Expected: FAIL — module not found

- [ ] **Step 3: Implement operator routes**

Create `apps/api/src/routes/operator.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { OperatorChannelSchema } from "@switchboard/schemas";
import type { OperatorRequest, OperatorCommand } from "@switchboard/schemas";
import { z } from "zod";

const CommandBodySchema = z.object({
  rawInput: z.string().min(1).max(2000),
  channel: OperatorChannelSchema,
  operatorId: z.string().min(1),
});

export async function operatorRoutes(app: FastifyInstance): Promise<void> {
  const deps = (app as Record<string, unknown>).operatorDeps as
    | import("../bootstrap/operator-deps.js").OperatorDeps
    | null;

  if (!deps) {
    app.log.warn("Operator deps not available — operator routes disabled");
    return;
  }

  // Submit a command
  app.post("/command", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const parsed = CommandBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const { rawInput, channel, operatorId } = parsed.data;

    // 1. Save request
    const opRequest: OperatorRequest = {
      id: randomUUID(),
      organizationId: orgId,
      operatorId,
      channel,
      rawInput,
      receivedAt: new Date(),
    };
    await deps.commandStore.saveRequest(opRequest);

    // 2. Interpret (LLM parse)
    const interpretResult = await deps.interpreter.interpret(rawInput, {
      organizationId: orgId,
      channel,
    });

    // 3. Guardrail evaluation
    const guardrailResult = deps.guardrailEvaluator.evaluate(interpretResult);

    // 4. Build command
    const command: OperatorCommand = {
      id: randomUUID(),
      requestId: opRequest.id,
      organizationId: orgId,
      intent: interpretResult.intent,
      entities: interpretResult.entities,
      parameters: interpretResult.parameters,
      parseConfidence: interpretResult.confidence,
      guardrailResult,
      status: "parsed",
      workflowIds: [],
      resultSummary: null,
      createdAt: new Date(),
      completedAt: null,
    };

    // 5. If guardrails block, reject
    if (!guardrailResult.canExecute) {
      command.status = "rejected";
      command.completedAt = new Date();
      command.resultSummary = guardrailResult.warnings.join("; ");
      await deps.commandStore.saveCommand(command);
      return reply.send({
        commandId: command.id,
        status: "rejected",
        message: deps.formatter.formatClarificationPrompt(
          guardrailResult.missingEntities.length > 0
            ? guardrailResult.missingEntities
            : ["your request"],
          channel,
        ),
        guardrailResult,
      });
    }

    // 6. If confirmation required, save as parsed and return prompt
    if (guardrailResult.requiresConfirmation) {
      await deps.commandStore.saveCommand(command);
      return reply.send({
        commandId: command.id,
        status: "awaiting_confirmation",
        message: deps.formatter.formatConfirmationPrompt(command.intent, command.entities, channel),
        guardrailResult,
      });
    }

    // 7. Execute immediately
    command.status = "executing";
    await deps.commandStore.saveCommand(command);

    const routerResult = await deps.router.dispatch(command);

    command.status = routerResult.success ? "completed" : "failed";
    command.completedAt = new Date();
    command.workflowIds = routerResult.workflowIds;
    command.resultSummary = routerResult.success
      ? deps.formatter.formatSuccess(
          command.intent,
          JSON.parse(routerResult.resultSummary || "{}"),
          channel,
        )
      : deps.formatter.formatError(routerResult.error ?? "Unknown error", channel);

    await deps.commandStore.updateCommandStatus(command.id, command.status, {
      resultSummary: command.resultSummary,
      completedAt: command.completedAt,
      workflowIds: command.workflowIds,
    });

    return reply.send({
      commandId: command.id,
      status: command.status,
      message: command.resultSummary,
      workflowIds: command.workflowIds,
    });
  });

  // List command history
  app.get("/commands", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const query = request.query as { limit?: string; offset?: string };
    const commands = await deps.commandStore.listCommands({
      organizationId: orgId,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    return reply.send({ commands });
  });
}
```

- [ ] **Step 4: Create operator-deps bootstrap**

Create `apps/api/src/bootstrap/operator-deps.ts`:

```typescript
import {
  CommandInterpreter,
  CommandGuardrailEvaluator,
  CommandRouter,
  SummaryFormatter,
} from "@switchboard/agents";
import type { OperatorCommandStore } from "@switchboard/core";
import type { CommandLLM } from "@switchboard/agents";

export interface OperatorDeps {
  interpreter: CommandInterpreter;
  guardrailEvaluator: CommandGuardrailEvaluator;
  router: CommandRouter;
  formatter: SummaryFormatter;
  commandStore: OperatorCommandStore;
}

export interface BuildOperatorDepsOptions {
  commandStore: OperatorCommandStore;
  llm?: CommandLLM;
  workflowSpawner?: import("@switchboard/agents").WorkflowSpawner;
  agentQueryHandlers?: Record<string, import("@switchboard/agents").AgentQueryHandler>;
}

export function buildOperatorDeps(options: BuildOperatorDepsOptions): OperatorDeps {
  const stubLLM: CommandLLM = {
    async parseCommand() {
      return {
        intent: "unknown",
        entities: [],
        parameters: {},
        confidence: 0,
        ambiguityFlags: ["no_llm_configured"],
      };
    },
  };

  return {
    interpreter: new CommandInterpreter({ llm: options.llm ?? stubLLM }),
    guardrailEvaluator: new CommandGuardrailEvaluator(),
    router: new CommandRouter({
      workflowSpawner: options.workflowSpawner,
      agentQueryHandlers: options.agentQueryHandlers,
    }),
    formatter: new SummaryFormatter(),
    commandStore: options.commandStore,
  };
}
```

- [ ] **Step 5: Add operatorDeps to Fastify declaration**

In `apps/api/src/app.ts`, add to the `FastifyInstance` interface:

```typescript
operatorDeps: import("./bootstrap/operator-deps.js").OperatorDeps | null;
```

- [ ] **Step 6: Register routes**

In `apps/api/src/bootstrap/routes.ts`, add:

```typescript
import { operatorRoutes } from "../routes/operator.js";
```

And in `registerRoutes`, add:

```typescript
await app.register(operatorRoutes, { prefix: "/api/operator" });
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @switchboard/api test -- --run operator`
Expected: PASS

- [ ] **Step 8: Commit**

```
feat(api): add operator command API routes and bootstrap
```

---

## Task 9: Operator Handler in Chat App

**Files:**

- Create: `apps/chat/src/handlers/operator-handler.ts`
- Create: `apps/chat/src/handlers/__tests__/operator-handler.test.ts`
- Modify: `apps/chat/src/handlers/lead-handler.ts` (add operator detection)

- [ ] **Step 1: Write the failing test**

Create `apps/chat/src/handlers/__tests__/operator-handler.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { isOperatorMessage, delegateOperatorCommand } from "../operator-handler.js";
import type { EventLoopDelegateConfig } from "../lead-handler.js";

describe("operator-handler", () => {
  describe("isOperatorMessage", () => {
    it("returns true when principal has operator role", () => {
      const roles = ["requester", "operator"];
      expect(isOperatorMessage(roles)).toBe(true);
    });

    it("returns false when principal lacks operator role", () => {
      const roles = ["requester"];
      expect(isOperatorMessage(roles)).toBe(false);
    });

    it("returns false for empty roles", () => {
      expect(isOperatorMessage([])).toBe(false);
      expect(isOperatorMessage(undefined)).toBe(false);
    });
  });

  describe("delegateOperatorCommand", () => {
    it("sends command to API operator endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            commandId: "cmd-1",
            status: "completed",
            message: "Done — pipeline summary.",
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: EventLoopDelegateConfig = { apiUrl: "http://localhost:3000" };
      const sendReply = vi.fn();

      await delegateOperatorCommand(config, {
        rawInput: "show pipeline",
        channel: "telegram",
        operatorId: "op-1",
        organizationId: "org-1",
        sendReply,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/operator/command",
        expect.objectContaining({ method: "POST" }),
      );
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("Done"));

      vi.unstubAllGlobals();
    });

    it("sends error reply on API failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error" }),
      );

      const sendReply = vi.fn();

      await delegateOperatorCommand(
        { apiUrl: "http://localhost:3000" },
        {
          rawInput: "do something",
          channel: "telegram",
          operatorId: "op-1",
          organizationId: "org-1",
          sendReply,
        },
      );

      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("went wrong"));

      vi.unstubAllGlobals();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/chat test -- --run operator-handler`
Expected: FAIL

- [ ] **Step 3: Implement operator-handler**

Create `apps/chat/src/handlers/operator-handler.ts`:

```typescript
import type { EventLoopDelegateConfig } from "./lead-handler.js";

export function isOperatorMessage(roles: string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes("operator");
}

export interface DelegateOperatorInput {
  rawInput: string;
  channel: "telegram" | "whatsapp" | "dashboard";
  operatorId: string;
  organizationId: string;
  sendReply: (text: string) => Promise<void> | void;
}

export async function delegateOperatorCommand(
  config: EventLoopDelegateConfig,
  input: DelegateOperatorInput,
): Promise<void> {
  const url = `${config.apiUrl}/api/operator/command`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        rawInput: input.rawInput,
        channel: input.channel,
        operatorId: input.operatorId,
      }),
    });

    if (!res.ok) {
      console.error(`[OperatorHandler] API error: ${res.status} ${res.statusText}`);
      await input.sendReply("Sorry, something went wrong processing your command.");
      return;
    }

    const body = (await res.json()) as {
      commandId: string;
      status: string;
      message: string;
    };

    await input.sendReply(body.message);
  } catch (err) {
    console.error("[OperatorHandler] Delegation error:", err);
    await input.sendReply("Sorry, something went wrong processing your command.");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/chat test -- --run operator-handler`
Expected: PASS

- [ ] **Step 5: Wire operator detection into lead-handler.ts**

In `apps/chat/src/handlers/lead-handler.ts`, at the top add the import:

```typescript
import { isOperatorMessage, delegateOperatorCommand } from "./operator-handler.js";
```

Then in the `handleLeadMessage` function, before the `const inbound` line, add operator detection:

```typescript
// Check if this is an operator message — route to operator handler instead
const principalRoles = (message.metadata?.roles ?? []) as string[];
if (isOperatorMessage(principalRoles)) {
  const apiUrl = process.env.SWITCHBOARD_API_URL;
  if (apiUrl) {
    await delegateOperatorCommand(
      { apiUrl },
      {
        rawInput: message.text,
        channel: (message.channel === "telegram" ? "telegram" : "whatsapp") as
          | "telegram"
          | "whatsapp",
        operatorId: message.principalId,
        organizationId: message.organizationId ?? "default",
        sendReply: (text: string) => ctx.sendFilteredReply(threadId, text),
      },
    );
    return;
  }
}
```

- [ ] **Step 6: Run full chat tests**

Run: `pnpm --filter @switchboard/chat test`
Expected: PASS (existing + new tests)

- [ ] **Step 7: Commit**

```
feat(chat): add operator handler for command delegation
```

---

## Task 10: Add Operator Exports to Agents Barrel

**Files:**

- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Add operator exports**

In `packages/agents/src/index.ts`, add at the end:

```typescript
// Operator Chat (command interpretation and routing)
export {
  INTENT_AGENT_MAP,
  READ_ONLY_INTENTS,
  CommandInterpreter,
  CommandGuardrailEvaluator,
  CommandRouter,
  SummaryFormatter,
  type InterpretResult,
  type CommandRouterResult,
  type CommandLLM,
  type CommandInterpreterDeps,
  type CommandRouterDeps,
  type AgentQueryHandler,
  type WorkflowSpawner,
} from "./operator/index.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(agents): export operator module from agents barrel
```

---

## Task 11: Wire Operator Deps into App Bootstrap

**Files:**

- Modify: `apps/api/src/app.ts` (wire operatorDeps in `buildServer`)

- [ ] **Step 1: Add operator dep construction in buildServer**

In `apps/api/src/app.ts`, in the `buildServer` function, after the scheduler service setup, add:

```typescript
import { buildOperatorDeps } from "./bootstrap/operator-deps.js";
import { PrismaOperatorCommandStore } from "@switchboard/db";
```

(Add imports at the top of the file.)

Then in the bootstrap section:

```typescript
// Operator deps — requires Prisma
let operatorDeps: import("./bootstrap/operator-deps.js").OperatorDeps | null = null;
if (prisma) {
  try {
    const commandStore = new PrismaOperatorCommandStore(prisma);
    operatorDeps = buildOperatorDeps({ commandStore });
    app.log.info("[boot] Operator command system wired");
  } catch (err) {
    app.log.warn({ err }, "[boot] Operator deps unavailable — operator routes disabled");
  }
}
app.decorate("operatorDeps", operatorDeps);
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(api): wire OperatorDeps into app bootstrap
```

---

## Task 12: Dashboard Operator Chat Widget

**Files:**

- Create: `apps/dashboard/src/components/operator-chat/use-operator-chat.ts`
- Create: `apps/dashboard/src/components/operator-chat/message-bubble.tsx`
- Create: `apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx`
- Create: `apps/dashboard/src/components/operator-chat/__tests__/operator-chat-widget.test.tsx`

Note: Dashboard uses extensionless imports (no `.js` extensions). Follow that convention.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/operator-chat/__tests__/operator-chat-widget.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperatorChatWidget } from "../operator-chat-widget";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("OperatorChatWidget", () => {
  it("renders the chat toggle button", () => {
    render(<OperatorChatWidget />);
    expect(screen.getByRole("button", { name: /operator/i })).toBeDefined();
  });

  it("opens the chat panel when clicked", async () => {
    render(<OperatorChatWidget />);
    fireEvent.click(screen.getByRole("button", { name: /operator/i }));
    expect(screen.getByPlaceholderText(/command/i)).toBeDefined();
  });

  it("sends a command and displays the response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          commandId: "cmd-1",
          status: "completed",
          message: "Done — pipeline summary.",
        }),
    });

    render(<OperatorChatWidget />);
    fireEvent.click(screen.getByRole("button", { name: /operator/i }));

    const input = screen.getByPlaceholderText(/command/i);
    fireEvent.change(input, { target: { value: "show pipeline" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/pipeline summary/)).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- --run operator-chat-widget`
Expected: FAIL

- [ ] **Step 3: Create the chat hook**

Create `apps/dashboard/src/components/operator-chat/use-operator-chat.ts`:

```typescript
"use client";

import { useState, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "operator" | "system";
  text: string;
  timestamp: Date;
  status?: "completed" | "failed" | "rejected" | "awaiting_confirmation";
}

export function useOperatorChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendCommand = useCallback(async (rawInput: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "operator",
      text: rawInput,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/dashboard/operator-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput, channel: "dashboard" }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const body = (await res.json()) as {
        commandId: string;
        status: string;
        message: string;
      };

      const systemMsg: ChatMessage = {
        id: body.commandId,
        role: "system",
        text: body.message,
        timestamp: new Date(),
        status: body.status as ChatMessage["status"],
      };
      setMessages((prev) => [...prev, systemMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "system",
        text: "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
        status: "failed",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { messages, isLoading, sendCommand };
}
```

- [ ] **Step 4: Create message bubble component**

Create `apps/dashboard/src/components/operator-chat/message-bubble.tsx`:

```tsx
"use client";

import type { ChatMessage } from "./use-operator-chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOperator = message.role === "operator";

  return (
    <div className={`flex ${isOperator ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isOperator
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        <span className="mt-1 block text-xs opacity-60">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create chat widget component**

Create `apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useOperatorChat } from "./use-operator-chat";
import { MessageBubble } from "./message-bubble";

export function OperatorChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, isLoading, sendCommand } = useOperatorChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    sendCommand(trimmed);
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700"
        aria-label="Operator Chat"
      >
        {isOpen ? "Close" : "Chat"}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-16 right-4 z-50 flex h-96 w-80 flex-col rounded-lg border bg-white shadow-xl dark:bg-gray-800">
          {/* Header */}
          <div className="border-b px-4 py-2">
            <h3 className="text-sm font-semibold">Operator Chat</h3>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-center text-xs text-gray-400">
                Type a command like &quot;show pipeline&quot; or &quot;pause low-performing
                ads&quot;
              </p>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t p-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command..."
              disabled={isLoading}
              className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700"
            />
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- --run operator-chat-widget`
Expected: PASS

- [ ] **Step 7: Commit**

```
feat(dashboard): add operator chat widget component
```

---

## Task 13: Dashboard Operator Chat API Route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/operator-chat/route.ts`

- [ ] **Step 1: Create the Next.js API route**

Create `apps/dashboard/src/app/api/dashboard/operator-chat/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiClient } from "../../../../lib/api-client";

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { rawInput: string; channel: string };

    const res = await apiClient("/operator/command", {
      method: "POST",
      body: JSON.stringify({
        rawInput: body.rawInput,
        channel: body.channel ?? "dashboard",
        operatorId: session.user.email ?? "dashboard-operator",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ error: "API error", details: errBody }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[OperatorChat] route error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write test for the route**

Create `apps/dashboard/src/app/api/dashboard/operator-chat/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next-auth before importing route
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock api-client
vi.mock("../../../../../lib/api-client", () => ({
  apiClient: vi.fn(),
}));

import { POST } from "../route";
import { getServerSession } from "next-auth";
import { apiClient } from "../../../../../lib/api-client";

describe("POST /api/dashboard/operator-chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const request = new Request("http://localhost/api/dashboard/operator-chat", {
      method: "POST",
      body: JSON.stringify({ rawInput: "show pipeline" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(401);
  });

  it("proxies command to API and returns response", async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { email: "owner@example.com" },
    });
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ commandId: "cmd-1", status: "completed", message: "Done" }),
    });

    const request = new Request("http://localhost/api/dashboard/operator-chat", {
      method: "POST",
      body: JSON.stringify({ rawInput: "show pipeline", channel: "dashboard" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commandId).toBe("cmd-1");
  });
});
```

Note: Check what auth mechanism the dashboard actually uses (it may be custom session cookies rather than `next-auth`). Adapt `getServerSession` to match the existing pattern in other dashboard API routes like `apps/dashboard/src/app/api/dashboard/agents/wizard-complete/route.ts`.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @switchboard/dashboard test -- --run route`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(dashboard): add operator chat proxy API route
```

---

## Task 14: Run Full Test Suite and Typecheck

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All existing + new tests pass

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (no new lint errors)

- [ ] **Step 4: Final commit if any fixes needed**

```
fix(core): address Phase 5 lint and type issues
```
