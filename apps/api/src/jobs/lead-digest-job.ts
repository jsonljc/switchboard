// ---------------------------------------------------------------------------
// Lead Digest Job — Weekly performance digest sent to business owners
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import type { AgentNotifier } from "@switchboard/core";

export interface LeadDigestJobConfig {
  prisma: import("@switchboard/db").PrismaClient;
  redis?: import("ioredis").default;
  notifier: AgentNotifier;
  intervalMs?: number;
  logger?: Logger;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export function startLeadDigestJob(config: LeadDigestJobConfig): () => void {
  const {
    prisma,
    redis,
    notifier,
    intervalMs = ONE_HOUR_MS,
    logger = createLogger("lead-digest"),
  } = config;

  let stopped = false;
  let lastFiredWeek = -1;

  const run = async () => {
    if (stopped) return;

    const now = new Date();
    // Fire on Monday between 01:00-01:59 UTC (~9am SGT)
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 1) return;

    // Prevent re-firing in the same week
    const weekNumber = getISOWeekNumber(now);
    if (weekNumber === lastFiredWeek) return;
    lastFiredWeek = weekNumber;

    try {
      const { generateWeeklyDigest } = await import("../services/lead-digest.js");

      // Find all active operator configs — they have the notification channel
      const configs = await prisma.adsOperatorConfig.findMany({
        where: { active: true },
        select: {
          organizationId: true,
          notificationChannel: true,
        },
      });

      for (const cfg of configs) {
        try {
          const channel = cfg.notificationChannel as { chatId?: string; type?: string } | null;
          if (!channel?.chatId || !channel?.type) continue;

          const digest = await generateWeeklyDigest({
            prisma,
            redis,
            organizationId: cfg.organizationId,
          });

          await notifier.sendProactive(channel.chatId, channel.type, digest.formattedMessage);

          logger.info({ organizationId: cfg.organizationId }, "Weekly digest sent");
        } catch (err) {
          logger.error({ err, organizationId: cfg.organizationId }, "Failed to send digest");
        }
      }
    } catch (err) {
      logger.error({ err }, "Lead digest job failed");
    }
  };

  const timer = setInterval(() => {
    run().catch((err) => logger.error({ err }, "Lead digest job error"));
  }, intervalMs);

  logger.info({ intervalMs }, "Lead digest job started");

  return () => {
    stopped = true;
    clearInterval(timer);
    logger.info("Lead digest job stopped");
  };
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
