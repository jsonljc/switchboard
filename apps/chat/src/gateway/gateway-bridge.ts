import type { PrismaClient } from "@switchboard/db";
import { PrismaDeploymentStateStore, PrismaActionRequestStore } from "@switchboard/db";
import { ChannelGateway } from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import { PrismaDeploymentLookup } from "./deployment-lookup.js";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";

export function createGatewayBridge(prisma: PrismaClient): ChannelGateway {
  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: () => createAnthropicAdapter(),
  });
}
