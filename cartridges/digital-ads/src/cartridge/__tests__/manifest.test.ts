import { describe, it, expect } from "vitest";
import { DIGITAL_ADS_MANIFEST } from "../manifest.js";
import { validateManifest } from "../types.js";

describe("CartridgeManifest", () => {
  it("passes validation (errors only, warnings allowed)", () => {
    const errors = validateManifest(DIGITAL_ADS_MANIFEST);
    const hardErrors = errors.filter((e) => e.severity !== "warning");
    expect(hardErrors).toHaveLength(0);
  });

  it("has the correct id, name, and version", () => {
    expect(DIGITAL_ADS_MANIFEST.id).toBe("digital-ads");
    expect(DIGITAL_ADS_MANIFEST.name).toBe("Digital Ads");
    expect(DIGITAL_ADS_MANIFEST.version).toBe("1.0.0");
  });

  it("declares meta-ads as required connection", () => {
    expect(DIGITAL_ADS_MANIFEST.requiredConnections).toContain("meta-ads");
  });

  it("declares digital-ads-default as default policy", () => {
    expect(DIGITAL_ADS_MANIFEST.defaultPolicies).toEqual([
      "digital-ads-default",
    ]);
  });

  it("defines exactly 16 actions (6 read + 10 write)", () => {
    expect(DIGITAL_ADS_MANIFEST.actions).toHaveLength(16);
  });

  it("has correct read action types", () => {
    const actionTypes = DIGITAL_ADS_MANIFEST.actions.map((a) => a.actionType);
    expect(actionTypes).toContain("digital-ads.platform.connect");
    expect(actionTypes).toContain("digital-ads.funnel.diagnose");
    expect(actionTypes).toContain("digital-ads.portfolio.diagnose");
    expect(actionTypes).toContain("digital-ads.snapshot.fetch");
    expect(actionTypes).toContain("digital-ads.structure.analyze");
    expect(actionTypes).toContain("digital-ads.health.check");
  });

  it("has correct write action types", () => {
    const actionTypes = DIGITAL_ADS_MANIFEST.actions.map((a) => a.actionType);
    expect(actionTypes).toContain("digital-ads.campaign.pause");
    expect(actionTypes).toContain("digital-ads.campaign.resume");
    expect(actionTypes).toContain("digital-ads.campaign.adjust_budget");
    expect(actionTypes).toContain("digital-ads.campaign.create");
    expect(actionTypes).toContain("digital-ads.adset.pause");
    expect(actionTypes).toContain("digital-ads.adset.resume");
    expect(actionTypes).toContain("digital-ads.adset.adjust_budget");
    expect(actionTypes).toContain("digital-ads.adset.create");
    expect(actionTypes).toContain("digital-ads.ad.create");
    expect(actionTypes).toContain("digital-ads.targeting.modify");
  });

  it("has no duplicate action types", () => {
    const types = DIGITAL_ADS_MANIFEST.actions.map((a) => a.actionType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("every action has a name", () => {
    for (const action of DIGITAL_ADS_MANIFEST.actions) {
      expect(action.name).toBeTruthy();
      expect(typeof action.name).toBe("string");
    }
  });

  it("marks connect and health.check as none risk", () => {
    const connect = DIGITAL_ADS_MANIFEST.actions.find(
      (a) => a.actionType === "digital-ads.platform.connect"
    );
    const health = DIGITAL_ADS_MANIFEST.actions.find(
      (a) => a.actionType === "digital-ads.health.check"
    );
    expect(connect?.baseRiskCategory).toBe("none");
    expect(health?.baseRiskCategory).toBe("none");
  });

  it("marks read-only diagnostic actions as low risk", () => {
    const diagnosticTypes = [
      "digital-ads.funnel.diagnose",
      "digital-ads.portfolio.diagnose",
      "digital-ads.snapshot.fetch",
      "digital-ads.structure.analyze",
    ];
    for (const at of diagnosticTypes) {
      const action = DIGITAL_ADS_MANIFEST.actions.find((a) => a.actionType === at);
      expect(action?.baseRiskCategory).toBe("low");
    }
  });

  it("marks write actions with appropriate risk levels", () => {
    const mediumRiskActions = [
      "digital-ads.campaign.pause",
      "digital-ads.campaign.resume",
      "digital-ads.adset.pause",
      "digital-ads.adset.resume",
    ];
    for (const at of mediumRiskActions) {
      const action = DIGITAL_ADS_MANIFEST.actions.find((a) => a.actionType === at);
      expect(action?.baseRiskCategory).toBe("medium");
    }

    const highRiskActions = [
      "digital-ads.campaign.adjust_budget",
      "digital-ads.adset.adjust_budget",
      "digital-ads.targeting.modify",
    ];
    for (const at of highRiskActions) {
      const action = DIGITAL_ADS_MANIFEST.actions.find((a) => a.actionType === at);
      expect(action?.baseRiskCategory).toBe("high");
    }
  });

  it("marks targeting.modify as irreversible", () => {
    const targeting = DIGITAL_ADS_MANIFEST.actions.find(
      (a) => a.actionType === "digital-ads.targeting.modify"
    );
    expect(targeting?.reversible).toBe(false);
  });

  it("marks all other actions as reversible", () => {
    const reversibleActions = DIGITAL_ADS_MANIFEST.actions.filter(
      (a) => a.actionType !== "digital-ads.targeting.modify"
    );
    for (const action of reversibleActions) {
      expect(action.reversible).toBe(true);
    }
  });

  it("rejects manifest with missing id", () => {
    const bad = { ...DIGITAL_ADS_MANIFEST, id: "" };
    const errors = validateManifest(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe("id");
  });

  it("rejects manifest with missing name", () => {
    const bad = { ...DIGITAL_ADS_MANIFEST, name: "" };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects manifest with duplicate action types", () => {
    const bad = {
      ...DIGITAL_ADS_MANIFEST,
      actions: [
        DIGITAL_ADS_MANIFEST.actions[0],
        DIGITAL_ADS_MANIFEST.actions[0],
      ],
    };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.message.includes("duplicate"))).toBe(true);
  });

  it("validates id format with regex", () => {
    const bad = { ...DIGITAL_ADS_MANIFEST, id: "INVALID_ID" };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.field === "id" && e.message.includes("pattern"))).toBe(true);
  });

  it("validates version format with semver regex", () => {
    const bad = { ...DIGITAL_ADS_MANIFEST, version: "not-semver" };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.field === "version" && e.message.includes("semver"))).toBe(true);
  });
});
