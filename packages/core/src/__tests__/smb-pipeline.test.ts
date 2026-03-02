import { describe, it, expect, beforeEach } from "vitest";
import { smbPropose } from "../smb/pipeline.js";
import { SmbActivityLog, InMemorySmbActivityLogStorage } from "../smb/activity-log.js";
import { createInMemoryStorage } from "../storage/index.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { SmbOrgConfig } from "@switchboard/schemas";
import type { StorageContext } from "../storage/interfaces.js";
import type { GuardrailState } from "../engine/policy-engine.js";

function makeSmbConfig(overrides?: Partial<SmbOrgConfig>): SmbOrgConfig {
  return {
    tier: "smb",
    governanceProfile: "guarded",
    perActionSpendLimit: null,
    dailySpendLimit: null,
    ownerId: "owner_1",
    ...overrides,
  };
}

describe("smbPropose (pipeline)", () => {
  let storage: StorageContext;
  let activityLog: SmbActivityLog;
  let activityStorage: InMemorySmbActivityLogStorage;
  let guardrailState: GuardrailState;
  let cartridge: TestCartridge;

  beforeEach(() => {
    storage = createInMemoryStorage();
    activityStorage = new InMemorySmbActivityLogStorage();
    activityLog = new SmbActivityLog(activityStorage);
    guardrailState = createGuardrailState();

    cartridge = new TestCartridge(createTestManifest({ id: "digital-ads" }));
    cartridge.onExecute((_actionType, _params) => ({
      success: true,
      summary: `Executed ${_actionType}`,
      externalRefs: {},
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: 15,
      undoRecipe: null,
    }));

    storage.cartridges.register("digital-ads", cartridge);
  });

  it("should auto-approve a simple action with guarded profile", async () => {
    const config = makeSmbConfig();

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.denied).toBe(false);
    expect(result.envelope.status).toBe("approved");
    expect(result.approvalRequest).toBeNull();
    expect(result.decisionTrace.finalDecision).toBe("allow");
    expect(result.decisionTrace.approvalRequired).toBe("none");

    // Activity log should have an entry
    const entries = await activityLog.query({ organizationId: "org_1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe("allowed");
  });

  it("should deny action not in allowlist", async () => {
    const config = makeSmbConfig({
      allowedActionTypes: ["digital-ads.campaign.create"],
    });

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.denied).toBe(true);
    expect(result.envelope.status).toBe("denied");

    const entries = await activityLog.query({ organizationId: "org_1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe("denied");
  });

  it("should route high-risk action to approval with guarded profile", async () => {
    const config = makeSmbConfig();

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.create",
        parameters: { amount: 2000 },
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.denied).toBe(false);
    expect(result.envelope.status).toBe("pending_approval");
    expect(result.approvalRequest).not.toBeNull();
    expect(result.approvalRequest!.approvers).toEqual(["owner_1"]);
    expect(result.approvalRequest!.quorum).toBeNull();

    const entries = await activityLog.query({ organizationId: "org_1" });
    expect(entries[0]!.result).toBe("pending_approval");
  });

  it("should auto-approve in observe mode regardless of risk", async () => {
    const config = makeSmbConfig({ governanceProfile: "observe" });

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.create",
        parameters: { amount: 50000 },
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.denied).toBe(false);
    expect(result.envelope.status).toBe("approved");
    expect(result.governanceNote).toContain("observe mode");
  });

  it("should always require approval in locked mode", async () => {
    const config = makeSmbConfig({ governanceProfile: "locked" });

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.envelope.status).toBe("pending_approval");
    expect(result.approvalRequest).not.toBeNull();
  });

  it("should deny when per-action spend limit exceeded", async () => {
    const config = makeSmbConfig({ perActionSpendLimit: 100 });

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.create",
        parameters: { amount: 200 },
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.denied).toBe(true);
    expect(result.envelope.status).toBe("denied");
  });

  it("should save envelope to storage", async () => {
    const config = makeSmbConfig();

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    const saved = await storage.envelopes.getById(result.envelope.id);
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe(result.envelope.id);
  });

  it("should save approval to storage when approval required", async () => {
    const config = makeSmbConfig({ governanceProfile: "locked" });

    const result = await smbPropose(
      {
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    expect(result.approvalRequest).not.toBeNull();
    const saved = await storage.approvals.getById(result.approvalRequest!.id);
    expect(saved).not.toBeNull();
    expect(saved!.request.approvers).toEqual(["owner_1"]);
  });

  it("should record amount in activity log", async () => {
    const config = makeSmbConfig();

    await smbPropose(
      {
        actionType: "digital-ads.campaign.create",
        parameters: { amount: 750 },
        principalId: "user_1",
        organizationId: "org_1",
        cartridgeId: "digital-ads",
      },
      { storage, activityLog, guardrailState, orgConfig: config },
    );

    const entries = await activityLog.query({ organizationId: "org_1" });
    expect(entries[0]!.amount).toBe(750);
  });

  it("should throw when cartridge not found", async () => {
    const config = makeSmbConfig();

    await expect(
      smbPropose(
        {
          actionType: "test.action",
          parameters: {},
          principalId: "user_1",
          organizationId: "org_1",
          cartridgeId: "nonexistent",
        },
        { storage, activityLog, guardrailState, orgConfig: config },
      ),
    ).rejects.toThrow("Cartridge not found");
  });
});
