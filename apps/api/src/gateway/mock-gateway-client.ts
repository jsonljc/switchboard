import { randomUUID } from "node:crypto";
import type {
  GatewayHealthResponse,
  GatewayInitialInvokeRequest,
  GatewayInvokeResponse,
  GatewayResumeInvokeRequest,
  GatewayToolCallInput,
} from "@switchboard/schemas";
import type { GatewayClient, GatewayInvocationOpts } from "./gateway-client.js";
import {
  GatewayInvocationAbortedError,
  GatewayInvalidResponseError,
  GatewayTimeoutError,
  GatewayTransportError,
} from "./gateway-errors.js";

type MockHandler = (input: {
  kind: "initial" | "resume";
  request: GatewayInitialInvokeRequest | GatewayResumeInvokeRequest;
}) => Promise<GatewayInvokeResponse>;

/**
 * Deterministic in-process gateway for lifecycle tests.
 * Queue handlers with `enqueue`; each invoke/resume consumes one handler.
 */
export class MockGatewayClient implements GatewayClient {
  private readonly handlers: MockHandler[] = [];

  enqueue(handler: MockHandler): void {
    this.handlers.push(handler);
  }

  clear(): void {
    this.handlers.length = 0;
  }

  async invokeInitial(
    request: GatewayInitialInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    if (opts?.signal?.aborted) {
      throw new GatewayInvocationAbortedError();
    }
    return this.runNext({ kind: "initial", request });
  }

  async resume(
    request: GatewayResumeInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    if (opts?.signal?.aborted) {
      throw new GatewayInvocationAbortedError();
    }
    return this.runNext({ kind: "resume", request });
  }

  async cancel(_input: {
    sessionId: string;
    runId: string;
    sessionToken: string;
    traceId: string;
  }): Promise<void> {
    // no-op for tests
  }

  async healthCheck(): Promise<GatewayHealthResponse> {
    return { ok: true, version: "mock" };
  }

  private async runNext(ctx: {
    kind: "initial" | "resume";
    request: GatewayInitialInvokeRequest | GatewayResumeInvokeRequest;
  }): Promise<GatewayInvokeResponse> {
    const next = this.handlers.shift();
    if (!next) {
      throw new GatewayTransportError("MockGatewayClient: no handler queued");
    }
    return next(ctx);
  }
}

export function sampleToolCall(partial: Partial<GatewayToolCallInput> = {}): GatewayToolCallInput {
  return {
    idempotencyKey: partial.idempotencyKey ?? `tool-${randomUUID()}`,
    toolName: partial.toolName ?? "tool_a",
    parameters: partial.parameters ?? {},
    result: partial.result ?? null,
    isMutation: partial.isMutation ?? false,
    dollarsAtRisk: partial.dollarsAtRisk ?? 0,
    durationMs: partial.durationMs ?? null,
    envelopeId: partial.envelopeId ?? null,
  };
}

export const mockComplete =
  (toolCalls?: GatewayToolCallInput[]): MockHandler =>
  async () => ({
    status: "completed" as const,
    toolCalls,
    result: {},
  });

export const mockPause =
  (input: {
    checkpoint: GatewayInvokeResponse["checkpoint"];
    toolCalls?: GatewayToolCallInput[];
  }): MockHandler =>
  async () => ({
    status: "paused" as const,
    checkpoint: input.checkpoint,
    toolCalls: input.toolCalls,
  });

export const mockFail =
  (code: string, message: string): MockHandler =>
  async () => ({
    status: "failed" as const,
    error: { code, message },
  });

export const mockThrowTimeout = (): MockHandler => async () => {
  throw new GatewayTimeoutError("mock timeout");
};

export const mockThrowInvalidJson = (): MockHandler => async () => {
  throw new GatewayInvalidResponseError("mock malformed");
};
