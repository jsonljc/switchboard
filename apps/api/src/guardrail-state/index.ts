import Redis from "ioredis";
import type { GuardrailStateStore } from "@switchboard/core";
import { InMemoryGuardrailStateStore } from "@switchboard/core";
import { RedisGuardrailStateStore } from "./redis.js";

export function createGuardrailStateStore(sharedRedis?: Redis): GuardrailStateStore {
  const redisUrl = process.env["REDIS_URL"];
  if (sharedRedis) {
    return new RedisGuardrailStateStore(sharedRedis);
  }
  if (redisUrl) {
    return new RedisGuardrailStateStore(new Redis(redisUrl));
  }
  return new InMemoryGuardrailStateStore();
}
