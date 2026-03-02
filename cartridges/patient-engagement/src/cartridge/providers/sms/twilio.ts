// ---------------------------------------------------------------------------
// Twilio SMS Provider — with CircuitBreaker + retry
// ---------------------------------------------------------------------------

import type { SMSProvider } from "../provider.js";
import type { PlatformHealth } from "../../types.js";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureAt = 0;
  private readonly threshold: number;
  private readonly resetTimeMs: number;

  constructor(threshold = 5, resetTimeMs = 60_000) {
    this.threshold = threshold;
    this.resetTimeMs = resetTimeMs;
  }

  get isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailureAt > this.resetTimeMs) {
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void { this.failures = 0; }
  recordFailure(): void { this.failures++; this.lastFailureAt = Date.now(); }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error("withRetry exhausted");
}

export class TwilioSMSProvider implements SMSProvider {
  readonly platform = "twilio" as const;
  private readonly breaker = new CircuitBreaker();

  constructor(_config: TwilioConfig) {
    // Config will be used when real API integration is implemented
  }

  async sendMessage(
    _to: string,
    _from: string,
    _body: string,
  ): Promise<{ messageId: string; status: string }> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Twilio unavailable");

    return withRetry(async () => {
      try {
        // In production: POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
        const messageId = `twilio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.breaker.recordSuccess();
        return { messageId, status: "queued" };
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async checkHealth(): Promise<PlatformHealth> {
    if (this.breaker.isOpen) {
      return { status: "disconnected", latencyMs: 0, error: "Circuit breaker open" };
    }
    return { status: "connected", latencyMs: 0, error: null };
  }
}
