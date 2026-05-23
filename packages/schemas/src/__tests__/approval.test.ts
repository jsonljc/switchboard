import { describe, expect, it } from "vitest";
import { ApprovalStateSchema, type ApprovalState } from "../approval.js";

describe("ApprovalStateSchema", () => {
  it("parses a minimal valid state", () => {
    const valid: ApprovalState = {
      status: "pending",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(),
      version: 1,
      quorum: null,
    };
    const result = ApprovalStateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("parses a state with quorum entries", () => {
    const withQuorum: ApprovalState = {
      status: "approved",
      respondedBy: "user_a",
      respondedAt: new Date(),
      patchValue: null,
      expiresAt: new Date(Date.now() + 3600_000),
      version: 2,
      quorum: {
        required: 2,
        approvalHashes: [
          { approverId: "user_a", hash: "abc", approvedAt: new Date() },
          { approverId: "user_b", hash: "def", approvedAt: new Date() },
        ],
      },
    };
    expect(ApprovalStateSchema.safeParse(withQuorum).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const result = ApprovalStateSchema.safeParse({
      status: "not-a-status",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(),
      version: 1,
      quorum: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ISO-string dates (domain schema is strict, no coercion)", () => {
    const result = ApprovalStateSchema.safeParse({
      status: "pending",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: "2026-12-31T23:59:59.000Z",
      version: 1,
      quorum: null,
    });
    expect(result.success).toBe(false);
  });
});
