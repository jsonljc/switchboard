import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertRuleCard } from "@/components/alerts/alert-rule-card";
import type { AlertRule } from "@/lib/api-client";

// Mock radix UI components that have complex internals
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      data-testid="toggle-switch"
    >
      {checked ? "On" : "Off"}
    </button>
  ),
}));

const baseRule: AlertRule = {
  id: "rule-1",
  organizationId: "org-1",
  name: "High CPA Alert",
  enabled: true,
  metricPath: "primaryKPI.current",
  operator: "gt",
  threshold: 50,
  platform: "meta",
  vertical: "ecommerce",
  notifyChannels: ["slack", "telegram"],
  notifyRecipients: ["U123"],
  cooldownMinutes: 60,
  lastTriggeredAt: null,
  snoozedUntil: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

describe("AlertRuleCard", () => {
  it("renders rule name and metric info", () => {
    render(
      <AlertRuleCard
        rule={baseRule}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("High CPA Alert")).toBeInTheDocument();
    expect(screen.getByText(/primaryKPI\.current/)).toBeInTheDocument();
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });

  it("renders channel badges", () => {
    render(
      <AlertRuleCard
        rule={baseRule}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("slack")).toBeInTheDocument();
    expect(screen.getByText("telegram")).toBeInTheDocument();
    expect(screen.getByText("meta")).toBeInTheDocument();
  });

  it("calls onToggle when switch is clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <AlertRuleCard
        rule={baseRule}
        onToggle={onToggle}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("toggle-switch"));
    expect(onToggle).toHaveBeenCalledWith("rule-1", false);
  });

  it("calls onDelete when delete button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <AlertRuleCard
        rule={baseRule}
        onToggle={vi.fn()}
        onDelete={onDelete}
        onSelect={vi.fn()}
      />,
    );

    // The delete button has a Trash2 icon
    const deleteButtons = screen.getAllByRole("button");
    // Find the one that's not the switch
    const deleteBtn = deleteButtons.find((btn) => btn.getAttribute("role") !== "switch");
    if (deleteBtn) {
      await user.click(deleteBtn);
      expect(onDelete).toHaveBeenCalledWith("rule-1");
    }
  });

  it("shows Disabled badge when rule is disabled", () => {
    render(
      <AlertRuleCard
        rule={{ ...baseRule, enabled: false }}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("shows Snoozed badge when rule is snoozed", () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    render(
      <AlertRuleCard
        rule={{ ...baseRule, snoozedUntil: futureDate }}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Snoozed")).toBeInTheDocument();
  });

  it("calls onSelect when card is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    const { container: _container } = render(
      <AlertRuleCard
        rule={baseRule}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onSelect={onSelect}
      />,
    );

    // Click on the card title (not the switch/delete area)
    await user.click(screen.getByText("High CPA Alert"));
    expect(onSelect).toHaveBeenCalledWith("rule-1");
  });
});
