import type { PrismaDbClient } from "../prisma-db.js";
import type { AvatarQualityTier, CreatorIdentity } from "@switchboard/schemas";

interface CreateCreatorIdentityInput {
  deploymentId: string;
  name: string;
  identityRefIds: string[];
  heroImageAssetId: string;
  identityDescription: string;
  identityObjects?: Record<string, string> | null;
  voice: Record<string, unknown>;
  personality: Record<string, unknown>;
  appearanceRules: Record<string, unknown>;
  environmentSet: string[];
}

export class PrismaCreatorIdentityStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateCreatorIdentityInput): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.create({
      data: {
        deploymentId: input.deploymentId,
        name: input.name,
        identityRefIds: input.identityRefIds,
        heroImageAssetId: input.heroImageAssetId,
        identityDescription: input.identityDescription,
        identityObjects: input.identityObjects ? (input.identityObjects as object) : undefined,
        voice: input.voice as object,
        personality: input.personality as object,
        appearanceRules: input.appearanceRules as object,
        environmentSet: input.environmentSet,
      },
    }) as unknown as CreatorIdentity;
  }

  async findById(id: string): Promise<CreatorIdentity | null> {
    return this.prisma.creatorIdentity.findUnique({
      where: { id },
    }) as unknown as CreatorIdentity | null;
  }

  async findByDeployment(deploymentId: string): Promise<CreatorIdentity[]> {
    return this.prisma.creatorIdentity.findMany({
      where: { deploymentId, isActive: true },
      orderBy: { createdAt: "desc" },
    }) as unknown as CreatorIdentity[];
  }

  async update(
    id: string,
    data: Partial<Omit<CreatorIdentity, "id" | "createdAt" | "updatedAt">>,
  ): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: data as never,
    }) as unknown as CreatorIdentity;
  }

  async approve(id: string): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: { approved: true },
    }) as unknown as CreatorIdentity;
  }

  async deactivate(id: string): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: { isActive: false },
    }) as unknown as CreatorIdentity;
  }

  async setQualityTier(id: string, tier: AvatarQualityTier): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: { qualityTier: tier },
    }) as unknown as CreatorIdentity;
  }

  async attachConsentRecord(id: string, consentRecordId: string): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: { consentRecordId },
    }) as unknown as CreatorIdentity;
  }
}
