import type { PrismaClient } from "@prisma/client";
import type { ConsentStateStore } from "@switchboard/core";
import type { ContactConsentState, ConsentSource, PdpaJurisdiction } from "@switchboard/schemas";

interface Deps {
  prisma: PrismaClient;
}

export function createPrismaConsentStore(deps: Deps): ConsentStateStore {
  const { prisma } = deps;
  return {
    async readOrNull(contactId: string): Promise<ContactConsentState | null> {
      const row = await prisma.contact.findUnique({
        where: { id: contactId },
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
      if (!row) return null;
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

    async setJurisdictionIfNull(contactId: string, jurisdiction: PdpaJurisdiction) {
      await prisma.contact.updateMany({
        where: { id: contactId, pdpaJurisdiction: null },
        data: { pdpaJurisdiction: jurisdiction },
      });
    },

    async setDisclosure({
      contactId,
      version,
      shownAt,
      actor,
    }: {
      contactId: string;
      version: string;
      shownAt: Date;
      actor: string;
    }) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          aiDisclosureVersionShown: version,
          aiDisclosureShownAt: shownAt,
          consentUpdatedBy: actor,
        },
      });
    },

    async setGrant({
      contactId,
      grantedAt,
      source,
      actor,
      notes,
    }: {
      contactId: string;
      grantedAt: Date;
      source: ConsentSource;
      actor: string;
      notes?: string;
    }) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          consentGrantedAt: grantedAt,
          consentSource: source,
          consentUpdatedBy: actor,
          consentNotes: notes ?? null,
        },
      });
    },

    async setRevocationIfNotRevoked({
      contactId,
      revokedAt,
      source,
      actor,
      notes,
    }: {
      contactId: string;
      revokedAt: Date;
      source: ConsentSource;
      actor: string;
      notes?: string;
    }) {
      const result = await prisma.contact.updateMany({
        where: { id: contactId, consentRevokedAt: null },
        data: {
          consentRevokedAt: revokedAt,
          consentSource: source,
          consentUpdatedBy: actor,
          consentNotes: notes ?? null,
        },
      });
      if (result.count === 1) {
        return { wasNewlyRevoked: true, existingRevokedAt: null };
      }
      // Row exists but was already revoked — fetch existing timestamp.
      const existing = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { consentRevokedAt: true },
      });
      return {
        wasNewlyRevoked: false,
        existingRevokedAt: existing?.consentRevokedAt ?? null,
      };
    },

    async clearConsentTimestamps({
      contactId,
      actor,
      notes,
    }: {
      contactId: string;
      actor: string;
      notes: string;
    }) {
      const previous = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { consentGrantedAt: true, consentRevokedAt: true },
      });
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          consentGrantedAt: null,
          consentRevokedAt: null,
          consentSource: null,
          consentUpdatedBy: actor,
          consentNotes: notes,
        },
      });
      return {
        previousGrantedAt: previous?.consentGrantedAt ?? null,
        previousRevokedAt: previous?.consentRevokedAt ?? null,
      };
    },
  };
}
