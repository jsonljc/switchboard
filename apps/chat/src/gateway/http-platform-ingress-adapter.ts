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
        console.error(`[HttpPlatformIngress] API error ${response.status}: ${text}`);
        return {
          ok: false,
          error: {
            type: "validation_failed",
            message: `API server returned ${response.status}`,
            intent: request.intent,
          },
        };
      }

      return (await response.json()) as SubmitWorkResponse;
    } catch (err) {
      console.error("[HttpPlatformIngress] Network error:", err);
      return {
        ok: false,
        error: {
          type: "validation_failed",
          message: err instanceof Error ? err.message : "Unknown network error",
          intent: request.intent,
        },
      };
    }
  }
}
