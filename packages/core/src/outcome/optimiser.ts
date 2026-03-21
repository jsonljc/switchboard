// ---------------------------------------------------------------------------
// Auto-Optimisation Worker — nightly analysis of conversation performance
// ---------------------------------------------------------------------------

import type { OutcomeStore, OptimisationProposal } from "./types.js";
import { OutcomeAggregator } from "./aggregator.js";
import { randomUUID } from "node:crypto";

export interface OptimiserConfig {
  minSampleSize: number;
  autoApplyTimingChanges: boolean;
  requireOwnerApprovalForContent: boolean;
}

const DEFAULT_CONFIG: OptimiserConfig = {
  minSampleSize: 30,
  autoApplyTimingChanges: true,
  requireOwnerApprovalForContent: true,
};

export interface OptimisationResult {
  proposals: OptimisationProposal[];
  autoApplied: OptimisationProposal[];
}

export async function runOptimisationCycle(
  organizationId: string,
  store: OutcomeStore,
  config?: Partial<OptimiserConfig>,
): Promise<OptimisationResult> {
  const opts = { ...DEFAULT_CONFIG, ...config };
  const proposals: OptimisationProposal[] = [];
  const autoApplied: OptimisationProposal[] = [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

  // Analyze response variant performance
  const variantLogs = await store.listVariantLogs({ organizationId, since });
  if (variantLogs.length < opts.minSampleSize) {
    return { proposals, autoApplied };
  }

  const aggregator = new OutcomeAggregator();
  const performance = aggregator.aggregateVariants(variantLogs);

  // Find underperforming variants
  for (const variant of performance) {
    if (variant.totalSent < opts.minSampleSize) continue;

    // If reply rate is below 20%, suggest content change
    if (variant.replyRate < 0.2 && variant.totalSent >= opts.minSampleSize) {
      const proposal: OptimisationProposal = {
        id: `opt_${randomUUID()}`,
        organizationId,
        type: "content",
        description: `Low reply rate (${(variant.replyRate * 100).toFixed(1)}%) for "${variant.primaryMove}" responses`,
        currentValue: `Reply rate: ${(variant.replyRate * 100).toFixed(1)}%`,
        proposedValue: "Review and revise response templates for this move",
        confidence: variant.wilsonLowerBound,
        sampleSize: variant.totalSent,
        status: opts.requireOwnerApprovalForContent ? "pending" : "auto_applied",
        createdAt: new Date(),
      };
      proposals.push(proposal);
    }
  }

  // Analyze outcome distribution
  const events = await store.listEvents({ organizationId, since });
  const totalOutcomes = events.length;
  if (totalOutcomes >= opts.minSampleSize) {
    const booked = events.filter((e) => e.outcomeType === "booked").length;
    const bookingRate = booked / totalOutcomes;

    if (bookingRate < 0.1) {
      proposals.push({
        id: `opt_${randomUUID()}`,
        organizationId,
        type: "ordering",
        description: `Low booking rate (${(bookingRate * 100).toFixed(1)}%). Consider advancing to booking push earlier.`,
        currentValue: `Booking rate: ${(bookingRate * 100).toFixed(1)}%`,
        proposedValue: "Reduce qualification steps before booking push",
        confidence: 0.6,
        sampleSize: totalOutcomes,
        status: "pending",
        createdAt: new Date(),
      });
    }
  }

  return { proposals, autoApplied };
}
