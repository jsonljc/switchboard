import type { LeadIntakeStore } from "@switchboard/core";
import { normalizeToE164 } from "@switchboard/schemas";
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
  messagingOptIn?: boolean;
  messagingOptInSource?: "ctwa" | "organic_inbound" | "web_form" | "manual";
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

  async findContactByIdempotency(
    organizationId: string,
    key: string,
  ): Promise<{ id: string } | null> {
    // Scoped to the (organizationId, idempotencyKey) unique. A global lookup by
    // key alone could return another tenant's Contact when two orgs share a key
    // (e.g. a replayed/crafted key), leaking its id and falsely deduping the lead.
    const row = await this.prisma.contact.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey: key },
      },
      select: { id: true },
    });
    return row ? { id: row.id } : null;
  }

  async upsertContact(input: UpsertContactInput): Promise<{ id: string }> {
    const primaryChannel = input.channel ?? "whatsapp";
    const now = new Date();
    const messagingOptIn = input.messagingOptIn ?? false;
    const phoneE164 = normalizeToE164(input.phone ?? null);

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
        phoneE164,
        email: input.email ?? null,
        primaryChannel,
        firstTouchChannel: primaryChannel,
        sourceType: input.sourceType,
        source: input.sourceType,
        attribution: input.attribution as object,
        idempotencyKey: input.idempotencyKey,
        messagingOptIn,
        messagingOptInAt: messagingOptIn ? now : null,
        messagingOptInSource: input.messagingOptInSource ?? null,
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

  /**
   * Gate-0 data-presence read for the CoverageValidator (D9-4): has this org
   * received a lead from `sourceType` within the last `days`? Uses the indexed
   * `(organizationId, sourceType, createdAt)` composite. `sourceType` matches the
   * values the lead-intake writes ("ctwa" | "instant_form" | ...), so the validator's
   * source keys join directly. Count-based (`> 0`) so it stops at the first match.
   */
  async hasRecentLead(organizationId: string, sourceType: string, days: number): Promise<boolean> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const count = await this.prisma.contact.count({
      where: { organizationId, sourceType, createdAt: { gte: since } },
    });
    return count > 0;
  }
}
