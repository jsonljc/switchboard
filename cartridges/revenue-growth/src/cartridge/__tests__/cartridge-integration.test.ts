// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Integration Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { RevenueGrowthCartridge } from "../index.js";
import { MockConnector } from "../../data/normalizer.js";
import type { DiagnosticRunOutput } from "@switchboard/schemas";

const CTX = {
  principalId: "user_1",
  organizationId: "org_1",
  connectionCredentials: {},
};

describe("RevenueGrowthCartridge", () => {
  describe("manifest", () => {
    it("has correct id and version", () => {
      const cartridge = new RevenueGrowthCartridge();
      expect(cartridge.manifest.id).toBe("revenue-growth");
      expect(cartridge.manifest.version).toBe("0.1.0");
      expect(cartridge.manifest.actions.length).toBeGreaterThan(0);
    });
  });

  describe("execute", () => {
    it("returns failure for unknown action type", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute("revenue-growth.unknown", {}, CTX);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Unknown action type");
    });

    it("validates required params for diagnostic.run", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute("revenue-growth.diagnostic.run", {}, CTX);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Missing required parameters");
    });

    it("runs diagnostic with no deps (sparse data)", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute(
        "revenue-growth.diagnostic.run",
        { accountId: "acc_1", organizationId: "org_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const output = result.data as DiagnosticRunOutput;
      expect(output.dataTier).toBe("SPARSE");
      expect(output.scorerOutputs).toHaveLength(2);
    });

    it("runs diagnostic with full data and identifies constraints", async () => {
      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({
        connectors: [
          new MockConnector({
            adMetrics: {
              impressions: 1000,
              clicks: 50,
              spend: 100,
              conversions: 5,
              revenue: 500,
              ctr: 0.05,
              cpc: 2,
              cpa: 20,
              roas: 5,
              frequency: 2,
            },
            signalHealth: {
              pixelActive: false,
              capiConfigured: false,
              eventMatchQuality: 2,
              eventCompleteness: 0.1,
              deduplicationRate: null,
              conversionLagHours: 72,
            },
            creativeAssets: {
              totalAssets: 10,
              activeAssets: 8,
              averageScore: 70,
              fatigueRate: 0.1,
              topPerformerCount: 3,
              bottomPerformerCount: 1,
              diversityScore: 65,
            },
          }),
        ],
      });

      const result = await cartridge.execute(
        "revenue-growth.diagnostic.run",
        { accountId: "acc_1", organizationId: "org_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      const output = result.data as DiagnosticRunOutput;
      expect(output.primaryConstraint).not.toBeNull();
      expect(output.primaryConstraint!.type).toBe("SIGNAL");
      expect(output.scorerOutputs).toHaveLength(2);
    });

    it("runs diagnostic with healthy data and no constraints", async () => {
      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({
        connectors: [
          new MockConnector({
            signalHealth: {
              pixelActive: true,
              capiConfigured: true,
              eventMatchQuality: 9,
              eventCompleteness: 0.95,
              deduplicationRate: 0.05,
              conversionLagHours: 2,
            },
            creativeAssets: {
              totalAssets: 15,
              activeAssets: 12,
              averageScore: 80,
              fatigueRate: 0.05,
              topPerformerCount: 5,
              bottomPerformerCount: 0,
              diversityScore: 85,
            },
            crmSummary: {
              totalLeads: 100,
              matchedLeads: 80,
              matchRate: 0.8,
              openDeals: 10,
              averageDealValue: 500,
              averageTimeToFirstContact: 1,
              leadToCloseRate: 0.2,
            },
          }),
        ],
      });

      const result = await cartridge.execute(
        "revenue-growth.diagnostic.run",
        { accountId: "acc_1", organizationId: "org_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      const output = result.data as DiagnosticRunOutput;
      expect(output.primaryConstraint).toBeNull();
      expect(result.summary).toContain("No binding constraint");
    });

    it("gets connector status", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute(
        "revenue-growth.connectors.status",
        { accountId: "acc_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("validates accountId for connector status", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute("revenue-growth.connectors.status", {}, CTX);
      expect(result.success).toBe(false);
    });

    it("handles intervention approve", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute(
        "revenue-growth.intervention.approve",
        { interventionId: "int_1" },
        CTX,
      );
      expect(result.success).toBe(true);
    });

    it("validates interventionId for approve", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute("revenue-growth.intervention.approve", {}, CTX);
      expect(result.success).toBe(false);
    });

    it("handles intervention defer", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute(
        "revenue-growth.intervention.defer",
        { interventionId: "int_1", reason: "Not ready" },
        CTX,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Not ready");
    });

    it("gets latest diagnostic", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.execute(
        "revenue-growth.diagnostic.latest",
        { accountId: "acc_1" },
        CTX,
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getRiskInput", () => {
    it("returns none risk for diagnostic actions", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const risk = await cartridge.getRiskInput("revenue-growth.diagnostic.run", {}, {});
      expect(risk.baseRisk).toBe("none");
    });

    it("returns low risk for intervention actions", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const risk = await cartridge.getRiskInput("revenue-growth.intervention.approve", {}, {});
      expect(risk.baseRisk).toBe("low");
    });
  });

  describe("getGuardrails", () => {
    it("returns default guardrails", () => {
      const cartridge = new RevenueGrowthCartridge();
      const guardrails = cartridge.getGuardrails();
      expect(guardrails.rateLimits.length).toBeGreaterThan(0);
    });
  });

  describe("healthCheck", () => {
    it("returns connected status", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const health = await cartridge.healthCheck();
      expect(health.status).toBe("connected");
    });
  });

  describe("enrichContext", () => {
    it("returns empty object", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const result = await cartridge.enrichContext("revenue-growth.diagnostic.run", {}, CTX);
      expect(result).toEqual({});
    });
  });
});
