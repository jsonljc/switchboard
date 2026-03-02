import type { CapacityAligner } from "./alignment.js";
import type { EventBus } from "../event-bus/types.js";

/**
 * Capacity alignment background job.
 * Runs on an interval, checks capacity alignment for each org,
 * and publishes misalignment events to the EventBus.
 */
export function startCapacityAlignmentJob(config: {
  aligner: CapacityAligner;
  eventBus: EventBus;
  organizationIds: string[];
  /** Interval in ms (default: 15 minutes) */
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = config.intervalMs ?? 15 * 60 * 1000;

  const check = async () => {
    for (const orgId of config.organizationIds) {
      try {
        const signal = await config.aligner.analyze(orgId);

        if (!signal.aligned) {
          await config.eventBus.publish({
            id: `cap_evt_${orgId}_${Date.now()}`,
            eventType: "capacity.misaligned",
            sourceCartridgeId: "capacity-aligner",
            organizationId: orgId,
            principalId: "system",
            payload: {
              signal,
            },
            envelopeId: "",
            traceId: `cap_${orgId}_${Date.now()}`,
            emittedAt: new Date(),
          });

          console.log(
            `[CapacityJob] Misalignment detected for org ${orgId}: ${signal.recommendation}`,
          );
        }
      } catch (err) {
        console.error(
          `[CapacityJob] Error checking org ${orgId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  };

  const timer = setInterval(check, intervalMs);
  // Run immediately on start
  check().catch((err) =>
    console.error("[CapacityJob] Initial check error:", err),
  );

  return {
    stop: () => clearInterval(timer),
  };
}
