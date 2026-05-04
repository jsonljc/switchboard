import { describe, expect, it, vi, beforeEach } from "vitest";
import { dispatchDecisionAction } from "../dispatch-action.js";

beforeEach(() => {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
});

describe("dispatchDecisionAction", () => {
  it("approval primary calls POST /api/dashboard/recommendations with recommendationId in body", async () => {
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "primary");
    expect(fetch).toHaveBeenCalledWith(
      "/api/dashboard/recommendations",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"primary"'),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.recommendationId).toBe("rec-1");
  });

  it("approval includes optional note in payload", async () => {
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "secondary", {
      note: "n",
    });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.note).toBe("n");
  });

  it("handoff primary calls /api/dashboard/escalations/:id/reply (NOT /api/handoffs/*)", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary", {
      message: "Got it.",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/dashboard/escalations/h-1/reply",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"message":"Got it."'),
      }),
    );
  });

  it("handoff secondary/dismiss call /api/dashboard/escalations/:id/resolve", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "secondary", {
      resolutionNote: "snooze",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/dashboard/escalations/h-1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "dismiss");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/dashboard/escalations/h-1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("handoff primary with no message sends empty string (B2 must surface composer)", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary");
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.message).toBe("");
  });

  it("throws if approval response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(
      dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "primary"),
    ).rejects.toThrow(/Recommendation action failed/);
  });

  it("throws if handoff reply response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(
      dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary"),
    ).rejects.toThrow(/Handoff reply failed/);
  });

  it("throws if handoff resolve response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(
      dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "secondary"),
    ).rejects.toThrow(/Handoff resolve failed/);
  });
});
