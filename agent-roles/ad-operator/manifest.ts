import type { AgentRoleManifest } from "@switchboard/schemas";

const manifest: AgentRoleManifest = {
  id: "ad-operator",
  name: "Ad Operator",
  description:
    "Manages digital advertising campaigns across Meta, Google, and TikTok. " +
    "Reads performance metrics, proposes budget changes, and pauses underperforming campaigns.",
  version: "1.0.0",
  toolPack: ["digital-ads"],
  governanceProfile: "guarded",
  safetyEnvelope: {
    maxToolCalls: 200,
    maxMutations: 50,
    maxDollarsAtRisk: 10_000,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  },
  // Note: .ts path is for type-checking reference. Runtime loader uses manifest.json
  // which points to .json artifacts.
  instructionPath: "./defaults/instruction.md",
  checkpointSchemaPath: "./defaults/checkpoint-schema.ts",
  maxConcurrentSessions: 3,
};

export default manifest;
