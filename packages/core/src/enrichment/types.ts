export interface CrossCartridgeContext {
  [cartridgeId: string]: {
    _available: boolean;
    _error?: string;
    [key: string]: unknown;
  };
}

export interface EnrichmentMapping {
  targetCartridgeId: string;
  sourceCartridgeId: string;
  targetEntityParam: string;
  sourceEntityType: string;
  enrichmentHint: string;
  enabled: boolean;
}

export interface CrossCartridgeEnricher {
  enrich(params: {
    targetCartridgeId: string;
    actionType: string;
    parameters: Record<string, unknown>;
    organizationId: string;
    principalId: string;
  }): Promise<CrossCartridgeContext>;
}
