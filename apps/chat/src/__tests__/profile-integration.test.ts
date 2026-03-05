import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  SkinLoader,
  SkinResolver,
  ToolRegistry,
  ProfileLoader,
  ProfileResolver,
} from "@switchboard/core";
import type { ResolvedSkin, ResolvedProfile } from "@switchboard/core";
import { BusinessProfileSchema } from "@switchboard/schemas";
import { bootstrapCustomerEngagementCartridge } from "@switchboard/customer-engagement";
import { SkinAwareInterpreter } from "../interpreter/skin-aware-interpreter.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SKINS_DIR = resolve(ROOT, "skins");
const PROFILES_DIR = resolve(ROOT, "profiles");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSkinAndProfile(
  skinId: string,
  profileId: string,
): Promise<{ resolvedSkin: ResolvedSkin; resolvedProfile: ResolvedProfile }> {
  // Bootstrap the customer-engagement cartridge to get its manifest
  const { cartridge } = await bootstrapCustomerEngagementCartridge();

  // Build tool registry
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerCartridge("customer-engagement", cartridge.manifest);

  // Load and resolve skin
  const skinLoader = new SkinLoader(SKINS_DIR);
  const skinResolver = new SkinResolver();
  const skin = await skinLoader.load(skinId);
  const resolvedSkin = skinResolver.resolve(skin, toolRegistry);

  // Load and resolve profile
  const profileLoader = new ProfileLoader(PROFILES_DIR);
  const profile = await profileLoader.load(profileId);
  const profileResolver = new ProfileResolver();
  const resolvedProfile = profileResolver.resolve(profile);

  return { resolvedSkin, resolvedProfile };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Profile Integration — Multi-Vertical", () => {
  describe("clinic skin + clinic profile", () => {
    let resolvedSkin: ResolvedSkin;
    let resolvedProfile: ResolvedProfile;

    it("loads clinic skin and clinic profile successfully", async () => {
      const result = await loadSkinAndProfile("clinic", "clinic-demo");
      resolvedSkin = result.resolvedSkin;
      resolvedProfile = result.resolvedProfile;

      expect(resolvedSkin).toBeDefined();
      expect(resolvedProfile).toBeDefined();
    });

    it("clinic profile has HIPAA compliance enabled", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("clinic", "clinic-demo");
        resolvedProfile = result.resolvedProfile;
      }
      expect(resolvedProfile.compliance.enableHipaaRedactor).toBe(true);
      expect(resolvedProfile.compliance.enableMedicalClaimFilter).toBe(true);
      expect(resolvedProfile.compliance.enableConsentGate).toBe(true);
    });

    it("clinic bootstrap enables HIPAA interceptor", async () => {
      const profileJson = JSON.parse(
        readFileSync(resolve(PROFILES_DIR, "clinic-demo.json"), "utf-8"),
      );
      const profile = BusinessProfileSchema.parse(profileJson);
      const { interceptors } = await bootstrapCustomerEngagementCartridge({}, profile);

      const interceptorNames = interceptors.map((i) => i.constructor.name);
      expect(interceptorNames).toContain("HIPAARedactor");
      expect(interceptorNames).toContain("MedicalClaimFilter");
      expect(interceptorNames).toContain("ConsentGate");
    });

    it("clinic profile has dental-specific objection trees", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("clinic", "clinic-demo");
        resolvedProfile = result.resolvedProfile;
      }
      expect(resolvedProfile.objectionTrees.length).toBeGreaterThan(0);
      const categories = resolvedProfile.objectionTrees.map((t) => t.category);
      expect(categories).toContain("price");
      expect(categories).toContain("fear"); // dental-specific
      expect(categories).toContain("insurance"); // dental-specific
    });

    it("clinic profile has dental journey stages", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("clinic", "clinic-demo");
        resolvedProfile = result.resolvedProfile;
      }
      const stageIds = resolvedProfile.journey.stages.map((s) => s.id);
      expect(stageIds).toContain("consultation_booked");
      expect(stageIds).toContain("service_proposed");
      expect(stageIds).toContain("repeat_customer");
      expect(resolvedProfile.journey.primaryKPI).toBe("services_completed");
    });

    it("clinic skin uses guarded governance", async () => {
      if (!resolvedSkin) {
        const result = await loadSkinAndProfile("clinic", "clinic-demo");
        resolvedSkin = result.resolvedSkin;
      }
      expect(resolvedSkin.governance.profile).toBe("guarded");
    });

    it("clinic skin has customer-engagement tools", async () => {
      if (!resolvedSkin) {
        const result = await loadSkinAndProfile("clinic", "clinic-demo");
        resolvedSkin = result.resolvedSkin;
      }
      expect(resolvedSkin.tools.length).toBeGreaterThan(0);
      const actionTypes = resolvedSkin.tools.map((t) => t.actionType);
      expect(actionTypes.every((at) => at.startsWith("customer-engagement."))).toBe(true);
    });

    it("clinic system prompt includes business context", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("clinic", "clinic-demo");
        resolvedProfile = result.resolvedProfile;
      }
      const fragment = resolvedProfile.systemPromptFragment;
      expect(fragment).toContain("Bright Smile Dental");
      expect(fragment).toContain("dental");
      expect(fragment).toContain("Dental Cleaning");
      expect(fragment).toContain("Dr. Sarah Chen");
    });
  });

  describe("gym skin + gym profile", () => {
    let resolvedSkin: ResolvedSkin;
    let resolvedProfile: ResolvedProfile;

    it("loads gym skin and gym profile successfully", async () => {
      const result = await loadSkinAndProfile("gym", "gym-demo");
      resolvedSkin = result.resolvedSkin;
      resolvedProfile = result.resolvedProfile;

      expect(resolvedSkin).toBeDefined();
      expect(resolvedProfile).toBeDefined();
    });

    it("gym profile has NO HIPAA compliance", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("gym", "gym-demo");
        resolvedProfile = result.resolvedProfile;
      }
      expect(resolvedProfile.compliance.enableHipaaRedactor).toBe(false);
      expect(resolvedProfile.compliance.enableMedicalClaimFilter).toBe(false);
    });

    it("gym bootstrap does NOT enable HIPAA interceptor", async () => {
      const profileJson = JSON.parse(readFileSync(resolve(PROFILES_DIR, "gym-demo.json"), "utf-8"));
      const profile = BusinessProfileSchema.parse(profileJson);
      const { interceptors } = await bootstrapCustomerEngagementCartridge({}, profile);

      const interceptorNames = interceptors.map((i) => i.constructor.name);
      expect(interceptorNames).not.toContain("HIPAARedactor");
      expect(interceptorNames).not.toContain("MedicalClaimFilter");
      // Consent gate is still enabled for gym
      expect(interceptorNames).toContain("ConsentGate");
    });

    it("gym profile has gym-specific objection trees", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("gym", "gym-demo");
        resolvedProfile = result.resolvedProfile;
      }
      expect(resolvedProfile.objectionTrees.length).toBeGreaterThan(0);
      const categories = resolvedProfile.objectionTrees.map((t) => t.category);
      expect(categories).toContain("price");
      expect(categories).toContain("intimidation"); // gym-specific
      expect(categories).toContain("commitment"); // gym-specific
      expect(categories).not.toContain("fear"); // dental-specific
    });

    it("gym profile has membership journey stages", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("gym", "gym-demo");
        resolvedProfile = result.resolvedProfile;
      }
      const stageIds = resolvedProfile.journey.stages.map((s) => s.id);
      expect(stageIds).toContain("trial_booked"); // gym-specific
      expect(stageIds).toContain("trial_completed"); // gym-specific
      expect(stageIds).toContain("active_member"); // gym-specific
      expect(resolvedProfile.journey.primaryKPI).toBe("active_members");
    });

    it("gym skin uses standard governance", async () => {
      if (!resolvedSkin) {
        const result = await loadSkinAndProfile("gym", "gym-demo");
        resolvedSkin = result.resolvedSkin;
      }
      expect(resolvedSkin.governance.profile).toBe("observe");
    });

    it("gym skin has customer-engagement tools", async () => {
      if (!resolvedSkin) {
        const result = await loadSkinAndProfile("gym", "gym-demo");
        resolvedSkin = result.resolvedSkin;
      }
      expect(resolvedSkin.tools.length).toBeGreaterThan(0);
      const actionTypes = resolvedSkin.tools.map((t) => t.actionType);
      expect(actionTypes.every((at) => at.startsWith("customer-engagement."))).toBe(true);
      // Gym excludes treatment.* tools
      expect(actionTypes.some((at) => at.includes(".treatment."))).toBe(false);
    });

    it("gym system prompt includes business context", async () => {
      if (!resolvedProfile) {
        const result = await loadSkinAndProfile("gym", "gym-demo");
        resolvedProfile = result.resolvedProfile;
      }
      const fragment = resolvedProfile.systemPromptFragment;
      expect(fragment).toContain("Peak Performance Fitness");
      expect(fragment).toContain("gym");
      expect(fragment).toContain("Personal Training Session");
      expect(fragment).toContain("Mike Torres");
    });
  });

  describe("both verticals use customer-engagement action types", () => {
    it("clinic and gym both use customer-engagement.* action types", async () => {
      const clinic = await loadSkinAndProfile("clinic", "clinic-demo");
      const gym = await loadSkinAndProfile("gym", "gym-demo");

      const clinicActions = clinic.resolvedSkin.tools.map((t) => t.actionType);
      const gymActions = gym.resolvedSkin.tools.map((t) => t.actionType);

      // Both use customer-engagement prefix
      for (const action of clinicActions) {
        expect(action).toMatch(/^customer-engagement\./);
      }
      for (const action of gymActions) {
        expect(action).toMatch(/^customer-engagement\./);
      }

      // They share common actions (appointment, lead, etc.)
      const commonActions = clinicActions.filter((a) => gymActions.includes(a));
      expect(commonActions.length).toBeGreaterThan(5);
    });
  });

  describe("SkinAwareInterpreter with different verticals", () => {
    it("builds interpreter with clinic skin + profile", async () => {
      const { resolvedSkin, resolvedProfile } = await loadSkinAndProfile("clinic", "clinic-demo");
      const interpreter = new SkinAwareInterpreter(
        {
          apiKey: "test",
          model: "claude-3-5-haiku-20241022",
          baseUrl: "https://api.anthropic.com",
        },
        { adAccountId: "act_test" },
        { skin: resolvedSkin, profile: resolvedProfile },
      );

      expect(interpreter.name).toBe("skin-aware");
      expect(interpreter.getResolvedSkin()).toBe(resolvedSkin);
      expect(interpreter.getResolvedProfile()).toBe(resolvedProfile);
    });

    it("builds interpreter with gym skin + profile", async () => {
      const { resolvedSkin, resolvedProfile } = await loadSkinAndProfile("gym", "gym-demo");
      const interpreter = new SkinAwareInterpreter(
        {
          apiKey: "test",
          model: "claude-3-5-haiku-20241022",
          baseUrl: "https://api.anthropic.com",
        },
        { adAccountId: "act_test" },
        { skin: resolvedSkin, profile: resolvedProfile },
      );

      expect(interpreter.name).toBe("skin-aware");
      expect(interpreter.getResolvedSkin()).toBe(resolvedSkin);
      expect(interpreter.getResolvedProfile()!.profile.business.name).toBe(
        "Peak Performance Fitness",
      );
    });

    it("different profiles produce different scoring configs", async () => {
      const clinic = await loadSkinAndProfile("clinic", "clinic-demo");
      const gym = await loadSkinAndProfile("gym", "gym-demo");

      expect(clinic.resolvedProfile.scoring.referralValue).toBe(200);
      expect(gym.resolvedProfile.scoring.referralValue).toBe(150);
      expect(clinic.resolvedProfile.scoring.projectionYears).toBe(5);
      expect(gym.resolvedProfile.scoring.projectionYears).toBe(3);
    });

    it("different profiles produce different LLM personas", async () => {
      const clinic = await loadSkinAndProfile("clinic", "clinic-demo");
      const gym = await loadSkinAndProfile("gym", "gym-demo");

      expect(clinic.resolvedProfile.llmContext.persona).toBe("friendly dental office coordinator");
      expect(gym.resolvedProfile.llmContext.persona).toBe("enthusiastic fitness coordinator");
      expect(clinic.resolvedProfile.llmContext.tone).toBe("warm and professional");
      expect(gym.resolvedProfile.llmContext.tone).toBe("energetic and supportive");
    });
  });

  describe("profile-driven cartridge behavior", () => {
    it("clinic profile injects HIPAA and consent interceptors", async () => {
      const clinicProfile = BusinessProfileSchema.parse(
        JSON.parse(readFileSync(resolve(PROFILES_DIR, "clinic-demo.json"), "utf-8")),
      );
      const { cartridge, interceptors } = await bootstrapCustomerEngagementCartridge(
        {},
        clinicProfile,
      );

      // Profile was set on cartridge
      expect(cartridge.manifest.id).toBe("customer-engagement");
      expect(interceptors.length).toBe(3); // HIPAA + Consent + MedicalClaim
    });

    it("gym profile skips HIPAA and medical claim interceptors", async () => {
      const gymProfile = BusinessProfileSchema.parse(
        JSON.parse(readFileSync(resolve(PROFILES_DIR, "gym-demo.json"), "utf-8")),
      );
      const { interceptors } = await bootstrapCustomerEngagementCartridge({}, gymProfile);

      expect(interceptors.length).toBe(1); // Only ConsentGate
      expect(interceptors[0]!.constructor.name).toBe("ConsentGate");
    });
  });
});
