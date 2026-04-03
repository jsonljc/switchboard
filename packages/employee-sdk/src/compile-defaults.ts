import type { EmployeeConfig } from "./types.js";

export function compileDefaults(config: EmployeeConfig) {
  return {
    policies: config.policies ?? [],
    guardrails: config.guardrails ?? { rateLimits: [], cooldowns: [] },
  };
}
