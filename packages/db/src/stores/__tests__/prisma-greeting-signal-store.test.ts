// ---------------------------------------------------------------------------
// PrismaGreetingSignalStore Integration Tests
//
// Requires running PostgreSQL (DATABASE_URL in env).
// Tests signal projection from PendingActionRecord + AuditEntry.
// ---------------------------------------------------------------------------

import { describe, beforeEach, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaGreetingSignalStore } from "../prisma-greeting-signal-store.js";

const ORG_ID = `test-greeting-${Date.now()}`;

describe.skipIf(!process.env.DATABASE_URL)("PrismaGreetingSignalStore", () => {
  const prisma = new PrismaClient();
  const store = new PrismaGreetingSignalStore(prisma);

  beforeEach(async () => {
    // Clean up test data
    await prisma.pendingActionRecord.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.auditEntry.deleteMany({ where: { organizationId: ORG_ID } });
  });

  describe("getSignal", () => {
    it("returns zero signal when org has no pending records", async () => {
      const signal = await store.getSignal(ORG_ID, "alex");

      expect(signal).toEqual({
        inboxCount: 0,
        oldestOpenItemAgeHours: null,
        hoursSinceLastOperatorAction: null,
      });
    });

    it("counts pending records for the correct agent", async () => {
      // Seed 2 pending for alex, 1 for riley
      await prisma.pendingActionRecord.createMany({
        data: [
          {
            idempotencyKey: `alex-1-${Date.now()}`,
            status: "pending",
            intent: "test-lead",
            targetEntities: {},
            parameters: {},
            humanSummary: "Alex lead 1",
            confidence: 0.9,
            riskLevel: "low",
            dollarsAtRisk: 0,
            requiredCapabilities: [],
            approvalRequired: "manual",
            sourceAgent: "alex",
            organizationId: ORG_ID,
            surface: "queue",
          },
          {
            idempotencyKey: `alex-2-${Date.now()}`,
            status: "pending",
            intent: "test-lead",
            targetEntities: {},
            parameters: {},
            humanSummary: "Alex lead 2",
            confidence: 0.9,
            riskLevel: "low",
            dollarsAtRisk: 0,
            requiredCapabilities: [],
            approvalRequired: "manual",
            sourceAgent: "alex",
            organizationId: ORG_ID,
            surface: "queue",
          },
          {
            idempotencyKey: `riley-1-${Date.now()}`,
            status: "pending",
            intent: "test-adset",
            targetEntities: {},
            parameters: {},
            humanSummary: "Riley adset 1",
            confidence: 0.9,
            riskLevel: "low",
            dollarsAtRisk: 0,
            requiredCapabilities: [],
            approvalRequired: "manual",
            sourceAgent: "riley",
            organizationId: ORG_ID,
            surface: "queue",
          },
        ],
      });

      const alexSignal = await store.getSignal(ORG_ID, "alex");
      const rileySignal = await store.getSignal(ORG_ID, "riley");

      expect(alexSignal.inboxCount).toBe(2);
      expect(rileySignal.inboxCount).toBe(1);
    });

    it("computes oldestOpenItemAgeHours from oldest pending record", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      await prisma.pendingActionRecord.create({
        data: {
          idempotencyKey: `old-${Date.now()}`,
          status: "pending",
          intent: "test-lead",
          targetEntities: {},
          parameters: {},
          humanSummary: "Old lead",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          approvalRequired: "manual",
          sourceAgent: "alex",
          organizationId: ORG_ID,
          surface: "queue",
          createdAt: twoHoursAgo,
        },
      });

      const signal = await store.getSignal(ORG_ID, "alex");

      expect(signal.oldestOpenItemAgeHours).toBeGreaterThan(1.9);
      expect(signal.oldestOpenItemAgeHours).toBeLessThan(2.5);
    });

    it("computes hoursSinceLastOperatorAction from audit entries", async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      await prisma.auditEntry.create({
        data: {
          eventType: "action_approved",
          actorType: "operator",
          actorId: "test-operator",
          entityType: "action",
          entityId: "test-action-1",
          riskCategory: "low",
          summary: "Operator approved something",
          snapshot: {},
          evidencePointers: {},
          entryHash: "test-hash-1",
          organizationId: ORG_ID,
          timestamp: threeHoursAgo,
        },
      });

      const signal = await store.getSignal(ORG_ID, "alex");

      expect(signal.hoursSinceLastOperatorAction).toBeGreaterThan(2.9);
      expect(signal.hoursSinceLastOperatorAction).toBeLessThan(3.5);
    });
  });

  describe("getTopItem", () => {
    it("returns null when org has no pending records", async () => {
      const topItem = await store.getTopItem(ORG_ID, "alex");

      expect(topItem).toBeNull();
    });

    it("returns oldest pending record with extracted name and age label", async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

      await prisma.pendingActionRecord.create({
        data: {
          idempotencyKey: `maya-${Date.now()}`,
          status: "pending",
          intent: "test-lead",
          targetEntities: {},
          parameters: {},
          humanSummary: 'New lead from "Maya Johnson" needs review',
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          approvalRequired: "manual",
          sourceAgent: "alex",
          organizationId: ORG_ID,
          surface: "queue",
          createdAt: oneHourAgo,
        },
      });

      const topItem = await store.getTopItem(ORG_ID, "alex");

      expect(topItem).not.toBeNull();
      expect(topItem?.name).toBe("Maya Johnson");
      expect(topItem?.ageLabel).toBe("about an hour");
    });

    it("falls back to first 20 chars when name extraction fails", async () => {
      await prisma.pendingActionRecord.create({
        data: {
          idempotencyKey: `generic-${Date.now()}`,
          status: "pending",
          intent: "test-lead",
          targetEntities: {},
          parameters: {},
          humanSummary: "This is a very long summary without a clear name to extract from it",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          approvalRequired: "manual",
          sourceAgent: "alex",
          organizationId: ORG_ID,
          surface: "queue",
        },
      });

      const topItem = await store.getTopItem(ORG_ID, "alex");

      expect(topItem).not.toBeNull();
      expect(topItem?.name).toBe("This is a very long ");
    });
  });
});
