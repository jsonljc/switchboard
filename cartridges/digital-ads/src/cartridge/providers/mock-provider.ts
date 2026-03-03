// ---------------------------------------------------------------------------
// Mock Provider — for testing
// ---------------------------------------------------------------------------

import type { PlatformClient, PlatformCredentials, PlatformType } from "../../platforms/types.js";
import type {
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  SubEntityBreakdown,
  TimeRange,
} from "../../core/types.js";
import type { PlatformHealth } from "../types.js";
import type { AdPlatformProvider } from "./provider.js";

// ---------------------------------------------------------------------------
// Mock Client
// ---------------------------------------------------------------------------

export class MockPlatformClient implements PlatformClient {
  readonly platform: PlatformType;
  private snapshot: MetricSnapshot;

  constructor(platform: PlatformType, snapshot?: Partial<MetricSnapshot>) {
    this.platform = platform;
    this.snapshot = {
      entityId: snapshot?.entityId ?? "mock_entity",
      entityLevel: snapshot?.entityLevel ?? "account",
      periodStart: snapshot?.periodStart ?? "2024-01-08",
      periodEnd: snapshot?.periodEnd ?? "2024-01-14",
      spend: snapshot?.spend ?? 1000,
      stages: snapshot?.stages ?? {
        impressions: { count: 10000, cost: null },
        clicks: { count: 500, cost: null },
        purchase: { count: 25, cost: 40 },
      },
      topLevel: snapshot?.topLevel ?? {
        ctr: 5,
        cpm: 100,
        cpc: 2,
      },
    };
  }

  async fetchSnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    _funnel: FunnelSchema,
  ): Promise<MetricSnapshot> {
    return {
      ...this.snapshot,
      entityId,
      entityLevel,
      periodStart: timeRange.since,
      periodEnd: timeRange.until,
    };
  }

  async fetchComparisonSnapshots(
    entityId: string,
    entityLevel: EntityLevel,
    current: TimeRange,
    previous: TimeRange,
    funnel: FunnelSchema,
  ): Promise<{ current: MetricSnapshot; previous: MetricSnapshot }> {
    return {
      current: await this.fetchSnapshot(entityId, entityLevel, current, funnel),
      previous: await this.fetchSnapshot(entityId, entityLevel, previous, funnel),
    };
  }

  async fetchSubEntityBreakdowns(
    _entityId: string,
    _entityLevel: EntityLevel,
    _timeRange: TimeRange,
    _funnel: FunnelSchema,
  ): Promise<SubEntityBreakdown[]> {
    return [
      {
        entityId: "adset_001",
        entityLevel: "adset",
        spend: 600,
        conversions: 15,
        daysSinceLastEdit: 5,
        inLearningPhase: false,
        dailyBudget: 100,
      },
      {
        entityId: "adset_002",
        entityLevel: "adset",
        spend: 400,
        conversions: 10,
        daysSinceLastEdit: 2,
        inLearningPhase: true,
        dailyBudget: 80,
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Mock Provider
// ---------------------------------------------------------------------------

export class MockProvider implements AdPlatformProvider {
  readonly platform: PlatformType;
  private mockClient: MockPlatformClient;
  /** Set to true to simulate connection failure */
  shouldFail = false;
  failError = "Mock connection failure";

  constructor(platform: PlatformType, snapshot?: Partial<MetricSnapshot>) {
    this.platform = platform;
    this.mockClient = new MockPlatformClient(platform, snapshot);
  }

  async connect(
    _credentials: PlatformCredentials,
    entityId: string,
  ): Promise<{
    client: PlatformClient;
    accountName: string;
    entityLevels: EntityLevel[];
  }> {
    if (this.shouldFail) {
      throw new Error(this.failError);
    }
    return {
      client: this.mockClient,
      accountName: `Mock ${this.platform} account (${entityId})`,
      entityLevels: ["account", "campaign", "adset"],
    };
  }

  async checkHealth(_credentials: PlatformCredentials, _entityId: string): Promise<PlatformHealth> {
    if (this.shouldFail) {
      return {
        platform: this.platform,
        status: "disconnected",
        latencyMs: 1,
        error: this.failError,
        capabilities: [],
      };
    }
    return {
      platform: this.platform,
      status: "connected",
      latencyMs: 1,
      capabilities: [
        `${this.platform}-commerce`,
        `${this.platform}-leadgen`,
        `${this.platform}-brand`,
      ],
    };
  }

  createClient(_credentials: PlatformCredentials): PlatformClient {
    if (this.shouldFail) {
      throw new Error(this.failError);
    }
    return this.mockClient;
  }
}
