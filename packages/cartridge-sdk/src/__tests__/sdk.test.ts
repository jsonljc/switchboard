import { describe, it, expect } from "vitest";
import {
  ActionBuilder,
  action,
  validateConnection,
  TestCartridge,
  createTestManifest,
} from "../index.js";
import type { CartridgeConnectionConfig } from "../index.js";

// ---------------------------------------------------------------------------
// 1. ActionBuilder
// ---------------------------------------------------------------------------
describe("ActionBuilder", () => {
  it("builds a simple proposal with actionType", () => {
    const builder = new ActionBuilder("ads.campaign.pause");
    const proposal = builder.build();

    expect(proposal.actionType).toBe("ads.campaign.pause");
    expect(proposal.id).toMatch(/^proposal_/);
    expect(proposal.parameters).toEqual({});
    expect(proposal.confidence).toBe(1.0);
    expect(proposal.evidence).toBe("");
    expect(proposal.originatingMessageId).toBe("");
  });

  it("builds with parameters", () => {
    const proposal = new ActionBuilder("ads.budget.adjust")
      .parameter("campaignId", "camp_123")
      .parameter("newBudget", 500)
      .build();

    expect(proposal.parameters).toEqual({
      campaignId: "camp_123",
      newBudget: 500,
    });
  });

  it("builds with evidence and confidence", () => {
    const proposal = new ActionBuilder("ads.campaign.pause")
      .evidence("User explicitly requested pause")
      .confidence(0.85)
      .build();

    expect(proposal.evidence).toBe("User explicitly requested pause");
    expect(proposal.confidence).toBe(0.85);
  });

  it("supports fluent chaining", () => {
    const proposal = new ActionBuilder("ads.targeting.modify")
      .parameter("adSetId", "adset_1")
      .parameters({ targeting: { age_min: 25 } })
      .evidence("Based on performance data")
      .confidence(0.9)
      .originatingMessage("msg_abc")
      .build();

    expect(proposal.actionType).toBe("ads.targeting.modify");
    expect(proposal.parameters).toEqual({
      adSetId: "adset_1",
      targeting: { age_min: 25 },
    });
    expect(proposal.evidence).toBe("Based on performance data");
    expect(proposal.confidence).toBe(0.9);
    expect(proposal.originatingMessageId).toBe("msg_abc");
  });

  it("exposes an action() factory function", () => {
    const proposal = action("ads.campaign.resume")
      .parameter("campaignId", "camp_456")
      .build();

    expect(proposal.actionType).toBe("ads.campaign.resume");
    expect(proposal.parameters).toEqual({ campaignId: "camp_456" });
  });
});

