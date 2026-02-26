import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";

export interface ApiResponse {
  type: "text" | "approval_card" | "result_card";
  threadId: string;
  payload: unknown;
  timestamp: Date;
}

/**
 * API Channel Adapter for headless/programmatic access to the chat runtime.
 * Responses are stored in memory and returned via polling or webhook callback.
 */
export class ApiChannelAdapter implements ChannelAdapter {
  readonly channel = "api" as const;
  private responses: ApiResponse[] = [];
  private webhookUrl: string | null;
  private static readonly MAX_BUFFER_SIZE = 100;

  constructor(config?: { webhookUrl?: string }) {
    this.webhookUrl = config?.webhookUrl ?? null;
  }

  private pushResponse(response: ApiResponse): void {
    this.responses.push(response);
    if (this.responses.length > ApiChannelAdapter.MAX_BUFFER_SIZE) {
      this.responses = this.responses.slice(-ApiChannelAdapter.MAX_BUFFER_SIZE);
    }
  }

  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null {
    const payload = rawPayload as Record<string, unknown>;
    if (!payload) return null;

    const text = payload["text"] as string | undefined;
    if (!text) return null;

    return {
      id: (payload["messageId"] as string) ?? `api_${Date.now()}`,
      channel: "api",
      channelMessageId: (payload["messageId"] as string) ?? `api_${Date.now()}`,
      principalId: (payload["principalId"] as string) ?? "api-user",
      text,
      threadId: (payload["threadId"] as string) ?? `api_thread_${Date.now()}`,
      timestamp: new Date(),
      metadata: {},
      attachments: [],
      organizationId: (payload["organizationId"] as string) ?? null,
    };
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    const response: ApiResponse = {
      type: "text",
      threadId,
      payload: { text },
      timestamp: new Date(),
    };
    this.pushResponse(response);
    await this.pushToWebhook(response);
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    const response: ApiResponse = {
      type: "approval_card",
      threadId,
      payload: card,
      timestamp: new Date(),
    };
    this.pushResponse(response);
    await this.pushToWebhook(response);
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    const response: ApiResponse = {
      type: "result_card",
      threadId,
      payload: card,
      timestamp: new Date(),
    };
    this.pushResponse(response);
    await this.pushToWebhook(response);
  }

  extractMessageId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown>;
    return (payload?.["messageId"] as string) ?? null;
  }

  /** Get all pending responses for a thread and clear them. */
  drainResponses(threadId?: string): ApiResponse[] {
    if (threadId) {
      const matching = this.responses.filter((r) => r.threadId === threadId);
      this.responses = this.responses.filter((r) => r.threadId !== threadId);
      return matching;
    }
    const all = [...this.responses];
    this.responses = [];
    return all;
  }

  /** Get responses without clearing them. */
  peekResponses(threadId?: string): ApiResponse[] {
    if (threadId) {
      return this.responses.filter((r) => r.threadId === threadId);
    }
    return [...this.responses];
  }

  private async pushToWebhook(response: ApiResponse): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      });
    } catch {
      // Webhook push failure is non-critical
    }
  }
}
