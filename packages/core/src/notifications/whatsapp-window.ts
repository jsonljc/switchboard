/** WhatsApp 24-hour conversation window duration in milliseconds. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether we are inside the WhatsApp 24-hour conversation window. Outside the
 * window, only pre-approved template messages may be sent. Null inbound (e.g. a
 * CTWA-only / web-form lead) is treated as OUTSIDE — fail closed.
 */
export function isWithinWhatsAppWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}

export type WhatsAppTemplateConsentReason = "outside_window_no_consent";

/**
 * Whether a proactive WhatsApp template can be sent. Inside the window any
 * template is allowed (the inbound is implicit consent); outside, the contact
 * must have explicit messagingOptIn.
 */
export function canSendWhatsAppTemplate(args: {
  contact: { messagingOptIn: boolean };
  lastInboundAt: Date | null;
}): { allowed: true } | { allowed: false; reason: WhatsAppTemplateConsentReason } {
  if (isWithinWhatsAppWindow(args.lastInboundAt)) {
    return { allowed: true };
  }
  if (args.contact.messagingOptIn) {
    return { allowed: true };
  }
  return { allowed: false, reason: "outside_window_no_consent" };
}
