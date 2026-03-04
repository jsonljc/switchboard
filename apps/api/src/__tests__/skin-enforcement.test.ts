import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { executeRoutes } from "../routes/execute.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  ExecutionService,
} from "@switchboard/core";
import type { StorageContext, PolicyCache, ResolvedSkin } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";

const IDEMPOTENCY_HEADERS = { "Idempotency-Key": "test-key-skin" };

function createMockSkin(overrides?: Partial<ResolvedSkin>): ResolvedSkin {
  return {
    manifest: {
      id: "clinic",
      name: "Clinic",
      version: "1.0.0",
      tools: { include: ["patient-engagement.*"] },
      governance: { profile: "strict" },
      language: { locale: "en" },
      requiredCartridges: ["patient-engagement"],
    } as ResolvedSkin["manifest"],
    toolFilter: { include: ["patient-engagement.*"] },
    tools: [],
    governancePreset: {} as ResolvedSkin["governancePreset"],
    governance: {
      profile: "strict",
      policyOverrides: [
        {
          name: "deny-high-risk-pe",
          description: "Deny high-risk patient-engagement actions",
          rule: {
            composition: "AND",
            conditions: [{ field: "actionType", operator: "contains", value: "delete" }],
          },
          effect: "deny" as const,
        },
      ],
    },
    language: { locale: "en" },
    playbooks: [],
    primaryChannel: null,
    requiredCartridges: ["patient-engagement"],
    config: {},
    ...overrides,
  };
}

interface SkinTestContext {
  app: FastifyInstance;
  storage: StorageContext;
  governanceProfileStore: InMemoryGovernanceProfileStore;
}

