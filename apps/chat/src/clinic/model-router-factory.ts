import type Redis from "ioredis";
import type { ModelRouter, ModelRouterConfig } from "./model-router-types.js";
import { InMemoryModelRouter } from "./model-router.js";
import { RedisModelRouter } from "./redis-model-router.js";

/**
 * Create a ModelRouter backed by Redis (if available) or in-memory fallback.
 * Follows the same pattern as `guardrail-state/index.ts`.
 */
export function createModelRouter(config: ModelRouterConfig, redis?: Redis): ModelRouter {
  if (redis) {
    return new RedisModelRouter(config, redis);
  }
  return new InMemoryModelRouter(config);
}
