// The deposit-link tool is registered into the skill runtime as part of the payment
// issuance wiring per spec §12 de-risk ordering (PR 1A-4d), whenever a per-org payment-port
// factory is injected (apps/api/src/bootstrap/skill-mode.ts). It rides a confirmed booking's
// prior approval and issues live only against an org with connected Stripe Connect
// credentials; otherwise the Noop adapter fails closed.
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import type { PaymentPort, SupportedCurrency } from "@switchboard/schemas";

/** Per-org PaymentPort resolver. Typed here (not imported from apps/api) so
 *  core stays at L3 — it depends only on the L1 PaymentPort type. The concrete
 *  factory is injected from apps/api at wiring time. */
export type PaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

/** Minimal booking row the tool needs to gate issuance. Injected so the durable
 *  booking store stays in db/apps and calendar-book.ts is untouched. */
interface BookingLookup {
  findById(
    orgId: string,
    bookingId: string,
  ): Promise<{ id: string; organizationId: string; status: string } | null>;
}

interface DepositLinkToolDeps {
  paymentPortFactory: PaymentPortFactory;
  findById: BookingLookup["findById"];
  /** Deposit amount in minor units (cents). Injected dep until per-org deposit
   *  pricing is wired. */
  depositAmountCents: number;
  /**
   * Resolves the clinic's settlement currency from its market, keyed by the trusted
   * `ctx.deploymentId` (never LLM input). Returns null when the market cannot be
   * resolved (no/corrupt governanceConfig). The tool fails CLOSED on null: a deposit
   * is never charged in a guessed currency. apps/api wires this to the same
   * governanceConfigResolver the gates use, so the charge currency and the gate
   * jurisdiction can never disagree.
   */
  resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>;
}

export type DepositLinkToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Exported input-schema constant — the single source of truth for the
 * deposit.issue input contract. The factory references it by value
 * (behaviour-preserving); the alex-conversation eval imports it so its mock tool
 * presents the EXACT production contract (EV-5/AGENT-5 mock-tool-blind gap).
 * orgId is ctx-injected (AI-1), so only bookingId appears here.
 */
export const DEPOSIT_LINK_ISSUE_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    bookingId: {
      type: "string",
      description: "The confirmed booking to attach a deposit to",
    },
  },
  required: ["bookingId"],
};

/**
 * Issues a first-party deposit link against an ALREADY-APPROVED, confirmed
 * booking. This is an idempotent external read riding on the booking's prior
 * approval — NO new approval is required (spec §8). `orgId` is sourced from the
 * trusted `SkillRequestContext`, never from LLM tool input (AI-1, mirrors
 * calendar-book.ts). The externalReference is deterministic per booking, so a
 * replay returns the same link.
 */
export function createDepositLinkToolFactory(deps: DepositLinkToolDeps): DepositLinkToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "deposit-link",
    operations: {
      "deposit.issue": {
        description:
          "Issue a deposit payment link for a confirmed booking. Idempotent; returns the same link on replay.",
        // effectCategory "read": an idempotent, inbound external read on an
        // already-confirmed booking. It must NOT trigger a new approval (spec
        // §8; design record 2026-06-13-deposit-issuance-governance-posture).
        // Rationale, affirmed at go-live:
        //  - Inbound collection, not outbound spend. The platform's governance
        //    doctrine (intent-registration.ts) auto-approves inbound recording
        //    that carries money (e.g. the payment.record_verified intent,
        //    system_auto_approved) and require_approves only OUTBOUND spend
        //    (spendBearing, F4 #978). A deposit link asks the customer to pay
        //    the clinic; no money moves until the customer actively pays.
        //  - It rides a higher governance class: the booking (calendar.book) is
        //    external_mutation; this read is strictly downstream of a confirmed
        //    booking.
        //  - A mid-loop per-issue approval is unrepresentable in skill-mode: a
        //    hook pending_approval is re-injected and the loop continues with no
        //    resume (skill-executor.ts), so require-approval here would block
        //    issuance with no human-approve-then-issue path and break the loop,
        //    not supervise it. The deliberate human control lives at per-org
        //    Stripe provisioning (fail-closed) and at booking confirmation.
        // The EffectCategory union has no 'external_read'; 'read' + idempotent is
        // the honest mapping. The posture is pinned by the governance test in
        // this file's sibling deposit-link.test.ts.
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: DEPOSIT_LINK_ISSUE_INPUT_SCHEMA,
        execute: async (params: unknown): Promise<ToolResult> => {
          const { bookingId } = params as { bookingId: string };
          // orgId is sourced from the trusted SkillRequestContext (AI-1).
          // params.organizationId is intentionally ignored — accepting orgId
          // from LLM tool input would allow a prompt-injection attack to
          // cross org boundaries (mirrors calendar-book.ts:154-159).
          const orgId = ctx.orgId;

          const booking = await deps.findById(orgId, bookingId);
          if (!booking) {
            return fail("MISSING_BOOKING", "No booking was found for this id.", {
              retryable: false,
              modelRemediation:
                "Do not issue a deposit link without a confirmed booking. Book the slot first.",
            });
          }
          if (booking.status !== "confirmed") {
            return fail(
              "BOOKING_NOT_CONFIRMED",
              "A deposit link can only be issued for a confirmed booking.",
              {
                retryable: false,
                modelRemediation:
                  "Confirm the booking before issuing a deposit link. Do not tell the customer to pay yet.",
              },
            );
          }

          // Resolve the clinic's currency from its market BEFORE touching the
          // payment port. Fail closed: a null currency means the market is unknown,
          // and no charge is strictly safer than a wrong-currency charge. For a
          // P2-A-seeded org this branch is unreachable (a config always resolves);
          // it is the defence-in-depth guarantee that money never moves blind.
          const currency = await deps.resolveCurrency(ctx.deploymentId);
          if (!currency) {
            return fail(
              "CURRENCY_UNRESOLVED",
              "The clinic's billing currency is not configured, so a deposit cannot be issued.",
              {
                retryable: false,
                modelRemediation:
                  "Do not ask the customer to pay. Hand off so an operator can finish billing setup.",
              },
            );
          }

          const port = await deps.paymentPortFactory(orgId);
          const link = await port.createDepositLink({
            bookingId,
            organizationId: orgId,
            amountCents: deps.depositAmountCents,
            currency,
          });

          return ok({
            url: link.url,
            externalReference: link.externalReference,
            amountCents: link.amountCents,
          });
        },
      },
    },
  });
}
