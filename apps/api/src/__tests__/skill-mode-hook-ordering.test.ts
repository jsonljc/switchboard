import { describe, it, expect } from "vitest";

// This test captures the Phase 1c hook-ordering invariant by static-source
// inspection of bootstrap/skill-mode.ts. We can't easily instantiate the
// bootstrap (it requires a real PrismaClient, Anthropic API key, etc.), so we
// rely on text-pattern checks for the canonical hook array shape.
//
// If skill-mode.ts changes the order or skips a hook, this test fails and
// forces the change to be intentional.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillModePath = resolve(__dirname, "../bootstrap/skill-mode.ts");
const source = readFileSync(skillModePath, "utf-8");

describe("skill-mode hook chain ordering (Phase 1d)", () => {
  it("registers hooks in the order: GovernanceHook, safetyGateHook, claimClassifierHook, pdpaConsentGateHook, whatsAppWindowGateHook", () => {
    // Locate the `const hooks = [...]` array literal in the production executor.
    const match = source.match(
      /const hooks = \[\s*new GovernanceHook\([^)]*\),\s*safetyGateHook,\s*claimClassifierHook,\s*pdpaConsentGateHook,\s*whatsAppWindowGateHook,?\s*\]/,
    );
    expect(match).not.toBeNull();
  });

  it("simulationHooks chain mirrors the production order with SimulationPolicyHook last", () => {
    const match = source.match(
      /const simulationHooks = \[\s*new GovernanceHook\([^)]*\),\s*safetyGateHook,\s*claimClassifierHook,\s*pdpaConsentGateHook,\s*whatsAppWindowGateHook,\s*new SimulationPolicyHook\(\),?\s*\]/,
    );
    expect(match).not.toBeNull();
  });

  it("pdpaConsentGateHook is constructed with the third posture cache instance", () => {
    expect(source).toMatch(/const consentPostureCache = new InMemoryGovernancePostureCache\(\)/);
    expect(source).toMatch(/new PdpaConsentGateHook\(\{[\s\S]*?postureCache: consentPostureCache/);
  });
});
