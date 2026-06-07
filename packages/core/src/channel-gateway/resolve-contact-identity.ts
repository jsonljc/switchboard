import { normalizeToE164 } from "@switchboard/schemas";
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
  region?: "SG" | "MY";
}): Promise<ResolvedContactIdentity> {
  const { channel, sessionId, organizationId, contactStore, region } = args;

  if (channel !== "whatsapp") {
    return { contactId: null, phone: null, channel };
  }

  // Normalize the WhatsApp wa_id to canonical E.164 so a bare id resolves the
  // same Contact a +-stored CTWA lead created. Fall back to the raw id when the
  // number cannot be normalized without guessing a country (refuse-to-guess).
  const phone = normalizeToE164(sessionId, region) ?? sessionId;
  const existing = await contactStore.findByPhone(organizationId, phone);
  if (existing) {
    return { contactId: existing.id, phone, channel };
  }

  const created = await contactStore.create({
    organizationId,
    phone,
    primaryChannel: "whatsapp",
    source: "whatsapp_inbound",
    messagingOptIn: true,
    messagingOptInSource: "organic_inbound",
  });
  return { contactId: created.id, phone, channel };
}
