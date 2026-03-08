// ---------------------------------------------------------------------------
// Shared agent utilities — DRY helpers used across all AdsAgent implementations
// ---------------------------------------------------------------------------

import type { AgentContext } from "./types.js";

/** Standard campaign shape returned by snapshot fetches. */
export interface SnapshotCampaign {
  id: string;
  name: string;
  metrics: Record<string, number>;
  budget: number;
  status: string;
}

/**
 * Fetch campaign snapshots for all ad accounts in the operator config.
 *
 * Proposes `digital-ads.snapshot.fetch` through governance, executes on approval,
 * and aggregates campaign data across all accounts.
 *
 * @returns campaigns and per-account action log entries
 */
export async function fetchAccountSnapshots(
  ctx: AgentContext,
  agentName: string,
): Promise<{
  campaigns: SnapshotCampaign[];
  actions: Array<{ actionType: string; outcome: string }>;
}> {
  const { config, orchestrator } = ctx;
  const campaigns: SnapshotCampaign[] = [];
  const actions: Array<{ actionType: string; outcome: string }> = [];

  for (const accountId of config.adAccountIds) {
    try {
      const proposeResult = await orchestrator.resolveAndPropose({
        actionType: "digital-ads.snapshot.fetch",
        parameters: { adAccountId: accountId },
        principalId: config.principalId,
        cartridgeId: "digital-ads",
        entityRefs: [],
        message: `Agent ${agentName}: fetch snapshot for ${accountId}`,
        organizationId: config.organizationId,
      });

      if ("denied" in proposeResult && !proposeResult.denied && proposeResult.envelope) {
        const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
        if (execResult.success && execResult.data) {
          const snapCampaigns = execResult.data as SnapshotCampaign[];
          campaigns.push(...snapCampaigns);
        }
        actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "fetched" });
      } else {
        actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "denied" });
      }
    } catch {
      actions.push({ actionType: "digital-ads.snapshot.fetch", outcome: "error" });
    }
  }

  return { campaigns, actions };
}
