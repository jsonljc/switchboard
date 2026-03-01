import { describe, it, expect, vi } from "vitest";
import { AbstractPlatformClient } from "../base-client.js";
import type {
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  TimeRange,
} from "../../core/types.js";
import type { PlatformType } from "../types.js";

// ---------------------------------------------------------------------------
// Concrete stub so we can test the abstract base class
// ---------------------------------------------------------------------------

class StubClient extends AbstractPlatformClient {
  readonly platform: PlatformType = "meta";

  fetchSnapshot = vi.fn<
    (
      entityId: string,
      entityLevel: EntityLevel,
      timeRange: TimeRange,
      funnel: FunnelSchema,
    ) => Promise<MetricSnapshot>
  >();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const funnel: FunnelSchema = {
  vertical: "commerce",
  stages: [
    {
      name: "awareness",
      metric: "impressions",
      metricSource: "top_level",
      costMetric: null,
      costMetricSource: null,
    },
  ],
  primaryKPI: "impressions",
  roasMetric: null,
};

const currentRange: TimeRange = { since: "2024-01-08", until: "2024-01-14" };
const previousRange: TimeRange = { since: "2024-01-01", until: "2024-01-07" };

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "123",
    entityLevel: "campaign",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 100,
    stages: { impressions: { count: 1000, cost: null } },
    topLevel: { impressions: 1000, spend: 100 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AbstractPlatformClient", () => {
  describe("fetchComparisonSnapshots", () => {
    it("calls fetchSnapshot with the current and previous time ranges", async () => {
      const client = new StubClient();
      const currentSnap = makeSnapshot({ periodStart: "2024-01-08", periodEnd: "2024-01-14", spend: 200 });
      const previousSnap = makeSnapshot({ periodStart: "2024-01-01", periodEnd: "2024-01-07", spend: 100 });

      client.fetchSnapshot
        .mockResolvedValueOnce(currentSnap)
        .mockResolvedValueOnce(previousSnap);

      await client.fetchComparisonSnapshots(
        "123",
        "campaign",
        currentRange,
        previousRange,
        funnel,
      );

      expect(client.fetchSnapshot).toHaveBeenCalledTimes(2);
      expect(client.fetchSnapshot).toHaveBeenCalledWith("123", "campaign", currentRange, funnel);
      expect(client.fetchSnapshot).toHaveBeenCalledWith("123", "campaign", previousRange, funnel);
    });

    it("runs both calls in parallel via Promise.all", async () => {
      const client = new StubClient();

      // Track the order of resolution to verify parallel execution
      const callOrder: string[] = [];

      client.fetchSnapshot.mockImplementation(async (_id, _level, timeRange) => {
        if (timeRange.since === currentRange.since) {
          // Current call resolves second
          await new Promise((r) => setTimeout(r, 20));
          callOrder.push("current");
        } else {
          // Previous call resolves first
          await new Promise((r) => setTimeout(r, 5));
          callOrder.push("previous");
        }
        return makeSnapshot();
      });

      await client.fetchComparisonSnapshots(
        "123",
        "campaign",
        currentRange,
        previousRange,
        funnel,
      );

      // If calls were sequential, current would resolve first; parallel means previous resolves first
      expect(callOrder).toEqual(["previous", "current"]);
    });

    it("returns { current, previous } correctly", async () => {
      const client = new StubClient();
      const currentSnap = makeSnapshot({ spend: 200 });
      const previousSnap = makeSnapshot({ spend: 100 });

      client.fetchSnapshot
        .mockResolvedValueOnce(currentSnap)
        .mockResolvedValueOnce(previousSnap);

      const result = await client.fetchComparisonSnapshots(
        "123",
        "campaign",
        currentRange,
        previousRange,
        funnel,
      );

      expect(result.current).toBe(currentSnap);
      expect(result.previous).toBe(previousSnap);
    });
  });
});
