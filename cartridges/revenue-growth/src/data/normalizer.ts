// ---------------------------------------------------------------------------
// Data Normalizer — Collects and normalizes data from multiple sources
// ---------------------------------------------------------------------------
// Consumes digital-ads and CRM data (via CrossCartridgeEnricher patterns)
// to produce a unified NormalizedData object with a DataConfidenceTier.
// ---------------------------------------------------------------------------

import type {
  NormalizedData,
  DataConfidenceTier,
  SignalHealthSummary,
  CreativeAssetSummary,
  CrmSummary,
  AdMetrics,
  FunnelEvent,
  HeadroomSummary,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Connector interface — standardized abstraction for data sources
// ---------------------------------------------------------------------------

export interface CartridgeConnector {
  readonly id: string;
  readonly name: string;
  fetchAdMetrics(accountId: string): Promise<AdMetrics | null>;
  fetchFunnelEvents(accountId: string): Promise<FunnelEvent[]>;
  fetchSignalHealth(accountId: string): Promise<SignalHealthSummary | null>;
  fetchCreativeAssets(accountId: string): Promise<CreativeAssetSummary | null>;
  fetchCrmSummary(accountId: string): Promise<CrmSummary | null>;
  fetchHeadroom(accountId: string): Promise<HeadroomSummary | null>;
}

// ---------------------------------------------------------------------------
// Dependency injection for data collection
// ---------------------------------------------------------------------------

export interface DataCollectionDeps {
  connectors: CartridgeConnector[];
}

// ---------------------------------------------------------------------------
// Mock connector for testing
// ---------------------------------------------------------------------------

export class MockConnector implements CartridgeConnector {
  readonly id = "mock";
  readonly name = "Mock Connector";

  constructor(
    private readonly data: {
      adMetrics?: AdMetrics | null;
      funnelEvents?: FunnelEvent[];
      signalHealth?: SignalHealthSummary | null;
      creativeAssets?: CreativeAssetSummary | null;
      crmSummary?: CrmSummary | null;
      headroom?: HeadroomSummary | null;
    } = {},
  ) {}

  async fetchAdMetrics(_accountId: string): Promise<AdMetrics | null> {
    return this.data.adMetrics ?? null;
  }

  async fetchFunnelEvents(_accountId: string): Promise<FunnelEvent[]> {
    return this.data.funnelEvents ?? [];
  }

  async fetchSignalHealth(_accountId: string): Promise<SignalHealthSummary | null> {
    return this.data.signalHealth ?? null;
  }

  async fetchCreativeAssets(_accountId: string): Promise<CreativeAssetSummary | null> {
    return this.data.creativeAssets ?? null;
  }

  async fetchCrmSummary(_accountId: string): Promise<CrmSummary | null> {
    return this.data.crmSummary ?? null;
  }

  async fetchHeadroom(_accountId: string): Promise<HeadroomSummary | null> {
    return this.data.headroom ?? null;
  }
}

// ---------------------------------------------------------------------------
// collectNormalizedData — Aggregates data from all connectors
// ---------------------------------------------------------------------------

export async function collectNormalizedData(
  accountId: string,
  organizationId: string,
  deps: DataCollectionDeps | null,
): Promise<NormalizedData> {
  const now = new Date().toISOString();

  if (!deps || deps.connectors.length === 0) {
    return {
      accountId,
      organizationId,
      collectedAt: now,
      dataTier: "SPARSE",
      adMetrics: null,
      funnelEvents: [],
      creativeAssets: null,
      crmSummary: null,
      signalHealth: null,
      headroom: null,
    };
  }

  // Collect from all connectors — first non-null wins for each data type
  let adMetrics: AdMetrics | null = null;
  let signalHealth: SignalHealthSummary | null = null;
  let creativeAssets: CreativeAssetSummary | null = null;
  let crmSummary: CrmSummary | null = null;
  let headroom: HeadroomSummary | null = null;
  let funnelEvents: FunnelEvent[] = [];

  for (const connector of deps.connectors) {
    try {
      if (!adMetrics) {
        adMetrics = await connector.fetchAdMetrics(accountId);
      }
      if (!signalHealth) {
        signalHealth = await connector.fetchSignalHealth(accountId);
      }
      if (!creativeAssets) {
        creativeAssets = await connector.fetchCreativeAssets(accountId);
      }
      if (!crmSummary) {
        crmSummary = await connector.fetchCrmSummary(accountId);
      }
      if (!headroom) {
        headroom = await connector.fetchHeadroom(accountId);
      }
      if (funnelEvents.length === 0) {
        funnelEvents = await connector.fetchFunnelEvents(accountId);
      }
    } catch {
      // Non-critical — continue with other connectors
    }
  }

  const dataTier = assignDataConfidenceTier({
    accountId,
    organizationId,
    collectedAt: now,
    dataTier: "SPARSE", // placeholder, will be overwritten
    adMetrics,
    funnelEvents,
    creativeAssets,
    crmSummary,
    signalHealth,
    headroom,
  });

  return {
    accountId,
    organizationId,
    collectedAt: now,
    dataTier,
    adMetrics,
    funnelEvents,
    creativeAssets,
    crmSummary,
    signalHealth,
    headroom,
  };
}

// ---------------------------------------------------------------------------
// assignDataConfidenceTier — Determine data completeness
// ---------------------------------------------------------------------------

export function assignDataConfidenceTier(data: NormalizedData): DataConfidenceTier {
  let sourceCount = 0;

  if (data.adMetrics) sourceCount++;
  if (data.signalHealth) sourceCount++;
  if (data.creativeAssets) sourceCount++;
  if (data.crmSummary) sourceCount++;
  if (data.funnelEvents.length > 0) sourceCount++;
  if (data.headroom) sourceCount++;

  if (sourceCount >= 4) return "FULL";
  if (sourceCount >= 2) return "PARTIAL";
  return "SPARSE";
}
