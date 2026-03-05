// ---------------------------------------------------------------------------
// Profile-Driven Behavior Tests — verifies that profile injection changes
// scoring, objection handling, cadence resolution, and journey validation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BusinessProfile } from "@switchboard/schemas";
import { computeLTV, DEFAULT_LTV_CONFIG } from "../core/scoring/ltv-score.js";
import type { LTVScoringConfig } from "../core/scoring/ltv-score.js";
import { computeLeadScore } from "../core/scoring/lead-score.js";
import { computeServiceAffinity } from "../core/scoring/service-affinity.js";
import { matchObjection } from "../agents/intake/objection-trees.js";
import { resolveCadenceTemplates, DEFAULT_CADENCE_TEMPLATES } from "../cadence/templates.js";
import { CUSTOMER_JOURNEY_SCHEMA, DEFAULT_JOURNEY_STAGE_IDS } from "../core/types.js";
import { bootstrapCustomerEngagementCartridge } from "../cartridge/bootstrap.js";

// --- Test Profiles ---

const clinicProfile: BusinessProfile = {
  id: "test-clinic",
  name: "Test Clinic",
  version: "1.0.0",
  business: { name: "Test Clinic", type: "dental" },
  services: {
    catalog: [
      {
        id: "cleaning",
        name: "Cleaning",
        category: "preventive",
        typicalValue: 150,
        durationMinutes: 60,
      },
    ],
  },
  journey: {
    stages: [
      { id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false },
      { id: "qualified", name: "Qualified", metric: "qualified_leads", terminal: false },
      {
        id: "service_completed",
        name: "Service Done",
        metric: "services_completed",
        terminal: false,
      },
      { id: "dormant", name: "Dormant", metric: "dormant", terminal: true },
    ],
    primaryKPI: "services_completed",
  },
  scoring: {
    referralValue: 500,
    noShowCost: 100,
    retentionDecayRate: 0.9,
    projectionYears: 7,
  },
  objectionTrees: [
    {
      category: "custom_price",
      keywords: ["expensive", "cost"],
      response: "Custom response about pricing",
      followUp: "Custom follow-up?",
    },
  ],
  compliance: {
    enableHipaaRedactor: true,
    enableConsentGate: true,
    enableMedicalClaimFilter: true,
  },
};

const gymProfile: BusinessProfile = {
  id: "test-gym",
  name: "Test Gym",
  version: "1.0.0",
  business: { name: "Test Gym", type: "gym" },
  services: {
    catalog: [
      {
        id: "pt-single",
        name: "PT Session",
        category: "training",
        typicalValue: 80,
        durationMinutes: 60,
      },
    ],
  },
  journey: {
    stages: [
      { id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false },
      { id: "trial_booked", name: "Trial Booked", metric: "trials_booked", terminal: false },
      { id: "active_member", name: "Active Member", metric: "active_members", terminal: false },
      { id: "dormant", name: "Inactive", metric: "dormant", terminal: true },
    ],
    primaryKPI: "active_members",
  },
  scoring: {
    referralValue: 150,
    noShowCost: 30,
    retentionDecayRate: 0.8,
    projectionYears: 3,
  },
  compliance: {
    enableHipaaRedactor: false,
    enableConsentGate: false,
    enableMedicalClaimFilter: false,
  },
};

// --- Tests ---

