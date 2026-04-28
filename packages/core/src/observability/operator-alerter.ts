export type InfrastructureErrorType = "governance_eval_exception" | "trace_persist_failed";

export interface InfrastructureFailureAlert {
  errorType: InfrastructureErrorType;
  severity: "critical" | "warning";
  errorMessage: string;
  intent?: string;
  traceId?: string;
  deploymentId?: string;
  organizationId?: string;
  retryable: boolean;
  occurredAt: string;
  source: "platform_ingress";
}

export interface OperatorAlerter {
  alert(payload: InfrastructureFailureAlert): Promise<void>;
}

export class NoopOperatorAlerter implements OperatorAlerter {
  async alert(_payload: InfrastructureFailureAlert): Promise<void> {
    // intentional no-op
  }
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 2000;

export async function safeAlert(
  alerter: OperatorAlerter,
  payload: InfrastructureFailureAlert,
): Promise<void> {
  try {
    await alerter.alert(payload);
  } catch (err) {
    console.error("[OperatorAlerter] alert delivery failed", err);
  }
}

export class WebhookOperatorAlerter implements OperatorAlerter {
  private readonly webhookUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: {
    webhookUrl: string;
    headers?: Record<string, string>;
    /** Default 2000ms; range 1500–3000ms acceptable. */
    timeoutMs?: number;
  }) {
    this.webhookUrl = config.webhookUrl;
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  }

  async alert(payload: InfrastructureFailureAlert): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(
          `[OperatorAlerter] webhook returned ${response.status}: ${response.statusText}`,
        );
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        console.error("[OperatorAlerter] webhook request timed out", err);
      } else {
        console.error("[OperatorAlerter] webhook delivery error", err);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
