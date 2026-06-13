// DEFERRED — not yet registered into the skill runtime.
// The deposit-link tool is wired into the skill runtime as part of the payment issuance
// wiring per spec §12 de-risk ordering (PR 1A-4d). Until the live Stripe adapter lands and
// the per-org payment-port factory is wired in apps/api, this module is defined + tested but
// intentionally not registered. It is not dead code.
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import type { PaymentPort } from "@switchboard/schemas";

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
   *  pricing is wired (mirrors calendar-book.ts defaultCurrency convention). */
  depositAmountCents: number;
  /** ISO-4217 currency for the deposit link. */
  defaultCurrency: string;
}

export type DepositLinkToolFactory = (ctx: SkillRequestContext) => SkillTool;

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
        inputSchema: {
          type: "object",
          properties: {
            bookingId: {
              type: "string",
              description: "The confirmed booking to attach a deposit to",
            },
          },
          required: ["bookingId"],
        },
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

          const port = await deps.paymentPortFactory(orgId);
          const link = await port.createDepositLink({
            bookingId,
            organizationId: orgId,
            amountCents: deps.depositAmountCents,
            currency: deps.defaultCurrency,
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
