import type { IntentClass, TemplateCategory } from "@switchboard/schemas";

export type Jurisdiction = "SG" | "MY";

/**
 * Where each template sits in the Meta App Review lifecycle.
 *
 * - "draft"     — authored in-repo, not yet submitted to Meta. Visible to the gate but never substituted.
 * - "submitted" — submitted to Meta, awaiting review. Visible to the gate but never substituted.
 * - "approved"  — Meta approved this template under metaTemplateName. Only status that can substitute in enforce mode.
 *
 * In enforce mode, the gate substitutes only entries with `approvalStatus === "approved"`.
 * Draft / submitted entries fall through to block + handoff with sub-cause "template_not_approved".
 */
export type TemplateApprovalStatus = "draft" | "submitted" | "approved";

/**
 * A WhatsApp template entry in the in-repo registry. Used by the Phase 1d window-gate hook
 * to substitute outbound free-form responses when the conversation is outside the 24h
 * customer-service window.
 *
 * Each body must pass the 1b-1 banned-phrase scanner AND the 1b-2 claim classifier — see
 * whatsapp-registry.test.ts for the cross-phase regression test (Task 5). The `approvalStatus`
 * field determines whether the runtime may actually substitute this entry; only Meta-approved
 * entries (`approvalStatus === "approved"`) are eligible.
 */
export interface WhatsAppTemplate {
  /** Internal name; also used in audit logs and tests. */
  name: string;
  /** The template name as submitted to Meta. */
  metaTemplateName: string;
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
  /** Meta-defined category. Propagated into substitute verdicts for downstream Phase 2 pricing. */
  templateCategory: TemplateCategory;
  /** Meta approval lifecycle. Only "approved" can substitute in enforce mode. */
  approvalStatus: TemplateApprovalStatus;
  /** Rendered body used for substitution. */
  body: string;
  /**
   * Variable placeholders, in Meta order. The order of this array MUST match the
   * `{{var_name}}` order in `body` — Meta substitutes by position ({{1}}, {{2}}, ...)
   * at send time. Use named placeholders in `body` for in-code readability.
   */
  variables: ReadonlyArray<{ name: string; description: string }>;
}

export const WHATSAPP_TEMPLATES: ReadonlyArray<WhatsAppTemplate> = [
  // Editing this array? Each entry is a Meta-submitted unit. To add or change a template:
  //  1. `name` must be unique (used in audit logs and tests).
  //  2. `metaTemplateName` must match the name submitted to Meta; updating it here without
  //     a corresponding Meta re-submission breaks substitution in production.
  //  3. Add or update the matching test case in whatsapp-registry.test.ts.
  //  4. The body MUST pass the 1b-1 banned-phrase scanner; the test file enforces this.
  //  5. Variables are indexed by position — the order of the array matches {{1}}, {{2}}, ...
  //     in Meta's template definition (we use named placeholders for in-code readability;
  //     Meta substitutes them by position at send time).
  //  6. Keep `approvalStatus: "draft"` until Meta approves; flip to "submitted" on submission
  //     and "approved" once Meta returns approval.
  {
    name: "appointment_confirm_sg_v1",
    metaTemplateName: "alex_appointment_confirm_sg_v1",
    intentClass: "appointment-confirm",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, your appointment with {{business_name}} on {{date}} at {{time}} is confirmed. " +
      "Please reply CONFIRM to lock it in, or reply RESCHEDULE if the time no longer works for you.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
      { name: "date", description: "Date of appointment (e.g. 12 May 2026)." },
      { name: "time", description: "Time of appointment (e.g. 3:00 PM)." },
    ],
  },
  {
    name: "appointment_confirm_my_v1",
    metaTemplateName: "alex_appointment_confirm_my_v1",
    intentClass: "appointment-confirm",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, your appointment with {{business_name}} on {{date}} at {{time}} is confirmed. " +
      "Please reply CONFIRM to lock it in, or reply RESCHEDULE if the time no longer works for you.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
      { name: "date", description: "Date of appointment (e.g. 12 May 2026)." },
      { name: "time", description: "Time of appointment (e.g. 3:00 PM)." },
    ],
  },
  {
    name: "appointment_reminder_sg_v1",
    metaTemplateName: "alex_appointment_reminder_sg_v1",
    intentClass: "appointment-reminder",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, a reminder that your appointment at {{business_name}} is tomorrow, {{date}} at {{time}}. " +
      "Reply CONFIRM to keep it or RESCHEDULE if you need to change.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
      { name: "date", description: "Date of appointment (e.g. 13 May 2026)." },
      { name: "time", description: "Time of appointment (e.g. 10:00 AM)." },
    ],
  },
  {
    name: "appointment_reminder_my_v1",
    metaTemplateName: "alex_appointment_reminder_my_v1",
    intentClass: "appointment-reminder",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, a reminder that your appointment at {{business_name}} is tomorrow, {{date}} at {{time}}. " +
      "Reply CONFIRM to keep it or RESCHEDULE if you need to change.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
      { name: "date", description: "Date of appointment (e.g. 13 May 2026)." },
      { name: "time", description: "Time of appointment (e.g. 10:00 AM)." },
    ],
  },
  {
    name: "aftercare_checkin_sg_v1",
    metaTemplateName: "alex_aftercare_checkin_sg_v1",
    intentClass: "aftercare-checkin",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, the team at {{business_name}} would like to check in after your recent visit. " +
      "How are you feeling? Please let us know if you have any questions or concerns.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
    ],
  },
  {
    name: "aftercare_checkin_my_v1",
    metaTemplateName: "alex_aftercare_checkin_my_v1",
    intentClass: "aftercare-checkin",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, the team at {{business_name}} would like to check in after your recent visit. " +
      "How are you feeling? Please let us know if you have any questions or concerns.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
    ],
  },
  {
    name: "consult_followup_sg_v1",
    metaTemplateName: "alex_consult_followup_sg_v1",
    intentClass: "consult-followup",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, following up on your recent consultation at {{business_name}}. " +
      "Let us know if you are ready to book your next appointment or if you have any questions.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
    ],
  },
  {
    name: "consult_followup_my_v1",
    metaTemplateName: "alex_consult_followup_my_v1",
    intentClass: "consult-followup",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, following up on your recent consultation at {{business_name}}. " +
      "Let us know if you are ready to book your next appointment or if you have any questions.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
    ],
  },
  {
    name: "re_engagement_offer_sg_v1",
    metaTemplateName: "alex_re_engagement_offer_sg_v1",
    intentClass: "re-engagement-offer",
    jurisdiction: "SG",
    templateCategory: "marketing",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, it has been a while since we last connected — we would love to see you at {{business_name}} again. " +
      "Reply BOOK to schedule a consultation, or STOP to opt out.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
    ],
  },
  {
    name: "re_engagement_offer_my_v1",
    metaTemplateName: "alex_re_engagement_offer_my_v1",
    intentClass: "re-engagement-offer",
    jurisdiction: "MY",
    templateCategory: "marketing",
    approvalStatus: "draft",
    body:
      "Hi {{lead_name}}, it has been a while since we last connected — we would love to see you at {{business_name}} again. " +
      "Reply BOOK to schedule a consultation, or STOP to opt out.",
    variables: [
      { name: "lead_name", description: "The lead's first name." },
      { name: "business_name", description: "The medspa's display name." },
    ],
  },
];

