import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDepositLinkToolFactory } from "./deposit-link.js";
import { GovernanceHook } from "../hooks/governance-hook.js";
import { getToolGovernanceDecision } from "../governance.js";
import type { TrustLevel } from "../governance-types.js";
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
    resolveCurrency: async (_deploymentId: string): Promise<"SGD" | "MYR" | null> => "SGD",
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
    // The default SG deployment charges SGD (behaviour unchanged for existing orgs).
    expect(deps._createDepositLink).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "SGD" }),
    );
  });

  it("charges in the currency derived from the deployment jurisdiction (MY -> MYR)", async () => {
    const d = { ...deps, resolveCurrency: async () => "MYR" as const };
    const tool = createDepositLinkToolFactory(d)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("success");
    expect(d._createDepositLink).toHaveBeenCalledWith(expect.objectContaining({ currency: "MYR" }));
  });

  it("fails closed and does NOT call the payment port when currency cannot be resolved", async () => {
    const d = { ...deps, resolveCurrency: async () => null };
    const tool = createDepositLinkToolFactory(d)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("CURRENCY_UNRESOLVED");
    // The safety invariant: no charge is issued in any currency when the market is unknown.
    expect(d._createDepositLink).not.toHaveBeenCalled();
    expect(d.paymentPortFactory).not.toHaveBeenCalled();
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

// Pins the go-live governance posture: live deposit-link issuance stays autonomous
// (auto-approve at every trust level), riding the booking's prior approval. See the
// design record docs/superpowers/specs/2026-06-13-deposit-issuance-governance-posture-design.md
// and the rationale comment in deposit-link.ts. These drive the REAL decision path
// (getToolGovernanceDecision + GovernanceHook.beforeToolCall), not a mock that assumes it.
describe("deposit.issue governance posture (rides booking approval, no per-issue gate)", () => {
  const TRUST_LEVELS: TrustLevel[] = ["supervised", "guided", "autonomous"];
  const confirmed = () => makeDeps({ id: "bk_1", organizationId: "org_1", status: "confirmed" });

  it("auto-approves at every trust level via the real policy table", () => {
    const op = createDepositLinkToolFactory(confirmed())(TEST_CONTEXT).operations["deposit.issue"]!;
    for (const trustLevel of TRUST_LEVELS) {
      expect(getToolGovernanceDecision(op, trustLevel)).toBe("auto-approve");
    }
  });

  it("the real GovernanceHook lets deposit.issue proceed (never pending_approval/denied)", async () => {
    const tool = createDepositLinkToolFactory(confirmed())(TEST_CONTEXT);
    const hook = new GovernanceHook(new Map([["deposit-link", tool]]));
    for (const trustLevel of TRUST_LEVELS) {
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

  it("is port-agnostic: the decision never resolves the payment port (live vs Noop is irrelevant)", async () => {
    const paymentPortFactory = vi.fn(async () => {
      throw new Error("port must not be resolved at governance-decision time");
    });
    const tool = createDepositLinkToolFactory({ ...confirmed(), paymentPortFactory })(TEST_CONTEXT);
    const hook = new GovernanceHook(new Map([["deposit-link", tool]]));
    const result = await hook.beforeToolCall({
      toolId: "deposit-link",
      operation: "deposit.issue",
      params: { bookingId: "bk_1" },
      effectCategory: "read",
      trustLevel: "supervised",
    });
    expect(result.proceed).toBe(true);
    expect(paymentPortFactory).not.toHaveBeenCalled();
  });
});
