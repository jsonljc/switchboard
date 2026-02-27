import { describe, it, expect } from "vitest";
import { validateManifest, validateCartridge } from "../validation.js";
import { TestCartridge, createTestManifest } from "../testing.js";
import type { CartridgeManifest } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function validManifest(overrides: Partial<CartridgeManifest> = {}): CartridgeManifest {
  return createTestManifest({
    id: "my-cartridge",
    name: "My Cartridge",
    version: "1.0.0",
    description: "A valid cartridge",
    actions: [
      {
        actionType: "my.resource.create",
        name: "Create Resource",
        description: "Creates a resource",
        parametersSchema: { type: "object" },
        baseRiskCategory: "low",
        reversible: true,
      },
    ],
    requiredConnections: ["my-api"],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. validateManifest
// ---------------------------------------------------------------------------
describe("validateManifest", () => {
  it("valid manifest passes", () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("INVALID_MANIFEST_ID on empty id", () => {
    const result = validateManifest(validManifest({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_MANIFEST_ID")).toBe(true);
  });

  it("INVALID_MANIFEST_ID on uppercase id", () => {
    const result = validateManifest(validManifest({ id: "MyCartridge" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_MANIFEST_ID")).toBe(true);
  });

  it("MISSING_MANIFEST_NAME on empty name", () => {
    const result = validateManifest(validManifest({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_MANIFEST_NAME")).toBe(true);
  });

  it("INVALID_VERSION on non-semver", () => {
    const result = validateManifest(validManifest({ version: "1.0" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_VERSION")).toBe(true);
  });

  it("MISSING_DESCRIPTION on empty description", () => {
    const result = validateManifest(validManifest({ description: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_DESCRIPTION")).toBe(true);
  });

  it("NO_ACTIONS on empty actions", () => {
    const result = validateManifest(validManifest({ actions: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_ACTIONS")).toBe(true);
  });

  it("INVALID_ACTION_TYPE on bad format", () => {
    const result = validateManifest(
      validManifest({
        actions: [
          {
            actionType: "singleword",
            name: "Bad Action",
            description: "Bad",
            parametersSchema: {},
            baseRiskCategory: "low",
            reversible: true,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_ACTION_TYPE")).toBe(true);
  });

  it("DUPLICATE_ACTION_TYPE on duplicates", () => {
    const action = {
      actionType: "my.resource.create",
      name: "Create",
      description: "Creates",
      parametersSchema: { type: "object" },
      baseRiskCategory: "low" as const,
      reversible: true,
    };
    const result = validateManifest(validManifest({ actions: [action, action] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_ACTION_TYPE")).toBe(true);
  });

  it("MISSING_ACTION_NAME on empty name", () => {
    const result = validateManifest(
      validManifest({
        actions: [
          {
            actionType: "my.resource.create",
            name: "",
            description: "Creates a resource",
            parametersSchema: {},
            baseRiskCategory: "low",
            reversible: true,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_ACTION_NAME")).toBe(true);
  });

  it("MISSING_ACTION_DESCRIPTION on empty description", () => {
    const result = validateManifest(
      validManifest({
        actions: [
          {
            actionType: "my.resource.create",
            name: "Create",
            description: "",
            parametersSchema: {},
            baseRiskCategory: "low",
            reversible: true,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_ACTION_DESCRIPTION")).toBe(true);
  });

  it("INVALID_RISK_CATEGORY on invalid value", () => {
    const result = validateManifest(
      validManifest({
        actions: [
          {
            actionType: "my.resource.create",
            name: "Create",
            description: "Creates",
            parametersSchema: {},
            baseRiskCategory: "extreme" as "low",
            reversible: true,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_RISK_CATEGORY")).toBe(true);
  });

  it("warns NO_REQUIRED_CONNECTIONS when empty", () => {
    const result = validateManifest(validManifest({ requiredConnections: [] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "NO_REQUIRED_CONNECTIONS")).toBe(true);
  });

  it("warns EMPTY_PARAMETERS_SCHEMA when missing", () => {
    const result = validateManifest(
      validManifest({
        actions: [
          {
            actionType: "my.resource.create",
            name: "Create",
            description: "Creates",
            parametersSchema: {},
            baseRiskCategory: "low",
            reversible: true,
          },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.code === "EMPTY_PARAMETERS_SCHEMA")).toBe(true);
  });

  it("warns ACTION_TYPE_PREFIX_MISMATCH when prefix unrelated", () => {
    const result = validateManifest(
      validManifest({
        id: "my-cartridge",
        actions: [
          {
            actionType: "unrelated.resource.create",
            name: "Create",
            description: "Creates",
            parametersSchema: { type: "object" },
            baseRiskCategory: "low",
            reversible: true,
          },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.code === "ACTION_TYPE_PREFIX_MISMATCH")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. validateCartridge
// ---------------------------------------------------------------------------
describe("validateCartridge", () => {
  it("valid TestCartridge passes", async () => {
    const manifest = validManifest();
    const cartridge = new TestCartridge(manifest);
    const result = await validateCartridge(cartridge);
    expect(result.valid).toBe(true);
  });

  it("MISSING_MANIFEST on null cartridge", async () => {
    const result = await validateCartridge(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_MANIFEST")).toBe(true);
  });

  it("MISSING_MANIFEST on object without manifest", async () => {
    const result = await validateCartridge({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_MANIFEST")).toBe(true);
  });

  it("MISSING_METHOD when methods are missing", async () => {
    const result = await validateCartridge({ manifest: validManifest() });
    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.code === "MISSING_METHOD")).toHaveLength(6);
  });

  it("warns NO_CAPTURE_SNAPSHOT when not implemented", async () => {
    const cartridge = new TestCartridge(validManifest());
    const result = await validateCartridge(cartridge);
    expect(result.warnings.some((w) => w.code === "NO_CAPTURE_SNAPSHOT")).toBe(true);
  });

  it("warns NO_RATE_LIMITS when guardrails have empty rateLimits", async () => {
    const cartridge = new TestCartridge(validManifest());
    const result = await validateCartridge(cartridge);
    expect(result.warnings.some((w) => w.code === "NO_RATE_LIMITS")).toBe(true);
  });

  it("INVALID_GUARDRAILS on bad guardrail return", async () => {
    const manifest = validManifest();
    const cartridge = new TestCartridge(manifest).onGuardrails(
      { rateLimits: "bad" } as never,
    );
    const result = await validateCartridge(cartridge);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_GUARDRAILS")).toBe(true);
  });
});
