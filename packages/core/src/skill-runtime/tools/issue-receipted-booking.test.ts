import { describe, it, expect, vi } from "vitest";
import {
  isPrismaUniqueConstraintError,
  issueReceiptedBookingInTx,
} from "./issue-receipted-booking.js";

/** Mirrors ReceiptedBookingIssuanceTx.contact.findFirst's return so the typed spy stays assignable. */
type ContactRead = {
  id?: string | null;
  leadgenId?: string | null;
  sourceType?: string | null;
  firstTouchChannel?: string | null;
  pdpaJurisdiction?: string | null;
  consentGrantedAt?: Date | null;
  consentRevokedAt?: Date | null;
  phoneE164?: string | null;
  duplicateContactRisk?: boolean | null;
} | null;

function makeTx(opts: {
  existingRow?: { id: string } | null;
  evidenceContact?: {
    leadgenId?: string | null;
    sourceType?: string | null;
    firstTouchChannel?: string | null;
    pdpaJurisdiction?: string | null;
    consentGrantedAt?: Date | null;
    consentRevokedAt?: Date | null;
    phoneE164?: string | null;
    duplicateContactRisk?: boolean | null;
  } | null;
  duplicateContact?: { id: string } | null;
  createImpl?: () => Promise<unknown>;
}) {
  // Typed spy (NOT a bare vi.fn): a zero-arg impl would infer an empty-tuple mock.calls and break
  // `tsc` at build (TS2493) while vitest greens. Typing the call args keeps mock.calls[0][0] sound.
  const create = vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(
    opts.createImpl ?? (async () => ({ id: "rb_1" })),
  );
  // Branch the two contact reads: the duplicate probe is the only findFirst whose where carries
  // phoneE164; the evidence read is by id. Typed args keep mock.calls sound under tsc.
  const contactFindFirst = vi.fn<
    (a: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => Promise<ContactRead>
  >(async (a) => {
    if (a.where.phoneE164 !== undefined) return opts.duplicateContact ?? null;
    return opts.evidenceContact ?? null;
  });
  return {
    tx: {
      receiptedBooking: {
        findFirst: vi.fn().mockResolvedValue(opts.existingRow ?? null),
        create,
      },
      contact: {
        findFirst: contactFindFirst,
      },
    },
    create,
  };
}

const baseArgs = {
  organizationId: "org-1",
  bookingId: "bk-1",
  contactId: "ct-1",
  sourceAdId: null,
  sourceCampaignId: null,
  estimatedValueCents: 45000,
  currency: "SGD",
  now: new Date("2026-06-15T10:00:00Z"),
};

describe("isPrismaUniqueConstraintError", () => {
  it("is true only for a P2002 error shape", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isPrismaUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isPrismaUniqueConstraintError(new Error("boom"))).toBe(false);
    expect(isPrismaUniqueConstraintError(null)).toBe(false);
  });
});

