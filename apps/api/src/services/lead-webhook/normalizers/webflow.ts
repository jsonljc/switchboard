import type { NormalizedLead } from "../types.js";
import { normalizeGeneric } from "./generic.js";

export function normalizeWebflow(payload: Record<string, unknown>): NormalizedLead {
  const data = (payload.data as Record<string, unknown>) ?? payload;
  const out = normalizeGeneric(data);
  const formId = payload.formId ?? payload.form_id;
  if (formId) out.sourceDetail = `webflow:${String(formId)}`;
  else out.sourceDetail = "webflow";
  return out;
}
