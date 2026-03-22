import type {
  GatewayHealthResponse,
  GatewayInitialInvokeRequest,
  GatewayInvokeResponse,
  GatewayResumeInvokeRequest,
} from "@switchboard/schemas";

/** Optional controls for long-running invoke/resume RPC (worker cancellation). */
export type GatewayInvocationOpts = {
  signal?: AbortSignal;
};

export interface GatewayClient {
  invokeInitial(
    request: GatewayInitialInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse>;
  resume(
    request: GatewayResumeInvokeRequest,
    opts?: GatewayInvocationOpts,
  ): Promise<GatewayInvokeResponse>;
  cancel(input: {
    sessionId: string;
    runId: string;
    sessionToken: string;
    traceId: string;
  }): Promise<void>;
  healthCheck(): Promise<GatewayHealthResponse>;
}
