// ---------------------------------------------------------------------------
// Mock SMS Provider
// ---------------------------------------------------------------------------

import type { SMSProvider } from "../provider.js";
import type { PlatformHealth } from "../../types.js";

export class MockSMSProvider implements SMSProvider {
  readonly platform = "mock" as const;
  readonly sentMessages: Array<{ to: string; body: string; messageId: string }> = [];
  private nextId = 1;

  async sendMessage(
    to: string,
    _from: string,
    body: string,
  ): Promise<{ messageId: string; status: string }> {
    const messageId = `mock-sms-${this.nextId++}`;
    this.sentMessages.push({ to, body, messageId });
    return { messageId, status: "sent" };
  }

  async checkHealth(): Promise<PlatformHealth> {
    return { status: "connected", latencyMs: 1, error: null };
  }
}
