import { describe, expect, it, vi, beforeEach } from "vitest";
import { dispatchDecisionAction } from "../dispatch-action.js";

beforeEach(() => {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
});

describe("dispatchDecisionAction", () => {
  it("approval primary calls POST /api/recommendations/:id/act with action='primary'", async () => {
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "primary");
    expect(fetch).toHaveBeenCalledWith(
      "/api/recommendations/rec-1/act",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"primary"'),
      }),
    );
  });

  it("approval includes optional note in payload", async () => {
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "secondary", {
      note: "n",
    });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.note).toBe("n");
  });

  it("handoff primary calls /api/escalations/:id/reply (NOT /api/handoffs/*)", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary", {
      message: "Got it.",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/escalations/h-1/reply",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"message":"Got it."'),
      }),
    );
  });

  it("handoff secondary/dismiss call /api/escalations/:id/resolve", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "secondary", {
      resolutionNote: "snooze",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/escalations/h-1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "dismiss");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/escalations/h-1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("handoff primary with no message sends empty string (B2 must surface composer)", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary");
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.message).toBe("");
  });
});
