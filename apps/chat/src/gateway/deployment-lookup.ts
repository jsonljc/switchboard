import type { PrismaClient } from "@switchboard/db";
import { decryptCredentials } from "@switchboard/db";
import type { DeploymentLookup, DeploymentInfo } from "@switchboard/core";
import type { AgentPersona } from "@switchboard/schemas";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  info: DeploymentInfo;
  expiresAt: number;
}

function trustLevelFromScore(score: number): "supervised" | "guided" | "autonomous" {
  if (score >= 55) return "autonomous";
  if (score >= 30) return "guided";
  return "supervised";
}

export class PrismaDeploymentLookup implements DeploymentLookup {
  private cache = new Map<string, CacheEntry>();

  constructor(private prisma: PrismaClient) {}

  async findByChannelToken(channel: string, token: string): Promise<DeploymentInfo | null> {
    const cacheKey = `${channel}:${token}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.info;
    }

    let matchedDeploymentId: string | null = null;

    if (channel === "telegram") {
      // For Telegram, the token IS the connection ID (registry already resolved it)
      const conn = await this.prisma.deploymentConnection.findUnique({
        where: { id: token },
      });
      if (conn && conn.status === "active") {
        matchedDeploymentId = conn.deploymentId;
      }
    } else {
      // For web_widget: scan all active connections, decrypt, match token
      const connections = await this.prisma.deploymentConnection.findMany({
        where: { type: channel, status: "active" },
      });

      for (const conn of connections) {
        try {
          const creds = decryptCredentials(conn.credentials) as Record<string, unknown>;
          if (creds["token"] === token) {
            matchedDeploymentId = conn.deploymentId;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!matchedDeploymentId) return null;

    // Load deployment + listing
    const deployment = await this.prisma.agentDeployment.findUnique({
      where: { id: matchedDeploymentId },
    });
    if (!deployment || deployment.status !== "active") return null;

    const listing = await this.prisma.agentListing.findUnique({
      where: { id: deployment.listingId },
    });

    const trustScore = (listing?.trustScore as number) ?? 0;
    const inputConfig = deployment.inputConfig as Record<string, unknown>;

    const persona: AgentPersona = {
      id: `persona-${deployment.id}`,
      organizationId: deployment.organizationId,
      businessName: (inputConfig["businessName"] as string) ?? "",
      businessType: (inputConfig["businessType"] as string) ?? "small_business",
      productService: (inputConfig["productService"] as string) ?? "",
      valueProposition: (inputConfig["valueProposition"] as string) ?? "",
      tone: (inputConfig["tone"] as "casual" | "professional" | "consultative") ?? "professional",
      qualificationCriteria:
        (inputConfig["qualificationCriteria"] as Record<string, unknown>) ?? {},
      disqualificationCriteria:
        (inputConfig["disqualificationCriteria"] as Record<string, unknown>) ?? {},
      escalationRules: (inputConfig["escalationRules"] as Record<string, unknown>) ?? {},
      bookingLink: (inputConfig["bookingLink"] as string) ?? null,
      customInstructions: (inputConfig["customInstructions"] as string) ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const info: DeploymentInfo = {
      deployment: { id: deployment.id, listingId: deployment.listingId },
      persona,
      trustScore,
      trustLevel: trustLevelFromScore(trustScore),
    };

    this.cache.set(cacheKey, {
      info,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return info;
  }
}
