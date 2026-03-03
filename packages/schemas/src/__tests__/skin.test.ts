import { describe, it, expect } from "vitest";
import { SkinManifestSchema } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validClinicSkin() {
  return {
    id: "clinic",
    name: "Dental Clinic",
    version: "1.0.0",
    description: "Skin for dental clinic operations",
    tools: {
      include: ["patient-engagement.*"],
      exclude: ["patient-engagement.internal.*"],
      aliases: { book_appointment: "patient-engagement.appointment.book" },
    },
    governance: {
      profile: "guarded",
      spendLimits: { dailyUsd: 500, weeklyUsd: 2000 },
      approvalRouting: {
        defaultApprovers: ["clinic-admin"],
        channelPreference: "whatsapp",
      },
    },
    language: {
      locale: "en",
      interpreterSystemPrompt: "You are a dental clinic assistant.",
      terminology: { campaign: "treatment plan" },
      replyTemplates: {
        greeting: "Welcome to {{clinicName}}!",
      },
    },
    playbooks: [
      {
        id: "new-patient",
        name: "New Patient Intake",
        trigger: "register new patient",
        steps: [
          { actionType: "patient-engagement.patient.register" },
          {
            actionType: "patient-engagement.appointment.book",
            parameterDefaults: { type: "initial-consultation" },
          },
        ],
      },
    ],
    requiredCartridges: ["patient-engagement"],
    channels: {
      primary: "whatsapp",
      enabled: ["whatsapp", "telegram"],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkinManifestSchema", () => {
  it("validates a complete clinic skin", () => {
    const result = SkinManifestSchema.safeParse(validClinicSkin());
    expect(result.success).toBe(true);
  });

  it("validates a minimal skin", () => {
    const minimal = {
      id: "minimal",
      name: "Minimal Skin",
      version: "0.1.0",
      description: "Bare minimum",
      tools: { include: ["crm.*"] },
      governance: { profile: "observe" },
      language: { locale: "en" },
      requiredCartridges: ["crm"],
    };
    const result = SkinManifestSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const skin = validClinicSkin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (skin as any).id;
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });

  it("rejects empty include array", () => {
    const skin = validClinicSkin();
    skin.tools.include = [];
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });

  it("rejects invalid governance profile", () => {
    const skin = validClinicSkin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (skin.governance as any).profile = "yolo";
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });

  it("rejects empty requiredCartridges", () => {
    const skin = validClinicSkin();
    skin.requiredCartridges = [];
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });

  it("rejects playbook with more than 10 steps", () => {
    const skin = validClinicSkin();
    skin.playbooks = [
      {
        id: "too-many",
        name: "Too Many Steps",
        trigger: "do everything",
        steps: Array.from({ length: 11 }, (_, i) => ({
          actionType: `action.step${i}`,
        })),
      },
    ];
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });

  it("rejects playbook with zero steps", () => {
    const skin = validClinicSkin();
    skin.playbooks = [
      {
        id: "empty",
        name: "Empty",
        trigger: "nothing",
        steps: [],
      },
    ];
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });

  it("accepts all governance profiles", () => {
    for (const profile of ["observe", "guarded", "strict", "locked"]) {
      const skin = validClinicSkin();
      skin.governance.profile = profile;
      const result = SkinManifestSchema.safeParse(skin);
      expect(result.success).toBe(true);
    }
  });

  it("accepts skin without optional fields", () => {
    const skin = validClinicSkin();
    delete skin.playbooks;
    delete skin.channels;
    delete skin.tools.exclude;
    delete skin.tools.aliases;
    delete skin.governance.spendLimits;
    delete skin.governance.approvalRouting;
    delete skin.language.interpreterSystemPrompt;
    delete skin.language.terminology;
    delete skin.language.replyTemplates;
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(true);
  });

  it("rejects negative spend limits", () => {
    const skin = validClinicSkin();
    skin.governance.spendLimits = { dailyUsd: -100 };
    const result = SkinManifestSchema.safeParse(skin);
    expect(result.success).toBe(false);
  });
});
