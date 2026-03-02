/**
 * AttributionTracker — links ad click → lead → appointment → treatment → revenue.
 *
 * Subscribes to domain events and builds attribution paths
 * for calculating ROAS, LTV, and channel effectiveness.
 */

export interface AttributionEvent {
  id: string;
  type: "ad_click" | "lead_captured" | "appointment_booked" | "treatment_completed" | "payment_received";
  /** Entity ID (e.g., lead ID, appointment ID) */
  entityId: string;
  /** Source channel (e.g., "meta", "google", "organic") */
  channel: string;
  /** Campaign ID if applicable */
  campaignId?: string;
  /** Revenue amount if applicable (in cents) */
  revenueAmountCents?: number;
  /** Cost amount if applicable (in cents) */
  costAmountCents?: number;
  /** Organization ID */
  organizationId: string;
  /** Timestamp */
  timestamp: Date;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface AttributionPath {
  id: string;
  /** The lead/patient entity that ties the path together */
  entityId: string;
  organizationId: string;
  channel: string;
  campaignId?: string;
  events: AttributionEvent[];
  /** Total revenue from this path (cents) */
  totalRevenueCents: number;
  /** Total cost from this path (cents) */
  totalCostCents: number;
  /** Computed ROAS for this path */
  roas: number | null;
  /** Time from first touch to revenue (ms) */
  timeToRevenue: number | null;
  createdAt: Date;
  lastUpdatedAt: Date;
}

export class AttributionTracker {
  private paths = new Map<string, AttributionPath>();
  private entityToPathId = new Map<string, string>();

  /**
   * Record an attribution event.
   */
  recordEvent(event: AttributionEvent): AttributionPath {
    // Find or create a path for this entity
    let pathId = this.entityToPathId.get(event.entityId);
    let path: AttributionPath;

    if (pathId) {
      path = this.paths.get(pathId)!;
    } else {
      pathId = `apath_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      path = {
        id: pathId,
        entityId: event.entityId,
        organizationId: event.organizationId,
        channel: event.channel,
        campaignId: event.campaignId,
        events: [],
        totalRevenueCents: 0,
        totalCostCents: 0,
        roas: null,
        timeToRevenue: null,
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
      };
      this.paths.set(pathId, path);
      this.entityToPathId.set(event.entityId, pathId);
    }

    // Add event to path
    path.events.push(event);
    path.lastUpdatedAt = new Date();

    // Update financials
    if (event.revenueAmountCents) {
      path.totalRevenueCents += event.revenueAmountCents;
    }
    if (event.costAmountCents) {
      path.totalCostCents += event.costAmountCents;
    }

    // Compute ROAS
    if (path.totalCostCents > 0) {
      path.roas = path.totalRevenueCents / path.totalCostCents;
    }

    // Compute time to revenue
    if (path.totalRevenueCents > 0 && path.events.length >= 2) {
      const firstTouch = path.events[0]!.timestamp.getTime();
      const lastRevenue = path.events
        .filter((e) => e.revenueAmountCents && e.revenueAmountCents > 0)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
      if (lastRevenue) {
        path.timeToRevenue = lastRevenue.timestamp.getTime() - firstTouch;
      }
    }

    return path;
  }

  /**
   * Get attribution path for an entity.
   */
  getPath(entityId: string): AttributionPath | null {
    const pathId = this.entityToPathId.get(entityId);
    if (!pathId) return null;
    return this.paths.get(pathId) ?? null;
  }

  /**
   * Get all paths for an organization.
   */
  getPathsByOrg(organizationId: string): AttributionPath[] {
    return Array.from(this.paths.values()).filter(
      (p) => p.organizationId === organizationId,
    );
  }

  /**
   * Get all paths for a campaign.
   */
  getPathsByCampaign(campaignId: string): AttributionPath[] {
    return Array.from(this.paths.values()).filter(
      (p) => p.campaignId === campaignId,
    );
  }
}
