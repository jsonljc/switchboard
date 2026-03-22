import { describe, it, expect, vi } from "vitest";
import type { Job } from "bullmq";
import type { SessionManager } from "@switchboard/core/sessions";
import {
  handleGatewayInvocationError,
  type SessionInvocationJobData,
} from "../session-invocation.js";
import {
  GatewayCircuitOpenError,
  GatewayInvocationAbortedError,
  GatewayInvalidResponseError,
  GatewayRejectedAuthError,
  GatewayTimeoutError,
  GatewayTransportError,
} from "../../gateway/gateway-errors.js";

function mockJob(attemptsMade: number, attempts = 3): Job<SessionInvocationJobData> {
  return { attemptsMade, opts: { attempts } } as Job<SessionInvocationJobData>;
}

describe("handleGatewayInvocationError", () => {
  it("fails session on final BullMQ attempt for transport timeout (not rethrow)", async () => {
    const failSession = vi.fn().mockResolvedValue(undefined);
    const sessionManager = { failSession } as unknown as SessionManager;
    const job = mockJob(2, 3);

    const action = await handleGatewayInvocationError({
      err: new GatewayTimeoutError(),
      job,
      sessionManager,
      sessionId: "s1",
      runId: "r1",
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(action).toBe("done");
    expect(failSession).toHaveBeenCalledWith("s1", {
      runId: "r1",
      error: expect.any(String),
      errorCode: "GATEWAY_TIMEOUT",
    });
  });

  it("rethrows transport errors when retries remain", async () => {
    const failSession = vi.fn();
    const sessionManager = { failSession } as unknown as SessionManager;
    const job = mockJob(0, 3);

    const action = await handleGatewayInvocationError({
      err: new GatewayTransportError("boom"),
      job,
      sessionManager,
      sessionId: "s1",
      runId: "r1",
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(action).toBe("rethrow");
    expect(failSession).not.toHaveBeenCalled();
  });

  it("maps GatewayInvalidResponseError to INVALID_GATEWAY_RESPONSE", async () => {
    const failSession = vi.fn().mockResolvedValue(undefined);
    const sessionManager = { failSession } as unknown as SessionManager;

    await handleGatewayInvocationError({
      err: new GatewayInvalidResponseError("bad json"),
      job: mockJob(0, 3),
      sessionManager,
      sessionId: "s1",
      runId: "r1",
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(failSession).toHaveBeenCalledWith("s1", {
      runId: "r1",
      error: "bad json",
      errorCode: "INVALID_GATEWAY_RESPONSE",
    });
  });

  it("maps GatewayCircuitOpenError to GATEWAY_CIRCUIT_OPEN without retry", async () => {
    const failSession = vi.fn().mockResolvedValue(undefined);
    const sessionManager = { failSession } as unknown as SessionManager;

    const action = await handleGatewayInvocationError({
      err: new GatewayCircuitOpenError(),
      job: mockJob(0, 3),
      sessionManager,
      sessionId: "s1",
      runId: "r1",
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(action).toBe("done");
    expect(failSession).toHaveBeenCalledWith("s1", {
      runId: "r1",
      error: expect.any(String),
      errorCode: "GATEWAY_CIRCUIT_OPEN",
    });
  });

  it("treats GatewayInvocationAbortedError as done without failSession when session cancelled", async () => {
    const failSession = vi.fn();
    const sessionManager = {
      failSession,
      getSession: vi.fn().mockResolvedValue({ id: "s1", status: "cancelled" }),
    } as unknown as SessionManager;

    const action = await handleGatewayInvocationError({
      err: new GatewayInvocationAbortedError(),
      job: mockJob(0, 3),
      sessionManager,
      sessionId: "s1",
      runId: "r1",
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(action).toBe("done");
    expect(failSession).not.toHaveBeenCalled();
  });

  it("maps GatewayRejectedAuthError to GATEWAY_AUTH_REJECTED", async () => {
    const failSession = vi.fn().mockResolvedValue(undefined);
    const sessionManager = { failSession } as unknown as SessionManager;

    await handleGatewayInvocationError({
      err: new GatewayRejectedAuthError("nope", 401),
      job: mockJob(0, 3),
      sessionManager,
      sessionId: "s1",
      runId: "r1",
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(failSession).toHaveBeenCalledWith("s1", {
      runId: "r1",
      error: "nope",
      errorCode: "GATEWAY_AUTH_REJECTED",
    });
  });
});
