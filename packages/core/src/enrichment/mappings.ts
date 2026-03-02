import type { EnrichmentMapping } from "./types.js";

/**
 * Default enrichment mappings between known cartridge pairs.
 * Each mapping specifies how to find the source entity from the target's parameters.
 */
export const DEFAULT_ENRICHMENT_MAPPINGS: EnrichmentMapping[] = [
  // patient-engagement ← crm
  {
    targetCartridgeId: "patient-engagement",
    sourceCartridgeId: "crm",
    targetEntityParam: "patientId",
    sourceEntityType: "contact",
    enrichmentHint: "contactName,dealCount,totalDealValue",
    enabled: true,
  },
  // patient-engagement ← payments
  {
    targetCartridgeId: "patient-engagement",
    sourceCartridgeId: "payments",
    targetEntityParam: "patientId",
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
  // payments ← patient-engagement
  {
    targetCartridgeId: "payments",
    sourceCartridgeId: "patient-engagement",
    targetEntityParam: "entityId",
    sourceEntityType: "patient",
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
  // crm ← patient-engagement
  {
    targetCartridgeId: "crm",
    sourceCartridgeId: "patient-engagement",
    targetEntityParam: "contactId",
    sourceEntityType: "patient",
    enrichmentHint: "journeyStage",
    enabled: true,
  },
];
