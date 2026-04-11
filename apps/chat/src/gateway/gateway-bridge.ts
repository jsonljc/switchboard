import type { PrismaClient } from "@switchboard/db";
import {
  PrismaDeploymentStateStore,
  PrismaActionRequestStore,
  PrismaAgentTaskStore,
} from "@switchboard/db";
import { ChannelGateway } from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import { PrismaDeploymentLookup } from "./deployment-lookup.js";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";
import { TaskRecorder } from "./task-recorder.js";

export function createGatewayBridge(prisma: PrismaClient): ChannelGateway {
  const taskStore = new PrismaAgentTaskStore(prisma);

  const taskRecorder = new TaskRecorder({
    createTask: (input) =>
      taskStore.create({
        deploymentId: input.deploymentId,
        organizationId: "", // Placeholder — will be resolved
        listingId: input.listingId,
        category: input.category,
        input: input.input,
      }),
    submitOutput: (taskId, output) => taskStore.submitOutput(taskId, output),
  });

  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: () => createAnthropicAdapter(),
    onMessageRecorded: (info) => taskRecorder.recordMessage(info),
  });
}