async function buildSkinTestServer(skin: ResolvedSkin | null): Promise<SkinTestContext> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // Register a patient-engagement cartridge
  const peCartridge = new TestCartridge(
    createTestManifest({
      id: "patient-engagement",
      actions: [
        {
          actionType: "patient-engagement.appointment.book",
          name: "Book Appointment",
          description: "Book an appointment",
          parametersSchema: {},
          baseRiskCategory: "low" as const,
          reversible: true,
        },
      ],
    }),
  );
  peCartridge.onRiskInput(() => ({
    baseRisk: "low" as const,
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full" as const,
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }));
  peCartridge.onExecute((_actionType, params) => ({
    success: true,
    summary: `Executed ${_actionType}`,
    externalRefs: { appointmentId: (params["appointmentId"] as string) ?? "unknown" },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 10,
    undoRecipe: null,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (peCartridge as any).resolveEntity = async (inputRef: string, entityType: string) => ({
    id: `resolve_${Date.now()}`,
    inputRef,
    resolvedType: entityType,
    resolvedId: "appt_123",
    resolvedName: inputRef,
    confidence: 0.95,
    alternatives: [],
    status: "resolved" as const,
  });
  storage.cartridges.register("patient-engagement", peCartridge);

  // Register a digital-ads cartridge (should be blocked by skin filter)
  const adsCartridge = new TestCartridge(
    createTestManifest({
      id: "digital-ads",
      actions: [
        {
          actionType: "digital-ads.campaign.create",
          name: "Create Campaign",
          description: "Create a campaign",
          parametersSchema: {},
          baseRiskCategory: "medium" as const,
          reversible: false,
        },
      ],
    }),
  );
  adsCartridge.onRiskInput(() => ({
    baseRisk: "medium" as const,
    exposure: { dollarsAtRisk: 100, blastRadius: 1 },
    reversibility: "none" as const,
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }));
  adsCartridge.onExecute(() => ({
    success: true,
    summary: "Created campaign",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 10,
    undoRecipe: null,
  }));
  storage.cartridges.register("digital-ads", adsCartridge);

  // Seed default allow policies for both cartridges
  await storage.policies.save({
    id: "allow-pe",
    name: "Allow patient-engagement",
    description: "Allow all patient-engagement actions",
    organizationId: null,
    cartridgeId: "patient-engagement",
    priority: 100,
    active: true,
    rule: { composition: "AND", conditions: [], children: [] },
    effect: "allow",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await storage.policies.save({
    id: "allow-ads",
    name: "Allow digital-ads",
    description: "Allow all digital-ads actions",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 100,
    active: true,
    rule: { composition: "AND", conditions: [], children: [] },
    effect: "allow",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await seedDefaultStorage(storage);

  await storage.identity.savePrincipal({
    id: "default",
    type: "user",
    name: "Default User",
    organizationId: null,
    roles: ["requester"],
  });

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    policyCache,
    governanceProfileStore,
  });

  const executionService = new ExecutionService(orchestrator, storage);
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache as PolicyCache);
  app.decorate("executionService", executionService);
  app.decorate("governanceProfileStore", governanceProfileStore);
  app.decorate("resolvedSkin", skin);

  await app.register(idempotencyMiddleware);
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(actionsRoutes, { prefix: "/api/actions" });

  return { app, storage, governanceProfileStore };
}

describe("Skin enforcement", () => {
  let app: FastifyInstance;
  let storage: StorageContext;
  let governanceProfileStore: InMemoryGovernanceProfileStore;

  afterEach(async () => {
    await app.close();
  });

  // ── Tool filter enforcement ──────────────────────────────────────

  describe("tool filter - execute route", () => {
    it("blocks disallowed action type with 403", async () => {
      const ctx = await buildSkinTestServer(createMockSkin());
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/execute",
        headers: IDEMPOTENCY_HEADERS,
        payload: {
          actorId: "default",
          action: {
            actionType: "digital-ads.campaign.create",
            parameters: { campaignId: "camp_1" },
            sideEffect: true,
          },
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toContain("digital-ads.campaign.create");
      expect(body.error).toContain("not available");
    });

    it("allows permitted action type", async () => {
      const ctx = await buildSkinTestServer(createMockSkin());
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/execute",
        headers: IDEMPOTENCY_HEADERS,
        payload: {
          actorId: "default",
          action: {
            actionType: "patient-engagement.appointment.book",
            parameters: { appointmentId: "appt_1" },
            sideEffect: true,
          },
        },
      });

      // Should not be 403 — may be 200 or other status depending on orchestrator outcome
      expect(res.statusCode).not.toBe(403);
    });

    it("passes all actions when no skin is loaded", async () => {
      const ctx = await buildSkinTestServer(null);
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/execute",
        headers: IDEMPOTENCY_HEADERS,
        payload: {
          actorId: "default",
          action: {
            actionType: "digital-ads.campaign.create",
            parameters: { campaignId: "camp_1" },
            sideEffect: true,
          },
        },
      });

      // Without a skin, no filtering — should not be 403
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe("tool filter - propose route", () => {
    it("blocks disallowed action type with 403", async () => {
      const ctx = await buildSkinTestServer(createMockSkin());
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "digital-ads.campaign.create",
          parameters: { campaignId: "camp_1" },
          principalId: "default",
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toContain("digital-ads.campaign.create");
    });

    it("allows permitted action type", async () => {
      const ctx = await buildSkinTestServer(createMockSkin());
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "patient-engagement.appointment.book",
          parameters: { appointmentId: "appt_1" },
          principalId: "default",
        },
      });

      expect(res.statusCode).not.toBe(403);
    });
  });

  describe("tool filter - batch route", () => {
    it("blocks batch if any proposal has disallowed action type", async () => {
      const ctx = await buildSkinTestServer(createMockSkin());
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/actions/batch",
        payload: {
          principalId: "default",
          proposals: [
            {
              actionType: "patient-engagement.appointment.book",
              parameters: { appointmentId: "appt_1" },
            },
            {
              actionType: "digital-ads.campaign.create",
              parameters: { campaignId: "camp_1" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toContain("digital-ads.campaign.create");
    });
  });

  describe("tool filter with exclude", () => {
    it("blocks action matching exclude pattern", async () => {
      const skin = createMockSkin({
        toolFilter: {
          include: ["patient-engagement.*"],
          exclude: ["patient-engagement.appointment.cancel"],
        },
      });
      const ctx = await buildSkinTestServer(skin);
      app = ctx.app;

      const res = await app.inject({
        method: "POST",
        url: "/api/execute",
        headers: IDEMPOTENCY_HEADERS,
        payload: {
          actorId: "default",
          action: {
            actionType: "patient-engagement.appointment.cancel",
            parameters: {},
            sideEffect: true,
          },
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── Governance profile ───────────────────────────────────────────

  describe("governance profile", () => {
    it("sets skin governance profile as global default on governanceProfileStore", async () => {
      const skin = createMockSkin();
      governanceProfileStore = new InMemoryGovernanceProfileStore();
      // Verify it starts as default ("guarded")
      const before = await governanceProfileStore.get(null);
      expect(before).toBe("guarded");

      // Set the skin profile (simulating what app.ts does)
      await governanceProfileStore.set(null, skin.governance.profile);
      const after = await governanceProfileStore.get(null);
      expect(after).toBe("strict");
    });
  });

  // ── Policy overrides ─────────────────────────────────────────────

  describe("policy overrides", () => {
    it("seeds skin policy overrides into the policy store with priority 9000+", async () => {
      const skin = createMockSkin();
      const ctx = await buildSkinTestServer(skin);
      app = ctx.app;
      storage = ctx.storage;

      // Simulate the policy seeding that app.ts does at boot
      if (skin.governance.policyOverrides?.length) {
        const now = new Date();
        for (let i = 0; i < skin.governance.policyOverrides.length; i++) {
          const override = skin.governance.policyOverrides[i]!;
          await storage.policies.save({
            id: `skin_${skin.manifest.id}_${i}`,
            name: override.name,
            description: override.description ?? `Skin policy: ${override.name}`,
            organizationId: null,
            cartridgeId: null,
            priority: 9000 + i,
            active: true,
            rule: override.rule as import("@switchboard/schemas").Policy["rule"],
            effect: override.effect,
            effectParams: override.effectParams ?? {},
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // Verify the policy was saved
      const policy = await storage.policies.getById("skin_clinic_0");
      expect(policy).not.toBeNull();
      expect(policy!.name).toBe("deny-high-risk-pe");
      expect(policy!.priority).toBe(9000);
      expect(policy!.effect).toBe("deny");
      expect(policy!.active).toBe(true);
    });

    it("does not seed policies when policyOverrides is empty", async () => {
      const skin = createMockSkin({
        governance: { profile: "strict" },
      });
      const ctx = await buildSkinTestServer(skin);
      app = ctx.app;
      storage = ctx.storage;

      const policy = await storage.policies.getById("skin_clinic_0");
      expect(policy).toBeNull();
    });
  });
});
