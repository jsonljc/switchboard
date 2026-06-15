/**
 * Composes the managed-webhook WhatsApp `onStatusUpdate` callback so delivery,
 * read, and failed receipts for REAL conversations are persisted to the
 * general-purpose status store, not just the test-send bridge.
 *
 * Audit finding (2026-06-15 meta-tech-provider, B/#6): the live inbound status
 * path fed ONLY the test-send bridge (`WhatsAppTestSend.lastWebhookStatus`), so
 * production conversation receipts were dropped on the floor. This wires the
 * existing `PrismaWhatsAppStatusStore` into that path while preserving the
 * test-send bridge as a downstream `next` handler.
 */

export interface WhatsAppStatusUpdate {
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errorCode?: string;
  errorTitle?: string;
  pricingCategory?: string;
  billable?: boolean;
}

/**
 * Minimal surface of `PrismaWhatsAppStatusStore` consumed here. Structural so
 * the handler is unit-testable with a plain mock and decoupled from the store
 * implementation.
 */
export interface StatusUpserter {
  upsert(input: WhatsAppStatusUpdate & { organizationId?: string }): Promise<unknown>;
}

export type StatusHandler = (status: WhatsAppStatusUpdate, orgId?: string) => Promise<void>;

/**
 * Build an `onStatusUpdate` handler that first persists the receipt to
 * `statusStore` (best-effort: a store failure is logged, never thrown, so it
 * cannot break the downstream bridge), then forwards to `next` (the existing
 * test-send bridge) when present. Persistence runs even without an `orgId` so
 * real-conversation receipts are no longer dropped.
 */
export function makeWhatsAppStatusHandler(opts: {
  statusStore: StatusUpserter | null | undefined;
  next?: StatusHandler;
}): StatusHandler {
  const { statusStore, next } = opts;
  return async (status, orgId) => {
    if (statusStore) {
      try {
        await statusStore.upsert({ ...status, organizationId: orgId });
      } catch (err) {
        console.error("[whatsapp-status] failed to persist inbound status", err);
      }
    }
    if (next) {
      await next(status, orgId);
    }
  };
}
