import type { PrismaClient } from "@prisma/client";
import type { ContactConsentState, PdpaJurisdiction, ConsentSource } from "@switchboard/schemas";
import { ContactNotFound, type ContactConsentReader } from "@switchboard/core";

interface Deps {
  prisma: PrismaClient;
}

export function createPrismaContactConsentReader(deps: Deps): ContactConsentReader {
  return {
    async read(organizationId: string, contactId: string): Promise<ContactConsentState> {
      const row = await deps.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
        select: {
          pdpaJurisdiction: true,
          consentGrantedAt: true,
          consentRevokedAt: true,
          consentSource: true,
          aiDisclosureVersionShown: true,
          aiDisclosureShownAt: true,
          consentUpdatedBy: true,
          consentNotes: true,
        },
      });
      if (!row) throw new ContactNotFound({ contactId });

      return {
        pdpaJurisdiction: row.pdpaJurisdiction as PdpaJurisdiction | null,
        consentGrantedAt: row.consentGrantedAt ? row.consentGrantedAt.toISOString() : null,
        consentRevokedAt: row.consentRevokedAt ? row.consentRevokedAt.toISOString() : null,
        consentSource: row.consentSource as ConsentSource | null,
        aiDisclosureVersionShown: row.aiDisclosureVersionShown,
        aiDisclosureShownAt: row.aiDisclosureShownAt ? row.aiDisclosureShownAt.toISOString() : null,
        consentUpdatedBy: row.consentUpdatedBy,
        consentNotes: row.consentNotes,
      };
    },
  };
}
