// ---------------------------------------------------------------------------
// Campaign Deployer — Testing campaign lifecycle management
// ---------------------------------------------------------------------------
// Creates, deploys, pauses, and completes testing campaigns with full
// lifecycle tracking and dispatcher integration.
// ---------------------------------------------------------------------------

import type { TestCampaign, TestCampaignStatus, ConstraintType } from "@switchboard/schemas";
import type { TestCampaignStore } from "../stores/interfaces.js";
import type { InterventionDispatcher, GovernanceGate } from "./dispatcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignConfig {
  accountId: string;
  organizationId: string;
  constraintType: ConstraintType;
  creativeAssetIds: string[];
  budget: number;
}

export interface CampaignDeployResult {
  campaign: TestCampaign;
  dispatched: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TestCampaignStatus, TestCampaignStatus[]> = {
  DRAFT: ["READY"],
  READY: ["DEPLOYING"],
  DEPLOYING: ["ACTIVE", "FAILED"],
  ACTIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["ACTIVE", "COMPLETED"],
  COMPLETED: [],
  FAILED: ["DRAFT"],
};

// ---------------------------------------------------------------------------
// CampaignDeployer
// ---------------------------------------------------------------------------

export class CampaignDeployer {
  constructor(
    private readonly store: TestCampaignStore,
    private readonly dispatcher?: InterventionDispatcher,
  ) {}

  /**
   * Create a new test campaign in DRAFT status.
   */
  async createTestCampaign(config: CampaignConfig): Promise<TestCampaign> {
    const now = new Date().toISOString();
    const campaign: TestCampaign = {
      id: crypto.randomUUID(),
      accountId: config.accountId,
      organizationId: config.organizationId,
      constraintType: config.constraintType,
      status: "DRAFT",
      creativeAssetIds: config.creativeAssetIds,
      budget: config.budget,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(campaign);
    return campaign;
  }

  /**
   * Deploy a campaign: DRAFT → READY → DEPLOYING → ACTIVE
   * Integrates with dispatcher for governance gating.
   */
  async deploy(
    campaignId: string,
    governanceLevel: GovernanceGate = "APPROVAL_REQUIRED",
  ): Promise<CampaignDeployResult> {
    const campaign = await this.store.getById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    // Transition to READY
    let current = this.transition(campaign, "READY");
    await this.store.save(current);

    // Transition to DEPLOYING
    current = this.transition(current, "DEPLOYING");
    await this.store.save(current);

    // Check governance via dispatcher
    if (this.dispatcher) {
      // Create a minimal intervention-like object for dispatch
      const dispatchResult = await this.dispatcher.dispatch(
        {
          id: campaignId,
          cycleId: "campaign",
          constraintType: campaign.constraintType,
          actionType: "REFRESH_CREATIVE",
          status: "APPROVED",
          priority: 2,
          estimatedImpact: "MEDIUM",
          reasoning: `Test campaign deployment for ${campaign.constraintType}`,
          artifacts: [],
          outcomeStatus: "PENDING",
          createdAt: campaign.createdAt,
          updatedAt: new Date().toISOString(),
        },
        governanceLevel,
      );

      if (!dispatchResult.dispatched) {
        // Revert to DRAFT if governance blocks
        current = {
          ...current,
          status: "FAILED" as TestCampaignStatus,
          updatedAt: new Date().toISOString(),
        };
        await this.store.save(current);
        return {
          campaign: current,
          dispatched: false,
          reason: dispatchResult.reason,
        };
      }
    }

    // Transition to ACTIVE
    current = this.transition(current, "ACTIVE");
    current = { ...current, startedAt: new Date().toISOString() };
    await this.store.save(current);

    return {
      campaign: current,
      dispatched: true,
      reason: "Campaign deployed successfully",
    };
  }

  /**
   * Pause an active campaign.
   */
  async pause(campaignId: string): Promise<TestCampaign> {
    const campaign = await this.store.getById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const paused = this.transition(campaign, "PAUSED");
    await this.store.save(paused);
    return paused;
  }

  /**
   * Complete a campaign (from ACTIVE or PAUSED).
   */
  async complete(campaignId: string): Promise<TestCampaign> {
    const campaign = await this.store.getById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const completed = this.transition(campaign, "COMPLETED");
    const withTimestamp = {
      ...completed,
      completedAt: new Date().toISOString(),
    };
    await this.store.save(withTimestamp);
    return withTimestamp;
  }

  /**
   * Validate and apply a status transition.
   */
  private transition(campaign: TestCampaign, targetStatus: TestCampaignStatus): TestCampaign {
    const allowed = VALID_TRANSITIONS[campaign.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new Error(
        `Invalid campaign transition: ${campaign.status} → ${targetStatus}. ` +
          `Allowed: ${allowed?.join(", ") || "none"}`,
      );
    }

    return {
      ...campaign,
      status: targetStatus,
      updatedAt: new Date().toISOString(),
    };
  }
}