describe("issueReceiptedBookingInTx", () => {
  it("creates a scored, org-scoped, snapshotted row when none exists", async () => {
    const { tx, create } = makeTx({
      evidenceContact: {
        leadgenId: "lead_1", // deterministic
        sourceType: "ctwa",
        firstTouchChannel: "instagram",
        pdpaJurisdiction: "SG", // in PDPA scope -> absent consent raises missing_consent
        consentGrantedAt: null, // raises missing_consent
        consentRevokedAt: null,
      },
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    expect(tx.receiptedBooking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", bookingId: "bk-1" } }),
    );
    expect(tx.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", id: "ct-1" } }),
    );
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0].data as {
      attributionConfidence: string;
      expectedValueAtIssue: number | null;
      currency: string | null;
      exceptions: Array<{ code: string; raisedAt: unknown }>;
    };
    expect(data.attributionConfidence).toBe("deterministic");
    expect(data.expectedValueAtIssue).toBe(45000);
    expect(data.currency).toBe("SGD");
    expect(data.exceptions.map((e) => e.code)).toEqual(["missing_consent"]);
    expect(data.exceptions.every((e) => typeof e.raisedAt === "string")).toBe(true);
  });

  it("does NOT persist missing_consent for a null-jurisdiction contact (not-applicable)", async () => {
    const { tx, create } = makeTx({
      evidenceContact: {
        leadgenId: "lead_1", // attributed -> no missing_source
        pdpaJurisdiction: null, // not-applicable -> no missing_consent despite absent consent
        consentGrantedAt: null,
        consentRevokedAt: null,
      },
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.map((e) => e.code)).not.toContain("missing_consent");
    expect(data.exceptions).toEqual([]);
  });

  it("is idempotent: skips the create (and the contact read) when a row already exists", async () => {
    const { tx, create } = makeTx({ existingRow: { id: "rb_existing" } });
    await issueReceiptedBookingInTx(tx, baseArgs);
    expect(create).not.toHaveBeenCalled();
    expect(tx.contact.findFirst).not.toHaveBeenCalled();
  });

  it("swallows a P2002 create race (idempotent no-op, never rolls back the booking)", async () => {
    const { tx } = makeTx({ createImpl: () => Promise.reject({ code: "P2002" }) });
    await expect(issueReceiptedBookingInTx(tx, baseArgs)).resolves.toBeUndefined();
  });

  it("rethrows a non-P2002 create error (a real failure is not masked)", async () => {
    const { tx } = makeTx({ createImpl: () => Promise.reject(new Error("connection lost")) });
    await expect(issueReceiptedBookingInTx(tx, baseArgs)).rejects.toThrow("connection lost");
  });

  it("flags duplicate_contact_risk when another contact shares the non-null phoneE164", async () => {
    const { tx, create } = makeTx({
      evidenceContact: { leadgenId: "lead_1", phoneE164: "+6591234567" },
      duplicateContact: { id: "ct-2" }, // a real, distinct contact shares the phone
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    // the probe is org-scoped, exact phoneE164, and excludes self
    expect(tx.contact.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", phoneE164: "+6591234567", id: { not: "ct-1" } },
      select: { id: true },
    });
    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.map((e) => e.code)).toContain("duplicate_contact_risk");
  });

  it("does NOT flag duplicate_contact_risk when no other contact shares the phoneE164", async () => {
    const { tx, create } = makeTx({
      evidenceContact: { leadgenId: "lead_1", phoneE164: "+6591234567" },
      duplicateContact: null,
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
  });

  it("skips the probe and never flags when phoneE164 is null/empty/whitespace", async () => {
    for (const phoneE164 of [null, "", "   "]) {
      const { tx, create } = makeTx({
        evidenceContact: { leadgenId: "lead_1", phoneE164 },
        duplicateContact: { id: "ct-2" }, // present, but must stay unreachable (no probe issued)
      });

      await issueReceiptedBookingInTx(tx, baseArgs);

      const probed = tx.contact.findFirst.mock.calls.some(
        (c) => (c[0] as { where: Record<string, unknown> }).where.phoneE164 !== undefined,
      );
      expect(probed).toBe(false);
      const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
      expect(data.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
    }
  });

  it("flags duplicate_contact_risk from the persisted intake flag even with no shared phone (A4)", async () => {
    // The A4 lead-intake matcher persists Contact.duplicateContactRisk; issuance ORs it in, so the
    // intake-time producer feeds evaluateExceptions even when the phone probe finds nothing (email-only).
    const { tx, create } = makeTx({
      evidenceContact: { leadgenId: "lead_1", phoneE164: null, duplicateContactRisk: true },
      duplicateContact: null,
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.map((e) => e.code)).toContain("duplicate_contact_risk");
  });

  it("does NOT flag when neither the persisted intake flag nor a shared phone is present", async () => {
    const { tx, create } = makeTx({
      evidenceContact: {
        leadgenId: "lead_1",
        phoneE164: "+6591234567",
        duplicateContactRisk: false,
      },
      duplicateContact: null,
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
  });

  it("emits EXACTLY ONE duplicate_contact_risk entry when both the intake flag and a shared phone apply (no double-flag)", async () => {
    // The two producers (A4 intake flag + the issuance phone probe) collapse to a single OR'd boolean
    // before evaluateExceptions, which emits at most one entry per code. Proves the cross-slice seam.
    const { tx, create } = makeTx({
      evidenceContact: {
        leadgenId: "lead_1",
        phoneE164: "+6591234567",
        duplicateContactRisk: true,
      },
      duplicateContact: { id: "ct-2" },
    });

    await issueReceiptedBookingInTx(tx, baseArgs);

    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.filter((e) => e.code === "duplicate_contact_risk")).toHaveLength(1);
  });
});
