import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackApprovalNotifier } from "../slack-notifier.js";
import type { ApprovalNotification } from "../notifier.js";
import { parseApprovalResponsePayload } from "../../channel-gateway/approval-response-payload.js";

describe("SlackApprovalNotifier", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
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

  it("button values round-trip through the REAL approval-response parser", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token");
    await notifier.notify(makeNotification());

    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);
    const actionsBlock = (body.blocks as Array<{ type: string; elements?: unknown[] }>).find(
      (b) => b.type === "actions",
    )!;
    const elements = actionsBlock.elements as Array<{ action_id: string; value: string }>;

    for (const [actionId, action] of [
      ["approval_approve", "approve"],
      ["approval_reject", "reject"],
    ] as const) {
      const btn = elements.find((e) => e.action_id === actionId)!;
      const parsed = parseApprovalResponsePayload(btn.value);
      expect(parsed).toEqual({ action, approvalId: "appr_1", bindingHash: "hash123" });
    }

    // Mutation proof: the parser genuinely rejects malformed values, so the
    // round-trip assertion above can fail. An extra key must parse to null.
    const approve = elements.find((e) => e.action_id === "approval_approve")!;
    const mutated = JSON.stringify({ ...JSON.parse(approve.value), extra: "x" });
    expect(parseApprovalResponsePayload(mutated)).toBeNull();
  });

  it("posts to defaultConversationId when configured, ignoring approvers", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token", {
      defaultConversationId: "C_OPS",
    });
    await notifier.notify(makeNotification({ approvers: ["U1", "U2"] }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(options.body).channel).toBe("C_OPS");
  });

  it("does not post when approvers is empty and no default conversation is set", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token");
    await notifier.notify(makeNotification({ approvers: [] }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs approvalId AND target and resolves on HTTP failure (best-effort, never thrown)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const notifier = new SlackApprovalNotifier("xoxb-test-token");

    await expect(notifier.notify(makeNotification())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("approvalId=appr_1"),
      expect.anything(),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("target=U12345"),
      expect.anything(),
    );
  });

  it("logs and resolves on a Slack ok:false envelope (HTTP 200)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: "channel_not_found" }),
    });
    const notifier = new SlackApprovalNotifier("xoxb-test-token", {
      defaultConversationId: "C_OPS",
    });

    await expect(notifier.notify(makeNotification())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("target=C_OPS"),
      expect.anything(),
    );
  });

  it("renders no action buttons when bindingHash is empty, with the Inbox cue (alert-only)", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token");
    await notifier.notify(makeNotification({ bindingHash: "" }));

    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);
    const actionsBlock = (body.blocks as Array<{ type: string }>).find((b) => b.type === "actions");
    expect(actionsBlock).toBeUndefined();
    expect(JSON.stringify(body.blocks)).toContain(
      "This approval cannot be actioned from Slack. Open the Inbox to review.",
    );
  });

  it("renders expiry in hours at or above 3 hours, minutes below", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token");

    await notifier.notify(
      makeNotification({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
    );
    let body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(JSON.stringify(body.blocks)).toContain("24 hours");

    fetchSpy.mockClear();
    await notifier.notify(makeNotification({ expiresAt: new Date(Date.now() + 30 * 60 * 1000) }));
    body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(JSON.stringify(body.blocks)).toContain("30 minutes");
  });
});
