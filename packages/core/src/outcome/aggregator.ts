// ---------------------------------------------------------------------------
// Outcome Aggregator — computes per-variant and per-template performance
// ---------------------------------------------------------------------------

import type { ResponseVariantLog } from "@switchboard/schemas";

export interface VariantPerformance {
  primaryMove: string;
  templateId?: string;
  totalSent: number;
  repliesReceived: number;
  positiveReplies: number;
  replyRate: number;
  positiveRate: number;
  wilsonLowerBound: number;
}

/** Wilson score interval lower bound (95% confidence). */
function wilsonLowerBound(successes: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.96; // 95% confidence
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (center - spread) / denominator);
}

export class OutcomeAggregator {
  aggregateVariants(logs: ResponseVariantLog[]): VariantPerformance[] {
    const groups = new Map<string, ResponseVariantLog[]>();

    for (const log of logs) {
      const key = `${log.primaryMove}::${log.templateId ?? "none"}`;
      const existing = groups.get(key) ?? [];
      existing.push(log);
      groups.set(key, existing);
    }

    const results: VariantPerformance[] = [];

    for (const [_key, groupLogs] of groups) {
      const totalSent = groupLogs.length;
      const repliesReceived = groupLogs.filter((l) => l.leadReplyReceived).length;
      const positiveReplies = groupLogs.filter((l) => l.leadReplyPositive).length;

      results.push({
        primaryMove: groupLogs[0]!.primaryMove,
        templateId: groupLogs[0]!.templateId ?? undefined,
        totalSent,
        repliesReceived,
        positiveReplies,
        replyRate: totalSent > 0 ? repliesReceived / totalSent : 0,
        positiveRate: repliesReceived > 0 ? positiveReplies / repliesReceived : 0,
        wilsonLowerBound: wilsonLowerBound(positiveReplies, repliesReceived),
      });
    }

    return results.sort((a, b) => b.wilsonLowerBound - a.wilsonLowerBound);
  }
}
