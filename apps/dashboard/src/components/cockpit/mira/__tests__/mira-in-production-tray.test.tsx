import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraInProductionTray } from "../mira-in-production-tray";
import type { MiraDeskItem } from "@switchboard/core";

const item = (over: Partial<MiraDeskItem>): MiraDeskItem => ({
  id: "i",
  title: "Botox promo",
  stage: "production",
  state: "in_production",
  updatedAt: "2026-05-26",
  ...over,
});

describe("MiraInProductionTray", () => {
  it("shows plain stage copy per item by default", () => {
    render(<MiraInProductionTray items={[item({ id: "a", stage: "production" })]} />);
    expect(screen.getByText(/generating draft/i)).toBeInTheDocument();
    expect(screen.queryByText(/storyboard|inngest|stage/i)).not.toBeInTheDocument();
  });

  it("surfaces a problem message only when a problem is present", () => {
    render(<MiraInProductionTray items={[item({ id: "b", problem: "quality_failed" })]} />);
    expect(screen.getByText(/failed a quality check/i)).toBeInTheDocument();
  });

  it("renders the calm empty state when there is nothing in production", () => {
    render(<MiraInProductionTray items={[]} />);
    expect(screen.getByText(/not working on anything/i)).toBeInTheDocument();
  });
});
