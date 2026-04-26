import type { NormalizedLead, SourceType } from "../types.js";
import { normalizeGeneric } from "./generic.js";
import { normalizeTally } from "./tally.js";
import { normalizeTypeform } from "./typeform.js";
import { normalizeWebflow } from "./webflow.js";
import { normalizeGoogleForms } from "./google-forms.js";

export type Normalizer = (payload: Record<string, unknown>) => NormalizedLead;

const REGISTRY: Record<SourceType, Normalizer> = {
  generic: normalizeGeneric,
  tally: normalizeTally,
  typeform: normalizeTypeform,
  webflow: normalizeWebflow,
  "google-forms": normalizeGoogleForms,
};

export function getNormalizer(sourceType: SourceType): Normalizer {
  const fn = REGISTRY[sourceType];
  if (!fn) throw new Error(`unknown sourceType: ${sourceType}`);
  return fn;
}
