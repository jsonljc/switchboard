// ---------------------------------------------------------------------------
// Silence Detector — flags conversations with 72h+ inactivity as unresponsive
// ---------------------------------------------------------------------------

import type { OutcomePipeline } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";

const SILENCE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours

export interface SilenceDetectorConfig {
  prisma: PrismaClient;
  outcomePipeline: OutcomePipeline;
  thresholdMs?: number;
}

export async function detectSilentConversations(config: SilenceDetectorConfig): Promise<number> {
  const { prisma, outcomePipeline, thresholdMs = SILENCE_THRESHOLD_MS } = config;
  const cutoff = new Date(Date.now() - thresholdMs);

  const silentConversations = await prisma.conversationState.findMany({
    where: {
      status: "active",
      lastInboundAt: { lt: cutoff },
    },
    select: { threadId: true, organizationId: true },
  });

  let emitted = 0;
  for (const conv of silentConversations) {
    if (!conv.organizationId) continue;
    try {
      await outcomePipeline.emitOutcome({
        sessionId: conv.threadId,
        organizationId: conv.organizationId,
        outcomeType: "unresponsive",
        metadata: { detectedBy: "silence_detector" },
      });
      await prisma.conversationState.update({
        where: { threadId: conv.threadId },
        data: { status: "completed" },
      });
      emitted++;
    } catch {
      // Non-critical — continue to next
    }
  }
  return emitted;
}

export function startSilenceDetector(
  config: SilenceDetectorConfig & { intervalMs?: number },
): () => void {
  const { intervalMs = 60 * 60 * 1000 } = config; // Default: every hour

  const timer = setInterval(() => {
    detectSilentConversations(config).catch((err) =>
      console.error("[SilenceDetector] Error:", err),
    );
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