export function selectTemplate(args: {
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
}): WhatsAppTemplate | null {
  return (
    WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === args.intentClass && t.jurisdiction === args.jurisdiction,
    ) ?? null
  );
}

/**
 * An org-resolvable WhatsApp template-approval source. Maps a `metaTemplateName`
 * to the approval status Meta currently reports for THAT org's submission of the
 * template. Populated operator-/config-side (e.g. written when the template-create
 * route receives a Meta status, or driven by per-org config) and overlaid onto the
 * static registry at resolve time.
 *
 * Keyed by `metaTemplateName` (not internal `name`) because that is the identifier
 * Meta approves under and the identifier the gate substitutes/sends with. A missing
 * key means "no org-specific signal" — the static registry default applies, which
 * ships as `draft`, so the send gate keeps blocking by default. This is deliberately
 * NOT an all-approved default.
 */
export type TemplateApprovalOverlay = Readonly<Record<string, TemplateApprovalStatus>>;

const APPROVAL_STATUSES: ReadonlySet<TemplateApprovalStatus> = new Set([
  "draft",
  "submitted",
  "approved",
]);

function isApprovalStatus(value: unknown): value is TemplateApprovalStatus {
  return typeof value === "string" && APPROVAL_STATUSES.has(value as TemplateApprovalStatus);
}

/**
 * Parse a persisted/config-driven approval source (e.g. an org's
 * `runtimeConfig.whatsappTemplateApprovals` JSON bag) into a typed
 * {@link TemplateApprovalOverlay}. Defensive by construction:
 *
 *  - Non-object / null / array input → `{}` (no signal; static default governs).
 *  - Entries whose value is not a known approval status are dropped, so a corrupt
 *    or partially-written record can never silently unblock a send.
 *
 * Keys are `metaTemplateName` strings (matched by {@link resolveTemplate}); unknown
 * keys are harmless because they never match a registry template.
 */
export function parseTemplateApprovalOverlay(raw: unknown): TemplateApprovalOverlay {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, TemplateApprovalStatus> = {};
  for (const [metaTemplateName, status] of Object.entries(raw)) {
    if (isApprovalStatus(status)) out[metaTemplateName] = status;
  }
  return out;
}

/**
 * Resolve a template for `(intentClass, jurisdiction)` and overlay the org-resolvable
 * approval status when the source reports one for the template's `metaTemplateName`.
 *
 * - No fit → null (delegates to {@link selectTemplate}).
 * - No overlay entry → the static registry default (`draft`) is preserved, so the
 *   send-time gate and proactive-eligibility check keep blocking by default.
 * - Overlay entry present → a shallow copy with the resolved `approvalStatus`. The
 *   shared static registry object is never mutated, so concurrent readers are
 *   unaffected.
 */
export function resolveTemplate(args: {
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
  approvalOverlay?: TemplateApprovalOverlay;
}): WhatsAppTemplate | null {
  const template = selectTemplate({
    intentClass: args.intentClass,
    jurisdiction: args.jurisdiction,
  });
  if (!template) return null;
  const resolvedStatus = args.approvalOverlay?.[template.metaTemplateName];
  if (resolvedStatus === undefined || resolvedStatus === template.approvalStatus) {
    return template;
  }
  return { ...template, approvalStatus: resolvedStatus };
}
