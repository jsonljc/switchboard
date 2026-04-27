/**
 * Builds the managed-channel webhook path used by the chat server's
 * inbound webhook handler. Mirrored regex pin lives in
 * apps/chat/src/__tests__/whatsapp-wiring.test.ts — keep them in sync.
 */
export function buildManagedWebhookPath(connectionId: string): string {
  return `/webhook/managed/${connectionId}`;
}
