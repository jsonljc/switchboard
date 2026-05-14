// apps/dashboard/src/components/cockpit/__tests__/approval-block.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalBlock } from "../approval-block";
import type { AlexApprovalView } from "../types";

function makeView(id: string, title: string): AlexApprovalView {
  return {
    id,
    kind: "pricing",
    urgency: "this_week",
    askedAt: "now",
    title,
    presentation: { primaryLabel: "Accept", dismissLabel: "Decline" },
    primary: "Accept",
    secondary: "Decline",
    primaryAction: { kind: "respond", bindingHash: "h", verdict: "accept" },
  };
}

describe("ApprovalBlock", () => {
  it("returns null when the data array is empty", () => {
    const { container } = render(<ApprovalBlock data={[]} onResolve={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per item in the array", () => {
    render(
      <ApprovalBlock
        data={[makeView("a", "First"), makeView("b", "Second")]}
        onResolve={() => {}}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("forwards (verdict, idx) to the resolver", () => {
    const handler = vi.fn();
    render(<ApprovalBlock data={[makeView("a", "Only")]} onResolve={handler} />);
    screen.getByRole("button", { name: "Accept" }).click();
    expect(handler).toHaveBeenCalledWith("accept", 0);
  });
});
