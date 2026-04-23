import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSkillMode } from "../skill-mode.js";

const register = vi.fn();

const governanceInstance = { name: "governance" };
const GovernanceHook = vi.fn().mockImplementation(() => governanceInstance);

const SkillExecutorImpl = vi.fn().mockImplementation(function (
  this: Record<string, unknown>,
  ...args: unknown[]
) {
  this._constructorArgs = args;
  return this;
});

vi.mock("@switchboard/core/skill-runtime", () => ({
  loadSkill: vi.fn(() => ({
    slug: "alex",
    body: "You are Alex",
    parameters: {},
    tools: ["crm-write"],
  })),
  SkillExecutorImpl,
  GovernanceHook,
  AnthropicToolCallingAdapter: vi.fn().mockImplementation(() => ({})),
  BuilderRegistry: vi.fn().mockImplementation(() => ({})),
  createCrmQueryTool: vi.fn(() => ({ operations: { get: { effectCategory: "read" } } })),
  createCrmWriteTool: vi.fn(() => ({ operations: { upsert: { effectCategory: "write" } } })),
  createCalendarBookTool: vi.fn(() => ({
    operations: { create: { effectCategory: "external_mutation" } },
  })),
  createEscalateToolFactory: vi.fn(() => () => ({
    operations: { owner: { effectCategory: "external_send" } },
  })),
  BookingFailureHandler: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/core/platform", () => ({
  SkillMode: class SkillMode {
    constructor(public config: Record<string, unknown>) {}
  },
  registerSkillIntents: vi.fn(),
}));

vi.mock("@switchboard/core", () => ({
  HandoffPackageAssembler: vi.fn().mockImplementation(() => ({})),
  HandoffNotifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/core/notifications", () => ({
  NoopNotifier: vi.fn().mockImplementation(() => ({})),
  TelegramApprovalNotifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/db", () => ({
  PrismaContactStore: vi.fn().mockImplementation(() => ({})),
  PrismaOpportunityStore: vi.fn().mockImplementation(() => ({
    findActiveByContact: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "opp_1" })),
  })),
  PrismaActivityLogStore: vi.fn().mockImplementation(() => ({})),
  PrismaBookingStore: vi.fn().mockImplementation(() => ({ findById: vi.fn(async () => null) })),
  PrismaHandoffStore: vi.fn().mockImplementation(() => ({})),
  PrismaBusinessFactsStore: vi.fn().mockImplementation(() => ({})),
}));

describe("bootstrapSkillMode governance wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANTHROPIC_API_KEY"] = "test-key";
  });

  it("constructs GovernanceHook and passes it to SkillExecutorImpl", async () => {
    await bootstrapSkillMode({
      prismaClient: {
        $transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => unknown) =>
          fn({
            booking: { update: vi.fn() },
            escalationRecord: {},
            outboxEvent: { create: vi.fn() },
          }),
        ),
        escalationRecord: { findMany: vi.fn(async () => []) },
      } as never,
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    // GovernanceHook was constructed with the tools map
    expect(GovernanceHook).toHaveBeenCalledOnce();
    const hookArg = GovernanceHook.mock.calls[0]![0];
    expect(hookArg).toBeInstanceOf(Map);

    // SkillExecutorImpl was constructed
    expect(SkillExecutorImpl).toHaveBeenCalledOnce();

    // The GovernanceHook instance was passed to SkillExecutorImpl
    const executorArgs = SkillExecutorImpl.mock.calls[0]!;
    const hooksArg = executorArgs.find(
      (arg) => Array.isArray(arg) && arg.some((h) => h === governanceInstance),
    );
    expect(hooksArg).toBeDefined();
  });
});
