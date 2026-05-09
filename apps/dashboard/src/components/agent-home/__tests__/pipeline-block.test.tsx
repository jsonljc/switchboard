import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineBlock } from "../pipeline-block";
import type { PipelineViewModel } from "@/lib/agent-home/types";

const baseVm: PipelineViewModel = {
  agentKey: "alex",
  pipelineKind: "leads",
  totalCount: 1,
  countNoun: "people",
  tiles: [
    {
      id: "c1",
      stage: "hot",
      name: "Maya R.",
      ctx: "Asked about classes.",
      link: { kind: "contact", id: "c1" },
    },
  ],
  setupLink: { kind: "agent-setup", agentKey: "alex" },
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "fixture" },
};

describe("PipelineBlock", () => {
  it("renders anchor with detail href when contact route is available (D1.5+)", () => {
    render(<PipelineBlock vm={baseVm} />);
    const tile = screen.getByText("Maya R.").closest("[data-stage]") as HTMLElement;
    expect(tile.tagName).toBe("A");
    expect(tile.getAttribute("href")).toBe("/contacts/c1");
    expect(tile.getAttribute("aria-disabled")).toBeNull();
  });

  it("renders empty-state for riley when no tiles", () => {
    const emptyRiley: PipelineViewModel = {
      ...baseVm,
      agentKey: "riley",
      pipelineKind: "ad-sets",
      countNoun: "ad sets",
      tiles: [],
    };
    render(<PipelineBlock vm={emptyRiley} />);
    expect(screen.getByText(/will surface ad sets/i)).toBeInTheDocument();
  });

  it("renders empty-state for alex when no tiles", () => {
    const emptyAlex: PipelineViewModel = { ...baseVm, tiles: [] };
    render(<PipelineBlock vm={emptyAlex} />);
    expect(screen.getByText(/no active leads yet/i)).toBeInTheDocument();
  });
});
