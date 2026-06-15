import { describe, it, expect, vi } from "vitest";
import {
  isPrismaUniqueConstraintError,
  issueReceiptedBookingInTx,
} from "./issue-receipted-booking.js";

function makeTx(opts: {
  existingRow?: { id: string } | null;
  evidenceContact?: {
    leadgenId?: string | null;
    sourceType?: string | null;
    firstTouchChannel?: string | null;
    consentGrantedAt?: Date | null;
    consentRevokedAt?: Date | null;
  } | null;
  createImpl?: () => Promise<unknown>;
}) {
  const create = vi.fn(opts.createImpl ?? (() => Promise.resolve({ id: "rb_1" })));
  return {
    tx: {
      receiptedBooking: {
        findFirst: vi.fn().mockResolvedValue(opts.existingRow ?? null),
        create,
      },
      contact: {
        findFirst: vi.fn().mockResolvedValue(opts.evidenceContact ?? null),
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
    const data = create.mock.calls[0]![0] as {
      data: {
        attributionConfidence: string;
        expectedValueAtIssue: number | null;
        currency: string | null;
        exceptions: Array<{ code: string; raisedAt: unknown }>;
      };
    };
    expect(data.data.attributionConfidence).toBe("deterministic");
    expect(data.data.expectedValueAtIssue).toBe(45000);
    expect(data.data.currency).toBe("SGD");
    expect(data.data.exceptions.map((e) => e.code)).toEqual(["missing_consent"]);
    expect(data.data.exceptions.every((e) => typeof e.raisedAt === "string")).toBe(true);
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
});
