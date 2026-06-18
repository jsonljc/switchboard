import { describe, it, expect } from "vitest";
import { buildRobinRecoverySendExecutor } from "../robin-recovery-executor.js";
import { ROBIN_RECOVERY_SEND_INTENT } from "../../services/workflows/robin-recovery-request.js";

describe("buildRobinRecoverySendExecutor", () => {
  it("registers under the recovery intent", () => {
    expect(buildRobinRecoverySendExecutor().intent).toBe(ROBIN_RECOVERY_SEND_INTENT);
  });

  it("is a fail-closed placeholder (the live send lands in a later slice)", async () => {
    const { handler } = buildRobinRecoverySendExecutor();
    const result = await handler.execute(
      {} as Parameters<typeof handler.execute>[0],
      {} as Parameters<typeof handler.execute>[1],
    );
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("ROBIN_RECOVERY_SEND_NOT_WIRED");
  });
});
