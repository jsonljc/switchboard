import { withRetry } from "@switchboard/core";
import type { Logger } from "../logger.js";

export interface ProactiveNotification {
  title: string;
  body: string;
  severity: "critical" | "warning" | "info";
  channels: string[];
  recipients: string[];
}

export interface SendResult {
  channel: string;
  recipient: string;
  success: boolean;
  error?: string;
}

interface ChannelCredentials {
  slack?: { botToken: string };
  telegram?: { botToken: string };
  whatsapp?: { token: string; phoneNumberId: string };
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("etimedout") || msg.includes("econnreset") || msg.includes("enotfound")) return true;
  }
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    return status === 429 || (status >= 500 && status <= 503);
  }
  return false;
}

export async function sendProactiveNotification(
  notification: ProactiveNotification,
  credentials: ChannelCredentials,
  logger?: Logger,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (const recipient of notification.recipients) {
    for (const channel of notification.channels) {
      try {
        switch (channel) {
          case "slack":
            if (credentials.slack) {
              await withRetry(
                () => sendSlackMessage(credentials.slack!.botToken, recipient, notification),
                { maxAttempts: 3, shouldRetry: isRetryableError },
              );
              results.push({ channel, recipient, success: true });
            } else {
              results.push({ channel, recipient, success: false, error: "No Slack credentials" });
            }
            break;

          case "telegram":
            if (credentials.telegram) {
              await withRetry(
                () => sendTelegramMessage(credentials.telegram!.botToken, recipient, notification),
                { maxAttempts: 3, shouldRetry: isRetryableError },
              );
              results.push({ channel, recipient, success: true });
            } else {
              results.push({ channel, recipient, success: false, error: "No Telegram credentials" });
            }
            break;

          case "whatsapp":
            if (credentials.whatsapp) {
              await withRetry(
                () => sendWhatsAppMessage(credentials.whatsapp!, recipient, notification),
                { maxAttempts: 3, shouldRetry: isRetryableError },
              );
              results.push({ channel, recipient, success: true });
            } else {
              results.push({ channel, recipient, success: false, error: "No WhatsApp credentials" });
            }
            break;

          default:
            results.push({ channel, recipient, success: false, error: `Unknown channel: ${channel}` });
        }
      } catch (err: any) {
        logger?.error({ err, channel, recipient }, "Failed to send proactive notification");
        results.push({ channel, recipient, success: false, error: err.message });
      }
    }
  }

  return results;
}

const severityEmoji: Record<string, string> = {
  critical: "\u{1F6A8}",
  warning: "\u{1F7E1}",
  info: "\u{2139}\u{FE0F}",
};

async function sendSlackMessage(
  botToken: string,
  channel: string,
  notification: ProactiveNotification,
): Promise<void> {
  const emoji = severityEmoji[notification.severity] ?? "";
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      channel,
      text: `${emoji} ${notification.title}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} ${notification.title}`, emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: notification.body },
        },
      ],
    }),
  });
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  notification: ProactiveNotification,
): Promise<void> {
  const emoji = severityEmoji[notification.severity] ?? "";
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `${emoji} *${notification.title}*\n\n${notification.body}`,
      parse_mode: "Markdown",
    }),
  });
}

async function sendWhatsAppMessage(
  credentials: { token: string; phoneNumberId: string },
  to: string,
  notification: ProactiveNotification,
): Promise<void> {
  const emoji = severityEmoji[notification.severity] ?? "";
  await fetch(
    `https://graph.facebook.com/v18.0/${credentials.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: `${emoji} ${notification.title}\n\n${notification.body}`,
        },
      }),
    },
  );
}
