// apps/api/src/services/notifications/send-email.ts
// ---------------------------------------------------------------------------
// A minimal, injectable email-send port. The delivery service depends on the
// `EmailSender` type, never on Resend directly, so it is unit-testable with a
// fake sender. The Resend-backed implementation imports the SDK lazily (mirrors
// email-escalation-notifier.ts) and NEVER throws: a missing key returns
// `not_configured`; a send failure returns `send_error`. The caller decides
// whether either is a hard failure.
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  ok: boolean;
  reason?: string;
}

export type EmailSender = (msg: EmailMessage) => Promise<EmailSendResult>;

export function createResendEmailSender(cfg: { apiKey?: string; from: string }): EmailSender {
  return async (msg: EmailMessage): Promise<EmailSendResult> => {
    if (!cfg.apiKey) {
      // No key: do not import the SDK, do not throw. The delivery handler maps
      // this to a soft "not configured" outcome (the deploy is dark by design
      // until RESEND_API_KEY is set).
      return { ok: false, reason: "not_configured" };
    }
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(cfg.apiKey);
      await resend.emails.send({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      return { ok: true };
    } catch (err) {
      // Swallow the provider error (it may carry a recipient address); surface a
      // stable reason. The caller logs and records a failed WorkTrace.
      console.error(
        `[send-email] Resend send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: "send_error" };
    }
  };
}
