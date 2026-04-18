import { createHash } from "node:crypto";
import type { DeploymentResolver, DeploymentResolverResult } from "./deployment-resolver.js";
import { DeploymentInactiveError } from "./deployment-resolver.js";
import type { AgentPersona, DeploymentPolicyOverrides } from "./deployment-context.js";
import type { TrustLevel } from "../skill-runtime/governance.js";

function trustLevelFromScore(score: number): TrustLevel {
  if (score >= 55) return "autonomous";
  if (score >= 30) return "guided";
  return "supervised";
}

function extractPersona(inputConfig: Record<string, unknown>): AgentPersona | undefined {
  const businessName = inputConfig.businessName;
  if (typeof businessName !== "string") return undefined;

  return {
    businessName,
    tone: typeof inputConfig.tone === "string" ? inputConfig.tone : "professional",
    qualificationCriteria: Array.isArray(inputConfig.qualificationCriteria)
      ? inputConfig.qualificationCriteria
      : undefined,
    disqualificationCriteria: Array.isArray(inputConfig.disqualificationCriteria)
      ? inputConfig.disqualificationCriteria
      : undefined,
    escalationRules: Array.isArray(inputConfig.escalationRules)
      ? inputConfig.escalationRules
      : undefined,
    bookingLink: typeof inputConfig.bookingLink === "string" ? inputConfig.bookingLink : undefined,
    customInstructions:
      typeof inputConfig.customInstructions === "string"
        ? inputConfig.customInstructions
        : undefined,
  };
}

function extractPolicyOverrides(
  row: Record<string, unknown>,
): DeploymentPolicyOverrides | undefined {
  const overrides: DeploymentPolicyOverrides = {};
  let hasAny = false;

  if (typeof row.circuitBreakerThreshold === "number") {
    overrides.circuitBreakerThreshold = row.circuitBreakerThreshold;
    hasAny = true;
  }
  if (typeof row.maxWritesPerHour === "number") {
    overrides.maxWritesPerHour = row.maxWritesPerHour;
    hasAny = true;
  }
  if (Array.isArray(row.allowedModelTiers) && row.allowedModelTiers.length > 0) {
    overrides.allowedModelTiers = row.allowedModelTiers as string[];
    hasAny = true;
  }
  if (typeof row.spendApprovalThreshold === "number") {
    overrides.spendApprovalThreshold = row.spendApprovalThreshold;
    hasAny = true;
  }

  return hasAny ? overrides : undefined;
}

interface DeploymentRow {
  id: string;
  organizationId: string;
  listingId: string;
  status: string;
  skillSlug: string | null;
  inputConfig: Record<string, unknown>;
  governanceSettings: Record<string, unknown>;
  circuitBreakerThreshold: number | null;
  maxWritesPerHour: number | null;
  allowedModelTiers: string[];
  spendApprovalThreshold: number;
  listing: { id: string; trustScore: number; status: string };
}

interface PrismaLike {
  agentDeployment: {
    findUnique(args: {
      where: { id: string };
      include?: { listing: boolean };
    }): Promise<DeploymentRow | null>;
    findFirst(args: {
      where: { organizationId: string; skillSlug: string; status: string };
      include?: { listing: boolean };
    }): Promise<DeploymentRow | null>;
  };
  deploymentConnection: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ deploymentId: string } | null>;
  };
}

export class PrismaDeploymentResolver implements DeploymentResolver {
  private readonly prisma: PrismaLike;

  constructor(prisma: PrismaLike) {
    this.prisma = prisma;
  }

  async resolveByDeploymentId(deploymentId: string): Promise<DeploymentResolverResult> {
    const row = await this.prisma.agentDeployment.findUnique({
      where: { id: deploymentId },
      include: { listing: true },
    });

    if (!row) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    return this.toResult(row);
  }

  async resolveByOrgAndSlug(
    organizationId: string,
    skillSlug: string,
  ): Promise<DeploymentResolverResult> {
    const row = await this.prisma.agentDeployment.findFirst({
      where: { organizationId, skillSlug, status: "active" },
      include: { listing: true },
    });

    if (!row) {
      throw new Error(`No active deployment found for org=${organizationId} slug=${skillSlug}`);
    }

    return this.toResult(row);
  }

  async resolveByChannelToken(channel: string, token: string): Promise<DeploymentResolverResult> {
    // Telegram passes the DeploymentConnection ID directly as the token.
    // Other channels use a hashed token to look up the connection.
    const where =
      channel === "telegram"
        ? { id: token, type: channel }
        : { type: channel, tokenHash: this.hashToken(token) };

    const conn = await this.prisma.deploymentConnection.findFirst({ where });

    if (!conn) {
      throw new Error(`No deployment connection found for channel=${channel}`);
    }

    const result = await this.resolveByDeploymentId(conn.deploymentId);
    console.warn(
      `[DeploymentResolver] resolved deployment=${result.deploymentId} skillSlug=${result.skillSlug} org=${result.organizationId}`,
    );
    return result;
  }

  private toResult(row: DeploymentRow): DeploymentResolverResult {
    if (row.status !== "active") {
      throw new DeploymentInactiveError(row.id, `status is ${row.status}`);
    }
    if (row.listing.status !== "active") {
      throw new DeploymentInactiveError(row.id, `listing is ${row.listing.status}`);
    }
    if (!row.skillSlug) {
      throw new DeploymentInactiveError(row.id, "no skillSlug configured");
    }

    const inputConfig =
      typeof row.inputConfig === "object" && row.inputConfig !== null
        ? (row.inputConfig as Record<string, unknown>)
        : {};

    return {
      deploymentId: row.id,
      listingId: row.listingId,
      organizationId: row.organizationId,
      skillSlug: row.skillSlug,
      trustScore: row.listing.trustScore,
      trustLevel: trustLevelFromScore(row.listing.trustScore),
      persona: extractPersona(inputConfig),
      deploymentConfig: inputConfig,
      policyOverrides: extractPolicyOverrides(row as unknown as Record<string, unknown>),
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
