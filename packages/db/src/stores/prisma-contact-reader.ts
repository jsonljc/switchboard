import type { PrismaDbClient } from "../prisma-db.js";

/**
 * Minimal Contact projection consumed by the ad-optimizer OutcomeDispatcher.
 * Only the fields required for CAPI dispatch (sourceType + attribution chain).
 */
export interface ContactReaderRecord {
  id: string;
  organizationId: string;
  sourceType: string | null;
  attribution: Record<string, unknown> | null;
}

export interface ContactReader {
  getContact(id: string): Promise<ContactReaderRecord | null>;
}

/**
 * Prisma-backed ContactReader.
 *
 * NOTE: this reader queries by id WITHOUT an organizationId scope. It is
 * intended for system-level consumers (the lifecycle event bus subscriber)
 * that already trust the contactId originated from an in-system event. Do
 * not use this from request-scoped code paths.
 */
export class PrismaContactReader implements ContactReader {
  constructor(private prisma: PrismaDbClient) {}

  async getContact(id: string): Promise<ContactReaderRecord | null> {
    const row = await this.prisma.contact.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        sourceType: true,
        attribution: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      sourceType: row.sourceType ?? null,
      attribution: (row.attribution as Record<string, unknown> | null) ?? null,
    };
  }
}
