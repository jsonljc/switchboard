import { describe, it, expect } from "vitest";
import { GovernanceHook } from "../../hooks/governance-hook.js";
import type { SkillTool, ToolCallContext } from "../../types.js";

describe("GovernanceHook", () => {
  const createTools = () =>
    new Map<string, SkillTool>([
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
      [
        "crm-write",
        {
          id: "crm-write",
          operations: {
            "contact.delete": {
              description: "Delete contact",
              inputSchema: { type: "object", properties: {} },
              governanceTier: "destructive" as const,
              execute: async () => ({}),
            },
          },
        },
      ],
      [
        "email-sender",
        {
          id: "email-sender",
          operations: {
            send: {
              description: "Send email",
              inputSchema: { type: "object", properties: {} },
              governanceTier: "external_write" as const,
              execute: async () => ({}),
            },
          },
        },
      ],
    ]);

  const createContext = (
    toolId: string,
    operation: string,
    trustLevel: "supervised" | "guided" | "autonomous",
  ): ToolCallContext => ({
    toolId,
    operation,
    trustLevel,
    input: {},
    deploymentId: "test-deployment",
    orgId: "test-org",
    sessionId: "test-session",
  });

  it("auto-approves read-tier tool at guided trust", async () => {
    const hook = new GovernanceHook(createTools());
    const ctx = createContext("crm-query", "contact.get", "guided");

    const result = await hook.beforeToolCall(ctx);

    expect(result.proceed).toBe(true);
    expect(result.decision).toBeUndefined();

    const logs = hook.getGovernanceLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].decision).toBe("auto-approve");
    expect(logs[0].tier).toBe("read");
  });

  it("denies destructive tool at supervised trust", async () => {
    const hook = new GovernanceHook(createTools());
    const ctx = createContext("crm-write", "contact.delete", "supervised");

    const result = await hook.beforeToolCall(ctx);

    expect(result.proceed).toBe(false);
    expect(result.decision).toBe("denied");
    expect(result.reason).toBe("This action is not permitted at your current trust level.");

    const logs = hook.getGovernanceLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].decision).toBe("deny");
    expect(logs[0].tier).toBe("destructive");
  });

  it("requires approval for external_write at guided trust", async () => {
    const hook = new GovernanceHook(createTools());
    const ctx = createContext("email-sender", "send", "guided");

    const result = await hook.beforeToolCall(ctx);

    expect(result.proceed).toBe(false);
    expect(result.decision).toBe("pending_approval");
    expect(result.reason).toBe("This action requires human approval.");

    const logs = hook.getGovernanceLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].decision).toBe("require-approval");
    expect(logs[0].tier).toBe("external_write");
  });

  it("accumulates governance logs across multiple calls", async () => {
    const hook = new GovernanceHook(createTools());

    await hook.beforeToolCall(createContext("crm-query", "contact.get", "guided"));
    await hook.beforeToolCall(createContext("email-sender", "send", "guided"));
    await hook.beforeToolCall(createContext("crm-write", "contact.delete", "supervised"));

    const logs = hook.getGovernanceLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].operationId).toBe("crm-query.contact.get");
    expect(logs[1].operationId).toBe("email-sender.send");
    expect(logs[2].operationId).toBe("crm-write.contact.delete");
  });
});
