import type { PrismaDbClient } from "../prisma-db.js";
import type { ConsentRecord } from "@switchboard/schemas";

export interface CreateConsentRecordInput {
  orgId: string;
  personName: string;
  scopeOfUse: string[];
  territory: string[];
  mediaTypes: string[];
  revocable?: boolean;
  recordingUri?: string;
  effectiveAt: Date;
  expiresAt?: Date;
}

export class PrismaConsentRecordStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateConsentRecordInput): Promise<ConsentRecord> {
    return this.prisma.consentRecord.create({
      data: {
        orgId: input.orgId,
        personName: input.personName,
        scopeOfUse: input.scopeOfUse,
        territory: input.territory,
        mediaTypes: input.mediaTypes,
        revocable: input.revocable ?? true,
        revoked: false,
        recordingUri: input.recordingUri,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
      },
    }) as unknown as ConsentRecord;
  }

  async getById(id: string): Promise<ConsentRecord | null> {
    return this.prisma.consentRecord.findUnique({
      where: { id },
    }) as unknown as ConsentRecord | null;
  }

  async revoke(id: string): Promise<ConsentRecord> {
    return this.prisma.consentRecord.update({
      where: { id },
      data: { revoked: true, revokedAt: new Date() },
    }) as unknown as ConsentRecord;
  }
}
