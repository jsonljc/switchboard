import type { PrismaDbClient } from "../prisma-db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceType = "tally" | "typeform" | "webflow" | "google-forms" | "generic";

export interface LeadWebhook {
  id: string;
  organizationId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  sourceType: SourceType;
  greetingTemplateName: string;
  status: "active" | "revoked";
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface CreateLeadWebhookInput {
  organizationId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  sourceType: SourceType;
  greetingTemplateName?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function map(row: {
  id: string;
  organizationId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  sourceType: string;
  greetingTemplateName: string;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): LeadWebhook {
  return {
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    tokenHash: row.tokenHash,
    tokenPrefix: row.tokenPrefix,
    sourceType: row.sourceType as SourceType,
    greetingTemplateName: row.greetingTemplateName,
    status: row.status as "active" | "revoked",
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class PrismaLeadWebhookStore {
  constructor(private readonly prisma: PrismaDbClient) {}

  async create(input: CreateLeadWebhookInput): Promise<LeadWebhook> {
    const row = await this.prisma.leadWebhook.create({
      data: {
        organizationId: input.organizationId,
        label: input.label,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        sourceType: input.sourceType,
        greetingTemplateName: input.greetingTemplateName ?? "lead_welcome",
      },
    });
    return map(row);
  }

  async findByTokenHash(tokenHash: string): Promise<LeadWebhook | null> {
    const row = await this.prisma.leadWebhook.findUnique({ where: { tokenHash } });
    if (!row || row.status !== "active") return null;
    return map(row);
  }

  async listByOrg(organizationId: string): Promise<LeadWebhook[]> {
    const rows = await this.prisma.leadWebhook.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(map);
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.leadWebhook.update({
      where: { id },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.leadWebhook.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
