import type { NormalizedLead } from "../types.js";
import { normalizeGeneric } from "./generic.js";

export function normalizeGoogleForms(payload: Record<string, unknown>): NormalizedLead {
  const out = normalizeGeneric(payload);
  out.sourceDetail = "google-forms";
  return out;
}
