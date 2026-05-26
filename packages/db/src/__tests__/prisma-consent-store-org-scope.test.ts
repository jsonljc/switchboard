// ---------------------------------------------------------------------------
// Tenant scoping for the consent state store — A3
//
// Every consent mutation targets `contact` by contactId. Without organizationId
// in the WHERE, an operator in org A can grant/revoke/clear consent on org B's
// contact (PDPA-sensitive cross-tenant write — ConsentService was discarding the
// org it received). Each mutation must scope its WHERE by organizationId so a
// cross-tenant target matches zero rows.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { createPrismaConsentStore } from "../prisma-consent-store.js";

const ORG = "org-a";

const buildPrisma = () =>
  ({
    contact: {
      findUnique: vi.fn().mockResolvedValue({ consentGrantedAt: null, consentRevokedAt: null }),
      findFirst: vi.fn().mockResolvedValue({ consentGrantedAt: null, consentRevokedAt: null }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

function whereOf(call: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const arg = call.mock.calls[0]![0] as { where: Record<string, unknown> };
  return arg.where;
}

describe("createPrismaConsentStore — organization scoping (A3)", () => {
  it("setJurisdictionIfNull scopes the WHERE by organizationId", async () => {
    const prisma = buildPrisma();
    const store = createPrismaConsentStore({ prisma });
    await store.setJurisdictionIfNull("c1", "SG", ORG);
    expect(whereOf(prisma.contact.updateMany)["organizationId"]).toBe(ORG);
  });

  it("setDisclosure scopes the WHERE by organizationId", async () => {
    const prisma = buildPrisma();
    const store = createPrismaConsentStore({ prisma });
    await store.setDisclosure({
      contactId: "c1",
      version: "v1",
      shownAt: new Date(),
      actor: "op",
      organizationId: ORG,
    });
    // update or updateMany — whichever the impl uses must carry the org filter.
    const call = prisma.contact.updateMany.mock.calls.length
      ? prisma.contact.updateMany
      : prisma.contact.update;
    expect(whereOf(call)["organizationId"]).toBe(ORG);
  });

  it("setGrant scopes the WHERE by organizationId", async () => {
    const prisma = buildPrisma();
    const store = createPrismaConsentStore({ prisma });
    await store.setGrant({
      contactId: "c1",
      grantedAt: new Date(),
      source: "operator_recorded",
      actor: "op",
      organizationId: ORG,
    });
    const call = prisma.contact.updateMany.mock.calls.length
      ? prisma.contact.updateMany
      : prisma.contact.update;
    expect(whereOf(call)["organizationId"]).toBe(ORG);
  });

  it("setRevocationIfNotRevoked scopes the WHERE by organizationId", async () => {
    const prisma = buildPrisma();
    const store = createPrismaConsentStore({ prisma });
    await store.setRevocationIfNotRevoked({
      contactId: "c1",
      revokedAt: new Date(),
      source: "inbound_keyword_revocation",
      actor: "sys",
      organizationId: ORG,
    });
    expect(whereOf(prisma.contact.updateMany)["organizationId"]).toBe(ORG);
  });

  it("clearConsentTimestamps scopes the WHERE by organizationId", async () => {
    const prisma = buildPrisma();
    const store = createPrismaConsentStore({ prisma });
    await store.clearConsentTimestamps({
      contactId: "c1",
      actor: "op",
      notes: "n",
      organizationId: ORG,
    });
    const call = prisma.contact.updateMany.mock.calls.length
      ? prisma.contact.updateMany
      : prisma.contact.update;
    expect(whereOf(call)["organizationId"]).toBe(ORG);
  });

  it("a cross-tenant mutation matches zero rows (updateMany count 0 → not-found)", async () => {
    const prisma = buildPrisma();
    prisma.contact.updateMany = vi.fn().mockResolvedValue({ count: 0 }); // contact belongs to another org
    const store = createPrismaConsentStore({ prisma });
    await expect(
      store.setGrant({
        contactId: "c1",
        grantedAt: new Date(),
        source: "operator_recorded",
        actor: "op",
        organizationId: ORG,
      }),
    ).rejects.toThrow();
  });
});
