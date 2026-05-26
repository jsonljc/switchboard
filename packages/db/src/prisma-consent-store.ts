import type { PrismaClient } from "@prisma/client";
import type { ConsentStateStore } from "@switchboard/core";
import { ContactNotFound } from "@switchboard/core";
import type { ContactConsentState, ConsentSource, PdpaJurisdiction } from "@switchboard/schemas";

interface Deps {
  prisma: PrismaClient;
}

const CONSENT_SELECT = {
  pdpaJurisdiction: true,
  consentGrantedAt: true,
  consentRevokedAt: true,
  consentSource: true,
  aiDisclosureVersionShown: true,
  aiDisclosureShownAt: true,
  consentUpdatedBy: true,
  consentNotes: true,
} as const;

export function createPrismaConsentStore(deps: Deps): ConsentStateStore {
  const { prisma } = deps;

  // Single-row consent mutations target `contact` by its primary key, so the
  // org filter alone is not a unique input — every write goes through
  // updateMany with `{ id, organizationId }` in the WHERE. A cross-tenant target
  // matches zero rows; callers that expect the contact to exist treat count===0
  // as not-found. Throws the typed ContactNotFound (the same the service raises
  // on its pre-read) so a TOCTOU miss maps to a clean 404, not a 500 — in
  // normal flow the service's org-scoped readOrNull throws first, so this is
  // defense-in-depth for a contact deleted between read and write.
  function assertScoped(count: number, contactId: string): void {
    if (count === 0) {
      throw new ContactNotFound({ contactId });
    }
  }

  return {
    async readOrNull(
      contactId: string,
      organizationId?: string,
    ): Promise<ContactConsentState | null> {
      const row = await prisma.contact.findFirst({
        where: { id: contactId, ...(organizationId ? { organizationId } : {}) },
        select: CONSENT_SELECT,
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

    async setJurisdictionIfNull(
      contactId: string,
      jurisdiction: PdpaJurisdiction,
      organizationId: string,
    ) {
      // "Set if null" semantics: a zero count means already-stamped OR not in
      // this org — both are correct no-ops here (the caller pre-reads).
      await prisma.contact.updateMany({
        where: { id: contactId, organizationId, pdpaJurisdiction: null },
        data: { pdpaJurisdiction: jurisdiction },
      });
    },

    async setDisclosure({
      contactId,
      version,
      shownAt,
      actor,
      organizationId,
    }: {
      contactId: string;
      version: string;
      shownAt: Date;
      actor: string;
      organizationId: string;
    }) {
      const result = await prisma.contact.updateMany({
        where: { id: contactId, organizationId },
        data: {
          aiDisclosureVersionShown: version,
          aiDisclosureShownAt: shownAt,
          consentUpdatedBy: actor,
        },
      });
      assertScoped(result.count, contactId);
    },

    async setGrant({
      contactId,
      grantedAt,
      source,
      actor,
      notes,
      organizationId,
    }: {
      contactId: string;
      grantedAt: Date;
      source: ConsentSource;
      actor: string;
      notes?: string;
      organizationId: string;
    }) {
      const result = await prisma.contact.updateMany({
        where: { id: contactId, organizationId },
        data: {
          consentGrantedAt: grantedAt,
          consentSource: source,
          consentUpdatedBy: actor,
          consentNotes: notes ?? null,
        },
      });
      assertScoped(result.count, contactId);
    },

    async setRevocationIfNotRevoked({
      contactId,
      revokedAt,
      source,
      actor,
      notes,
      organizationId,
    }: {
      contactId: string;
      revokedAt: Date;
      source: ConsentSource;
      actor: string;
      notes?: string;
      organizationId: string;
    }) {
      const result = await prisma.contact.updateMany({
        where: { id: contactId, organizationId, consentRevokedAt: null },
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
      // Zero rows: already revoked, or not in this org. Re-read within the org
      // to report the existing timestamp (null if the contact isn't ours).
      const existing = await prisma.contact.findFirst({
        where: { id: contactId, organizationId },
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
      organizationId,
    }: {
      contactId: string;
      actor: string;
      notes: string;
      organizationId: string;
    }) {
      const previous = await prisma.contact.findFirst({
        where: { id: contactId, organizationId },
        select: { consentGrantedAt: true, consentRevokedAt: true },
      });
      const result = await prisma.contact.updateMany({
        where: { id: contactId, organizationId },
        data: {
          consentGrantedAt: null,
          consentRevokedAt: null,
          consentSource: null,
          consentUpdatedBy: actor,
          consentNotes: notes,
        },
      });
      assertScoped(result.count, contactId);
      return {
        previousGrantedAt: previous?.consentGrantedAt ?? null,
        previousRevokedAt: previous?.consentRevokedAt ?? null,
      };
    },
  };
}
