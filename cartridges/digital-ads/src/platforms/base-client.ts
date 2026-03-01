import type {
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  TimeRange,
} from "../core/types.js";
import type { PlatformClient, PlatformType } from "./types.js";

// ---------------------------------------------------------------------------
// Abstract base class for platform clients
// ---------------------------------------------------------------------------
// Provides a shared fetchComparisonSnapshots implementation (Promise.all).
// Subclasses only need to implement fetchSnapshot().
// ---------------------------------------------------------------------------

export abstract class AbstractPlatformClient implements PlatformClient {
  abstract readonly platform: PlatformType;

  abstract fetchSnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema
  ): Promise<MetricSnapshot>;

  async fetchComparisonSnapshots(
    entityId: string,
    entityLevel: EntityLevel,
    current: TimeRange,
    previous: TimeRange,
    funnel: FunnelSchema
  ): Promise<{ current: MetricSnapshot; previous: MetricSnapshot }> {
    const [currentSnap, previousSnap] = await Promise.all([
      this.fetchSnapshot(entityId, entityLevel, current, funnel),
      this.fetchSnapshot(entityId, entityLevel, previous, funnel),
    ]);
    return { current: currentSnap, previous: previousSnap };
  }
}
