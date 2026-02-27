import { describe, it, expect } from "vitest";
import { CartridgeTestHarness } from "../test-harness.js";
import { TestCartridge, createTestManifest } from "../testing.js";
import type { CartridgeManifest } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function validManifest(): CartridgeManifest {
  return createTestManifest({
    id: "test-cartridge",
    name: "Test Cartridge",
    version: "1.0.0",
    description: "A test cartridge for harness tests",
    actions: [
      {
        actionType: "test.resource.create",
        name: "Create Resource",
        description: "Creates a test resource",
        parametersSchema: { type: "object" },
        baseRiskCategory: "low",
        reversible: true,
      },
      {
        actionType: "test.resource.delete",
        name: "Delete Resource",
        description: "Deletes a test resource",
        parametersSchema: { type: "object" },
        baseRiskCategory: "medium",
        reversible: false,
      },
    ],
    requiredConnections: ["test-api"],
  });
}

// ---------------------------------------------------------------------------
// 1. CartridgeTestHarness.run()
// ---------------------------------------------------------------------------
describe("CartridgeTestHarness", () => {
  it("valid TestCartridge passes all harness steps", async () => {
    const cartridge = new TestCartridge(validManifest());
    const harness = new CartridgeTestHarness(cartridge);
    const report = await harness.run();

    expect(report.passed).toBe(true);
    expect(report.cartridgeId).toBe("test-cartridge");
    expect(report.steps.every((s) => s.passed)).toBe(true);
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);

    const stepNames = report.steps.map((s) => s.step);
    expect(stepNames).toContain("validate-manifest");
    expect(stepNames).toContain("initialize");
    expect(stepNames).toContain("enrich-context");
    expect(stepNames).toContain("get-risk-input");
    expect(stepNames).toContain("get-guardrails");
    expect(stepNames).toContain("execute");
    expect(stepNames).toContain("health-check");
  });

  it("uses first action from manifest when actionType omitted", async () => {
    const cartridge = new TestCartridge(validManifest());
    const harness = new CartridgeTestHarness(cartridge);
    const report = await harness.run();

    expect(report.passed).toBe(true);
  });

  it("accepts explicit actionType and parameters", async () => {
    const cartridge = new TestCartridge(validManifest());
    const harness = new CartridgeTestHarness(cartridge, {
      actionType: "test.resource.delete",
      parameters: { id: "res-123" },
    });
    const report = await harness.run();

    expect(report.passed).toBe(true);
  });

  it("skipExecute skips the execute step", async () => {
    const cartridge = new TestCartridge(validManifest());
    const harness = new CartridgeTestHarness(cartridge, { skipExecute: true });
    const report = await harness.run();

    expect(report.passed).toBe(true);
    const stepNames = report.steps.map((s) => s.step);
    expect(stepNames).not.toContain("execute");
    expect(stepNames).toContain("validate-manifest");
    expect(stepNames).toContain("health-check");
  });

  it("reports failure when manifest is invalid", async () => {
    const badManifest = createTestManifest({
      id: "",
      name: "",
      version: "bad",
      description: "",
      actions: [],
    });
    const cartridge = new TestCartridge(badManifest);
    const harness = new CartridgeTestHarness(cartridge);
    const report = await harness.run();

    expect(report.passed).toBe(false);
    const manifestStep = report.steps.find((s) => s.step === "validate-manifest");
    expect(manifestStep?.passed).toBe(false);
    expect(manifestStep?.error).toBeDefined();
  });

  it("includes capture-snapshot step when method exists", async () => {
    const manifest = validManifest();
    const cartridge = new TestCartridge(manifest);
    // Add captureSnapshot method
    (cartridge as unknown as Record<string, unknown>)["captureSnapshot"] = async () => ({
      snapshot: "data",
    });
    const harness = new CartridgeTestHarness(cartridge);
    const report = await harness.run();

    expect(report.passed).toBe(true);
    const stepNames = report.steps.map((s) => s.step);
    expect(stepNames).toContain("capture-snapshot");
  });

  it("each step has durationMs", async () => {
    const cartridge = new TestCartridge(validManifest());
    const harness = new CartridgeTestHarness(cartridge);
    const report = await harness.run();

    for (const step of report.steps) {
      expect(typeof step.durationMs).toBe("number");
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. CartridgeTestHarness.runOrThrow()
// ---------------------------------------------------------------------------
describe("CartridgeTestHarness.runOrThrow", () => {
  it("does not throw on valid cartridge", async () => {
    const cartridge = new TestCartridge(validManifest());
    const harness = new CartridgeTestHarness(cartridge);

    const report = await harness.runOrThrow();
    expect(report.passed).toBe(true);
  });

  it("throws on failures listing failed steps", async () => {
    const badManifest = createTestManifest({
      id: "",
      name: "",
      version: "bad",
      description: "",
      actions: [],
    });
    const cartridge = new TestCartridge(badManifest);
    const harness = new CartridgeTestHarness(cartridge);

    await expect(harness.runOrThrow()).rejects.toThrow("failed steps");
  });
});
