/**
 * Authorizes a stable channel identity (e.g. WhatsApp phone, Telegram user id) to act as a
 * specific Principal for actions that require operator authority — primarily approval
 * response from chat.
 *
 * This is a surface→actor binding, distinct from the customer/lead `Contact` namespace.
 * Conceptually generalizable to any channel surface (chat, voice, email) that needs to
 * authorize an inbound endpoint to mutate governance state on behalf of an internal actor.
 *
 * Authorization rule (enforced at the call site, NOT in the store): a chat approval
 * succeeds only when the binding is `active` AND the resolved Principal carries one of
 * the authorized roles (approver, operator, admin). The store is the lookup mechanism;
 * role enforcement belongs to the caller because role lookup happens against a
 * separate Principal store and the role set may evolve independently.
 */
export interface OperatorChannelBindingRecord {
  id: string;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  principalId: string;
  status: "active" | "revoked";
  createdBy: string;
  revokedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperatorChannelBindingStore {
  /**
   * Look up a binding by its stable channel identity. Returns null if no row exists OR
   * if the row is revoked — callers MUST NOT see revoked bindings as authoritative.
   */
  findActiveBinding(args: {
    organizationId: string;
    channel: string;
    channelIdentifier: string;
  }): Promise<OperatorChannelBindingRecord | null>;
}
