import { describe, it, expect, beforeEach } from "vitest";
import {
  createApprovalCheckpoint,
  resolveCheckpoint,
  isCheckpointExpired,
} from "../approval-checkpoint.js";
import { createPendingAction } from "../pending-action.js";
import { InMemoryApprovalCheckpointStore } from "./test-stores.js";

describe("ApprovalCheckpoint", () => {
  let store: InMemoryApprovalCheckpointStore;

  beforeEach(() => {
    store = new InMemoryApprovalCheckpointStore();
  });

  describe("createApprovalCheckpoint", () => {
    it("creates pending checkpoint with correct fields", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
      });

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.workflowId).toBe("workflow-1");
      expect(checkpoint.stepIndex).toBe(0);
      expect(checkpoint.actionId).toBe(action.id);
      expect(checkpoint.reason).toBe("Email requires manual approval");
      expect(checkpoint.options).toEqual(["approve", "reject"]);
      expect(checkpoint.modifiableFields).toEqual([]);
      expect(checkpoint.alternatives).toEqual([]);
      expect(checkpoint.notifyChannels).toEqual(["dashboard"]);
      expect(checkpoint.status).toBe("pending");
      expect(checkpoint.resolution).toBeNull();
      expect(checkpoint.createdAt).toBeInstanceOf(Date);
      expect(checkpoint.expiresAt).toBeInstanceOf(Date);
      expect(checkpoint.expiresAt.getTime()).toBeGreaterThan(checkpoint.createdAt.getTime());
    });

    it("includes modify option when modifiableFields are provided", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
        modifiableFields: ["subject", "body"],
      });

      expect(checkpoint.options).toEqual(["approve", "reject", "modify"]);
      expect(checkpoint.modifiableFields).toEqual(["subject", "body"]);
    });

    it("uses custom alternatives and notifyChannels when provided", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
        alternatives: [
          { label: "Send SMS instead", parameters: { message: "Hi" } },
          { label: "Skip notification", parameters: {} },
        ],
        notifyChannels: ["telegram", "whatsapp"],
      });

      expect(checkpoint.alternatives).toHaveLength(2);
      expect(checkpoint.alternatives[0]?.label).toBe("Send SMS instead");
      expect(checkpoint.notifyChannels).toEqual(["telegram", "whatsapp"]);
    });
  });

  describe("resolveCheckpoint", () => {
    it("resolves checkpoint to approved status", async () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
      });

      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator-123",
        action: "approve",
      });

      const updated = await store.getById(checkpoint.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("approved");
      expect(updated!.resolution).not.toBeNull();
      expect(updated!.resolution!.decidedBy).toBe("operator-123");
      expect(updated!.resolution!.decidedAt).toBeInstanceOf(Date);
      expect(updated!.resolution!.selectedAlternative).toBeNull();
      expect(updated!.resolution!.fieldEdits).toBeNull();
    });

    it("resolves checkpoint to rejected status", async () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
      });

      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator-456",
        action: "reject",
      });

      const updated = await store.getById(checkpoint.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("rejected");
      expect(updated!.resolution).not.toBeNull();
      expect(updated!.resolution!.decidedBy).toBe("operator-456");
    });

    it("resolves checkpoint with field edits", async () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
        modifiableFields: ["subject", "body"],
      });

      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator-789",
        action: "modify",
        fieldEdits: { subject: "Updated Subject" },
      });

      const updated = await store.getById(checkpoint.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("modified");
      expect(updated!.resolution).not.toBeNull();
      expect(updated!.resolution!.fieldEdits).toEqual({ subject: "Updated Subject" });
    });

    it("resolves checkpoint with selected alternative", async () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
        alternatives: [
          { label: "Send SMS instead", parameters: { message: "Hi" } },
          { label: "Skip notification", parameters: {} },
        ],
      });

      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator-999",
        action: "approve",
        selectedAlternative: 1,
      });

      const updated = await store.getById(checkpoint.id);
      expect(updated).not.toBeNull();
      expect(updated!.resolution).not.toBeNull();
      expect(updated!.resolution!.selectedAlternative).toBe(1);
    });

    it("throws when checkpoint not found", async () => {
      await expect(
        resolveCheckpoint(store, "nonexistent-id", {
          decidedBy: "operator-123",
          action: "approve",
        }),
      ).rejects.toThrow("Checkpoint nonexistent-id not found");
    });

    it("throws when checkpoint is already resolved", async () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000,
      });

      await store.create(checkpoint);

      // Resolve it once
      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator-123",
        action: "approve",
      });

      // Try to resolve again
      await expect(
        resolveCheckpoint(store, checkpoint.id, {
          decidedBy: "operator-456",
          action: "reject",
        }),
      ).rejects.toThrow(`Checkpoint ${checkpoint.id} is already resolved (status: approved)`);
    });
  });

  describe("isCheckpointExpired", () => {
    it("returns false when checkpoint has not expired", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000, // 1 hour in the future
      });

      expect(isCheckpointExpired(checkpoint)).toBe(false);
    });

    it("returns true when checkpoint has expired", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: -1000, // Expired 1 second ago
      });

      expect(isCheckpointExpired(checkpoint)).toBe(true);
    });

    it("uses provided now parameter for expiry check", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "contact-1" }],
        parameters: { subject: "Hello", body: "World" },
        humanSummary: "Send email to contact",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "human_review",
        sourceAgent: "test-agent",
        organizationId: "org-1",
      });

      const checkpoint = createApprovalCheckpoint({
        workflowId: "workflow-1",
        stepIndex: 0,
        action,
        reason: "Email requires manual approval",
        ttlMs: 3600000, // 1 hour in the future from now
      });

      // Check with a time in the far future
      const futureTime = new Date(checkpoint.expiresAt.getTime() + 1000);
      expect(isCheckpointExpired(checkpoint, futureTime)).toBe(true);

      // Check with a time before expiry
      const pastTime = new Date(checkpoint.expiresAt.getTime() - 1000);
      expect(isCheckpointExpired(checkpoint, pastTime)).toBe(false);
    });
  });
});
