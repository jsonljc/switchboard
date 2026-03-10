// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Integration Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { RevenueGrowthCartridge } from "../index.js";
import { MockConnector } from "../../data/normalizer.js";
import {
  InMemoryInterventionStore,
  InMemoryDiagnosticCycleStore,
  InMemoryWeeklyDigestStore,
} from "../../stores/in-memory.js";
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

    it("includes digest.generate action", () => {
      const cartridge = new RevenueGrowthCartridge();
      const digestAction = cartridge.manifest.actions.find(
        (a) => a.actionType === "revenue-growth.digest.generate",
      );
      expect(digestAction).toBeDefined();
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
      expect(output.scorerOutputs).toHaveLength(5);
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
      expect(output.scorerOutputs).toHaveLength(5);
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
              stageConversionRates: { qualify: 0.6, propose: 0.5, close: 0.4 },
              averageDaysToClose: 30,
              adAttributedLeads: 60,
              followUpWithin24hRate: 0.8,
            },
            funnelEvents: [
              { stageName: "Impression", count: 10000, previousCount: 9500 },
              { stageName: "Click", count: 6000, previousCount: 5800 },
              { stageName: "Lead", count: 3500, previousCount: 3400 },
              { stageName: "Sale", count: 2000, previousCount: 1900 },
            ],
            headroom: {
              headroomPercent: 45,
              currentDailySpend: 5000,
              recommendedDailySpend: 7250,
              rSquared: 0.85,
              confidence: "HIGH",
              caveats: [],
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

  describe("persistence flow", () => {
    it("persists cycle and interventions to stores", async () => {
      const interventionStore = new InMemoryInterventionStore();
      const cycleStore = new InMemoryDiagnosticCycleStore();

      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({
        connectors: [
          new MockConnector({
            signalHealth: {
              pixelActive: false,
              capiConfigured: false,
              eventMatchQuality: 2,
              eventCompleteness: 0.1,
              deduplicationRate: null,
              conversionLagHours: 72,
            },
          }),
        ],
        interventionStore,
        cycleStore,
      });

      const result = await cartridge.execute(
        "revenue-growth.diagnostic.run",
        { accountId: "acc_1", organizationId: "org_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      const output = result.data as DiagnosticRunOutput;

      // Verify cycle was persisted
      const latestCycle = await cycleStore.getLatest("acc_1");
      expect(latestCycle).not.toBeNull();
      expect(latestCycle!.id).toBe(output.cycleId);

      // Verify interventions were persisted
      if (output.interventions.length > 0) {
        const stored = await interventionStore.getById(output.interventions[0]!.id);
        expect(stored).not.toBeNull();
      }
    });

    it("reads previous constraint from cycle store", async () => {
      const cycleStore = new InMemoryDiagnosticCycleStore();

      // Save a previous cycle with CREATIVE as primary
      await cycleStore.save({
        id: "prev_cycle",
        accountId: "acc_1",
        organizationId: "org_1",
        dataTier: "FULL",
        scorerOutputs: [],
        constraints: [],
        primaryConstraint: "CREATIVE",
        previousPrimaryConstraint: null,
        constraintTransition: false,
        interventions: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({
        connectors: [
          new MockConnector({
            signalHealth: {
              pixelActive: false,
              capiConfigured: false,
              eventMatchQuality: 2,
              eventCompleteness: 0.1,
              deduplicationRate: null,
              conversionLagHours: 72,
            },
          }),
        ],
        cycleStore,
      });

      const result = await cartridge.execute(
        "revenue-growth.diagnostic.run",
        { accountId: "acc_1", organizationId: "org_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      const output = result.data as DiagnosticRunOutput;
      // Since previous was CREATIVE and current is SIGNAL, should detect transition
      if (output.primaryConstraint) {
        expect(output.constraintTransition).toBe(true);
      }
    });

    it("approve updates intervention store", async () => {
      const interventionStore = new InMemoryInterventionStore();
      await interventionStore.save({
        id: "int_1",
        cycleId: "cycle_1",
        constraintType: "SIGNAL",
        actionType: "FIX_TRACKING",
        status: "PROPOSED",
        priority: 1,
        estimatedImpact: "HIGH",
        reasoning: "Test",
        artifacts: [],
        outcomeStatus: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({
        connectors: [],
        interventionStore,
      });

      await cartridge.execute(
        "revenue-growth.intervention.approve",
        { interventionId: "int_1" },
        CTX,
      );

      const updated = await interventionStore.getById("int_1");
      expect(updated!.status).toBe("APPROVED");
    });

    it("defer updates intervention store", async () => {
      const interventionStore = new InMemoryInterventionStore();
      await interventionStore.save({
        id: "int_2",
        cycleId: "cycle_1",
        constraintType: "SIGNAL",
        actionType: "FIX_TRACKING",
        status: "PROPOSED",
        priority: 1,
        estimatedImpact: "HIGH",
        reasoning: "Test",
        artifacts: [],
        outcomeStatus: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({
        connectors: [],
        interventionStore,
      });

      await cartridge.execute(
        "revenue-growth.intervention.defer",
        { interventionId: "int_2", reason: "Later" },
        CTX,
      );

      const updated = await interventionStore.getById("int_2");
      expect(updated!.status).toBe("DEFERRED");
    });

    it("gets latest diagnostic from store", async () => {
      const cycleStore = new InMemoryDiagnosticCycleStore();
      await cycleStore.save({
        id: "stored_cycle",
        accountId: "acc_1",
        organizationId: "org_1",
        dataTier: "FULL",
        scorerOutputs: [],
        constraints: [],
        primaryConstraint: "SIGNAL",
        previousPrimaryConstraint: null,
        constraintTransition: false,
        interventions: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({ connectors: [], cycleStore });

      const result = await cartridge.execute(
        "revenue-growth.diagnostic.latest",
        { accountId: "acc_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("SIGNAL");
      expect(result.externalRefs["cycleId"]).toBe("stored_cycle");
    });

    it("generates weekly digest", async () => {
      const cycleStore = new InMemoryDiagnosticCycleStore();
      const digestStore = new InMemoryWeeklyDigestStore();

      await cycleStore.save({
        id: "cycle_for_digest",
        accountId: "acc_1",
        organizationId: "org_1",
        dataTier: "FULL",
        scorerOutputs: [],
        constraints: [],
        primaryConstraint: "SIGNAL",
        previousPrimaryConstraint: null,
        constraintTransition: false,
        interventions: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      const cartridge = new RevenueGrowthCartridge();
      cartridge.setDeps({ connectors: [], cycleStore, digestStore });

      const result = await cartridge.execute(
        "revenue-growth.digest.generate",
        { accountId: "acc_1" },
        CTX,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("digest generated");

      // Verify digest was persisted
      const latest = await digestStore.getLatest("acc_1");
      expect(latest).not.toBeNull();
    });
  });

  describe("getRiskInput", () => {
    it("returns none risk for diagnostic actions", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const risk = await cartridge.getRiskInput("revenue-growth.diagnostic.run", {}, {});
      expect(risk.baseRisk).toBe("none");
    });

    it("returns none risk for digest actions", async () => {
      const cartridge = new RevenueGrowthCartridge();
      const risk = await cartridge.getRiskInput("revenue-growth.digest.generate", {}, {});
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
