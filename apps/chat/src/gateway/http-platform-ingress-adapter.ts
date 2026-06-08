import type { CanonicalSubmitRequest, SubmitWorkResponse } from "@switchboard/core/platform";

export class HttpPlatformIngressAdapter {
  private readonly baseUrl: string;
  private readonly internalSecret: string | undefined;

  constructor(baseUrl: string, internalSecret?: string) {
    this.baseUrl = baseUrl;
    this.internalSecret = internalSecret;
  }

  // Posts the canonical request to the API's internal ingress hop
  // (POST /api/internal/ingress/submit), authenticated by INTERNAL_API_SECRET: the chat
  // service is a trusted internal caller, and organizationId is the chat-resolved org
  // carried in the body and honored server-side. The `deployment: DeploymentContext` field
  // is resolved server-side after the HTTP hop, so callers here cannot supply it (F-15).
  async submit(request: CanonicalSubmitRequest): Promise<SubmitWorkResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.internalSecret) {
      headers["Authorization"] = `Bearer ${this.internalSecret}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/internal/ingress/submit`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const text = await response.text();
        const isClientError = response.status >= 400 && response.status < 500;
        console.error(`[HttpPlatformIngress] API error ${response.status}: ${text}`);
        return {
          ok: false,
          error: {
            type: isClientError ? "validation_failed" : "upstream_error",
            message: `API server returned ${response.status}`,
            intent: request.intent,
            retryable: !isClientError,
          },
        };
      }

      return (await response.json()) as SubmitWorkResponse;
    } catch (err) {
      console.error("[HttpPlatformIngress] Network error:", err);
      return {
        ok: false,
        error: {
          type: "network_error",
          message: err instanceof Error ? err.message : "Unknown network error",
          intent: request.intent,
          retryable: true,
        },
      };
    }
  }
}
