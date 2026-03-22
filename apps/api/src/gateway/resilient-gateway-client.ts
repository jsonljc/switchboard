import type {
  GatewayHealthResponse,
  GatewayInitialInvokeRequest,
  GatewayInvokeResponse,
  GatewayResumeInvokeRequest,
} from "@switchboard/schemas";
import type { GatewayClient } from "./gateway-client.js";
import type { GatewayCircuitBreaker } from "./circuit-breaker.js";
import type { GatewayInvocationOpts } from "./gateway-client.js";
import {
  GatewayInvocationAbortedError,
  GatewayTimeoutError,
  GatewayTransportError,
} from "./gateway-errors.js";

function isTransportClassFailure(err: unknown): boolean {
  if (err instanceof GatewayInvocationAbortedError) return false;
  if (err instanceof GatewayTimeoutError || err instanceof GatewayTransportError) return true;
  if (err instanceof TypeError) return true;
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Wraps a {@link GatewayClient} with a small circuit breaker (invoke + cancel only).
 */
export class ResilientGatewayClient implements GatewayClient {
  constructor(
    private readonly inner: GatewayClient,
    private readonly breaker: GatewayCircuitBreaker,
  ) {}

  async invokeInitial(
    request: GatewayInitialInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    this.breaker.assertAllowRequest();
    try {
      const r = await this.inner.invokeInitial(request, opts);
      this.breaker.recordSuccess();
      return r;
    } catch (err) {
      if (isTransportClassFailure(err)) this.breaker.recordInvokeFailure();
      throw err;
    }
  }

  async resume(
    request: GatewayResumeInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    this.breaker.assertAllowRequest();
    try {
      const r = await this.inner.resume(request, opts);
      this.breaker.recordSuccess();
      return r;
    } catch (err) {
      if (isTransportClassFailure(err)) this.breaker.recordInvokeFailure();
      throw err;
    }
  }

  async cancel(input: {
    sessionId: string;
    runId: string;
    sessionToken: string;
    traceId: string;
  }): Promise<void> {
    this.breaker.assertAllowRequest();
    try {
      await this.inner.cancel(input);
      this.breaker.recordSuccess();
    } catch (err) {
      if (isTransportClassFailure(err)) this.breaker.recordInvokeFailure();
      throw err;
    }
  }

  async healthCheck(): Promise<GatewayHealthResponse> {
    const h = await this.inner.healthCheck();
    if (h.ok) {
      this.breaker.recordSuccess();
    }
    return h;
  }
}
