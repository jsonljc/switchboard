/**
 * Single canonical resolver for the WhatsApp Cloud API **send** token used by the
 * api service's proactive outbound paths (appointment reminders, lead greetings,
 * follow-ups) and the escalation-reply agentNotifier in app.ts.
 *
 * Historically two env names addressed the same token: app.ts read `WHATSAPP_TOKEN`
 * while the proactive workflows read `WHATSAPP_ACCESS_TOKEN`. A deploy that set only
 * one name left half the send paths dark. This helper collapses both reads to one
 * resolution order so a single env value covers every api send call site.
 *
 * `WHATSAPP_ACCESS_TOKEN` is the canonical key; `WHATSAPP_TOKEN` is a supported
 * alias kept for backward compatibility. This is the Cloud API *send* token only —
 * the app-scoped provisioning token (`WHATSAPP_GRAPH_TOKEN`) is a separate credential
 * and is intentionally NOT consulted here.
 */
export function resolveWhatsAppSendToken(): string | undefined {
  return process.env["WHATSAPP_ACCESS_TOKEN"] ?? process.env["WHATSAPP_TOKEN"];
}
