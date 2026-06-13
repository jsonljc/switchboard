import { describe, it, expect, vi } from "vitest";
import {
  buildDepositLinkToolFactory,
  PILOT_DEPOSIT_AMOUNT_CENTS,
  PILOT_DEPOSIT_CURRENCY,
} from "../deposit-link-wiring.js";
import { NoopPaymentAdapter } from "../noop-payment-adapter.js";
import { GovernanceHook } from "@switchboard/core/skill-runtime";
import type { PaymentPort, DepositLinkInput } from "@switchboard/schemas";

// Structurally matches SkillRequestContext without importing the type.
const CTX = {
  sessionId: "sess_1",
  orgId: "org_1",
  deploymentId: "dep_1",
  surface: "chat" as const,
};

function fakePort() {
  const createDepositLink = vi.fn(async (input: DepositLinkInput) => ({
    url: `https://pay.test/${input.bookingId}`,
    externalReference: `ref_${input.bookingId}`,
    amountCents: input.amountCents,
    currency: input.currency,
  }));
  const port: PaymentPort = { createDepositLink, retrievePayment: vi.fn(async () => null) };
  return { port, createDepositLink };
}

const confirmed = { id: "bk_1", organizationId: "org_1", status: "confirmed" };

describe("buildDepositLinkToolFactory", () => {
  it("resolves the pilot amount/currency server-side and passes them to the injected factory", async () => {
    const { port, createDepositLink } = fakePort();
    const factory = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById: vi.fn(async () => confirmed),
    });
    const result = await factory(CTX).operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("success");
    expect(createDepositLink).toHaveBeenCalledWith({
      bookingId: "bk_1",
      organizationId: "org_1",
      amountCents: PILOT_DEPOSIT_AMOUNT_CENTS,
      currency: PILOT_DEPOSIT_CURRENCY,
    });
  });

  it("enforces org-isolation: a booking in another org surfaces as MISSING_BOOKING", async () => {
    const { port, createDepositLink } = fakePort();
    const findBookingById = vi.fn(async () => ({
      id: "bk_1",
      organizationId: "other_org",
      status: "confirmed",
    }));
    const factory = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById,
    });
    const result = await factory(CTX).operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("MISSING_BOOKING");
    expect(findBookingById).toHaveBeenCalledWith("bk_1");
    expect(createDepositLink).not.toHaveBeenCalled();
  });

  it("ignores organizationId from tool params (AI-1): lookup uses ctx.orgId", async () => {
    const { port } = fakePort();
    const factory = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById: vi.fn(async () => confirmed),
    });
    const result = await factory(CTX).operations["deposit.issue"]!.execute({
      bookingId: "bk_1",
      organizationId: "attacker_org",
    });
    expect(result.status).toBe("success");
  });

  it("rejects an unconfirmed booking with BOOKING_NOT_CONFIRMED", async () => {
    const { port } = fakePort();
    const factory = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById: vi.fn(async () => ({
        id: "bk_1",
        organizationId: "org_1",
        status: "pending_confirmation",
      })),
    });
    const result = await factory(CTX).operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("BOOKING_NOT_CONFIRMED");
  });

  it("rejects a missing booking with MISSING_BOOKING", async () => {
    const { port } = fakePort();
    const factory = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById: vi.fn(async () => null),
    });
    const result = await factory(CTX).operations["deposit.issue"]!.execute({ bookingId: "nope" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("MISSING_BOOKING");
  });

  it("issues a link the webhook can re-fetch: issue -> retrievePayment round-trips through the SAME Noop adapter", async () => {
    const noop = new NoopPaymentAdapter();
    const factory = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => noop),
      findBookingById: vi.fn(async () => ({
        id: "bk_42",
        organizationId: "org_1",
        status: "confirmed",
      })),
    });
    const issued = await factory(CTX).operations["deposit.issue"]!.execute({ bookingId: "bk_42" });
    expect(issued.status).toBe("success");
    const externalReference = (issued.data as { externalReference: string }).externalReference;

    const charge = await noop.retrievePayment(externalReference);
    expect(charge).not.toBeNull();
    expect(charge!.amountCents).toBe(PILOT_DEPOSIT_AMOUNT_CENTS);
    expect(charge!.bookingId).toBe("bk_42");
    expect(charge!.provider).toBe("noop");
    expect(charge!.status).toBe("paid");
  });

  // Integration-boundary guard: the wired tool keeps the autonomous (auto-approve)
  // governance posture at every trust level. Drives the REAL GovernanceHook over the
  // tool as actually built by the wiring, so a wiring-level override or reclassification
  // (drift away from the rides-booking-approval decision) turns this red. See the design
  // record docs/superpowers/specs/2026-06-13-deposit-issuance-governance-posture-design.md.
  it("the wired tool auto-approves through the real GovernanceHook at every trust level (no wiring-level override)", async () => {
    const { port } = fakePort();
    const tool = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById: vi.fn(async () => confirmed),
    })(CTX);
    const hook = new GovernanceHook(new Map([["deposit-link", tool]]));
    for (const trustLevel of ["supervised", "guided", "autonomous"] as const) {
      const result = await hook.beforeToolCall({
        toolId: "deposit-link",
        operation: "deposit.issue",
        params: { bookingId: "bk_1" },
        effectCategory: "read",
        trustLevel,
      });
      expect(result.proceed).toBe(true);
      expect(result.decision).toBeUndefined();
    }
  });
});
