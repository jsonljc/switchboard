import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GreetingBlock } from "../greeting-block";
import type { GreetingViewModel } from "@/lib/agent-home/types";

const vm: GreetingViewModel = {
  variant: "named-lead",
  segments: [
    { kind: "text", text: "Three leads. " },
    { kind: "accent", text: "Maya" },
    { kind: "text", text: " first." },
  ],
  signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "fixture" },
};

describe("GreetingBlock", () => {
  it("renders the prose with accent spans", () => {
    render(<GreetingBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("Maya")).toHaveClass("accent");
  });

  it("appends · FIXTURE folio badge when dataSource is fixture (non-prod)", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<GreetingBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("· FIXTURE")).toBeInTheDocument();
  });

  it("renders the alex portrait for agentKey=alex", () => {
    const { container } = render(<GreetingBlock vm={vm} agentKey="alex" />);
    expect(container.querySelector("svg[viewBox='0 0 140 140']")).not.toBeNull();
  });
});
