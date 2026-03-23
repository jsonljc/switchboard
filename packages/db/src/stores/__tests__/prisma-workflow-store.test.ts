import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWorkflowStore } from "../prisma-workflow-store.js";

function mockPrisma() {
  return {
    workflowExecution: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    pendingActionRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    approvalCheckpointRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

describe("PrismaWorkflowStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaWorkflowStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaWorkflowStore(prisma);
  });

  describe("workflows", () => {
    it("create persists a new workflow", async () => {
      const now = new Date();
      const workflow = {
        id: "wf-1",
        organizationId: "org-1",
        triggerType: "agent_initiated" as const,
        triggerRef: null,
        sourceAgent: "sales-closer",
        status: "pending" as const,
        plan: {
          steps: [],
          strategy: "sequential" as const,
          replannedCount: 0,
        },
        currentStepIndex: 0,
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 1000,
          timeoutMs: 300000,
          maxReplans: 3,
        },
        counters: {
          stepsCompleted: 0,
          dollarsAtRisk: 0,
          replansUsed: 0,
        },
        metadata: {},
        traceId: "trace-1",
        error: null,
        errorCode: null,
        startedAt: now,
        completedAt: null,
      };

      await store.workflows.create(workflow);

      expect(prisma.workflowExecution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "wf-1",
          organizationId: "org-1",
          status: "pending",
        }),
      });
    });

    it("getById returns null when workflow not found", async () => {
      (prisma.workflowExecution.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await store.workflows.getById("wf-1");

      expect(result).toBeNull();
      expect(prisma.workflowExecution.findUnique).toHaveBeenCalledWith({
        where: { id: "wf-1" },
      });
    });

    it("getById maps Prisma row to WorkflowExecution", async () => {
      const now = new Date();
      (prisma.workflowExecution.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "wf-1",
        organizationId: "org-1",
        triggerType: "agent_initiated",
        triggerRef: null,
        sourceAgent: "sales-closer",
        status: "running",
        plan: {
          steps: [],
          strategy: "sequential",
          replannedCount: 0,
        },
        currentStepIndex: 0,
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 1000,
          timeoutMs: 300000,
          maxReplans: 3,
        },
        counters: {
          stepsCompleted: 0,
          dollarsAtRisk: 0,
          replansUsed: 0,
        },
        metadata: {},
        traceId: "trace-1",
        error: null,
        errorCode: null,
        startedAt: now,
        completedAt: null,
      });

      const result = await store.workflows.getById("wf-1");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("running");
      expect(result!.organizationId).toBe("org-1");
    });

    it("update applies partial changes", async () => {
      await store.workflows.update("wf-1", {
        status: "completed",
        completedAt: new Date(),
      });

      expect(prisma.workflowExecution.update).toHaveBeenCalledWith({
        where: { id: "wf-1" },
        data: expect.objectContaining({
          status: "completed",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("list filters by organizationId and status", async () => {
      (prisma.workflowExecution.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await store.workflows.list({
        organizationId: "org-1",
        status: "running",
        limit: 10,
      });

      expect(prisma.workflowExecution.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          status: "running",
        },
        take: 10,
        orderBy: { startedAt: "desc" },
      });
    });
  });

  describe("actions", () => {
    it("create persists a new pending action", async () => {
      const now = new Date();
      const action = {
        id: "action-1",
        idempotencyKey: "key-1",
        workflowId: "wf-1",
        stepIndex: 0,
        status: "proposed" as const,
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "c-1" }],
        parameters: { subject: "Test" },
        humanSummary: "Send test email",
        confidence: 0.9,
        riskLevel: "low" as const,
        dollarsAtRisk: 0,
        requiredCapabilities: ["email"],
        dryRunSupported: true,
        approvalRequired: "auto" as const,
        fallback: null,
        sourceAgent: "sales-closer",
        sourceWorkflow: "wf-1",
        organizationId: "org-1",
        createdAt: now,
        expiresAt: null,
        resolvedAt: null,
        resolvedBy: null,
      };

      await store.actions.create(action);

      expect(prisma.pendingActionRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "action-1",
          idempotencyKey: "key-1",
          status: "proposed",
        }),
      });
    });

    it("getById returns null when action not found", async () => {
      (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await store.actions.getById("action-1");

      expect(result).toBeNull();
    });

    it("listByWorkflow returns actions for workflow", async () => {
      (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await store.actions.listByWorkflow("wf-1");

      expect(prisma.pendingActionRecord.findMany).toHaveBeenCalledWith({
        where: { workflowId: "wf-1" },
        orderBy: { createdAt: "asc" },
      });
    });

    it("listByStatus filters by organizationId and status", async () => {
      (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await store.actions.listByStatus("org-1", "proposed", 10);

      expect(prisma.pendingActionRecord.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          status: "proposed",
        },
        take: 10,
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("checkpoints", () => {
    it("create persists a new checkpoint", async () => {
      const now = new Date();
      const checkpoint = {
        id: "cp-1",
        workflowId: "wf-1",
        stepIndex: 0,
        actionId: "action-1",
        reason: "High risk action",
        options: ["approve", "reject"] as Array<"approve" | "reject" | "modify">,
        modifiableFields: [],
        alternatives: [],
        notifyChannels: ["dashboard"] as Array<"telegram" | "whatsapp" | "dashboard">,
        status: "pending" as const,
        resolution: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 3600000),
      };

      await store.checkpoints.create(checkpoint);

      expect(prisma.approvalCheckpointRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "cp-1",
          workflowId: "wf-1",
          stepIndex: 0,
        }),
      });
    });

    it("getById returns null when checkpoint not found", async () => {
      (prisma.approvalCheckpointRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );

      const result = await store.checkpoints.getById("cp-1");

      expect(result).toBeNull();
    });

    it("getByWorkflowAndStep uses composite key", async () => {
      (prisma.approvalCheckpointRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );

      await store.checkpoints.getByWorkflowAndStep("wf-1", 0);

      expect(prisma.approvalCheckpointRecord.findUnique).toHaveBeenCalledWith({
        where: { workflowId_stepIndex: { workflowId: "wf-1", stepIndex: 0 } },
      });
    });

    it("listPending filters by organizationId via workflow relation", async () => {
      (prisma.approvalCheckpointRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await store.checkpoints.listPending("org-1");

      expect(prisma.approvalCheckpointRecord.findMany).toHaveBeenCalledWith({
        where: {
          status: "pending",
          workflow: {
            organizationId: "org-1",
          },
        },
        orderBy: { createdAt: "asc" },
      });
    });
  });
});
