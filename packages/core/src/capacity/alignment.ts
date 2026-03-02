/**
 * CapacityAligner — links ad spend to appointment availability.
 *
 * Queries calendar availability + ad spend rates to detect misalignment.
 * A full-capacity clinic should not be spending on lead gen.
 */

export interface CapacitySignal {
  /** Available appointment slots in the next 7 days */
  availableSlots: number;
  /** Current daily ad spend rate (USD) */
  currentSpendRate: number;
  /** Whether capacity and spend are aligned */
  aligned: boolean;
  /** Recommendation */
  recommendation: "maintain" | "reduce_spend" | "increase_spend" | "pause_ads";
  /** Explanation */
  explanation: string;
  /** Timestamp of analysis */
  analyzedAt: string;
}

export interface CapacityDataSource {
  /** Get available appointment slots for a time range */
  getAvailableSlots(organizationId: string, days: number): Promise<number>;
  /** Get current daily ad spend */
  getCurrentDailySpend(organizationId: string): Promise<number>;
}

export class CapacityAligner {
  private dataSource: CapacityDataSource;

  /** Thresholds for capacity alignment */
  private static readonly LOW_CAPACITY_THRESHOLD = 3;     // slots
  private static readonly HIGH_CAPACITY_THRESHOLD = 20;    // slots
  private static readonly HIGH_SPEND_THRESHOLD = 100;      // USD/day

  constructor(dataSource: CapacityDataSource) {
    this.dataSource = dataSource;
  }

  /**
   * Analyze capacity alignment for an organization.
   */
  async analyze(organizationId: string): Promise<CapacitySignal> {
    const [availableSlots, currentSpendRate] = await Promise.all([
      this.dataSource.getAvailableSlots(organizationId, 7),
      this.dataSource.getCurrentDailySpend(organizationId),
    ]);

    let recommendation: CapacitySignal["recommendation"];
    let explanation: string;
    let aligned: boolean;

    if (availableSlots <= CapacityAligner.LOW_CAPACITY_THRESHOLD) {
      if (currentSpendRate > CapacityAligner.HIGH_SPEND_THRESHOLD) {
        recommendation = "pause_ads";
        explanation = `Only ${availableSlots} slots available but spending $${currentSpendRate.toFixed(0)}/day. Pause ads to avoid wasting budget on leads you can't serve.`;
        aligned = false;
      } else if (currentSpendRate > 0) {
        recommendation = "reduce_spend";
        explanation = `Low capacity (${availableSlots} slots). Consider reducing spend from $${currentSpendRate.toFixed(0)}/day.`;
        aligned = false;
      } else {
        recommendation = "maintain";
        explanation = `Low capacity (${availableSlots} slots), ads already paused/off.`;
        aligned = true;
      }
    } else if (availableSlots >= CapacityAligner.HIGH_CAPACITY_THRESHOLD) {
      if (currentSpendRate === 0) {
        recommendation = "increase_spend";
        explanation = `${availableSlots} slots available but no active ad spend. Consider increasing ads to fill capacity.`;
        aligned = false;
      } else {
        recommendation = "maintain";
        explanation = `Good alignment: ${availableSlots} slots available, spending $${currentSpendRate.toFixed(0)}/day.`;
        aligned = true;
      }
    } else {
      recommendation = "maintain";
      explanation = `Moderate capacity (${availableSlots} slots), $${currentSpendRate.toFixed(0)}/day spend. No adjustment needed.`;
      aligned = true;
    }

    return {
      availableSlots,
      currentSpendRate,
      aligned,
      recommendation,
      explanation,
      analyzedAt: new Date().toISOString(),
    };
  }
}
