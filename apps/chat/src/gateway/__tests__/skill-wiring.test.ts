import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import { createGatewayBridge } from "../gateway-bridge.js";

describe("Skill Runtime Wiring", () => {
  it("creates gateway with skill runtime dependencies successfully", () => {
    // Arrange - Create a minimal mock PrismaClient
    const mockPrisma = {
      contact: {},
      opportunity: {},
      activityLog: {},
      knowledgeEntry: {},
      agentTask: {},
      interactionSummary: {},
      deploymentMemory: {},
      knowledge: {},
      deploymentState: {},
      actionRequest: {},
      conversation: {},
    } as unknown as PrismaClient;

    // Act
    const gateway = createGatewayBridge(mockPrisma);

    // Assert
    expect(gateway).toBeDefined();
    expect(gateway.handleIncoming).toBeDefined();
  });

  it("gateway is an instance of ChannelGateway", () => {
    const mockPrisma = {
      contact: {},
      opportunity: {},
      activityLog: {},
      knowledgeEntry: {},
      agentTask: {},
      interactionSummary: {},
      deploymentMemory: {},
      knowledge: {},
      deploymentState: {},
      actionRequest: {},
      conversation: {},
    } as unknown as PrismaClient;

    const gateway = createGatewayBridge(mockPrisma);

    expect(gateway.constructor.name).toBe("ChannelGateway");
  });
});
