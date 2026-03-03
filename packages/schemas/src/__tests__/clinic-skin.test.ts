import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SkinManifestSchema } from "../skin.js";

// Resolve from packages/schemas/src/__tests__/ up to repo root /skins/
const skinsDir = join(import.meta.dirname, "../../../../skins");

// Dynamically discover all skin JSON files
const skinFiles = readdirSync(skinsDir).filter((f) => f.endsWith(".json"));

describe("skin manifest validation (all skins)", () => {
  it("has at least one skin file", () => {
    expect(skinFiles.length).toBeGreaterThan(0);
  });

  for (const file of skinFiles) {
    describe(`skins/${file}`, () => {
      const raw = readFileSync(join(skinsDir, file), "utf-8");
      const parsed = JSON.parse(raw);

      it("parses as valid JSON", () => {
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe("object");
      });

      it("validates against SkinManifestSchema", () => {
        const result = SkinManifestSchema.safeParse(parsed);
        if (!result.success) {
          console.error(`${file} validation errors:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      });

      it("id matches filename", () => {
        const expectedId = file.replace(".json", "");
        expect(parsed.id).toBe(expectedId);
      });

      it("has at least one required cartridge", () => {
        expect(parsed.requiredCartridges.length).toBeGreaterThan(0);
      });

      it("playbook steps do not exceed max of 10", () => {
        if (parsed.playbooks) {
          for (const playbook of parsed.playbooks) {
            expect(playbook.steps.length).toBeLessThanOrEqual(10);
          }
        }
      });
    });
  }
});

// Keep existing clinic-specific tests
describe("clinic skin manifest (detailed)", () => {
  const raw = readFileSync(join(skinsDir, "clinic.json"), "utf-8");
  const parsed = JSON.parse(raw);

  it("has correct id", () => {
    expect(parsed.id).toBe("clinic");
  });

  it("requires patient-engagement cartridge", () => {
    expect(parsed.requiredCartridges).toContain("patient-engagement");
  });

  it("includes patient-engagement tools", () => {
    expect(parsed.tools.include).toContain("patient-engagement.*");
  });

  it("excludes diagnostic/internal tools", () => {
    expect(parsed.tools.exclude).toContain("patient-engagement.pipeline.*");
  });

  it("declares WhatsApp as primary channel", () => {
    expect(parsed.channels.primary).toBe("whatsapp");
  });

  it("uses guarded governance profile", () => {
    expect(parsed.governance.profile).toBe("guarded");
  });

  it("defines spend limits", () => {
    expect(parsed.governance.spendLimits.dailyUsd).toBeGreaterThan(0);
    expect(parsed.governance.spendLimits.weeklyUsd).toBeGreaterThan(0);
    expect(parsed.governance.spendLimits.monthlyUsd).toBeGreaterThan(0);
  });

  it("has policy overrides for approval-requiring actions", () => {
    expect(parsed.governance.policyOverrides.length).toBeGreaterThanOrEqual(2);
    const actionTypes = parsed.governance.policyOverrides.map(
      (p: { rule: { actionType: string } }) => p.rule.actionType,
    );
    expect(actionTypes).toContain("patient-engagement.appointment.cancel");
    expect(actionTypes).toContain("patient-engagement.review.respond");
  });

  it("defines 3 playbooks", () => {
    expect(parsed.playbooks).toHaveLength(3);
    const ids = parsed.playbooks.map((p: { id: string }) => p.id);
    expect(ids).toContain("new-patient-intake");
    expect(ids).toContain("post-treatment-followup");
    expect(ids).toContain("appointment-reschedule");
  });

  it("defines clinic-specific terminology", () => {
    expect(parsed.language.terminology.contact).toBe("patient");
    expect(parsed.language.terminology.campaign).toBe("treatment plan");
    expect(parsed.language.terminology.lead).toBe("prospective patient");
  });

  it("defines tool aliases for common actions", () => {
    expect(parsed.tools.aliases.book_appointment).toBe("patient-engagement.appointment.book");
    expect(parsed.tools.aliases.send_reminder).toBe("patient-engagement.reminder.send");
    expect(parsed.tools.aliases.log_treatment).toBe("patient-engagement.treatment.log");
  });
});
