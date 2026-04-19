import type { PrismaDbClient } from "../prisma-db.js";
import type { AssetRecord } from "@switchboard/schemas";

interface UpsertAssetInput {
  jobId: string;
  specId: string;
  creatorId?: string | null;
  provider: string;
  modelId: string;
  modelVersion?: string | null;
  seed?: number | null;
  attemptNumber: number;
  inputHashes: Record<string, unknown>;
  outputs: Record<string, unknown>;
  qaMetrics?: Record<string, unknown> | null;
  qaHistory?: Record<string, unknown>[] | null;
  identityDriftScore?: number | null;
  baselineAssetId?: string | null;
  latencyMs?: number | null;
  costEstimate?: number | null;
  approvalState: string;
  lockedDerivativeOf?: string | null;
}

export class PrismaAssetRecordStore {
  constructor(private prisma: PrismaDbClient) {}

  async upsertByKey(input: UpsertAssetInput): Promise<AssetRecord> {
    const data = {
      jobId: input.jobId,
      specId: input.specId,
      creatorId: input.creatorId ?? null,
      provider: input.provider,
      modelId: input.modelId,
      modelVersion: input.modelVersion ?? null,
      seed: input.seed ?? null,
      attemptNumber: input.attemptNumber,
      inputHashes: input.inputHashes as object,
      outputs: input.outputs as object,
      qaMetrics: input.qaMetrics ? (input.qaMetrics as object) : undefined,
      qaHistory: input.qaHistory ? (input.qaHistory as object) : undefined,
      identityDriftScore: input.identityDriftScore ?? null,
      baselineAssetId: input.baselineAssetId ?? null,
      latencyMs: input.latencyMs ?? null,
      costEstimate: input.costEstimate ?? null,
      approvalState: input.approvalState,
      lockedDerivativeOf: input.lockedDerivativeOf ?? null,
    };

    return this.prisma.assetRecord.upsert({
      where: {
        specId_attemptNumber_provider: {
          specId: input.specId,
          attemptNumber: input.attemptNumber,
          provider: input.provider,
        },
      },
      create: data,
      update: {
        outputs: data.outputs,
        qaMetrics: data.qaMetrics,
        qaHistory: data.qaHistory,
        identityDriftScore: data.identityDriftScore,
        latencyMs: data.latencyMs,
        costEstimate: data.costEstimate,
        approvalState: data.approvalState,
      },
    }) as unknown as AssetRecord;
  }

  async findById(id: string): Promise<AssetRecord | null> {
    return this.prisma.assetRecord.findUnique({
      where: { id },
    }) as unknown as AssetRecord | null;
  }

  async findByJob(jobId: string): Promise<AssetRecord[]> {
    return this.prisma.assetRecord.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
    }) as unknown as AssetRecord[];
  }

  async findBySpec(specId: string): Promise<AssetRecord[]> {
    return this.prisma.assetRecord.findMany({
      where: { specId },
      orderBy: { attemptNumber: "asc" },
    }) as unknown as AssetRecord[];
  }

  async findLockedByCreator(creatorId: string): Promise<AssetRecord | null> {
    const results = await this.prisma.assetRecord.findMany({
      where: { creatorId, approvalState: "locked" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    return (results[0] as unknown as AssetRecord) ?? null;
  }

  async updateApprovalState(id: string, state: string): Promise<AssetRecord> {
    return this.prisma.assetRecord.update({
      where: { id },
      data: { approvalState: state },
    }) as unknown as AssetRecord;
  }

  async updateQaMetrics(
    id: string,
    metrics: Record<string, unknown>,
    history: Record<string, unknown>[],
  ): Promise<AssetRecord> {
    return this.prisma.assetRecord.update({
      where: { id },
      data: {
        qaMetrics: metrics as object,
        qaHistory: history as object,
      },
    }) as unknown as AssetRecord;
  }
}
