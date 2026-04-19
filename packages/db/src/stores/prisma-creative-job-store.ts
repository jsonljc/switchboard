import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type { CreativeJob } from "@switchboard/schemas";

interface CreateCreativeJobInput {
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  generateReferenceImages: boolean;
}

interface CreativeJobFilters {
  deploymentId?: string;
  currentStage?: string;
  limit?: number;
  offset?: number;
}

export class PrismaCreativeJobStore {
  constructor(private prisma: PrismaDbClient) {}

  // ── Mode invariant helper ──

  private async assertMode(id: string, expectedMode: "polished" | "ugc"): Promise<void> {
    const job = await this.prisma.creativeJob.findUnique({ where: { id }, select: { mode: true } });
    if (!job) throw new Error(`Creative job not found: ${id}`);
    if (expectedMode === "ugc" && job.mode !== "ugc") {
      throw new Error("Cannot update UGC phase on a polished-mode job");
    }
    if (expectedMode === "polished" && job.mode === "ugc") {
      throw new Error("Cannot update polished stage on a UGC-mode job");
    }
  }

  async create(input: CreateCreativeJobInput): Promise<CreativeJob> {
    return this.prisma.creativeJob.create({
      data: {
        taskId: input.taskId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        platforms: input.platforms,
        brandVoice: input.brandVoice,
        productImages: input.productImages,
        references: input.references,
        pastPerformance: input.pastPerformance
          ? (input.pastPerformance as object)
          : Prisma.JsonNull,
        generateReferenceImages: input.generateReferenceImages,
      },
    }) as unknown as CreativeJob;
  }

  async findById(id: string): Promise<CreativeJob | null> {
    return this.prisma.creativeJob.findUnique({
      where: { id },
    }) as unknown as CreativeJob | null;
  }

  async findByTaskId(taskId: string): Promise<CreativeJob | null> {
    return this.prisma.creativeJob.findUnique({
      where: { taskId },
    }) as unknown as CreativeJob | null;
  }

  async listByOrg(organizationId: string, filters?: CreativeJobFilters): Promise<CreativeJob[]> {
    return this.prisma.creativeJob.findMany({
      where: {
        organizationId,
        ...(filters?.deploymentId ? { deploymentId: filters.deploymentId } : {}),
        ...(filters?.currentStage ? { currentStage: filters.currentStage } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as CreativeJob[];
  }

  async updateStage(
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "polished");
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        currentStage: stage,
        stageOutputs: stageOutputs as object,
      },
    }) as unknown as CreativeJob;
  }

  async stop(id: string, stoppedAt: string): Promise<CreativeJob> {
    return this.prisma.creativeJob.update({
      where: { id },
      data: { stoppedAt },
    }) as unknown as CreativeJob;
  }

  async updateProductionTier(id: string, tier: string): Promise<CreativeJob> {
    return this.prisma.creativeJob.update({
      where: { id },
      data: { productionTier: tier },
    }) as unknown as CreativeJob;
  }

  // ── UGC methods ──

  async createUgc(
    input: CreateCreativeJobInput & { ugcConfig: Record<string, unknown> },
  ): Promise<CreativeJob> {
    return this.prisma.creativeJob.create({
      data: {
        taskId: input.taskId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        platforms: input.platforms,
        brandVoice: input.brandVoice,
        productImages: input.productImages,
        references: input.references,
        pastPerformance: input.pastPerformance
          ? (input.pastPerformance as object)
          : Prisma.JsonNull,
        generateReferenceImages: input.generateReferenceImages,
        mode: "ugc",
        ugcPhase: "planning",
        ugcPhaseOutputs: {},
        ugcPhaseOutputsVersion: "v1",
        ugcConfig: input.ugcConfig as object,
      },
    }) as unknown as CreativeJob;
  }

  async updateUgcPhase(
    id: string,
    phase: string,
    phaseOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        ugcPhase: phase,
        ugcPhaseOutputs: phaseOutputs as object,
      },
    }) as unknown as CreativeJob;
  }

  async failUgc(id: string, phase: string, error: Record<string, unknown>): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        ugcPhase: phase,
        ugcFailure: error as object,
      },
    }) as unknown as CreativeJob;
  }

  async stopUgc(id: string, phase: string): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    return this.prisma.creativeJob.update({
      where: { id },
      data: { stoppedAt: phase, ugcPhase: phase },
    }) as unknown as CreativeJob;
  }
}
