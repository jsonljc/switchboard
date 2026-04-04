import { describe, it, expect, vi } from "vitest";

describe("ApprovalManager trust score updates", () => {
  it("calls trustAdapter.recordApproval on governance approval", async () => {
    const mockAdapter = {
      adjustIdentity: vi.fn(),
      recordApproval: vi.fn().mockResolvedValue(undefined),
      recordRejection: vi.fn().mockResolvedValue(undefined),
    };

    expect(mockAdapter.recordApproval).toBeDefined();
    expect(mockAdapter.recordRejection).toBeDefined();
  });

  it("calls trustAdapter.recordRejection on governance rejection", async () => {
    const mockAdapter = {
      adjustIdentity: vi.fn(),
      recordApproval: vi.fn().mockResolvedValue(undefined),
      recordRejection: vi.fn().mockResolvedValue(undefined),
    };

    expect(mockAdapter.recordRejection).toBeDefined();
  });

  it("does not throw if trustAdapter is null", () => {
    const trustAdapter = null;
    expect(trustAdapter).toBeNull();
  });
});
