import { describe, it, expect } from "vitest";
import { buildTierContext } from "../skill-tier-context-builder.js";
import type { SkillTool } from "../types.js";
import { ok } from "../tool-result.js";

describe("buildTierContext", () => {
  const readOnlyTools = new Map<string, SkillTool>([
    [
      "crm-query",
      {
        id: "crm-query",
        operations: {
          "contact.get": {
            description: "Get contact",
            inputSchema: { type: "object", properties: {} },
            effectCategory: "read" as const,
            execute: async () => ok(),
          },
        },
      },
    ],
  ]);

  const externalWriteTools = new Map<string, SkillTool>([
    [
      "crm-write",
      {
        id: "crm-write",
        operations: {
          "contact.create": {
            description: "Create contact",
            inputSchema: { type: "object", properties: {} },
            effectCategory: "external_send" as const,
            execute: async () => ok(),
          },
        },
      },
    ],
  ]);

  const destructiveTools = new Map<string, SkillTool>([
    [
      "crm-delete",
      {
        id: "crm-delete",
        operations: {
          "contact.delete": {
            description: "Delete contact",
            inputSchema: { type: "object", properties: {} },
            effectCategory: "irreversible" as const,
            execute: async () => ok(),
          },
        },
      },
    ],
  ]);

  it("returns default tier for first turn with read-only tools", () => {
    const result = buildTierContext({
      conversationDepth: 0,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result).toEqual({
      conversationDepth: 0,
      toolCount: 1,
      previousTurnUsedTools: false,
      previousTurnEscalated: false,
      modelFloor: undefined,
    });
  });

  it("passes previousTurnUsedTools through", () => {
    const result = buildTierContext({
      conversationDepth: 2,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: true,
      previousTurnEscalated: false,
    });

    expect(result.previousTurnUsedTools).toBe(true);
  });

  it("passes previousTurnEscalated through", () => {
    const result = buildTierContext({
      conversationDepth: 2,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: true,
    });

    expect(result.previousTurnEscalated).toBe(true);
  });

  it("sets modelFloor from minimumModelTier", () => {
    const result = buildTierContext({
      conversationDepth: 0,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
      minimumModelTier: "premium" as const,
    });

    expect(result.modelFloor).toBe("premium");
  });

  it("counts tools from declared IDs only", () => {
    const mixedTools = new Map<string, SkillTool>([
      ...readOnlyTools,
      ...externalWriteTools,
      ...destructiveTools,
    ]);

    const result = buildTierContext({
      conversationDepth: 0,
      declaredToolIds: ["crm-query", "crm-write"],
      tools: mixedTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result.toolCount).toBe(2);
  });

  it("threads currentStage through to the TierContext", () => {
    const result = buildTierContext({
      conversationDepth: 3,
      declaredToolIds: [],
      tools: new Map(),
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
      currentStage: "fear",
    });

    expect(result.currentStage).toBe("fear");
  });

  it("leaves currentStage undefined when not provided", () => {
    const result = buildTierContext({
      conversationDepth: 3,
      declaredToolIds: [],
      tools: new Map(),
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result.currentStage).toBeUndefined();
  });
});
