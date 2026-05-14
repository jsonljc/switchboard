import { describe, it, expect } from "vitest";
import { groupSignalHealthByPixel } from "../signal-health-grouper";
import { signalHealthFixtures } from "../__fixtures__/riley-recommendation-fixtures";

describe("groupSignalHealthByPixel", () => {
  it("collapses 3 rows for the same pixel into 1 view-model", () => {
    const grouped = groupSignalHealthByPixel(signalHealthFixtures);
    expect(grouped).toHaveLength(1);
  });

  it("synthesized view-model uses campaign.kind === 'account'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.campaign.kind).toBe("account");
  });

  it("carries the pixelId and breach count", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    if (view.campaign.kind === "account") {
      expect(view.campaign.pixelId).toBe("1234567890");
      expect(view.campaign.breaches).toBe(3);
    }
  });

  it("quote is a bulleted breach list", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.quote).toContain("•");
    expect(view.quote).toContain("Pixel is dead");
    expect(view.quote).toContain("Server-to-browser");
    expect(view.quote).toContain("stale");
  });

  it("kind is 'signal_health_group'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.kind).toBe("signal_health_group");
  });

  it("urgency is 'immediate' if any breach is immediate; otherwise 'this_week'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.urgency).toBe("immediate");
  });

  it("primaryAction is external with Meta Events Manager URL", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.primaryAction.kind).toBe("external");
    if (view.primaryAction.kind === "external") {
      expect(view.primaryAction.service).toBe("meta");
      expect(view.primaryAction.url).toContain("events_manager");
    }
  });

  it("no 'Dismiss all' affordance in B.1 — presentation.dismissLabel does NOT say 'Dismiss all'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.presentation.dismissLabel.toLowerCase()).not.toContain("dismiss all");
  });

  it("returns empty array when given no signal-health rows", () => {
    expect(groupSignalHealthByPixel([])).toEqual([]);
  });

  it("groups rows from different pixels independently (2 pixels → 2 view-models)", () => {
    const first = signalHealthFixtures[0];
    const firstParams = first.parameters.__recommendation as Record<string, unknown>;
    const otherPixel = {
      ...first,
      id: "rec_other_pixel",
      targetEntities: { pixelId: "9876543210" },
      parameters: {
        __recommendation: { ...firstParams, campaignId: "signal:9876543210" },
      } as typeof first.parameters,
    };
    const grouped = groupSignalHealthByPixel([...signalHealthFixtures, otherPixel]);
    expect(grouped).toHaveLength(2);
  });
});
