// ---------------------------------------------------------------------------
// Action: digital-ads.snapshot.fetch
// ---------------------------------------------------------------------------
// Fetches raw metric data without analysis. Useful for exploration or
// custom queries.
// ---------------------------------------------------------------------------

import type { AdPlatformProvider } from "../providers/provider.js";
import type { FetchSnapshotParams, ExecuteResult, SessionState } from "../types.js";
import { resolveFunnel } from "../../platforms/registry.js";

export async function executeFetchSnapshot(
  params: FetchSnapshotParams,
  provider: AdPlatformProvider,
  session: SessionState,
  credentials?: import("../../platforms/types.js").PlatformCredentials,
): Promise<ExecuteResult> {
  const start = Date.now();

  try {
    const creds = credentials ?? session.connections.get(params.platform)?.credentials;
    if (!creds) {
      return {
        success: false,
        summary: `No credentials available for ${params.platform}. Use platform.connect first.`,
        externalRefs: { platform: params.platform, entityId: params.entityId },
        rollbackAvailable: false,
        partialFailures: [{ step: "resolve_credentials", error: "No credentials found" }],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    const client = provider.createClient(creds);
    const { entityId, entityLevel = "account", vertical, timeRange } = params;

    const funnel = resolveFunnel(params.platform, vertical);

    const snapshot = await client.fetchSnapshot(entityId, entityLevel, timeRange, funnel);

    return {
      success: true,
      summary: `Fetched snapshot for ${params.platform} ${entityId}: $${snapshot.spend.toFixed(2)} spend, ${timeRange.since} to ${timeRange.until}.`,
      externalRefs: {
        platform: params.platform,
        entityId,
        period: `${timeRange.since} to ${timeRange.until}`,
      },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: snapshot,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Snapshot fetch failed for ${params.platform} ${params.entityId}: ${errorMsg}`,
      externalRefs: {
        platform: params.platform,
        entityId: params.entityId,
      },
      rollbackAvailable: false,
      partialFailures: [{ step: "fetch_snapshot", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
