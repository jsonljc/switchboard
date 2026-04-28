import type { PrismaClient } from "@switchboard/db";
import { PrismaConnectionStore } from "@switchboard/db";
import { sendHealthCheckAlert } from "./alert-webhook.js";

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type NextStatus = "active" | "error";

async function updateAndAlert(
  prisma: PrismaClient,
  channelId: string,
  channelType: string,
  previousStatus: string,
  nextStatus: NextStatus,
  statusDetail: string | null,
): Promise<void> {
  await prisma.managedChannel.update({
    where: { id: channelId },
    data: { status: nextStatus, statusDetail, lastHealthCheck: new Date() },
  });

  const wasError = previousStatus === "error";
  const nowError = nextStatus === "error";
  if (!wasError && nowError) {
    void sendHealthCheckAlert("failure", {
      channel: channelType,
      channelId,
      statusDetail,
    });
  } else if (wasError && !nowError) {
    void sendHealthCheckAlert("recovery", {
      channel: channelType,
      channelId,
    });
  }
}

/**
 * Run a single pass of the health check across all candidate managed channels.
 * Exported for tests; the long-running scheduler calls this on an interval.
 */
export async function runHealthCheck(prisma: PrismaClient): Promise<void> {
  const connectionStore = new PrismaConnectionStore(prisma);
  try {
    const channels = await prisma.managedChannel.findMany({
      where: { status: { in: ["active", "error", "provisioning"] } },
    });

    for (const channel of channels) {
      try {
        const previousStatus = channel.status;
        const connection = await connectionStore.getById(channel.connectionId);
        if (!connection) {
          await updateAndAlert(
            prisma,
            channel.id,
            channel.channel,
            previousStatus,
            "error",
            "Connection not found",
          );
          continue;
        }

        let healthy = false;
        if (channel.channel === "telegram") {
          const botToken = connection.credentials["botToken"] as string;
          if (!botToken) {
            await updateAndAlert(
              prisma,
              channel.id,
              channel.channel,
              previousStatus,
              "error",
              "Missing bot token",
            );
            continue;
          }
          healthy = await checkTelegram(botToken);
        } else if (channel.channel === "slack") {
          const botToken = connection.credentials["botToken"] as string;
          if (!botToken) {
            await updateAndAlert(
              prisma,
              channel.id,
              channel.channel,
              previousStatus,
              "error",
              "Missing bot token",
            );
            continue;
          }
          healthy = await checkSlack(botToken);
        } else if (channel.channel === "whatsapp") {
          const token = connection.credentials["token"] as string;
          const phoneNumberId = connection.credentials["phoneNumberId"] as string;
          if (!token || !phoneNumberId) {
            await updateAndAlert(
              prisma,
              channel.id,
              channel.channel,
              previousStatus,
              "error",
              "Missing WhatsApp credentials",
            );
            continue;
          }
          healthy = await checkWhatsApp(token, phoneNumberId);
        }

        await updateAndAlert(
          prisma,
          channel.id,
          channel.channel,
          previousStatus,
          healthy ? "active" : "error",
          healthy ? null : "Health check failed",
        );
      } catch (err) {
        console.error(`[HealthChecker] Error checking channel ${channel.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[HealthChecker] Error during health check run:", err);
  }
}

/**
 * Start a background health checker that periodically validates managed bot tokens.
 * Returns a cleanup function for graceful shutdown.
 */
export function startHealthChecker(prisma: PrismaClient): () => void {
  const timer = setInterval(() => void runHealthCheck(prisma), HEALTH_CHECK_INTERVAL_MS);
  setTimeout(() => void runHealthCheck(prisma), 10_000);
  return () => {
    clearInterval(timer);
  };
}

async function checkTelegram(botToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

async function checkSlack(botToken: string): Promise<boolean> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

async function checkWhatsApp(token: string, phoneNumberId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