// ---------------------------------------------------------------------------
// 2. Connection validation
// ---------------------------------------------------------------------------
describe("validateConnection", () => {
  it("OAuth2 requires accessToken", () => {
    const config: CartridgeConnectionConfig = {
      serviceId: "meta-ads",
      serviceName: "Meta Ads",
      authType: "oauth2",
      requiredScopes: ["ads_read"],
      refreshStrategy: "auto",
    };

    const missing = validateConnection(config, {});
    expect(missing.valid).toBe(false);
    expect(missing.missing).toContain("accessToken");

    const valid = validateConnection(config, { accessToken: "tok_123" });
    expect(valid.valid).toBe(true);
    expect(valid.missing).toEqual([]);
  });

  it("API key requires apiKey", () => {
    const config: CartridgeConnectionConfig = {
      serviceId: "analytics",
      serviceName: "Analytics",
      authType: "api_key",
      requiredScopes: [],
      refreshStrategy: "none",
    };

    const missing = validateConnection(config, {});
    expect(missing.valid).toBe(false);
    expect(missing.missing).toContain("apiKey");

    const valid = validateConnection(config, { apiKey: "key_abc" });
    expect(valid.valid).toBe(true);
    expect(valid.missing).toEqual([]);
  });

  it("Service account requires serviceAccountKey", () => {
    const config: CartridgeConnectionConfig = {
      serviceId: "gcp",
      serviceName: "Google Cloud",
      authType: "service_account",
      requiredScopes: ["cloud-platform"],
      refreshStrategy: "manual",
    };

    const missing = validateConnection(config, {});
    expect(missing.valid).toBe(false);
    expect(missing.missing).toContain("serviceAccountKey");

    const valid = validateConnection(config, { serviceAccountKey: "{}" });
    expect(valid.valid).toBe(true);
    expect(valid.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. TestCartridge
// ---------------------------------------------------------------------------
describe("TestCartridge", () => {
  it("default execute returns success", async () => {
    const manifest = createTestManifest();
    const cartridge = new TestCartridge(manifest);

    const result = await cartridge.execute(
      "some.action",
      { key: "value" },
      { principalId: "usr_1", organizationId: null, connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Executed some.action");
    expect(result.rollbackAvailable).toBe(false);
    expect(result.undoRecipe).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("custom execute handler overrides default", async () => {
    const manifest = createTestManifest();
    const cartridge = new TestCartridge(manifest).onExecute((actionType, params) => ({
      success: true,
      summary: `Custom: ${actionType} with ${JSON.stringify(params)}`,
      externalRefs: { ref: "ext_1" },
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: 42,
      undoRecipe: null,
    }));

    const result = await cartridge.execute(
      "my.action",
      { foo: "bar" },
      { principalId: "usr_1", organizationId: null, connectionCredentials: {} },
    );

    expect(result.summary).toBe('Custom: my.action with {"foo":"bar"}');
    expect(result.externalRefs).toEqual({ ref: "ext_1" });
    expect(result.rollbackAvailable).toBe(true);
  });

  it("custom enrich handler returns enriched context", async () => {
    const manifest = createTestManifest();
    const cartridge = new TestCartridge(manifest).onEnrich((_actionType, params) => ({
      enrichedField: "hello",
      paramEcho: params["key"],
    }));

    const enriched = await cartridge.enrichContext(
      "some.action",
      { key: "world" },
      { principalId: "usr_1", organizationId: null, connectionCredentials: {} },
    );

    expect(enriched).toEqual({ enrichedField: "hello", paramEcho: "world" });
  });

  it("custom risk input handler overrides default", async () => {
    const manifest = createTestManifest();
    const cartridge = new TestCartridge(manifest).onRiskInput((_actionType, _params) => ({
      baseRisk: "critical",
      exposure: { dollarsAtRisk: 99999, blastRadius: 100 },
      reversibility: "none",
      sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
    }));

    const riskInput = await cartridge.getRiskInput("danger.action", {}, {});

    expect(riskInput.baseRisk).toBe("critical");
    expect(riskInput.exposure.dollarsAtRisk).toBe(99999);
    expect(riskInput.reversibility).toBe("none");
    expect(riskInput.sensitivity.entityVolatile).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. createTestManifest
// ---------------------------------------------------------------------------
describe("createTestManifest", () => {
  it("creates a default manifest with sensible defaults", () => {
    const manifest = createTestManifest();

    expect(manifest.id).toBe("test-cartridge");
    expect(manifest.name).toBe("Test Cartridge");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toBe("A test cartridge");
    expect(manifest.actions).toEqual([]);
    expect(manifest.requiredConnections).toEqual([]);
    expect(manifest.defaultPolicies).toEqual([]);
  });

  it("allows overriding individual manifest fields", () => {
    const manifest = createTestManifest({
      id: "custom-cartridge",
      name: "Custom",
      actions: [
        {
          actionType: "custom.do",
          name: "Do Something",
          description: "Does a thing",
          parametersSchema: { type: "object", properties: {} },
          baseRiskCategory: "low",
          reversible: true,
        },
      ],
    });

    expect(manifest.id).toBe("custom-cartridge");
    expect(manifest.name).toBe("Custom");
    expect(manifest.version).toBe("1.0.0"); // default kept
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]!.actionType).toBe("custom.do");
  });
});