describe("Profile-Driven Behavior", () => {
  describe("LTV Scoring", () => {
    const baseInput = {
      averageServiceValue: 200,
      visitFrequencyPerYear: 2,
      retentionYears: 5,
      referralCount: 1,
      noShowCount: 1,
      totalVisits: 10,
    };

    it("uses default constants when no config is provided", () => {
      const result = computeLTV(baseInput);
      expect(result.estimatedLTV).toBeGreaterThan(0);
      // Verify it used default referralValue (200) and noShowCost (75)
      expect(result.components.referralValue).toBe(DEFAULT_LTV_CONFIG.referralValue);
      expect(result.components.noShowCost).toBe(DEFAULT_LTV_CONFIG.noShowCost);
    });

    it("uses profile scoring config when provided", () => {
      const config: LTVScoringConfig = clinicProfile.scoring;
      const result = computeLTV(baseInput, config);
      // Profile has referralValue=500, noShowCost=100
      expect(result.components.referralValue).toBe(500);
      expect(result.components.noShowCost).toBe(100);
    });

    it("produces different LTV for different profiles", () => {
      const clinicResult = computeLTV(baseInput, clinicProfile.scoring);
      const gymResult = computeLTV(baseInput, gymProfile.scoring);
      // Different scoring configs should produce different LTV estimates
      expect(clinicResult.estimatedLTV).not.toBe(gymResult.estimatedLTV);
    });
  });

  describe("Lead Scoring", () => {
    const baseInput = {
      serviceValue: 300,
      urgencyLevel: 7,
      hasInsurance: true,
      isReturning: false,
      source: "referral" as const,
      engagementScore: 8,
      responseSpeedMs: 120_000,
      hasMedicalHistory: false,
      budgetIndicator: 6,
      eventDriven: false,
    };

    it("uses default weights when no config is provided", () => {
      const result = computeLeadScore(baseInput);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("applies custom weights from profile", () => {
      const customWeights = { treatmentValue: 40, urgency: 5 };
      const defaultResult = computeLeadScore(baseInput);
      const customResult = computeLeadScore(baseInput, customWeights);
      // Custom weights (treatmentValue=40 vs default 20) should change the score
      expect(customResult.score).not.toBe(defaultResult.score);
    });
  });

  describe("Service Affinity", () => {
    it("uses hardcoded matrix when no custom matrix is provided", () => {
      const result = computeServiceAffinity({
        currentService: "dental_cleaning",
        ageRange: "36-45",
        budgetIndicator: 5,
        previousServices: [],
      });
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it("uses custom affinity matrix from profile", () => {
      const customMatrix: Record<string, Record<string, number>> = {
        cleaning: { whitening: 0.9, checkup: 0.8 },
      };
      const result = computeServiceAffinity(
        {
          currentService: "cleaning",
          ageRange: "36-45",
          budgetIndicator: 5,
          previousServices: [],
        },
        customMatrix,
      );
      expect(result.recommendations.length).toBeGreaterThan(0);
      // Should recommend whitening with a high score
      const whitening = result.recommendations.find((r) => r.treatment === "whitening");
      expect(whitening).toBeDefined();
      expect(whitening!.affinityScore).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("Objection Matching", () => {
    it("uses default objection trees when no profile trees are provided", () => {
      const result = matchObjection("This is too expensive for me");
      expect(result).not.toBeNull();
      expect(result!.category).toBe("price");
    });

    it("uses profile-specific objection trees when provided", () => {
      const result = matchObjection("This is too expensive", clinicProfile.objectionTrees);
      expect(result).not.toBeNull();
      expect(result!.category).toBe("custom_price");
      expect(result!.response).toBe("Custom response about pricing");
    });

    it("returns null when no match in custom trees", () => {
      const result = matchObjection("I want to fly to the moon", clinicProfile.objectionTrees);
      expect(result).toBeNull();
    });
  });

  describe("Cadence Templates", () => {
    it("returns default templates when none provided", () => {
      const result = resolveCadenceTemplates();
      expect(result).toBe(DEFAULT_CADENCE_TEMPLATES);
      expect(result.length).toBe(5);
    });

    it("returns profile templates when provided", () => {
      const customTemplates = [
        {
          id: "custom",
          name: "Custom",
          description: "Custom cadence",
          trigger: { event: "test" },
          steps: [],
        },
      ];
      const result = resolveCadenceTemplates(customTemplates as any);
      expect(result.length).toBe(1);
      expect(result[0]!.id).toBe("custom");
    });
  });

  describe("Journey Stage Validation", () => {
    it("default stages match CUSTOMER_JOURNEY_SCHEMA", () => {
      const schemaStageIds = CUSTOMER_JOURNEY_SCHEMA.stages.map((s) => s.id);
      expect(DEFAULT_JOURNEY_STAGE_IDS).toEqual(schemaStageIds);
    });

    it("journey stage IDs are open strings (profile-defined stages work)", () => {
      const gymStageIds = gymProfile.journey.stages.map((s) => s.id);
      // Gym has custom stages like "trial_booked" and "active_member"
      expect(gymStageIds).toContain("trial_booked");
      expect(gymStageIds).toContain("active_member");
      // These are valid strings, not blocked by a union type
      expect(typeof gymStageIds[0]).toBe("string");
    });
  });

  describe("Bootstrap with Profile", () => {
    it("bootstraps with no profile (all interceptors enabled by default)", async () => {
      const { interceptors } = await bootstrapCustomerEngagementCartridge();
      // With no profile, all three interceptors should be active (default = true)
      expect(interceptors.length).toBe(3);
    });

    it("bootstraps with clinic profile (HIPAA enabled)", async () => {
      const { interceptors } = await bootstrapCustomerEngagementCartridge({}, clinicProfile);
      // Clinic profile enables all compliance interceptors
      expect(interceptors.length).toBe(3);
    });

    it("bootstraps with gym profile (no HIPAA)", async () => {
      const { interceptors } = await bootstrapCustomerEngagementCartridge({}, gymProfile);
      // Gym profile disables all compliance interceptors
      expect(interceptors.length).toBe(0);
    });

    it("sets profile on cartridge instance", async () => {
      const { cartridge } = await bootstrapCustomerEngagementCartridge({}, clinicProfile);
      // The cartridge should have the profile set (via getProfile if available)
      const ceCartridge = cartridge as any;
      expect(ceCartridge.getProfile?.()).toEqual(clinicProfile);
    });

    it("profile-driven LTV scoring through execute", async () => {
      const { cartridge } = await bootstrapCustomerEngagementCartridge({}, clinicProfile);
      const result = await cartridge.execute(
        "customer-engagement.contact.score_ltv",
        {
          contactId: "test-1",
          averageServiceValue: 200,
          visitFrequency: 2,
          retentionYears: 5,
          referralCount: 1,
          noShowCount: 1,
        },
        { principalId: "test", organizationId: null, connectionCredentials: {} },
      );
      expect(result.success).toBe(true);
      // Profile has referralValue=500 (not default 200) and noShowCost=100 (not default 75)
      const data = result.data as { components: { referralValue: number; noShowCost: number } };
      expect(data.components.referralValue).toBe(500);
      expect(data.components.noShowCost).toBe(100);
    });

    it("profile-driven journey stage validation through execute", async () => {
      const { cartridge } = await bootstrapCustomerEngagementCartridge({}, gymProfile);

      // "active_member" is a valid stage in gym profile but not in defaults
      const validResult = await cartridge.execute(
        "customer-engagement.journey.update_stage",
        { contactId: "test-1", newStage: "active_member" },
        { principalId: "test", organizationId: null, connectionCredentials: {} },
      );
      expect(validResult.success).toBe(true);

      // "consultation_booked" is NOT a valid stage in gym profile
      const invalidResult = await cartridge.execute(
        "customer-engagement.journey.update_stage",
        { contactId: "test-1", newStage: "consultation_booked" },
        { principalId: "test", organizationId: null, connectionCredentials: {} },
      );
      expect(invalidResult.success).toBe(false);
    });
  });
});
