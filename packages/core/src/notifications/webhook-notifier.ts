import type { ApprovalNotifier, ApprovalNotification } from "./notifier.js";

/**
 * WebhookApprovalNotifier — sends approval requests via HTTP POST to a configurable URL.
 */
export class WebhookApprovalNotifier implements ApprovalNotifier {
  private webhookUrl: string;
  private headers: Record<string, string>;
  private timeoutMs: number;

  constructor(config: {
    webhookUrl: string;
    /** Additional headers (e.g., Authorization) */
    headers?: Record<string, string>;
    /** Request timeout in ms (default: 10000) */
    timeoutMs?: number;
  }) {
    this.webhookUrl = config.webhookUrl;
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const payload = {
      type: "approval_required",
      approvalId: notification.approvalId,
      envelopeId: notification.envelopeId,
      summary: notification.summary,
      riskCategory: notification.riskCategory,
      explanation: notification.explanation,
      bindingHash: notification.bindingHash,
      expiresAt: notification.expiresAt.toISOString(),
      approvers: notification.approvers,
      evidenceBundle: notification.evidenceBundle,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(
          `[WebhookNotifier] Webhook returned ${response.status}: ${response.statusText}`,
        );
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        console.error("[WebhookNotifier] Webhook request timed out");
      } else {
        console.error("[WebhookNotifier] Webhook error:", (err as Error).message);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
