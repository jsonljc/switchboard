import { describe, it, expect, beforeEach } from "vitest";
import { CrmCartridge } from "../index.js";
import { CartridgeTestHarness } from "@switchboard/cartridge-sdk";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";

describe("CrmCartridge", () => {
  let cartridge: CrmCartridge;
  const ctx: CartridgeContext = {
    principalId: "test_user",
    organizationId: null,
    connectionCredentials: {},
  };

  beforeEach(async () => {
    cartridge = new CrmCartridge();
    await cartridge.initialize(ctx);
  });

  describe("manifest", () => {
    it("should have correct cartridge id", () => {
      expect(cartridge.manifest.id).toBe("crm");
    });

    it("should define 8 actions", () => {
      expect(cartridge.manifest.actions).toHaveLength(8);
    });

    it("should have correct action types", () => {
      const types = cartridge.manifest.actions.map((a) => a.actionType);
      expect(types).toContain("crm.contact.search");
      expect(types).toContain("crm.deal.list");
      expect(types).toContain("crm.activity.list");
      expect(types).toContain("crm.pipeline.status");
      expect(types).toContain("crm.contact.create");
      expect(types).toContain("crm.contact.update");
      expect(types).toContain("crm.deal.create");
      expect(types).toContain("crm.activity.log");
    });

    it("should mark activity.log as irreversible", () => {
      const log = cartridge.manifest.actions.find(
        (a) => a.actionType === "crm.activity.log",
      );
      expect(log?.reversible).toBe(false);
      expect(log?.baseRiskCategory).toBe("low");
    });

    it("should mark contact.update as medium risk", () => {
      const update = cartridge.manifest.actions.find(
        (a) => a.actionType === "crm.contact.update",
      );
      expect(update?.baseRiskCategory).toBe("medium");
      expect(update?.reversible).toBe(true);
    });

    it("should require no external connections", () => {
      expect(cartridge.manifest.requiredConnections).toHaveLength(0);
    });
  });

  describe("risk computation", () => {
    it("should compute low risk for read actions", async () => {
      const risk = await cartridge.getRiskInput("crm.contact.search", { query: "test" }, {});
      expect(risk.baseRisk).toBe("low");
      expect(risk.exposure.dollarsAtRisk).toBe(0);
      expect(risk.exposure.blastRadius).toBe(0);
    });

    it("should compute low risk for contact creation", async () => {
      const risk = await cartridge.getRiskInput("crm.contact.create", {}, {});
      expect(risk.baseRisk).toBe("low");
      expect(risk.exposure.blastRadius).toBe(1);
      expect(risk.reversibility).toBe("full");
    });

    it("should compute medium risk for contact update", async () => {
      const risk = await cartridge.getRiskInput("crm.contact.update", {}, {});
      expect(risk.baseRisk).toBe("medium");
      expect(risk.reversibility).toBe("full");
    });

    it("should compute medium risk for deal creation with amount at risk", async () => {
      const risk = await cartridge.getRiskInput("crm.deal.create", { amount: 50000 }, {});
      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(50000);
    });

    it("should compute irreversible risk for activity logging", async () => {
      const risk = await cartridge.getRiskInput("crm.activity.log", {}, {});
      expect(risk.baseRisk).toBe("low");
      expect(risk.reversibility).toBe("none");
    });

    it("should compute zero dollars for pipeline status", async () => {
      const risk = await cartridge.getRiskInput("crm.pipeline.status", {}, {});
      expect(risk.exposure.dollarsAtRisk).toBe(0);
      expect(risk.reversibility).toBe("full");
    });
  });

  describe("execute — read actions", () => {
    it("should search contacts by name", async () => {
      const result = await cartridge.execute("crm.contact.search", { query: "alice" }, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Alice");
      expect(result.summary).toContain("1 contact");
    });

    it("should search contacts by company", async () => {
      const result = await cartridge.execute("crm.contact.search", { query: "acme" }, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Acme Corp");
    });

    it("should return no results for unknown query", async () => {
      const result = await cartridge.execute("crm.contact.search", { query: "nonexistent123" }, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("No contacts found");
    });

    it("should fail search without query parameter", async () => {
      const result = await cartridge.execute("crm.contact.search", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("query");
    });

    it("should list deals", async () => {
      const result = await cartridge.execute("crm.deal.list", {}, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("deal");
    });

    it("should list deals filtered by stage", async () => {
      const result = await cartridge.execute("crm.deal.list", { stage: "negotiation" }, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("1 deal");
      expect(result.summary).toContain("Acme");
    });

    it("should list activities", async () => {
      const result = await cartridge.execute("crm.activity.list", {}, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("activit");
    });

    it("should list activities filtered by type", async () => {
      const result = await cartridge.execute("crm.activity.list", { type: "call" }, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("call");
      expect(result.summary).toContain("1 activity");
    });

    it("should return pipeline status", async () => {
      const result = await cartridge.execute("crm.pipeline.status", {}, ctx);
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Pipeline");
      expect(result.summary).toContain("deal");
    });
  });

  describe("execute — write actions", () => {
    it("should create a contact", async () => {
      const result = await cartridge.execute(
        "crm.contact.create",
        { email: "new@example.com", firstName: "New", lastName: "User" },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("created");
      expect(result.summary).toContain("new@example.com");
      expect(result.externalRefs["contactId"]).toBeTruthy();
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).toBeTruthy();
    });

    it("should fail contact creation without email", async () => {
      const result = await cartridge.execute("crm.contact.create", { firstName: "No Email" }, ctx);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("email");
    });

    it("should update a contact", async () => {
      const result = await cartridge.execute(
        "crm.contact.update",
        { contactId: "ct_alice", data: { company: "New Company" } },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("updated");
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).toBeTruthy();
      expect(result.undoRecipe?.reverseActionType).toBe("crm.contact.update");
    });

    it("should fail contact update without contactId", async () => {
      const result = await cartridge.execute(
        "crm.contact.update",
        { data: { company: "X" } },
        ctx,
      );
      expect(result.success).toBe(false);
    });

    it("should create a deal", async () => {
      const result = await cartridge.execute(
        "crm.deal.create",
        { name: "Big Deal", amount: 100000, stage: "qualified" },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Big Deal");
      expect(result.summary).toContain("100,000");
      expect(result.externalRefs["dealId"]).toBeTruthy();
      expect(result.rollbackAvailable).toBe(true);
    });

    it("should fail deal creation without name", async () => {
      const result = await cartridge.execute("crm.deal.create", { amount: 5000 }, ctx);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("name");
    });

    it("should log an activity", async () => {
      const result = await cartridge.execute(
        "crm.activity.log",
        { type: "call", subject: "Follow-up", body: "Discussed renewal terms" },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("call");
      expect(result.summary).toContain("Follow-up");
      expect(result.rollbackAvailable).toBe(false);
      expect(result.undoRecipe).toBeNull();
    });

    it("should reject invalid activity type", async () => {
      const result = await cartridge.execute(
        "crm.activity.log",
        { type: "invalid" },
        ctx,
      );
      expect(result.success).toBe(false);
    });

    it("should return error for unknown action type", async () => {
      const result = await cartridge.execute("crm.unknown.action", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Unknown action type");
    });
  });

  describe("enrichContext", () => {
    it("should enrich with contact metadata when contactId is provided", async () => {
      const enriched = await cartridge.enrichContext(
        "crm.contact.update",
        { contactId: "ct_alice" },
        ctx,
      );
      expect(enriched["contactName"]).toBe("Alice Johnson");
      expect(enriched["contactCompany"]).toBe("Acme Corp");
      expect(enriched["dealCount"]).toBe(1);
      expect(enriched["activityCount"]).toBeGreaterThan(0);
    });

    it("should return empty when no contactId is provided", async () => {
      const enriched = await cartridge.enrichContext("crm.deal.list", {}, ctx);
      expect(Object.keys(enriched)).toHaveLength(0);
    });

    it("should return empty for unknown contactId", async () => {
      const enriched = await cartridge.enrichContext(
        "crm.contact.update",
        { contactId: "ct_nonexistent" },
        ctx,
      );
      expect(Object.keys(enriched)).toHaveLength(0);
    });
  });

  describe("captureSnapshot", () => {
    it("should capture contact state before mutation", async () => {
      const snapshot = await cartridge.captureSnapshot(
        "crm.contact.update",
        { contactId: "ct_alice" },
        ctx,
      );
      expect(snapshot["capturedAt"]).toBeTruthy();
      expect(snapshot["actionType"]).toBe("crm.contact.update");
      expect(snapshot["contact"]).toBeDefined();
      const contact = snapshot["contact"] as Record<string, unknown>;
      expect(contact["email"]).toBe("alice@acmecorp.com");
    });

    it("should return snapshot without contact for missing contactId", async () => {
      const snapshot = await cartridge.captureSnapshot("crm.deal.create", { name: "Test" }, ctx);
      expect(snapshot["capturedAt"]).toBeTruthy();
      expect(snapshot["contact"]).toBeUndefined();
    });
  });

  describe("guardrails", () => {
    it("should return guardrails config", () => {
      const guardrails = cartridge.getGuardrails();
      expect(guardrails.rateLimits.length).toBeGreaterThan(0);
      expect(guardrails.cooldowns.length).toBeGreaterThan(0);
    });

    it("should have contact create rate limit of 50/hr", () => {
      const guardrails = cartridge.getGuardrails();
      const limit = guardrails.rateLimits.find((r) => r.scope === "crm.contact.create");
      expect(limit?.maxActions).toBe(50);
      expect(limit?.windowMs).toBe(3600000);
    });

    it("should have contact update cooldown of 5 min", () => {
      const guardrails = cartridge.getGuardrails();
      const cooldown = guardrails.cooldowns.find((c) => c.actionType === "crm.contact.update");
      expect(cooldown?.cooldownMs).toBe(300000);
      expect(cooldown?.scope).toBe("customer");
    });
  });

  describe("default policies", async () => {
    const { DEFAULT_CRM_POLICIES } = await import("../defaults/policies.js");

    it("should define 3 default policies", () => {
      expect(DEFAULT_CRM_POLICIES).toHaveLength(3);
    });

    it("should require approval for contact updates", () => {
      const policy = DEFAULT_CRM_POLICIES.find((p) => p.id === "crm-contact-update-approval");
      expect(policy).toBeDefined();
      expect(policy?.effect).toBe("require_approval");
      expect(policy?.approvalRequirement).toBe("standard");
    });

    it("should require elevated approval for large deals", () => {
      const policy = DEFAULT_CRM_POLICIES.find((p) => p.id === "crm-large-deal-approval");
      expect(policy).toBeDefined();
      expect(policy?.effect).toBe("require_approval");
      expect(policy?.approvalRequirement).toBe("elevated");
    });
  });

  describe("healthCheck", () => {
    it("should return connected status", async () => {
      const health = await cartridge.healthCheck();
      expect(health.status).toBe("connected");
      expect(health.capabilities.length).toBe(8);
    });
  });

  describe("CartridgeTestHarness", () => {
    it("should pass all harness steps", async () => {
      const harness = new CartridgeTestHarness(cartridge);
      const report = await harness.run({
        context: ctx,
        testActionType: "crm.contact.search",
        testParameters: { query: "alice" },
      });
      expect(report.passed).toBe(true);
      for (const step of report.steps) {
        expect(step.passed).toBe(true);
      }
    });
  });
});
