// ---------------------------------------------------------------------------
// Minimal Profile Builder — creates a BusinessProfile from org config data
// ---------------------------------------------------------------------------
// Used when no PROFILE_ID JSON file is available (e.g. SMBs onboarded via
// the setup wizard). Generates enough context for the StrategistAgent to
// create campaign plans.
// ---------------------------------------------------------------------------

import type { BusinessProfile } from "@switchboard/schemas";

/** Minimal org data needed to build a profile. */
export interface MinimalOrgData {
  orgId: string;
  businessName: string;
  skinId: string;
  timezone?: string;
}

/** Skin-to-vertical mapping with default service catalogs. */
const SKIN_DEFAULTS: Record<
  string,
  {
    type: string;
    services: Array<{ id: string; name: string; category: string }>;
    primaryKPI: string;
  }
> = {
  clinic: {
    type: "healthcare",
    services: [
      { id: "consultation", name: "Consultation", category: "Medical" },
      { id: "checkup", name: "Regular Checkup", category: "Medical" },
      { id: "treatment", name: "Treatment", category: "Medical" },
    ],
    primaryKPI: "appointments_booked",
  },
  gym: {
    type: "fitness",
    services: [
      { id: "membership", name: "Membership", category: "Fitness" },
      { id: "personal-training", name: "Personal Training", category: "Fitness" },
      { id: "group-class", name: "Group Class", category: "Fitness" },
    ],
    primaryKPI: "memberships_sold",
  },
  commerce: {
    type: "ecommerce",
    services: [
      { id: "products", name: "Products", category: "Retail" },
      { id: "shipping", name: "Shipping & Delivery", category: "Retail" },
    ],
    primaryKPI: "purchases",
  },
  generic: {
    type: "general_business",
    services: [{ id: "service", name: "General Service", category: "Business" }],
    primaryKPI: "leads_generated",
  },
};

/**
 * Build a minimal BusinessProfile from org configuration data.
 *
 * This creates enough context for agents (especially StrategistAgent) to
 * generate campaign plans without requiring a full JSON profile file.
 */
export function buildMinimalProfile(data: MinimalOrgData): BusinessProfile {
  const defaults = SKIN_DEFAULTS[data.skinId] ?? SKIN_DEFAULTS["generic"]!;

  return {
    id: `auto_${data.orgId}`,
    name: data.businessName,
    version: "1.0",

    business: {
      name: data.businessName,
      type: defaults.type,
      timezone: data.timezone,
    },

    services: {
      catalog: defaults.services,
    },

    journey: {
      stages: [
        { id: "new", name: "New Lead", metric: "lead_count", terminal: false },
        { id: "engaged", name: "Engaged", metric: "engagement_count", terminal: false },
        { id: "converted", name: "Converted", metric: defaults.primaryKPI, terminal: true },
      ],
      primaryKPI: defaults.primaryKPI,
    },
  };
}
