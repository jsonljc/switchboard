import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@switchboard/core/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/core/sessions")>();
  return {
    ...actual,
    applyGatewayOutcomeToSession: vi.fn().mockResolvedValue(undefined),
  };
});

import { applyGatewayOutcomeToSession } from "@switchboard/core/sessions";
import {
  advisoryLockInt32Pair,
  applyGatewayOutcomeForRunWithAdvisoryLock,
  isTerminalSessionStatusForGatewayCallback,
  RunCallbackRunNotFoundError,
  RunCallbackSessionMismatchError,
  RunCallbackSessionNotFoundError,
} from "../apply-gateway-outcome-locked.js";
import type { SessionManagerDeps } from "@switchboard/core/sessions";

const sessionId = "550e8400-e29b-41d4-a716-446655440010";
const runId = "550e8400-e29b-41d4-a716-446655440011";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const sessionManagerBase: Pick<
  SessionManagerDeps,
  "maxConcurrentSessions" | "getRoleCheckpointValidator"
> = {
  maxConcurrentSessions: 10,
  getRoleCheckpointValidator: undefined,
};

describe("isTerminalSessionStatusForGatewayCallback", () => {
  it("treats completed, failed, and cancelled as terminal", () => {
    expect(isTerminalSessionStatusForGatewayCallback("completed")).toBe(true);
    expect(isTerminalSessionStatusForGatewayCallback("failed")).toBe(true);
    expect(isTerminalSessionStatusForGatewayCallback("cancelled")).toBe(true);
  });

  it("does not treat running or paused as terminal", () => {
    expect(isTerminalSessionStatusForGatewayCallback("running")).toBe(false);
    expect(isTerminalSessionStatusForGatewayCallback("paused")).toBe(false);
  });
});

describe("advisoryLockInt32Pair", () => {
  it("is stable for the same session and run", () => {
    expect(advisoryLockInt32Pair(sessionId, runId)).toEqual(
      advisoryLockInt32Pair(sessionId, runId),
    );
  });

  it("differs when runId changes", () => {
    const a = advisoryLockInt32Pair(sessionId, runId);
    const b = advisoryLockInt32Pair(sessionId, "550e8400-e29b-41d4-a716-446655440099");
    expect(a).not.toEqual(b);
  });
});

describe("applyGatewayOutcomeForRunWithAdvisoryLock", () => {
  beforeEach(() => {
    vi.mocked(applyGatewayOutcomeToSession).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns duplicate without applying when run already has an outcome", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ sessionId, outcome: "completed" }]),
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await applyGatewayOutcomeForRunWithAdvisoryLock({
      prisma: prisma as never,
      sessionManagerBase,
      sessionId,
      runId,
      response: { status: "completed" },
      logger,
    });

    expect(result).toEqual({ duplicate: true });
    expect(applyGatewayOutcomeToSession).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it("returns duplicate when session is terminal even if run outcome is still null", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ sessionId, outcome: null }]),
      agentSession: {
        findUnique: vi.fn().mockResolvedValue({ status: "cancelled" }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await applyGatewayOutcomeForRunWithAdvisoryLock({
      prisma: prisma as never,
      sessionManagerBase,
      sessionId,
      runId,
      response: { status: "completed" },
      logger,
    });

    expect(result).toEqual({ duplicate: true });
    expect(applyGatewayOutcomeToSession).not.toHaveBeenCalled();
  });

  it("throws RunCallbackRunNotFoundError when run row is missing", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      applyGatewayOutcomeForRunWithAdvisoryLock({
        prisma: prisma as never,
        sessionManagerBase,
        sessionId,
        runId,
        response: { status: "completed" },
        logger,
      }),
    ).rejects.toThrow(RunCallbackRunNotFoundError);
    expect(applyGatewayOutcomeToSession).not.toHaveBeenCalled();
  });

  it("throws RunCallbackSessionMismatchError when run belongs to another session", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ sessionId: "550e8400-e29b-41d4-a716-446655440099", outcome: null }]),
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      applyGatewayOutcomeForRunWithAdvisoryLock({
        prisma: prisma as never,
        sessionManagerBase,
        sessionId,
        runId,
        response: { status: "completed" },
        logger,
      }),
    ).rejects.toThrow(RunCallbackSessionMismatchError);
    expect(applyGatewayOutcomeToSession).not.toHaveBeenCalled();
  });

  it("throws RunCallbackSessionNotFoundError when session row is missing", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ sessionId, outcome: null }]),
      agentSession: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      applyGatewayOutcomeForRunWithAdvisoryLock({
        prisma: prisma as never,
        sessionManagerBase,
        sessionId,
        runId,
        response: { status: "completed" },
        logger,
      }),
    ).rejects.toThrow(RunCallbackSessionNotFoundError);
    expect(applyGatewayOutcomeToSession).not.toHaveBeenCalled();
  });
});
