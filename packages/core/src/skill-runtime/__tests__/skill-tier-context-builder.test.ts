import { describe, it, expect } from "vitest";
import { buildTierContext } from "../skill-tier-context-builder.js";
import type { SkillTool } from "../types.js";

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
            governanceTier: "read" as const,
            execute: async () => ({}),
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
            governanceTier: "external_send" as const,
            execute: async () => ({}),
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
            governanceTier: "irreversible" as const,
            execute: async () => ({}),
          },
        },
      },
    ],
  ]);

  it("returns default tier for first turn with read-only tools", () => {
    const result = buildTierContext({
      turnCount: 0,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result).toEqual({
      messageIndex: 0,
      toolCount: 1,
      hasHighRiskTools: false,
      previousTurnUsedTools: false,
      previousTurnEscalated: false,
      modelFloor: undefined,
    });
  });

  it("flags hasHighRiskTools when external_write tool is declared", () => {
    const result = buildTierContext({
      turnCount: 1,
      declaredToolIds: ["crm-write"],
      tools: externalWriteTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result.hasHighRiskTools).toBe(true);
  });

  it("flags hasHighRiskTools when destructive tool is declared", () => {
    const result = buildTierContext({
      turnCount: 1,
      declaredToolIds: ["crm-delete"],
      tools: destructiveTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result.hasHighRiskTools).toBe(true);
  });

  it("passes previousTurnUsedTools through", () => {
    const result = buildTierContext({
      turnCount: 2,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: true,
      previousTurnEscalated: false,
    });

    expect(result.previousTurnUsedTools).toBe(true);
  });

  it("passes previousTurnEscalated through", () => {
    const result = buildTierContext({
      turnCount: 2,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: true,
    });

    expect(result.previousTurnEscalated).toBe(true);
  });

  it("sets modelFloor from minimumModelTier", () => {
    const result = buildTierContext({
      turnCount: 0,
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
      turnCount: 0,
      declaredToolIds: ["crm-query", "crm-write"],
      tools: mixedTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });

    expect(result.toolCount).toBe(2);
  });
});
