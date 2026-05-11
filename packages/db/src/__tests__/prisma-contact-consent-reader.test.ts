import { describe, it, expect, vi } from "vitest";
import { createPrismaContactConsentReader } from "../prisma-contact-consent-reader.js";
import { ContactNotFound } from "@switchboard/core";

describe("createPrismaContactConsentReader", () => {
  it("returns ContactConsentState shape on success", async () => {
    const prisma = {
      contact: {
        findUnique: vi.fn().mockResolvedValue({
          pdpaJurisdiction: "MY",
          consentGrantedAt: new Date("2026-05-01T00:00:00Z"),
          consentRevokedAt: null,
          consentSource: "whatsapp_quick_reply",
          aiDisclosureVersionShown: "my-disclosure@1.0.0",
          aiDisclosureShownAt: new Date("2026-04-29T00:00:00Z"),
          consentUpdatedBy: "system:skill_runtime",
          consentNotes: null,
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const reader = createPrismaContactConsentReader({ prisma });
    const state = await reader.read("c1");
    expect(state.pdpaJurisdiction).toBe("MY");
    expect(state.consentGrantedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(state.consentRevokedAt).toBeNull();
  });

  it("throws ContactNotFound when row is missing", async () => {
    const prisma = {
      contact: { findUnique: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const reader = createPrismaContactConsentReader({ prisma });
    await expect(reader.read("missing")).rejects.toBeInstanceOf(ContactNotFound);
  });
});
