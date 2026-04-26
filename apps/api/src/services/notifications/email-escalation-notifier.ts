import type { ApprovalNotifier, ApprovalNotification } from "@switchboard/core/notifications";

export interface EmailEscalationConfig {
  resendApiKey: string;
  fromAddress: string;
  dashboardBaseUrl: string;
}

export interface DeliveryResult {
  recipient: string;
  status: "delivered" | "failed";
  error?: string;
  attempts: number;
}

export class EmailEscalationNotifier implements ApprovalNotifier {
  private config: EmailEscalationConfig;
  /** Last notification's delivery results — exposed for testing and auditing. */
  lastDeliveryResults: DeliveryResult[] = [];

  constructor(config: EmailEscalationConfig) {
    this.config = config;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const { approvers } = notification;
    if (approvers.length === 0) {
      this.lastDeliveryResults = [];
      return;
    }

    const { Resend } = await import("resend");
    const resend = new Resend(this.config.resendApiKey);

    const subject = `[Escalation] ${notification.riskCategory.toUpperCase()}: ${notification.summary}`;
    const html = this.buildEmailHtml(notification);

    this.lastDeliveryResults = await Promise.all(
      approvers.map(async (approverEmail) => {
        return this.sendWithRetry(resend, approverEmail, subject, html);
      }),
    );
  }

  private async sendWithRetry(
    resend: { emails: { send: (args: Record<string, string>) => Promise<unknown> } },
    to: string,
    subject: string,
    html: string,
    attempt = 1,
  ): Promise<DeliveryResult> {
    try {
      await resend.emails.send({
        from: this.config.fromAddress,
        to,
        subject,
        html,
      });
      return { recipient: to, status: "delivered", attempts: attempt };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        return this.sendWithRetry(resend, to, subject, html, attempt + 1);
      }
      console.error(
        `[email-escalation] Failed to send to ${to} after ${attempt} attempts: ${msg}`,
      );
      return { recipient: to, status: "failed", error: msg, attempts: attempt };
    }
  }

  private buildEmailHtml(n: ApprovalNotification): string {
    const expiresIn = Math.round((n.expiresAt.getTime() - Date.now()) / 60000);
    const escalationUrl = `${this.config.dashboardBaseUrl}/escalations/${n.approvalId}`;

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px;">
        <h2 style="color: #1A1714; margin-bottom: 8px;">Escalation: ${this.escapeHtml(n.summary)}</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px 0; color: #7A736C; width: 120px;">Risk Level</td>
            <td style="padding: 8px 0; font-weight: 600;">${this.escapeHtml(n.riskCategory.toUpperCase())}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #7A736C;">Reason</td>
            <td style="padding: 8px 0;">${this.escapeHtml(n.explanation)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #7A736C;">Envelope</td>
            <td style="padding: 8px 0; font-family: monospace;">${this.escapeHtml(n.envelopeId)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #7A736C;">Expires in</td>
            <td style="padding: 8px 0;">${expiresIn} minutes</td>
          </tr>
        </table>
        <div style="margin-top: 24px;">
          <a href="${escalationUrl}" style="display: inline-block; padding: 12px 32px; background: #A07850; color: #ffffff; text-decoration: none; border-radius: 9999px; font-weight: 600; font-size: 15px;">
            View in Dashboard
          </a>
        </div>
        <p style="color: #7A736C; font-size: 13px; margin-top: 32px;">
          This escalation requires action within ${expiresIn} minutes.
        </p>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
