import { describe, it, expect } from "vitest";
import { BusinessProfileSchema } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validClinicProfile() {
  return {
    id: "clinic-demo",
    name: "Bright Smile Dental",
    version: "1.0.0",
    business: {
      name: "Bright Smile Dental",
      type: "dental",
      tagline: "Your smile, our passion",
      website: "https://brightsmile.example.com",
      phone: "+15551234567",
      timezone: "America/New_York",
    },
    services: {
      catalog: [
        {
          id: "cleaning",
          name: "Dental Cleaning",
          category: "preventive",
          typicalValue: 150,
          durationMinutes: 60,
        },
        {
          id: "whitening",
          name: "Teeth Whitening",
          category: "cosmetic",
          typicalValue: 350,
          durationMinutes: 90,
        },
      ],
      affinityMatrix: {
        cleaning: { whitening: 0.7 },
        whitening: { cleaning: 0.6 },
      },
    },
    team: [
      {
        id: "dr-chen",
        name: "Dr. Sarah Chen",
        role: "Lead Dentist",
        specialties: ["cosmetic", "implants"],
      },
    ],
    journey: {
      stages: [
        { id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false },
        { id: "qualified", name: "Qualified", metric: "qualified_leads", terminal: false },
        { id: "lost", name: "Lost", metric: "lost_customers", terminal: true },
      ],
      primaryKPI: "qualified_leads",
    },
    scoring: {
      referralValue: 200,
      noShowCost: 75,
      retentionDecayRate: 0.85,
      projectionYears: 5,
    },
    objectionTrees: [
      {
        category: "price",
        keywords: ["expensive", "cost"],
        response: "We offer payment plans.",
        followUp: "Want to learn more?",
      },
    ],
    cadenceTemplates: [
      {
        id: "reminder",
        name: "Consultation Reminder",
        trigger: "consultation_booked",
        steps: [
          {
            actionType: "customer-engagement.reminder.send",
            delayMs: 0,
            messageTemplate: "Booking confirmation",
            parameters: { contactId: "{{contactId}}" },
          },
        ],
      },
    ],
    compliance: {
      enableHipaaRedactor: true,
      enableMedicalClaimFilter: true,
      enableConsentGate: true,
    },
    reviewPlatforms: ["google", "yelp"],
    hours: {
      monday: { open: "08:00", close: "17:00" },
    },
    policies: [
      {
        topic: "Cancellation",
        content: "Cancel 24 hours in advance.",
      },
    ],
    llmContext: {
      systemPromptExtension: "Be empathetic.",
      persona: "dental coordinator",
      tone: "warm",
      bannedTopics: ["competitor pricing"],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BusinessProfileSchema", () => {
  it("validates a complete clinic profile", () => {
    const result = BusinessProfileSchema.safeParse(validClinicProfile());
    expect(result.success).toBe(true);
  });

  it("validates a minimal profile (only required fields)", () => {
    const minimal = {
      id: "minimal",
      name: "Minimal Biz",
      version: "0.1.0",
      business: {
        name: "Minimal Biz",
        type: "other",
      },
      services: {
        catalog: [{ id: "svc1", name: "Service One", category: "general" }],
      },
      journey: {
        stages: [{ id: "lead", name: "Lead", metric: "leads", terminal: false }],
        primaryKPI: "leads",
      },
    };
    const result = BusinessProfileSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const profile = validClinicProfile();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (profile as any).id;
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects missing business", () => {
    const profile = validClinicProfile();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (profile as any).business;
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects empty services catalog", () => {
    const profile = validClinicProfile();
    profile.services.catalog = [];
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects missing journey", () => {
    const profile = validClinicProfile();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (profile as any).journey;
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects empty journey stages", () => {
    const profile = validClinicProfile();
    profile.journey.stages = [];
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects negative typicalValue", () => {
    const profile = validClinicProfile();
    profile.services.catalog[0]!.typicalValue = -100;
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects retentionDecayRate > 1", () => {
    const profile = validClinicProfile();
    profile.scoring!.retentionDecayRate = 1.5;
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects empty objection tree keywords", () => {
    const profile = validClinicProfile();
    profile.objectionTrees![0]!.keywords = [];
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects cadence template with empty steps", () => {
    const profile = validClinicProfile();
    profile.cadenceTemplates![0]!.steps = [];
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("accepts profile without optional fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = validClinicProfile() as any;
    delete profile.team;
    delete profile.scoring;
    delete profile.objectionTrees;
    delete profile.cadenceTemplates;
    delete profile.compliance;
    delete profile.reviewPlatforms;
    delete profile.hours;
    delete profile.policies;
    delete profile.llmContext;
    delete profile.business.tagline;
    delete profile.business.website;
    delete profile.business.phone;
    delete profile.business.timezone;
    delete profile.services.affinityMatrix;
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("rejects invalid website URL", () => {
    const profile = validClinicProfile();
    profile.business.website = "not-a-url";
    const result = BusinessProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("validates the clinic-demo.json fixture", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(
      join(import.meta.dirname, "../../../../profiles/clinic-demo.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    const result = BusinessProfileSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("validates the gym-demo.json fixture", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(
      join(import.meta.dirname, "../../../../profiles/gym-demo.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    const result = BusinessProfileSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});
