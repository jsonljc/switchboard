// ---------------------------------------------------------------------------
// Entity operations — captureSnapshot, resolveEntity, searchCampaigns
// ---------------------------------------------------------------------------
// These methods handle pre-mutation state capture and entity name resolution
// for the DigitalAdsCartridge. They are extracted from the main class to keep
// the cartridge index file under the 600-line limit.
// ---------------------------------------------------------------------------

import type { CartridgeContext } from "@switchboard/cartridge-sdk";
import type { ResolvedEntity } from "@switchboard/schemas";
import type { MetaAdsWriteProvider, CampaignInfo } from "./types.js";
import { READ_ACTIONS } from "./constants.js";

/**
 * Capture pre-mutation state for write actions so the orchestrator can
 * compare before/after and support undo.
 */
export async function captureSnapshot(
  actionType: string,
  parameters: Record<string, unknown>,
  _context: CartridgeContext,
  writeProvider: MetaAdsWriteProvider | null,
): Promise<Record<string, unknown>> {
  // For write actions, capture entity state before mutation
  if (!READ_ACTIONS.has(actionType) && writeProvider) {
    const campaignId = parameters.campaignId as string | undefined;
    const adSetId = parameters.adSetId as string | undefined;

    if (campaignId) {
      try {
        const campaign = await writeProvider.getCampaign(campaignId);
        return {
          campaignId,
          status: campaign.status,
          dailyBudget: campaign.dailyBudget / 100,
          deliveryStatus: campaign.deliveryStatus,
        };
      } catch {
        return { campaignId, error: "Could not capture pre-mutation state" };
      }
    }

    if (adSetId) {
      try {
        const adSet = await writeProvider.getAdSet(adSetId);
        return {
          adSetId,
          status: adSet.status,
          dailyBudget: adSet.dailyBudget / 100,
          deliveryStatus: adSet.deliveryStatus,
        };
      } catch {
        return { adSetId, error: "Could not capture pre-mutation state" };
      }
    }
  }

  return {};
}

/**
 * Search campaigns via write provider (for entity resolution).
 */
export async function searchCampaigns(
  query: string,
  writeProvider: MetaAdsWriteProvider | null,
): Promise<CampaignInfo[]> {
  if (!writeProvider) return [];
  return writeProvider.searchCampaigns(query);
}

/**
 * Resolve an entity reference (e.g. campaign name) to a concrete entity
 * with confidence scoring and alternative suggestions.
 */
export async function resolveEntity(
  inputRef: string,
  entityType: string,
  _context: Record<string, unknown>,
  writeProvider: MetaAdsWriteProvider | null,
): Promise<ResolvedEntity> {
  if (!writeProvider) {
    return {
      id: "",
      inputRef,
      resolvedType: entityType,
      resolvedId: "",
      resolvedName: "",
      confidence: 0,
      alternatives: [],
      status: "not_found",
    };
  }

  const matches = await writeProvider.searchCampaigns(inputRef);

  if (matches.length === 1) {
    const match = matches[0]!;
    return {
      id: match.id,
      inputRef,
      resolvedType: entityType,
      resolvedId: match.id,
      resolvedName: match.name,
      confidence: 0.95,
      alternatives: [],
      status: "resolved",
    };
  }

  if (matches.length > 1) {
    return {
      id: "",
      inputRef,
      resolvedType: entityType,
      resolvedId: "",
      resolvedName: "",
      confidence: 0.5,
      alternatives: matches.map((m) => ({
        id: m.id,
        name: m.name,
        score: 0.5,
      })),
      status: "ambiguous",
    };
  }

  return {
    id: "",
    inputRef,
    resolvedType: entityType,
    resolvedId: "",
    resolvedName: "",
    confidence: 0,
    alternatives: [],
    status: "not_found",
  };
}
