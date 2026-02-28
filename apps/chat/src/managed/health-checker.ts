import type { PrismaClient } from "@switchboard/db";
import { PrismaConnectionStore } from "@switchboard/db";

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start a background health checker that periodically validates managed bot tokens.
 * Returns a cleanup function for graceful shutdown.
 */
export function startHealthChecker(prisma: PrismaClient): () => void {
  const connectionStore = new PrismaConnectionStore(prisma);

  const checkAll = async () => {
    try {
      const channels = await prisma.managedChannel.findMany({
        where: { status: { in: ["active", "error"] } },
      });

      for (const channel of channels) {
        try {
          const connection = await connectionStore.getById(channel.connectionId);
          if (!connection) {
            await prisma.managedChannel.update({
              where: { id: channel.id },
              data: { status: "error", statusDetail: "Connection not found", lastHealthCheck: new Date() },
            });
            continue;
          }

          const botToken = connection.credentials["botToken"] as string;
          if (!botToken) {
            await prisma.managedChannel.update({
              where: { id: channel.id },
              data: { status: "error", statusDetail: "Missing bot token", lastHealthCheck: new Date() },
            });
            continue;
          }

          let healthy = false;
          if (channel.channel === "telegram") {
            healthy = await checkTelegram(botToken);
          } else if (channel.channel === "slack") {
            healthy = await checkSlack(botToken);
          }

          await prisma.managedChannel.update({
            where: { id: channel.id },
            data: {
              status: healthy ? "active" : "error",
              statusDetail: healthy ? null : "Health check failed",
              lastHealthCheck: new Date(),
            },
          });
        } catch (err) {
          console.error(`[HealthChecker] Error checking channel ${channel.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[HealthChecker] Error during health check run:", err);
    }
  };

  const timer = setInterval(checkAll, HEALTH_CHECK_INTERVAL_MS);

  // Run first check after a short delay
  setTimeout(checkAll, 10_000);

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
