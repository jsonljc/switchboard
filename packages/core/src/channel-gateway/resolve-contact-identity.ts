import type { GatewayContactStore } from "./types.js";

export interface ResolvedContactIdentity {
  contactId: string | null;
  phone: string | null;
  channel: string;
}

export async function resolveContactIdentity(args: {
  channel: string;
  sessionId: string;
  organizationId: string;
  contactStore: GatewayContactStore;
}): Promise<ResolvedContactIdentity> {
  const { channel, sessionId, organizationId, contactStore } = args;

  if (channel !== "whatsapp") {
    return { contactId: null, phone: null, channel };
  }

  const phone = sessionId;
  const existing = await contactStore.findByPhone(organizationId, phone);
  if (existing) {
    return { contactId: existing.id, phone, channel };
  }

  const created = await contactStore.create({
    organizationId,
    phone,
    primaryChannel: "whatsapp",
    source: "whatsapp_inbound",
  });
  return { contactId: created.id, phone, channel };
}
