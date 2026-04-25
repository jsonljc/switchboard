import type { ApprovalNotifier, ApprovalNotification } from "@switchboard/core/notifications";

export interface EmailEscalationConfig {
  resendApiKey: string;
  fromAddress: string;
  dashboardBaseUrl: string;
}

export class EmailEscalationNotifier implements ApprovalNotifier {
  private config: EmailEscalationConfig;

  constructor(config: EmailEscalationConfig) {
    this.config = config;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const { approvers } = notification;
    if (approvers.length === 0) return;

    const { Resend } = await import("resend");
    const resend = new Resend(this.config.resendApiKey);

    const subject = `[Escalation] ${notification.riskCategory.toUpperCase()}: ${notification.summary}`;
    const html = this.buildEmailHtml(notification);

    await Promise.allSettled(
      approvers.map((approverEmail) =>
        resend.emails
          .send({
            from: this.config.fromAddress,
            to: approverEmail,
            subject,
            html,
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[email-escalation] Failed to send to ${approverEmail}: ${msg}`);
          }),
      ),
    );
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
