import type { LeadIntakeStore } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";

interface UpsertContactInput {
  organizationId: string;
  deploymentId: string;
  phone?: string;
  email?: string;
  channel?: string;
  sourceType: string;
  sourceAdId?: string;
  sourceCampaignId?: string;
  sourceAdsetId?: string;
  attribution: Record<string, unknown>;
  idempotencyKey: string;
}

interface CreateActivityInput {
  contactId: string;
  organizationId: string;
  deploymentId: string;
  kind: "lead_received";
  sourceType: string;
  metadata: Record<string, unknown>;
}

/**
 * Prisma-backed implementation of {@link LeadIntakeStore}.
 *
 * Idempotency model: backed by the unique constraint
 * `Contact_organizationId_idempotencyKey_key` on
 * `(organizationId, idempotencyKey)`. A dedicated `idempotencyKey` column was
 * added (rather than reusing `leadgenId`) because `leadgenId` is semantically
 * Meta Instant Form-specific, while idempotency keys also originate from CTWA
 * (`wamid`-derived) and other lead surfaces. Reusing `leadgenId` would force a
 * unique constraint that would block legitimate non-Meta paths and conflate
 * source identifiers with deduplication keys.
 *
 * Activity model: writes lead lifecycle events to {@link PrismaDbClient.activityLog}.
 * `eventType` carries `kind` ("lead_received"); `metadata` embeds `contactId`,
 * `sourceType`, and the caller-provided metadata so per-Contact funnel queries
 * (Task 12) can filter on `metadata->>'contactId'`.
 *
 * Concurrency: `upsertContact` uses `prisma.contact.upsert` keyed on the
 * `(organizationId, idempotencyKey)` unique constraint, closing the TOCTOU
 * window between `findContactByIdempotency` and `upsertContact`.
 */
export class PrismaLeadIntakeStore implements LeadIntakeStore {
  constructor(private readonly prisma: PrismaDbClient) {}

  async findContactByIdempotency(key: string): Promise<{ id: string } | null> {
    const row = await this.prisma.contact.findFirst({
      where: { idempotencyKey: key },
      select: { id: true },
    });
    return row ? { id: row.id } : null;
  }

  async upsertContact(input: UpsertContactInput): Promise<{ id: string }> {
    const primaryChannel = input.channel ?? "whatsapp";
    const now = new Date();

    const row = await this.prisma.contact.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        phone: input.phone ?? null,
        email: input.email ?? null,
        primaryChannel,
        firstTouchChannel: primaryChannel,
        sourceType: input.sourceType,
        source: input.sourceType,
        attribution: input.attribution as object,
        idempotencyKey: input.idempotencyKey,
        firstContactAt: now,
        lastActivityAt: now,
      },
      update: {
        // No-op update: idempotent write. Touching `lastActivityAt` would
        // contradict the idempotency contract (caller sees the same row, not a
        // refreshed one). We intentionally leave fields untouched on conflict.
        lastActivityAt: undefined,
      },
      select: { id: true },
    });

    return { id: row.id };
  }

  async createActivity(input: CreateActivityInput): Promise<{ id: string }> {
    const row = await this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        eventType: input.kind,
        description: `Lead received from ${input.sourceType}`,
        metadata: {
          contactId: input.contactId,
          sourceType: input.sourceType,
          ...input.metadata,
        } as object,
      },
      select: { id: true },
    });

    return { id: row.id };
  }
}
