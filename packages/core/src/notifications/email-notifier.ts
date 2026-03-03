import type { ApprovalNotifier, ApprovalNotification } from "./notifier.js";

/**
 * EmailApprovalNotifier — sends approval requests via SMTP.
 */
export class EmailApprovalNotifier implements ApprovalNotifier {
  private smtpHost: string;
  private smtpPort: number;
  private fromAddress: string;
  private toAddresses: string[];
  private secure: boolean;
  private auth?: { user: string; pass: string };

  constructor(config: {
    smtpHost: string;
    smtpPort?: number;
    fromAddress: string;
    toAddresses: string[];
    secure?: boolean;
    auth?: { user: string; pass: string };
  }) {
    this.smtpHost = config.smtpHost;
    this.smtpPort = config.smtpPort ?? (config.secure ? 465 : 587);
    this.fromAddress = config.fromAddress;
    this.toAddresses = config.toAddresses;
    this.secure = config.secure ?? false;
    this.auth = config.auth;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const subject = `[Switchboard] Approval Required: ${notification.summary}`;
    const body = this.buildEmailBody(notification);

    // Use nodemailer-compatible SMTP via net.Socket for minimal dependencies
    const net = await import("node:net");
    const tls = await import("node:tls");

    const socket = this.secure
      ? tls.connect({ host: this.smtpHost, port: this.smtpPort })
      : net.createConnection({ host: this.smtpHost, port: this.smtpPort });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("SMTP connection timeout"));
      }, 10_000);

      const commands: string[] = [];
      let step = 0;

      // Build SMTP command sequence
      commands.push(`EHLO switchboard\r\n`);
      if (this.auth) {
        commands.push(`AUTH LOGIN\r\n`);
        commands.push(`${Buffer.from(this.auth.user).toString("base64")}\r\n`);
        commands.push(`${Buffer.from(this.auth.pass).toString("base64")}\r\n`);
      }
      commands.push(`MAIL FROM:<${this.fromAddress}>\r\n`);
      for (const to of this.toAddresses) {
        commands.push(`RCPT TO:<${to}>\r\n`);
      }
      commands.push(`DATA\r\n`);
      commands.push(
        `From: ${this.fromAddress}\r\n` +
          `To: ${this.toAddresses.join(", ")}\r\n` +
          `Subject: ${subject}\r\n` +
          `Content-Type: text/plain; charset=utf-8\r\n` +
          `\r\n` +
          `${body}\r\n.\r\n`,
      );
      commands.push(`QUIT\r\n`);

      socket.on("data", () => {
        if (step < commands.length) {
          socket.write(commands[step]!);
          step++;
        }
      });

      socket.on("end", () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        console.error("[EmailNotifier] SMTP error:", err.message);
        reject(err);
      });
    });
  }

  private buildEmailBody(notification: ApprovalNotification): string {
    return [
      `Approval Required`,
      `=================`,
      ``,
      `Summary: ${notification.summary}`,
      `Risk Category: ${notification.riskCategory}`,
      `Explanation: ${notification.explanation}`,
      ``,
      `Approval ID: ${notification.approvalId}`,
      `Envelope ID: ${notification.envelopeId}`,
      `Binding Hash: ${notification.bindingHash}`,
      `Expires: ${notification.expiresAt.toISOString()}`,
      ``,
      `Approvers: ${notification.approvers.join(", ")}`,
      ``,
      `To approve or reject, use the Switchboard dashboard or reply to the appropriate channel.`,
    ].join("\n");
  }
}
