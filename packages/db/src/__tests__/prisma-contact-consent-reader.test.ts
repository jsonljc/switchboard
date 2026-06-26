import { describe, it, expect, vi } from "vitest";
import { createPrismaContactConsentReader } from "../prisma-contact-consent-reader.js";
import { ContactNotFound } from "@switchboard/core";

const ROW = {
  pdpaJurisdiction: "MY",
  phoneE164: "+60123456789",
  consentGrantedAt: new Date("2026-05-01T00:00:00Z"),
  consentRevokedAt: null,
  consentSource: "whatsapp_quick_reply",
  aiDisclosureVersionShown: "my-disclosure@1.0.0",
  aiDisclosureShownAt: new Date("2026-04-29T00:00:00Z"),
  consentUpdatedBy: "system:skill_runtime",
  consentNotes: null,
};

/**
 * Mock prisma whose findFirst mirrors a real org-scoped query: it returns the
 * row only when BOTH id and organizationId match. A reader that fails to pass
 * organizationId therefore cannot read the row, which is what the org-scoping
 * test asserts.
 */
function makeScopingPrisma(ownerOrgId: string, contactId: string) {
  const findFirst = vi.fn(async (args: { where?: { id?: string; organizationId?: string } }) => {
    if (args.where?.id === contactId && args.where?.organizationId === ownerOrgId) {
      return { ...ROW };
    }
    return null;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { prisma: { contact: { findFirst } } as any, findFirst };
}

describe("createPrismaContactConsentReader", () => {
  it("returns ContactConsentState shape on success", async () => {
    const { prisma } = makeScopingPrisma("org_a", "c1");
    const reader = createPrismaContactConsentReader({ prisma });
    const state = await reader.read("org_a", "c1");
    expect(state.pdpaJurisdiction).toBe("MY");
    expect(state.consentGrantedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(state.consentRevokedAt).toBeNull();
  });

  it("returns and selects the contact's phoneE164 (for per-lead jurisdiction resolution)", async () => {
    const { prisma, findFirst } = makeScopingPrisma("org_a", "c1");
    const reader = createPrismaContactConsentReader({ prisma });
    const state = await reader.read("org_a", "c1");
    expect(state.phoneE164).toBe("+60123456789");
    // The column must be projected, not accidentally surfaced by the mock.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ phoneE164: true }) }),
    );
  });

  it("throws ContactNotFound when row is missing", async () => {
    const prisma = {
      contact: { findFirst: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const reader = createPrismaContactConsentReader({ prisma });
    await expect(reader.read("org_a", "missing")).rejects.toBeInstanceOf(ContactNotFound);
  });

  it("scopes the read by organizationId (no cross-tenant consent read)", async () => {
    // c1 belongs to org_a. An org_b principal must NOT be able to read it.
    const { prisma, findFirst } = makeScopingPrisma("org_a", "c1");
    const reader = createPrismaContactConsentReader({ prisma });

    // Same-tenant read succeeds.
    await expect(reader.read("org_a", "c1")).resolves.toMatchObject({ pdpaJurisdiction: "MY" });

    // Cross-tenant read is blocked (treated as not found), never leaks the row.
    await expect(reader.read("org_b", "c1")).rejects.toBeInstanceOf(ContactNotFound);

    // The query is org-scoped: organizationId is part of every where clause.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c1", organizationId: "org_b" }),
      }),
    );
  });
});
