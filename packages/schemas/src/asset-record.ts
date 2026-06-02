// packages/schemas/src/asset-record.ts
import { z } from "zod";

// `requires_human_review` is the state produced for every freshly generated
// asset until real frame-based QA exists (an un-evaluated/fabricated score must
// never auto-`approved`). See creative-pipeline `deriveApprovalState`.
export const AssetApprovalState = z.enum([
  "pending",
  "approved",
  "rejected",
  "requires_human_review",
  "locked",
]);
export type AssetApprovalState = z.infer<typeof AssetApprovalState>;

export const InputHashesSchema = z.object({
  referencesHash: z.string(),
  promptHash: z.string(),
  audioHash: z.string().optional(),
});
export type InputHashes = z.infer<typeof InputHashesSchema>;

export const AssetOutputsSchema = z.object({
  videoUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  checksums: z.record(z.string()),
});
export type AssetOutputs = z.infer<typeof AssetOutputsSchema>;

export const AssetRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  specId: z.string(),
  creatorId: z.string().nullable().optional(),
  provider: z.string(),
  modelId: z.string(),
  modelVersion: z.string().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  inputHashes: InputHashesSchema,
  outputs: AssetOutputsSchema,
  qaMetrics: z.record(z.unknown()).nullable().optional(),
  qaHistory: z.array(z.record(z.unknown())).nullable().optional(),
  identityDriftScore: z.number().nullable().optional(),
  baselineAssetId: z.string().nullable().optional(),
  latencyMs: z.number().int().nullable().optional(),
  costEstimate: z.number().nullable().optional(),
  attemptNumber: z.number().int().nullable().optional(),
  approvalState: AssetApprovalState,
  lockedDerivativeOf: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;
