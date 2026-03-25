// ---------------------------------------------------------------------------
// Tests for operator command routes (submit, confirm, cancel)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { OperatorCommand, OperatorRequest } from "@switchboard/schemas";
import { operatorRoutes } from "../routes/operator.js";
import type { OperatorDeps } from "../bootstrap/operator-deps.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeCommand(overrides: Partial<OperatorCommand> = {}): OperatorCommand {
  return {
    id: "cmd-1",
    requestId: "req-1",
    organizationId: "org-1",
    intent: "pause_campaigns",
    entities: [{ type: "campaign" }],
    parameters: {},
    parseConfidence: 0.95,
    guardrailResult: {
      canExecute: true,
      requiresConfirmation: true,
      requiresPreview: false,
      warnings: [],
      missingEntities: [],
      riskLevel: "medium",
      ambiguityFlags: [],
    },
    status: "parsed",
    workflowIds: [],
    resultSummary: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<OperatorRequest> = {}): OperatorRequest {
  return {
    id: "req-1",
    organizationId: "org-1",
    operatorId: "op-1",
    channel: "dashboard",
    rawInput: "pause all campaigns",
    receivedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app with mock deps
// ---------------------------------------------------------------------------

function buildMockDeps(): OperatorDeps {
  return {
    interpreter: { interpret: vi.fn() } as unknown as OperatorDeps["interpreter"],
    guardrailEvaluator: { evaluate: vi.fn() } as unknown as OperatorDeps["guardrailEvaluator"],
    router: {
      dispatch: vi.fn().mockResolvedValue({
        success: true,
        workflowIds: ["wf-1"],
        resultSummary: '{"paused":2}',
      }),
    } as unknown as OperatorDeps["router"],
    formatter: {
      formatSuccess: vi.fn().mockReturnValue("Done: paused 2 campaigns"),
      formatError: vi.fn().mockReturnValue("Error occurred"),
      formatConfirmationPrompt: vi.fn(),
      formatClarificationPrompt: vi.fn(),
    } as unknown as OperatorDeps["formatter"],
    commandStore: {
      saveRequest: vi.fn(),
      saveCommand: vi.fn(),
      updateCommandStatus: vi.fn(),
      getCommandById: vi.fn(),
      listCommands: vi.fn().mockResolvedValue([]),
      getRequestById: vi.fn(),
    } as unknown as OperatorDeps["commandStore"],
  };
}

function buildApp(deps: OperatorDeps) {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).operatorDeps = deps;
  app.decorateRequest("organizationIdFromAuth", undefined);

  // Hook to inject org id from header
  app.addHook("preHandler", (request, _reply, done) => {
    const orgHeader = request.headers["x-org-id"];
    if (orgHeader) {
      request.organizationIdFromAuth = orgHeader as string;
    }
    done();
  });

  app.register(operatorRoutes, { prefix: "/api/operator" });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("operator routes — confirm/cancel", () => {
  let deps: OperatorDeps;

  beforeEach(() => {
    deps = buildMockDeps();
  });

  // =========================================================================
  // POST /command/:id/confirm
  // =========================================================================
  describe("POST /api/operator/command/:id/confirm", () => {
    it("returns 401 when org context is missing", async () => {
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/confirm",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 when command not found", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(null);
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-999/confirm",
        headers: { "x-org-id": "org-1" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 when command belongs to a different org", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(
        makeCommand({ organizationId: "org-other" }),
      );
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/confirm",
        headers: { "x-org-id": "org-1" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 409 when command is not in parsed status", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(
        makeCommand({ status: "completed" }),
      );
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/confirm",
        headers: { "x-org-id": "org-1" },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("parsed");
    });

    it("executes command and returns completed status on success", async () => {
      const cmd = makeCommand();
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(cmd);
      vi.mocked(deps.commandStore.getRequestById).mockResolvedValue(makeRequest());

      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/confirm",
        headers: { "x-org-id": "org-1" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.commandId).toBe("cmd-1");
      expect(body.status).toBe("completed");
      expect(body.workflowIds).toEqual(["wf-1"]);
      expect(body.message).toBe("Done: paused 2 campaigns");

      // Verify status was updated to executing first
      expect(deps.commandStore.updateCommandStatus).toHaveBeenCalledWith("cmd-1", "executing");

      // Then updated to completed with results
      expect(deps.commandStore.updateCommandStatus).toHaveBeenCalledWith("cmd-1", "completed", {
        resultSummary: "Done: paused 2 campaigns",
        completedAt: expect.any(Date),
        workflowIds: ["wf-1"],
      });
    });

    it("returns failed status when dispatch fails", async () => {
      const cmd = makeCommand();
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(cmd);
      vi.mocked(deps.commandStore.getRequestById).mockResolvedValue(makeRequest());
      vi.mocked(deps.router.dispatch).mockResolvedValue({
        success: false,
        workflowIds: [],
        resultSummary: "",
        error: "Campaign not found",
      });

      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/confirm",
        headers: { "x-org-id": "org-1" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("failed");
      expect(body.message).toBe("Error occurred");
    });

    it("uses dashboard channel as fallback when request not found", async () => {
      const cmd = makeCommand();
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(cmd);
      vi.mocked(deps.commandStore.getRequestById).mockResolvedValue(null);

      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/confirm",
        headers: { "x-org-id": "org-1" },
      });

      expect(res.statusCode).toBe(200);
      // formatter.formatSuccess should have been called with "dashboard" channel
      expect(deps.formatter.formatSuccess).toHaveBeenCalledWith(
        "pause_campaigns",
        expect.any(Object),
        "dashboard",
      );
    });
  });

  // =========================================================================
  // POST /command/:id/cancel
  // =========================================================================
  describe("POST /api/operator/command/:id/cancel", () => {
    it("returns 401 when org context is missing", async () => {
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/cancel",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 when command not found", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(null);
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-999/cancel",
        headers: { "x-org-id": "org-1" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 when command belongs to a different org", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(
        makeCommand({ organizationId: "org-other" }),
      );
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/cancel",
        headers: { "x-org-id": "org-1" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 409 when command is not in parsed status", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(
        makeCommand({ status: "executing" }),
      );
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/cancel",
        headers: { "x-org-id": "org-1" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("cancels command and returns rejected status", async () => {
      vi.mocked(deps.commandStore.getCommandById).mockResolvedValue(makeCommand());
      const app = buildApp(deps);
      const res = await app.inject({
        method: "POST",
        url: "/api/operator/command/cmd-1/cancel",
        headers: { "x-org-id": "org-1" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.commandId).toBe("cmd-1");
      expect(body.status).toBe("rejected");
      expect(body.message).toBe("Command cancelled.");

      expect(deps.commandStore.updateCommandStatus).toHaveBeenCalledWith("cmd-1", "rejected", {
        resultSummary: "Cancelled by operator",
        completedAt: expect.any(Date),
      });
    });
  });
});
