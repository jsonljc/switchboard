import type { SubmitWorkRequest, SubmitWorkResponse } from "@switchboard/core/platform";

export class HttpPlatformIngressAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async submit(request: SubmitWorkRequest): Promise<SubmitWorkResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/ingress/submit`, {
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
