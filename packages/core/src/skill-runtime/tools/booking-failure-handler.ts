import { randomUUID } from "node:crypto";

export interface BookingFailureInput {
  bookingId: string;
  orgId: string;
  contactId: string;
  service: string;
  provider: string;
  error: unknown;
  failureType: "provider_error" | "confirmation_failed";
  retryable: boolean;
}

export interface BookingFailureResult {
  bookingId: string;
  status: "failed";
  failureType: string;
  retryable: boolean;
  escalationId: string;
  message: string;
}

interface BookingStoreSubset {
  findById(bookingId: string): Promise<{ id: string; status: string } | null>;
}

interface EscalationLookup {
  findByBookingId(bookingId: string): Promise<{ id: string } | null>;
}

type FailureTransactionFn = (
  fn: (tx: {
    booking: {
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    escalationRecord: {
      create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    };
    outboxEvent: {
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
  }) => Promise<unknown>,
) => Promise<unknown>;

interface BookingFailureHandlerDeps {
  runTransaction: FailureTransactionFn;
  bookingStore: BookingStoreSubset;
  escalationLookup: EscalationLookup;
}

const SAFE_MESSAGE =
  "I couldn't complete the booking just now. I've flagged this for a human to follow up.";

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.length > 200) return msg.slice(0, 200) + "…";
    return msg;
  }
  return "Unknown error";
}

export class BookingFailureHandler {
  constructor(private deps: BookingFailureHandlerDeps) {}

  async handle(input: BookingFailureInput): Promise<BookingFailureResult> {
    const booking = await this.deps.bookingStore.findById(input.bookingId);
    if (booking?.status === "failed") {
      const existing = await this.deps.escalationLookup.findByBookingId(input.bookingId);
      return {
        bookingId: input.bookingId,
        status: "failed",
        failureType: input.failureType,
        retryable: input.retryable,
        escalationId: existing?.id ?? "unknown",
        message: SAFE_MESSAGE,
      };
    }

    const eventId = randomUUID();
    let escalationId = "";

    await this.deps.runTransaction(async (tx) => {
      await tx.booking.update({
        where: { id: input.bookingId },
        data: { status: "failed" },
      });

      const escalation = await tx.escalationRecord.create({
        data: {
          orgId: input.orgId,
          contactId: input.contactId,
          reason: "booking_failure",
          reasonDetails: sanitizeError(input.error),
          sourceAgent: "alex",
          priority: "high",
          status: "open",
          metadata: {
            bookingId: input.bookingId,
            provider: input.provider,
            failureType: input.failureType,
            retryable: input.retryable,
            service: input.service,
          },
        },
      });
      escalationId = escalation.id;

      await tx.outboxEvent.create({
        data: {
          eventId,
          type: "booking.failed",
          status: "pending",
          payload: {
            type: "booking.failed",
            contactId: input.contactId,
            organizationId: input.orgId,
            value: 0,
            occurredAt: new Date().toISOString(),
            source: "booking-failure-handler",
            metadata: {
              bookingId: input.bookingId,
              provider: input.provider,
              failureType: input.failureType,
              retryable: input.retryable,
              escalationId,
              service: input.service,
            },
          },
        },
      });
    });

    return {
      bookingId: input.bookingId,
      status: "failed",
      failureType: input.failureType,
      retryable: input.retryable,
      escalationId,
      message: SAFE_MESSAGE,
    };
  }
}
