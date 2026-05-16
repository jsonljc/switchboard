// apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MissionPopover } from "../mission-popover";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const baseMission: MissionAggregatorResponse["mission"] = {
  role: "SDR · qualify inbound leads, book consultations",
  pipeline: "Consultations pipeline · single funnel",
  brand: "Acme Medspa · —",
  channels: [
    { kind: "meta-ads", label: "Meta Ads", status: "ok" },
    { kind: "whatsapp", label: "WhatsApp inbox", status: "warn" },
    { kind: "calendar", label: "Consultation calendar", status: "off" },
  ],
  rules: { priceApprovalThreshold: 89, refundEscalationFloor: 200 },
};

describe("MissionPopover", () => {
  it("renders all 5 rows including Rules when rules present", () => {
    const { container } = render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    expect(screen.getByText(/^ROLE$/i)).toBeInTheDocument();
    // PIPELINE eyebrow — check exact text to avoid collision with the pipeline value text
    expect(container.querySelector('[data-eyebrow="PIPELINE"]')).toBeTruthy();
    expect(screen.getByText(/^BRAND$/i)).toBeInTheDocument();
    expect(screen.getByText(/^CHANNELS$/i)).toBeInTheDocument();
    expect(screen.getByText(/^RULES$/i)).toBeInTheDocument();
    expect(screen.getByText(/Pricing approvals over \$89/)).toBeInTheDocument();
    expect(screen.getByText(/refunds over \$200/)).toBeInTheDocument();
  });

  it("hides Rules row when mission.rules is null", () => {
    render(<MissionPopover open onClose={() => {}} mission={{ ...baseMission, rules: null }} />);
    expect(screen.queryByText(/RULES/i)).not.toBeInTheDocument();
  });

  it("renders one channel dot per channel with the right aria-label per status", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    expect(screen.getByLabelText("Meta Ads: connected")).toBeInTheDocument();
    expect(screen.getByLabelText("WhatsApp inbox: degraded")).toBeInTheDocument();
    expect(screen.getByLabelText("Consultation calendar: not connected")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<MissionPopover open onClose={onClose} mission={baseMission} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an 'Edit configuration' link pointing at /settings", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    const link = screen.getByRole("link", { name: /Edit configuration/i });
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <MissionPopover open={false} onClose={() => {}} mission={baseMission} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onClose when mousedown fires outside the popover, but NOT when inside", () => {
    const onClose = vi.fn();
    render(<MissionPopover open onClose={onClose} mission={baseMission} />);

    // Positive case: mousedown on document.body (outside the popover container)
    // body is not contained by the popover's containerRef, so onClose must fire.
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();

    // Negative case: mousedown on the dialog element itself.
    // The dialog IS the containerRef node, so contains(target) returns true and
    // onClose must NOT fire.  This would fail if the contains-check were removed.
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses 'Alex mission' as the default aria-label when agentLabel is omitted", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    expect(screen.getByRole("dialog", { name: "Alex mission" })).toBeInTheDocument();
  });

  it("uses the provided agentLabel in the aria-label", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} agentLabel="Riley" />);
    expect(screen.getByRole("dialog", { name: "Riley mission" })).toBeInTheDocument();
  });
});
