import type { ExecutionConstraints } from "../governance-types.js";

export const CONSTRAINT_PROFILE_CARTRIDGE_V1 = "default-cartridge-v1";

export const DEFAULT_CARTRIDGE_CONSTRAINTS: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 10,
  maxLlmTurns: 1,
  maxTotalTokens: 0,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 10,
  trustLevel: "guided",
};
