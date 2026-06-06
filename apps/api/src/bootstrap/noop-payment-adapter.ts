import type {
  PaymentPort,
  DepositLinkInput,
  DepositLink,
  VerifiedPayment,
} from "@switchboard/schemas";

/**
 * In-process, side-effect-free PaymentPort used to prove the deposit mechanics
 * without Stripe-Connect onboarding (spec §2). Per R1 it is DEGRADED: every
 * payment it returns carries provider='noop' and must never be counted as a
 * real (T1) production paid visit. The Stripe Connect adapter (PR 1A-4b) lands
 * behind this same port.
 */
export class NoopPaymentAdapter implements PaymentPort {
  // Maps a deterministic externalReference -> the cents issued, so an issued
  // link's amount round-trips through retrievePayment. Process-lifetime only.
  private readonly issued = new Map<string, { amountCents: number; currency: string }>();

  async createDepositLink(input: DepositLinkInput): Promise<DepositLink> {
    const externalReference = `noop_pay_${input.bookingId}`;
    this.issued.set(externalReference, {
      amountCents: input.amountCents,
      currency: input.currency,
    });
    return {
      url: `https://pay.noop.switchboard.local/${externalReference}`,
      externalReference,
      amountCents: input.amountCents,
      currency: input.currency,
    };
  }

  async retrievePayment(externalReference: string): Promise<VerifiedPayment | null> {
    const issued = this.issued.get(externalReference);
    if (!issued) {
      // Unknown reference: a real PSP returns null; Noop does the same so the
      // verified writer's not-found branch is exercisable.
      return null;
    }
    return {
      provider: "noop",
      externalReference,
      amountCents: issued.amountCents,
      currency: issued.currency,
      status: "paid",
    };
  }
}

export function isNoopPaymentAdapter(port: PaymentPort): boolean {
  return port instanceof NoopPaymentAdapter;
}
