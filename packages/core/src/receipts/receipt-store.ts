import type {
  Receipt,
  ReceiptKind,
  ReceiptTier,
  ReceiptStatus,
  ReceiptEvidence,
  ReceiptExceptionReason,
} from "@switchboard/schemas";

/** Forwarded opaque tx context (mirrors lifecycle/revenue-store.ts ReceiptStoreTransactionContext). */
export type ReceiptStoreTransactionContext = unknown;

export interface MintReceiptInput {
  organizationId: string;
  kind: ReceiptKind;
  tier: ReceiptTier;
  status: ReceiptStatus;
  bookingId?: string | null;
  opportunityId?: string | null;
  revenueEventId?: string | null;
  connectionId?: string | null;
  provider?: string | null;
  externalRef?: string | null;
  amount?: number | null;
  currency?: string | null;
  evidence: ReceiptEvidence;
  capturedBy: string;
  verifiedAt?: Date | null;
  workTraceId?: string | null;
  exceptions?: ReceiptExceptionReason[];
}

export interface ReceiptStore {
  mint(input: MintReceiptInput, tx?: ReceiptStoreTransactionContext): Promise<Receipt>;
  findByBooking(orgId: string, bookingId: string): Promise<Receipt[]>;
}
