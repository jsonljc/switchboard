import { describe, it, expect, beforeEach } from "vitest";
import { CampaignDeployer } from "../campaign-deploy.js";
import { InMemoryTestCampaignStore } from "../../stores/in-memory.js";
import { InMemoryDispatcher } from "../dispatcher.js";
import type { CampaignConfig } from "../campaign-deploy.js";

const defaultConfig: CampaignConfig = {
  accountId: "acct-1",
  organizationId: "org-1",
  constraintType: "CREATIVE",
  creativeAssetIds: ["asset-1", "asset-2", "asset-3"],
  budget: 500,
};

describe("CampaignDeployer", () => {
  let store: InMemoryTestCampaignStore;
  let dispatcher: InMemoryDispatcher;
  let deployer: CampaignDeployer;

  beforeEach(() => {
    store = new InMemoryTestCampaignStore();
    dispatcher = new InMemoryDispatcher();
    deployer = new CampaignDeployer(store, dispatcher);
  });

  describe("createTestCampaign", () => {
    it("creates a campaign in DRAFT status", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);

      expect(campaign.status).toBe("DRAFT");
      expect(campaign.accountId).toBe("acct-1");
      expect(campaign.constraintType).toBe("CREATIVE");
      expect(campaign.creativeAssetIds).toEqual(["asset-1", "asset-2", "asset-3"]);
      expect(campaign.budget).toBe(500);
      expect(campaign.startedAt).toBeNull();
      expect(campaign.completedAt).toBeNull();
    });

    it("persists the campaign to the store", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      const stored = await store.getById(campaign.id);
      expect(stored).not.toBeNull();
      expect(stored!.id).toBe(campaign.id);
    });
  });

  describe("deploy", () => {
    it("deploys a campaign through full lifecycle with AUTO governance", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      const result = await deployer.deploy(campaign.id, "AUTO");

      expect(result.dispatched).toBe(true);
      expect(result.campaign.status).toBe("ACTIVE");
      expect(result.campaign.startedAt).not.toBeNull();
    });

    it("blocks deployment when governance is BLOCKED", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      const result = await deployer.deploy(campaign.id, "BLOCKED");

      expect(result.dispatched).toBe(false);
      expect(result.campaign.status).toBe("FAILED");
      expect(result.reason).toContain("blocked");
    });

    it("throws for non-existent campaign", async () => {
      await expect(deployer.deploy("non-existent")).rejects.toThrow("not found");
    });

    it("works without dispatcher", async () => {
      const deployerNoDispatch = new CampaignDeployer(store);
      const campaign = await deployerNoDispatch.createTestCampaign(defaultConfig);
      const result = await deployerNoDispatch.deploy(campaign.id);

      expect(result.dispatched).toBe(true);
      expect(result.campaign.status).toBe("ACTIVE");
    });

    it("records dispatch in dispatcher history", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      await deployer.deploy(campaign.id, "AUTO");

      const dispatched = dispatcher.getDispatched();
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.result.dispatched).toBe(true);
    });
  });

  describe("pause", () => {
    it("pauses an active campaign", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      await deployer.deploy(campaign.id, "AUTO");
      const paused = await deployer.pause(campaign.id);

      expect(paused.status).toBe("PAUSED");
    });

    it("throws for non-existent campaign", async () => {
      await expect(deployer.pause("non-existent")).rejects.toThrow("not found");
    });

    it("throws when pausing a DRAFT campaign", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      await expect(deployer.pause(campaign.id)).rejects.toThrow("Invalid campaign transition");
    });
  });

  describe("complete", () => {
    it("completes an active campaign", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      await deployer.deploy(campaign.id, "AUTO");
      const completed = await deployer.complete(campaign.id);

      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedAt).not.toBeNull();
    });

    it("completes a paused campaign", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      await deployer.deploy(campaign.id, "AUTO");
      await deployer.pause(campaign.id);
      const completed = await deployer.complete(campaign.id);

      expect(completed.status).toBe("COMPLETED");
    });

    it("throws when completing a DRAFT campaign", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      await expect(deployer.complete(campaign.id)).rejects.toThrow("Invalid campaign transition");
    });
  });

  describe("full lifecycle", () => {
    it("supports DRAFT → ACTIVE → PAUSED → ACTIVE → COMPLETED", async () => {
      const campaign = await deployer.createTestCampaign(defaultConfig);
      expect(campaign.status).toBe("DRAFT");

      await deployer.deploy(campaign.id, "AUTO");
      let current = await store.getById(campaign.id);
      expect(current!.status).toBe("ACTIVE");

      await deployer.pause(campaign.id);
      current = await store.getById(campaign.id);
      expect(current!.status).toBe("PAUSED");

      // Re-activate (PAUSED → ACTIVE is valid via store.updateStatus)
      await store.updateStatus(campaign.id, "ACTIVE");
      current = await store.getById(campaign.id);
      expect(current!.status).toBe("ACTIVE");

      await deployer.complete(campaign.id);
      current = await store.getById(campaign.id);
      expect(current!.status).toBe("COMPLETED");
    });
  });
});
