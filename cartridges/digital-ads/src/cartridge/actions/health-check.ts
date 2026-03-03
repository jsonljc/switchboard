// ---------------------------------------------------------------------------
// Action: digital-ads.health.check
// ---------------------------------------------------------------------------
// Checks connectivity and capabilities for all specified platforms.
// ---------------------------------------------------------------------------

import type { AdPlatformProvider } from "../providers/provider.js";
import type {
  HealthCheckParams,
  ExecuteResult,
  PlatformHealth,
  HealthCheckResult,
} from "../types.js";

export async function executeHealthCheck(
  params: HealthCheckParams,
  providers: Map<string, AdPlatformProvider>,
): Promise<ExecuteResult> {
  const start = Date.now();

  const healthChecks = params.platforms.map(async (p) => {
    const provider = providers.get(p.platform);
    if (!provider) {
      return {
        platform: p.platform,
        status: "disconnected" as const,
        latencyMs: 0,
        error: `No provider registered for platform: ${p.platform}`,
        capabilities: [],
      } satisfies PlatformHealth;
    }
    return provider.checkHealth(p.credentials, p.entityId);
  });

  const results = await Promise.allSettled(healthChecks);
  const platformHealth: PlatformHealth[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      platform: params.platforms[i]!.platform,
      status: "disconnected" as const,
      latencyMs: 0,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      capabilities: [],
    };
  });

  const connectedCount = platformHealth.filter((h) => h.status === "connected").length;
  const totalCount = platformHealth.length;

  let overall: HealthCheckResult["overall"];
  if (connectedCount === totalCount) {
    overall = "connected";
  } else if (connectedCount > 0) {
    overall = "degraded";
  } else {
    overall = "disconnected";
  }

  const capabilities = platformHealth.flatMap((h) => h.capabilities);

  const healthResult: HealthCheckResult = {
    overall,
    platforms: platformHealth,
    capabilities,
  };

  return {
    success: connectedCount > 0,
    summary: `Health check: ${connectedCount}/${totalCount} platforms connected (${overall}). Capabilities: ${capabilities.join(", ") || "none"}.`,
    externalRefs: {
      platforms: params.platforms.map((p) => p.platform).join(", "),
      status: overall,
    },
    rollbackAvailable: false,
    partialFailures: platformHealth
      .filter((h) => h.status !== "connected")
      .map((h) => ({
        step: `${h.platform}_health`,
        error: h.error ?? "Unknown error",
      })),
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: healthResult,
  };
}
