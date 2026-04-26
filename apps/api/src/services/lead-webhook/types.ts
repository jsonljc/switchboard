export type SourceType = "tally" | "typeform" | "webflow" | "google-forms" | "generic";

export interface NormalizedLead {
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  source: string; // e.g., "website"
  sourceDetail?: string; // e.g., "tally:contact-form"
  metadata: {
    page?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    fbclid?: string;
    fbp?: string;
    extra?: Record<string, unknown>;
  };
  dedupeKey?: string; // optional client-supplied
}
