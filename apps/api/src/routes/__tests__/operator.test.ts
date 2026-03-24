import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { operatorRoutes } from "../operator.js";

describe("operatorRoutes", () => {
  let app: FastifyInstance;
  const mockInterpret = vi.fn();
  const mockEvaluate = vi.fn();
  const mockDispatch = vi.fn();
  const mockFormat = vi.fn();
  const mockSaveRequest = vi.fn();
  const mockSaveCommand = vi.fn();
  const mockUpdateStatus = vi.fn();
  const mockListCommands = vi.fn();

  beforeEach(async () => {
    app = Fastify();
    // Mock operator deps on Fastify instance
    (app as unknown as Record<string, unknown>).operatorDeps = {
      interpreter: { interpret: mockInterpret },
      guardrailEvaluator: { evaluate: mockEvaluate },
      router: { dispatch: mockDispatch },
      formatter: {
        formatSuccess: mockFormat.mockReturnValue("Done"),
        formatError: vi.fn().mockReturnValue("Error"),
        formatConfirmationPrompt: vi.fn().mockReturnValue("Confirm?"),
        formatClarificationPrompt: vi.fn().mockReturnValue("Which one?"),
      },
      commandStore: {
        saveRequest: mockSaveRequest.mockResolvedValue(undefined),
        saveCommand: mockSaveCommand.mockResolvedValue(undefined),
        updateCommandStatus: mockUpdateStatus.mockResolvedValue(undefined),
        listCommands: mockListCommands.mockResolvedValue([]),
      },
    };
    // Mock auth
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (req) => {
      (req as unknown as Record<string, unknown>).organizationIdFromAuth = "org-1";
    });

    await app.register(operatorRoutes, { prefix: "/api/operator" });
    await app.ready();

    vi.clearAllMocks();
  });

  it("POST /command — processes a command end-to-end", async () => {
    mockInterpret.mockResolvedValue({
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      confidence: 0.95,
      ambiguityFlags: [],
    });
    mockEvaluate.mockReturnValue({
      canExecute: true,
      requiresConfirmation: false,
      requiresPreview: false,
      warnings: [],
      missingEntities: [],
      riskLevel: "low",
      ambiguityFlags: [],
    });
    mockDispatch.mockResolvedValue({
      success: true,
      workflowIds: [],
      resultSummary: '{"totalDeals":12}',
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/operator/command",
      payload: {
        rawInput: "show me pipeline",
        channel: "telegram",
        operatorId: "op-1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("completed");
  });

  it("POST /command — blocks when guardrails fail", async () => {
    mockInterpret.mockResolvedValue({
      intent: "unknown",
      entities: [],
      parameters: {},
      confidence: 0,
      ambiguityFlags: ["llm_error"],
    });
    mockEvaluate.mockReturnValue({
      canExecute: false,
      requiresConfirmation: false,
      requiresPreview: false,
      warnings: ["Could not understand"],
      missingEntities: [],
      riskLevel: "low",
      ambiguityFlags: ["llm_error"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/operator/command",
      payload: {
        rawInput: "asdfgh",
        channel: "telegram",
        operatorId: "op-1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("rejected");
  });

  it("GET /commands — lists command history", async () => {
    mockListCommands.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/operator/commands",
    });

    expect(res.statusCode).toBe(200);
  });

  it("POST /command — returns 401 without org context", async () => {
    // Override the hook to not set orgId
    const app2 = Fastify();
    (app2 as unknown as Record<string, unknown>).operatorDeps = (
      app as unknown as Record<string, unknown>
    ).operatorDeps;
    app2.decorateRequest("organizationIdFromAuth", undefined);
    await app2.register(operatorRoutes, { prefix: "/api/operator" });
    await app2.ready();

    const res = await app2.inject({
      method: "POST",
      url: "/api/operator/command",
      payload: {
        rawInput: "show pipeline",
        channel: "telegram",
        operatorId: "op-1",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
