import type { IncomingMessage, Channel } from "@switchboard/schemas";

export interface ChannelAdapter {
  readonly channel: Channel;
  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null;
  sendTextReply(threadId: string, text: string): Promise<void>;
  sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void>;
  sendResultCard(threadId: string, card: ResultCardPayload): Promise<void>;
  extractMessageId(rawPayload: unknown): string | null;
}

export interface ApprovalCardPayload {
  summary: string;
  riskCategory: string;
  explanation: string;
  buttons: Array<{
    label: string;
    callbackData: string;
  }>;
}

export interface ResultCardPayload {
  summary: string;
  success: boolean;
  auditId: string;
  riskCategory: string;
  undoAvailable: boolean;
  undoExpiresAt: Date | null;
}
