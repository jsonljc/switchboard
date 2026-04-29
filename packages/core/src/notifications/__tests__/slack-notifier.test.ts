import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackApprovalNotifier } from "../slack-notifier.js";
import type { ApprovalNotification } from "../notifier.js";

describe("SlackApprovalNotifier", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
    return {
      approvalId: "appr_1",
      envelopeId: "env_1",
      summary: "Pause campaign ABC",
      explanation: "Budget exceeds limit",
      riskCategory: "medium",
      bindingHash: "hash123",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      approvers: ["U12345"],
      evidenceBundle: {},
      ...overrides,
    };
  }

  it("emits Approve and Reject button payloads that both include bindingHash", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token");

    await notifier.notify(makeNotification());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);

    const actionsBlock = (body.blocks as Array<{ type: string; elements?: unknown[] }>).find(
      (b) => b.type === "actions",
    );
    expect(actionsBlock).toBeDefined();
    const elements = actionsBlock!.elements as Array<{
      action_id: string;
      value: string;
    }>;
    const approveBtn = elements.find((e) => e.action_id === "approval_approve");
    const rejectBtn = elements.find((e) => e.action_id === "approval_reject");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    const approveData = JSON.parse(approveBtn!.value);
    expect(approveData).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });

    const rejectData = JSON.parse(rejectBtn!.value);
    expect(rejectData).toEqual({
      action: "reject",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
  });
});
