import type { ChatProvider } from "@switchboard/sdk";
import type { ActionRequestPipeline } from "./action-request-pipeline.js";

export interface CloudChatProviderConfig {
  deploymentId: string;
  surface: string;
  pipeline: ActionRequestPipeline;
  onExecute: (message: string) => Promise<void> | void;
}

export class CloudChatProvider implements ChatProvider {
  constructor(private config: CloudChatProviderConfig) {}

  async send(message: string): Promise<void> {
    const result = await this.config.pipeline.evaluate({
      deploymentId: this.config.deploymentId,
      type: "send_message",
      surface: this.config.surface,
      payload: { content: message },
    });

    if (result.decision === "execute") {
      await this.config.onExecute(message);
    }
    // If "queue", the pipeline already persisted the ActionRequest.
    // The message will be sent when the founder approves.
  }

  async sendToThread(threadId: string, message: string): Promise<void> {
    const result = await this.config.pipeline.evaluate({
      deploymentId: this.config.deploymentId,
      type: "send_message",
      surface: this.config.surface,
      payload: { content: message, threadId },
    });

    if (result.decision === "execute") {
      await this.config.onExecute(message);
    }
  }
}
