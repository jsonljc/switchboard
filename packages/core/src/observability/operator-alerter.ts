export type InfrastructureErrorType =
  | "governance_eval_exception"
  | "trace_persist_failed"
  | "execution_exception"
  | "work_trace_locked_violation"
  | "work_trace_integrity_mismatch"
  | "work_trace_integrity_missing_anchor"
  | "integrity_check_unavailable"
  | "async_job_retry_exhausted"
  // EV-2 / SPINE-2: the stranded-claim reaper aged ≥1 orphaned `running` idempotency
  // claim to the `needs_reconciliation` dead-letter sink. Always surfaced (never a
  // silent block); severity escalates to critical when a reap-write itself failed.
  | "stranded_claim_reaped"
  // A8b-2 / rank-18: the stalled-booking reaper aged >=1 booking stranded in
  // `pending_confirmation` to `failed`, releasing the slot it blocked. Always surfaced;
  // severity escalates to critical when a reap-write itself failed.
  | "stalled_booking_reaped";

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
  source: "platform_ingress" | "inngest_function";
}

export interface OperatorAlerter {
  alert(payload: InfrastructureFailureAlert): Promise<void>;
}

export class NoopOperatorAlerter implements OperatorAlerter {
  async alert(payload: InfrastructureFailureAlert): Promise<void> {
    // No webhook configured (OPERATOR_ALERT_WEBHOOK_URL unset). The alert cannot
    // be delivered, but log it at error level so a misconfigured prod is at
    // least visible in host logs instead of being fully silent (D9-F1). Wiring
    // the webhook so alerts become actionable is a separate ops leg.
    console.error(
      `[OperatorAlerter] no webhook configured; operator alert dropped: ${payload.errorType} (${payload.severity}): ${payload.errorMessage}`,
    );
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
