// ---------------------------------------------------------------------------
// Action: digital-ads.platform.connect
// ---------------------------------------------------------------------------
// Validates credentials and establishes connectivity to a platform.
// ---------------------------------------------------------------------------

import type { AdPlatformProvider } from "../providers/provider.js";
import type { ConnectParams, ExecuteResult, SessionState } from "../types.js";
import { setConnection, setConnectionError } from "../context/session.js";

export async function executeConnect(
  params: ConnectParams,
  provider: AdPlatformProvider,
  session: SessionState
): Promise<ExecuteResult> {
  const start = Date.now();

  try {
    const { client: _client, accountName, entityLevels } = await provider.connect(
      params.credentials,
      params.entityId
    );

    setConnection(session, params.platform, params.credentials, accountName, entityLevels);

    return {
      success: true,
      summary: `Connected to ${params.platform} account "${accountName}" (${params.entityId}). Available entity levels: ${entityLevels.join(", ")}.`,
      externalRefs: {
        platform: params.platform,
        entityId: params.entityId,
        accountName,
      },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: {
        platform: params.platform,
        accountName,
        entityLevels,
        status: "connected",
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    setConnectionError(session, params.platform, params.credentials, errorMsg);

    return {
      success: false,
      summary: `Failed to connect to ${params.platform}: ${errorMsg}`,
      externalRefs: {
        platform: params.platform,
        entityId: params.entityId,
      },
      rollbackAvailable: false,
      partialFailures: [{ step: "connect", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
