// ---------------------------------------------------------------------------
// Twilio SMS Provider — Real API integration with CircuitBreaker + retry
// ---------------------------------------------------------------------------

import type { SMSProvider } from "../provider.js";
import type { PlatformHealth } from "../../types.js";
import { withRetry, CircuitBreaker } from "@switchboard/core";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/**
 * Real Twilio SMS provider using the Twilio REST API.
 * All calls are wrapped with retry + circuit breaker.
 *
 * API Reference: https://www.twilio.com/docs/sms/api/message-resource#create-a-message-resource
 */
export class TwilioSMSProvider implements SMSProvider {
  readonly platform = "twilio" as const;
  private readonly config: TwilioConfig;
  private readonly breaker: CircuitBreaker;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: TwilioConfig) {
    this.config = config;
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}`;
    this.authHeader = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 3,
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(() =>
      withRetry(fn, {
        maxAttempts: 3,
        shouldRetry: (err: unknown) => {
          if (err instanceof Error) {
            const msg = err.message;
            // Retry on rate limits (429) and transient network errors
            return (
              msg.includes("429") ||
              msg.includes("ETIMEDOUT") ||
              msg.includes("ECONNRESET") ||
              msg.includes("503")
            );
          }
          return false;
        },
      }),
    );
  }

  async sendMessage(
    to: string,
    from: string,
    body: string,
  ): Promise<{ messageId: string; status: string }> {
    return this.call(async () => {
      const params = new URLSearchParams();
      params.set("To", to);
      params.set("From", from || this.config.fromNumber);
      params.set("Body", body);

      const response = await fetch(`${this.baseUrl}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Twilio API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        sid: string;
        status: string;
      };

      return { messageId: data.sid, status: data.status };
    });
  }

  async checkHealth(): Promise<PlatformHealth> {
    const start = Date.now();
    try {
      // Lightweight account fetch to verify connectivity
      const response = await fetch(`${this.baseUrl}.json`, {
        method: "GET",
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return {
          status: "disconnected",
          latencyMs: Date.now() - start,
          error: `Twilio returned ${response.status}`,
        };
      }

      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Mock Twilio provider for development/testing.
 */
export class MockTwilioSMSProvider implements SMSProvider {
  readonly platform = "twilio" as const;

  async sendMessage(
    _to: string,
    _from: string,
    _body: string,
  ): Promise<{ messageId: string; status: string }> {
    const messageId = `twilio-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { messageId, status: "queued" };
  }

  async checkHealth(): Promise<PlatformHealth> {
    return { status: "connected", latencyMs: 1, error: null };
  }
}

/**
 * Factory: auto-detect real Twilio credentials.
 * Real account SIDs start with "AC" and are 34 chars.
 */
export function createTwilioSMSProvider(config: TwilioConfig): SMSProvider {
  const isReal =
    config.accountSid &&
    config.accountSid.startsWith("AC") &&
    config.accountSid.length >= 34 &&
    config.authToken &&
    config.authToken.length >= 32;

  if (isReal) {
    return new TwilioSMSProvider(config);
  }

  return new MockTwilioSMSProvider();
}
