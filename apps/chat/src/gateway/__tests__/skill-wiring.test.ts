import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import { createGatewayBridge } from "../gateway-bridge.js";

describe("Skill Runtime Wiring", () => {
  it("creates gateway with converged path dependencies successfully", () => {
    const mockPrisma = {
      agentTask: {},
      interactionSummary: {},
      deploymentMemory: {},
      conversation: {},
      agentDeployment: {},
      deploymentConnection: {},
    } as unknown as PrismaClient;

    const gateway = createGatewayBridge(mockPrisma, {
      platformIngress: {
        submit: async () => ({
          ok: true as const,
          result: {
            workUnitId: "wu-1",
            outcome: "completed" as const,
            outputs: {},
            summary: "",
            mode: "skill" as const,
            durationMs: 0,
            traceId: "t-1",
          },
          workUnit: {
            id: "wu-1",
            requestedAt: new Date().toISOString(),
            organizationId: "org-1",
            actor: { id: "user-1", type: "user" as const },
            intent: "test.respond",
            parameters: {},
            deployment: undefined as never,
            resolvedMode: "skill" as const,
            traceId: "t-1",
            trigger: "chat" as const,
            priority: "normal" as const,
          },
        }),
      },
    });

    expect(gateway).toBeDefined();
    expect(gateway.handleIncoming).toBeDefined();
  });

  it("throws when platformIngress is not provided", () => {
    const mockPrisma = {
      agentTask: {},
      interactionSummary: {},
      deploymentMemory: {},
      conversation: {},
      agentDeployment: {},
      deploymentConnection: {},
    } as unknown as PrismaClient;

    expect(() => createGatewayBridge(mockPrisma)).toThrow("PlatformIngress is required");
  });
});
