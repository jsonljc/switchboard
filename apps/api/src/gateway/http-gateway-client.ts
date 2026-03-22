import type {
  GatewayHealthResponse,
  GatewayInitialInvokeRequest,
  GatewayInvokeResponse,
  GatewayResumeInvokeRequest,
} from "@switchboard/schemas";
import { GatewayHealthResponseSchema, GatewayInvokeResponseSchema } from "@switchboard/schemas";
import type { GatewayClient, GatewayInvocationOpts } from "./gateway-client.js";
import {
  GatewayInvocationAbortedError,
  GatewayInvalidResponseError,
  GatewayRejectedAuthError,
  GatewayTimeoutError,
  GatewayTransportError,
} from "./gateway-errors.js";
import {
  buildOpenClawGatewayHeaders,
  mergeGatewayInvokeResponseCorrelation,
  OPENCLAW_GATEWAY_HTTP_PATHS,
  parseGatewayCorrelationHeaders,
  serializeGatewayCancelPayload,
} from "./openclaw-gateway-protocol.js";

export interface HttpGatewayClientOptions {
  baseUrl: string;
  /** Per-request timeout (ms) */
  fetchTimeoutMs?: number;
  /** Retries for transport-class failures only */
  maxRetries?: number;
  retryDelayMs?: number;
  /** Injected for tests; must respect `signal` when provided */
  fetchFn?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function linkAbortToCombined(combined: AbortController, sig: AbortSignal): void {
  if (sig.aborted) {
    combined.abort();
    return;
  }
  sig.addEventListener("abort", () => combined.abort(), { once: true });
}

function assertGatewayHttpOk(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new GatewayRejectedAuthError(`Gateway auth rejected: ${res.status}`, res.status);
  }
  if (res.status >= 500 || res.status === 429) {
    throw new GatewayTransportError(`Gateway HTTP ${res.status}`, res.status);
  }
  if (!res.ok) {
    throw new GatewayTransportError(`Gateway returned ${res.status}`, res.status);
  }
}

function mapFetchFailure(err: unknown): Error {
  const isAbort = err instanceof Error && err.name === "AbortError";
  if (isAbort) return new GatewayTimeoutError(undefined, err);
  if (err instanceof GatewayTransportError) return err;
  return new GatewayTransportError(
    err instanceof Error ? err.message : "Gateway fetch failed",
    undefined,
    err,
  );
}

export class HttpGatewayClient implements GatewayClient {
  private readonly baseUrl: string;
  private readonly fetchTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpGatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async invokeInitial(
    request: GatewayInitialInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    return this.postInvoke(request, request.sessionToken, request.traceId, opts);
  }

  async resume(
    request: GatewayResumeInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    return this.postInvoke(request, request.sessionToken, request.traceId, opts);
  }

  async cancel(input: {
    sessionId: string;
    runId: string;
    sessionToken: string;
    traceId: string;
  }): Promise<void> {
    const url = `${this.baseUrl}${OPENCLAW_GATEWAY_HTTP_PATHS.cancel}`;
    const headers = buildOpenClawGatewayHeaders({
      sessionToken: input.sessionToken,
      traceId: input.traceId,
    });
    await this.fetchWithRetry(
      url,
      {
        method: "POST",
        headers,
        body: serializeGatewayCancelPayload(input),
      },
      {},
    );
  }

  async healthCheck(): Promise<GatewayHealthResponse> {
    const url = `${this.baseUrl}${OPENCLAW_GATEWAY_HTTP_PATHS.health}`;
    const res = await this.fetchWithRetry(url, { method: "GET" }, {});
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (err) {
      throw new GatewayInvalidResponseError("Health check returned non-JSON", err);
    }
    try {
      return GatewayHealthResponseSchema.parse(body);
    } catch (err) {
      throw new GatewayInvalidResponseError(
        "Gateway health response failed schema validation",
        err,
      );
    }
  }

  private async postInvoke(
    body: GatewayInitialInvokeRequest | GatewayResumeInvokeRequest,
    sessionToken: string,
    traceId: string,
    invocationOpts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse> {
    const url = `${this.baseUrl}${OPENCLAW_GATEWAY_HTTP_PATHS.invoke}`;
    const headers = buildOpenClawGatewayHeaders({ sessionToken, traceId });
    const res = await this.fetchWithRetry(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      { externalSignal: invocationOpts?.signal },
    );
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      throw new GatewayInvalidResponseError("Gateway returned non-JSON body", err);
    }
    let parsed: GatewayInvokeResponse;
    try {
      parsed = GatewayInvokeResponseSchema.parse(json);
    } catch (err) {
      throw new GatewayInvalidResponseError(
        "Gateway invoke response failed schema validation",
        err,
      );
    }
    return mergeGatewayInvokeResponseCorrelation(
      parsed,
      parseGatewayCorrelationHeaders(res.headers),
    );
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    options: { externalSignal?: AbortSignal },
  ): Promise<Response> {
    const { externalSignal } = options;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutController = new AbortController();
        timer = setTimeout(() => timeoutController.abort(), this.fetchTimeoutMs);
        const combined = new AbortController();
        linkAbortToCombined(combined, timeoutController.signal);
        if (externalSignal) {
          linkAbortToCombined(combined, externalSignal);
        }
        const res = await this.fetchFn(url, { ...init, signal: combined.signal });
        clearTimeout(timer);
        assertGatewayHttpOk(res);
        return res;
      } catch (err) {
        if (timer !== undefined) clearTimeout(timer);
        if (externalSignal?.aborted) {
          throw new GatewayInvocationAbortedError();
        }
        if (
          err instanceof GatewayRejectedAuthError ||
          err instanceof GatewayInvalidResponseError ||
          err instanceof GatewayInvocationAbortedError
        ) {
          throw err;
        }
        const retryable =
          (err instanceof Error && err.name === "AbortError") ||
          err instanceof GatewayTransportError ||
          err instanceof TypeError;
        if (!retryable || attempt === this.maxRetries) {
          throw mapFetchFailure(err);
        }
        await sleep(this.retryDelayMs * 2 ** attempt);
      }
    }
    throw new GatewayTransportError("Gateway unreachable");
  }
}
