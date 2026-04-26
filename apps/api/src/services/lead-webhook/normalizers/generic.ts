import type { NormalizedLead } from "../types.js";
import { matchAlias } from "../aliases.js";

const KNOWN_META_KEYS = new Set([
  "page",
  "url",
  "pageurl",
  "page_url",
  "utmsource",
  "utm_source",
  "utmmedium",
  "utm_medium",
  "utmcampaign",
  "utm_campaign",
  "utmterm",
  "utm_term",
  "utmcontent",
  "utm_content",
  "fbclid",
  "fbp",
  "fbc",
]);

const META_KEY_MAP: Record<string, string> = {
  page: "page",
  url: "page",
  pageurl: "page",
  page_url: "page",
  utm_source: "utmSource",
  utmsource: "utmSource",
  utm_medium: "utmMedium",
  utmmedium: "utmMedium",
  utm_campaign: "utmCampaign",
  utmcampaign: "utmCampaign",
  utm_term: "utmTerm",
  utmterm: "utmTerm",
  utm_content: "utmContent",
  utmcontent: "utmContent",
  fbclid: "fbclid",
  fbp: "fbp",
  fbc: "fbc",
};

export function normalizeGeneric(payload: Record<string, unknown>): NormalizedLead {
  const out: NormalizedLead = {
    source: "website",
    metadata: { extra: {} },
  };
  let firstName: string | undefined;
  let lastName: string | undefined;

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    const lower = key.toLowerCase();

    if (KNOWN_META_KEYS.has(lower)) {
      const metaKey = META_KEY_MAP[lower] ?? lower;
      (out.metadata as Record<string, unknown>)[metaKey] = String(value);
      continue;
    }

    if (lower === "dedupekey" || lower === "dedupe_key") {
      out.dedupeKey = String(value);
      continue;
    }

    const canonical = matchAlias(key);
    if (canonical === "phone") out.phone = String(value);
    else if (canonical === "email") out.email = String(value);
    else if (canonical === "name") out.name = String(value);
    else if (canonical === "firstName") firstName = String(value);
    else if (canonical === "lastName") lastName = String(value);
    else if (canonical === "message") out.message = String(value);
    else (out.metadata.extra as Record<string, unknown>)[key] = value;
  }

  if (!out.name && (firstName ?? lastName)) {
    out.name = [firstName, lastName].filter(Boolean).join(" ");
  }
  return out;
}
