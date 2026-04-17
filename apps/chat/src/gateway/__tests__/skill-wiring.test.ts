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
          result: { outcome: "completed", outputs: {}, summary: "" },
          workUnit: { id: "wu-1", traceId: "t-1" },
        }),
      },
    });

    expect(gateway).toBeDefined();
    expect(gateway.handleIncoming).toBeDefined();
  });

  it("creates gateway without platformIngress (stub fallback)", () => {
    const mockPrisma = {
      agentTask: {},
      interactionSummary: {},
      deploymentMemory: {},
      conversation: {},
      agentDeployment: {},
      deploymentConnection: {},
    } as unknown as PrismaClient;

    // Should not throw during construction
    const gateway = createGatewayBridge(mockPrisma);

    expect(gateway.constructor.name).toBe("ChannelGateway");
  });
});
