import type { PrismaWhatsAppTestSendStore, WebhookStatus } from "@switchboard/db";

const ACCEPTED: ReadonlySet<WebhookStatus> = new Set<WebhookStatus>([
  "sent",
  "delivered",
  "read",
  "failed",
]);

interface BridgeDeps {
  testSendStore: Pick<PrismaWhatsAppTestSendStore, "updateWebhookStatus">;
}

export interface StatusUpdate {
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
}

export interface WhatsAppStatusBridge {
  onStatusUpdate(update: StatusUpdate, orgId: string): Promise<void>;
}

export function buildWhatsAppStatusBridge(deps: BridgeDeps): WhatsAppStatusBridge {
  return {
    async onStatusUpdate(update: StatusUpdate, orgId: string): Promise<void> {
      if (!ACCEPTED.has(update.status as WebhookStatus)) return;
      await deps.testSendStore.updateWebhookStatus({
        messageId: update.messageId,
        status: update.status as WebhookStatus,
        at: update.timestamp,
        ...(orgId ? { organizationId: orgId } : {}),
      });
    },
  };
}
