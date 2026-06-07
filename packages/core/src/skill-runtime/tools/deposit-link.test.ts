import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDepositLinkToolFactory } from "./deposit-link.js";
import type { SkillRequestContext } from "../types.js";
import type { PaymentPort, DepositLinkInput } from "@switchboard/schemas";

const TEST_CONTEXT: SkillRequestContext = {
  sessionId: "sess_1",
  orgId: "org_1",
  deploymentId: "deploy_1",
  surface: "chat",
};

function makeDeps(booking: { id: string; organizationId: string; status: string } | null) {
  const createDepositLink = vi.fn(async (input: DepositLinkInput) => ({
    url: `https://pay.noop/${input.bookingId}`,
    externalReference: `noop_pay_${input.bookingId}`,
    amountCents: input.amountCents,
    currency: input.currency,
  }));
  const paymentPort: PaymentPort = {
    createDepositLink,
    retrievePayment: vi.fn(async () => null),
  };
  const findById = vi.fn(async (_orgId: string, _bookingId: string) => booking);
  return {
    paymentPortFactory: vi.fn(async (_orgId: string) => paymentPort),
    findById,
    depositAmountCents: 5000,
    defaultCurrency: "SGD",
    _createDepositLink: createDepositLink,
  };
}

describe("deposit-link tool factory", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps({ id: "bk_1", organizationId: "org_1", status: "confirmed" });
  });

  it("factory returns a tool with id 'deposit-link'", () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    expect(tool.id).toBe("deposit-link");
  });

  it("issues a deposit link for a confirmed booking", async () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      url: "https://pay.noop/bk_1",
      externalReference: "noop_pay_bk_1",
      amountCents: 5000,
    });
  });

  it("fails MISSING_BOOKING when the booking does not exist", async () => {
    const d = makeDeps(null);
    const tool = createDepositLinkToolFactory(d)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "nope" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("MISSING_BOOKING");
  });

  it("fails BOOKING_NOT_CONFIRMED when the booking is not confirmed", async () => {
    const d = makeDeps({ id: "bk_1", organizationId: "org_1", status: "pending_confirmation" });
    const tool = createDepositLinkToolFactory(d)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("BOOKING_NOT_CONFIRMED");
  });

  it("sources orgId from ctx, never from params (AI-1)", async () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    await tool.operations["deposit.issue"]!.execute({
      bookingId: "bk_1",
      organizationId: "attacker_org",
    });
    expect(deps.findById).toHaveBeenCalledWith("org_1", "bk_1");
  });

  it("is idempotent: same bookingId yields the same externalReference", async () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    const a = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    const b = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(a.data!.externalReference).toBe(b.data!.externalReference);
  });
});
