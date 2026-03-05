import type { EnrichmentMapping } from "./types.js";

/**
 * Default enrichment mappings between known cartridge pairs.
 * Each mapping specifies how to find the source entity from the target's parameters.
 */
export const DEFAULT_ENRICHMENT_MAPPINGS: EnrichmentMapping[] = [
  // customer-engagement ← crm
  {
    targetCartridgeId: "customer-engagement",
    sourceCartridgeId: "crm",
    targetEntityParam: "contactId",
    sourceEntityType: "contact",
    enrichmentHint: "contactName,dealCount,totalDealValue",
    enabled: true,
  },
  // customer-engagement ← payments
  {
    targetCartridgeId: "customer-engagement",
    sourceCartridgeId: "payments",
    targetEntityParam: "contactId",
    sourceEntityType: "customer",
    enrichmentHint: "hasOpenDispute,totalLifetimeSpend",
    enabled: true,
  },
  // payments ← crm
  {
    targetCartridgeId: "payments",
    sourceCartridgeId: "crm",
    targetEntityParam: "entityId",
    sourceEntityType: "contact",
    enrichmentHint: "contactName,contactCompany",
    enabled: true,
  },
  // payments ← customer-engagement
  {
    targetCartridgeId: "payments",
    sourceCartridgeId: "customer-engagement",
    targetEntityParam: "entityId",
    sourceEntityType: "contact",
    enrichmentHint: "journeyStage",
    enabled: true,
  },
  // crm ← payments
  {
    targetCartridgeId: "crm",
    sourceCartridgeId: "payments",
    targetEntityParam: "contactId",
    sourceEntityType: "customer",
    enrichmentHint: "hasOpenDispute,totalLifetimeSpend",
    enabled: true,
  },
  // crm ← customer-engagement
  {
    targetCartridgeId: "crm",
    sourceCartridgeId: "customer-engagement",
    targetEntityParam: "contactId",
    sourceEntityType: "contact",
    enrichmentHint: "journeyStage",
    enabled: true,
  },
];
