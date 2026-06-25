import { describe, it, expect, vi } from "vitest";
import { buildObserveReview, type ObserveReviewDeps } from "../governance-observe-review.js";

function makeDeps(over: Partial<ObserveReviewDeps> = {}): ObserveReviewDeps {
  return {
    verdictStore: {
      summarizeByDeployment: vi.fn().mockResolvedValue([]),
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
    findAlexDeployment: vi.fn().mockResolvedValue({ id: "dep-1" }),
    now: () => new Date("2026-06-25T00:00:00.000Z"),
    ...over,
  };
}

describe("buildObserveReview", () => {
  it("returns per-unit would-act counts for the org's Alex deployment", async () => {
    const deps = makeDeps({
      verdictStore: {
        summarizeByDeployment: vi.fn().mockResolvedValue([
          {
            sourceGuard: "price_gate",
            reasonCode: "unsubstantiated_price",
            action: "allow",
            count: 5,
          },
          {
            sourceGuard: "consent_gate",
            reasonCode: "disclosure_not_shown",
            action: "allow",
            count: 3,
          },
        ]),
        listByDeployment: vi.fn().mockResolvedValue([]),
      },
    });

    const out = await buildObserveReview(deps, "org-1", {});
    if ("notFound" in out) throw new Error("unexpected notFound");

    expect(deps.findAlexDeployment).toHaveBeenCalledWith("org-1");
    expect(out.units.deterministic.wouldBlock).toBe(5);
    expect(out.units.deterministic.total).toBe(5);
    // consent disclosure_not_shown derives to "none": in total, zero would-block.
    expect(out.units.consent).toEqual({
      wouldBlock: 0,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 0,
      total: 3,
    });
  });

  it("defaults the window to 7 days before now and passes it to both store reads", async () => {
    const deps = makeDeps();
    const out = await buildObserveReview(deps, "org-1", {});
    if ("notFound" in out) throw new Error("unexpected notFound");

    expect(out.window.since).toBe("2026-06-18T00:00:00.000Z");
    expect(deps.verdictStore.summarizeByDeployment).toHaveBeenCalledWith("dep-1", {
      since: "2026-06-18T00:00:00.000Z",
    });
    expect(deps.verdictStore.listByDeployment).toHaveBeenCalledWith("dep-1", {
      since: "2026-06-18T00:00:00.000Z",
      limit: 20,
    });
  });

  it("honours an explicit since", async () => {
    const deps = makeDeps();
    await buildObserveReview(deps, "org-1", { since: "2026-01-01T00:00:00.000Z" });
    expect(deps.verdictStore.summarizeByDeployment).toHaveBeenCalledWith("dep-1", {
      since: "2026-01-01T00:00:00.000Z",
    });
  });

  it("maps sample rows with unit + derived enforce action + truncated preview, dropping non-units", async () => {
    const longText = "A".repeat(300);
    const deps = makeDeps({
      verdictStore: {
        summarizeByDeployment: vi.fn().mockResolvedValue([]),
        listByDeployment: vi.fn().mockResolvedValue([
          {
            id: "v1",
            sourceGuard: "price_gate",
            reasonCode: "unsubstantiated_price",
            action: "allow",
            decidedAt: "2026-06-24T10:00:00.000Z",
            conversationId: "conv-1",
            originalText: longText,
          },
          {
            id: "v2",
            sourceGuard: "escalation_trigger",
            reasonCode: "medical_safety_trigger",
            action: "allow",
            decidedAt: "2026-06-24T11:00:00.000Z",
            conversationId: "conv-2",
            originalText: "should be excluded",
          },
        ]),
      },
    });

    const out = await buildObserveReview(deps, "org-1", {});
    if ("notFound" in out) throw new Error("unexpected notFound");

    expect(out.samples).toHaveLength(1); // escalation_trigger sample dropped (not a flippable unit)
    expect(out.samples[0]).toMatchObject({
      unit: "deterministic",
      reasonCode: "unsubstantiated_price",
      enforceAction: "block",
      decidedAt: "2026-06-24T10:00:00.000Z",
      conversationId: "conv-1",
    });
    expect(out.samples[0]!.textPreview.length).toBe(160);
  });

  it("returns notFound when the org has no Alex deployment (org scope)", async () => {
    const deps = makeDeps({ findAlexDeployment: vi.fn().mockResolvedValue(null) });
    const out = await buildObserveReview(deps, "org-x", {});
    expect(out).toEqual({ notFound: true });
  });
});
