import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOperatorCommandStore } from "../prisma-command-store.js";
import type { OperatorCommand, OperatorRequest } from "@switchboard/schemas";

function makeMockPrisma() {
  return {
    operatorRequestRecord: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    operatorCommandRecord: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("PrismaOperatorCommandStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaOperatorCommandStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaOperatorCommandStore(prisma as never);
  });

  it("saves an operator request", async () => {
    const request: OperatorRequest = {
      id: "req-1",
      organizationId: "org-1",
      operatorId: "op-1",
      channel: "telegram",
      rawInput: "show pipeline",
      receivedAt: new Date(),
    };

    await store.saveRequest(request);
    expect(prisma.operatorRequestRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "req-1", organizationId: "org-1" }),
    });
  });

  it("saves an operator command", async () => {
    const command: OperatorCommand = {
      id: "cmd-1",
      requestId: "req-1",
      organizationId: "org-1",
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      parseConfidence: 0.95,
      guardrailResult: {
        canExecute: true,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings: [],
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: [],
      },
      status: "parsed",
      workflowIds: [],
      resultSummary: null,
      createdAt: new Date(),
      completedAt: null,
    };

    await store.saveCommand(command);
    expect(prisma.operatorCommandRecord.create).toHaveBeenCalled();
  });

  it("updates command status with tenant-scoped updateMany", async () => {
    const completedAt = new Date();
    await store.updateCommandStatus("org_1", "cmd-1", "completed", {
      resultSummary: "Done",
      completedAt,
    });
    expect(prisma.operatorCommandRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cmd-1", organizationId: "org_1" },
        data: expect.objectContaining({ status: "completed", resultSummary: "Done" }),
      }),
    );
  });

  it("throws StaleVersionError when updateMany count === 0", async () => {
    prisma.operatorCommandRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(store.updateCommandStatus("org_1", "cmd-missing", "completed")).rejects.toThrow(
      /Stale version/,
    );
  });

  it("lists commands by org", async () => {
    await store.listCommands({ organizationId: "org-1", limit: 20 });
    expect(prisma.operatorCommandRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
        take: 20,
      }),
    );
  });
});
