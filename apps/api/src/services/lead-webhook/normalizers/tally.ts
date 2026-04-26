import type { NormalizedLead } from "../types.js";
import { matchAlias } from "../aliases.js";

interface TallyField {
  key?: string;
  label?: string;
  type?: string;
  value?: unknown;
}

export function normalizeTally(payload: Record<string, unknown>): NormalizedLead {
  const data = (payload.data as Record<string, unknown>) ?? {};
  const fields = (data.fields as TallyField[]) ?? [];
  const out: NormalizedLead = { source: "website", metadata: { extra: {} } };
  let firstName: string | undefined;
  let lastName: string | undefined;

  for (const f of fields) {
    if (f.value === undefined || f.value === null || f.value === "") continue;
    const value = String(Array.isArray(f.value) ? f.value.join(", ") : f.value);
    const labelOrKey = f.label ?? f.key ?? "";
    const canonical = matchAlias(labelOrKey);
    if (canonical === "phone") out.phone = value;
    else if (canonical === "email") out.email = value;
    else if (canonical === "name") out.name = value;
    else if (canonical === "firstName") firstName = value;
    else if (canonical === "lastName") lastName = value;
    else if (canonical === "message") out.message = value;
    else (out.metadata.extra as Record<string, unknown>)[labelOrKey] = value;
  }

  if (!out.name && (firstName || lastName)) {
    out.name = [firstName, lastName].filter(Boolean).join(" ");
  }

  const formId = (data.formId as string) ?? (data.form_id as string);
  out.sourceDetail = formId ? `tally:${formId}` : "tally";

  // Tally exposes a stable submissionId — use it as a natural dedupeKey so retries collapse.
  const submissionId = (data.submissionId as string) ?? (data.responseId as string);
  if (submissionId) out.dedupeKey = `tally:${submissionId}`;

  return out;
}
