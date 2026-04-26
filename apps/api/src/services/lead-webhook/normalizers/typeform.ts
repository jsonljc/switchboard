import type { NormalizedLead } from "../types.js";
import { matchAlias, type CanonicalField } from "../aliases.js";

interface TypeformField {
  id?: string;
  ref?: string;
  type?: string;
  title?: string;
}
interface TypeformAnswer {
  type?: string;
  text?: string;
  email?: string;
  phone_number?: string;
  number?: number;
  boolean?: boolean;
  choice?: { label?: string };
  choices?: { labels?: string[] };
  date?: string;
  url?: string;
  field?: TypeformField;
}

function answerValue(ans: TypeformAnswer): string | undefined {
  if (ans.text !== undefined) return ans.text;
  if (ans.email !== undefined) return ans.email;
  if (ans.phone_number !== undefined) return ans.phone_number;
  if (ans.number !== undefined) return String(ans.number);
  if (ans.boolean !== undefined) return String(ans.boolean);
  if (ans.choice?.label) return ans.choice.label;
  if (ans.choices?.labels) return ans.choices.labels.join(", ");
  if (ans.date) return ans.date;
  if (ans.url) return ans.url;
  return undefined;
}

function classify(field: TypeformField | undefined): CanonicalField | null {
  if (!field) return null;
  return matchAlias(field.ref ?? "") ?? matchAlias(field.title ?? "");
}

export function normalizeTypeform(payload: Record<string, unknown>): NormalizedLead {
  const fr = payload.form_response as Record<string, unknown> | undefined;
  if (!fr) return { source: "website", metadata: { extra: {} }, sourceDetail: "typeform" };

  const answers = (fr.answers as TypeformAnswer[]) ?? [];
  const hidden = (fr.hidden as Record<string, unknown>) ?? {};
  const formId = (fr.form_id as string) ?? "";

  const out: NormalizedLead = { source: "website", metadata: { extra: {} } };
  let firstName: string | undefined;
  let lastName: string | undefined;

  for (const ans of answers) {
    const value = answerValue(ans);
    if (!value) continue;
    const canonical = classify(ans.field);
    const label = ans.field?.title ?? ans.field?.ref ?? "unknown";
    if (canonical === "phone") out.phone = value;
    else if (canonical === "email") out.email = value;
    else if (canonical === "name") out.name = value;
    else if (canonical === "firstName") firstName = value;
    else if (canonical === "lastName") lastName = value;
    else if (canonical === "message") out.message = value;
    else (out.metadata.extra as Record<string, unknown>)[label] = value;
  }

  if (!out.name && (firstName || lastName)) {
    out.name = [firstName, lastName].filter(Boolean).join(" ");
  }

  // Lift recognized keys out of hidden into metadata
  for (const [k, v] of Object.entries(hidden)) {
    const lower = k.toLowerCase();
    if (lower === "page" || lower === "url") out.metadata.page = String(v);
    else if (lower === "utm_source") out.metadata.utmSource = String(v);
    else if (lower === "utm_medium") out.metadata.utmMedium = String(v);
    else if (lower === "utm_campaign") out.metadata.utmCampaign = String(v);
    else if (lower === "fbclid") out.metadata.fbclid = String(v);
    else if (lower === "fbp") out.metadata.fbp = String(v);
    else (out.metadata.extra as Record<string, unknown>)[k] = v;
  }

  out.sourceDetail = formId ? `typeform:${formId}` : "typeform";

  // Typeform exposes a stable response token — use it as a natural dedupeKey.
  const token = fr.token as string | undefined;
  if (token) out.dedupeKey = `typeform:${token}`;

  return out;
}
