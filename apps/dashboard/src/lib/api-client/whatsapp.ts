import type { WhatsAppCreateTemplateRequest } from "@switchboard/schemas";
import { SwitchboardBillingClient } from "./billing";

// WhatsApp management endpoints are mounted on the Fastify API under
// `/api/dashboard/whatsapp/*` and return a structured
// `{ error: { code, message, retryable } }` envelope on failure. The generic
// `request()` helper flattens that into `Error(body.error)` (→ "[object Object]")
// and drops the status, so these methods forward status + body faithfully
// instead, letting the Next route handlers relay them unchanged.
export class SwitchboardWhatsAppClient extends SwitchboardBillingClient {
  private async waForward(
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; data: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...init?.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  getWhatsAppAccount() {
    return this.waForward("/api/dashboard/whatsapp/account");
  }

  listWhatsAppPhoneNumbers() {
    return this.waForward("/api/dashboard/whatsapp/phone-numbers");
  }

  listWhatsAppTemplates() {
    return this.waForward("/api/dashboard/whatsapp/templates");
  }

  createWhatsAppTemplate(body: WhatsAppCreateTemplateRequest) {
    return this.waForward("/api/dashboard/whatsapp/templates", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Embedded Signup onboard. The route is mounted at prefix `/api/whatsapp` +
  // route `/whatsapp/onboard` -> `/api/whatsapp/whatsapp/onboard`. waForward
  // attaches the operator Bearer so the route can resolve the org from the auth
  // context (it 403s without an org binding).
  onboardWhatsAppEmbedded(body: {
    code?: string;
    esToken?: string;
    wabaId?: string;
    phoneNumberId?: string;
    organizationId?: string;
  }) {
    return this.waForward("/api/whatsapp/whatsapp/onboard", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
