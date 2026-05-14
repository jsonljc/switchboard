import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApproveBlock } from "../components/detail/approve-block";

const baseProps = {
  bindingHash: "0x2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9",
  riskCategory: "low" as const,
  agentName: "Alex",
  actionDisplay: "fee",
  onApprove: vi.fn(),
  disabled: false,
};

describe("ApproveBlock — Shape A (low/medium/none)", () => {
  it("renders no ack checkbox on low risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="low" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders no ack checkbox on medium risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="medium" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders the code-anchor sub-line so the code is not decorative", () => {
    render(<ApproveBlock {...baseProps} riskCategory="low" />);
    expect(screen.getByText(/confirmation code above locks these details/i)).toBeInTheDocument();
  });

  it("CTA is enabled on render for low risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="low" />);
    expect(screen.getByRole("button", { name: /approve/i })).not.toBeDisabled();
  });

  it("CTA fires onApprove on click", () => {
    const onApprove = vi.fn();
    render(<ApproveBlock {...baseProps} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it("shows the short hash on the CTA", () => {
    render(<ApproveBlock {...baseProps} />);
    // shortHash: slice(0,6) + "…" + slice(-3) → "0x2f1a" + "…" + "1a9"
    // (Will appear in multiple places in Shape B; in Shape A only on the CTA.)
    expect(screen.getByText(/0x2f1a…1a9/)).toBeInTheDocument();
  });

  it("riskCategory 'none' renders Shape A (no ack checkbox)", () => {
    render(<ApproveBlock {...baseProps} riskCategory="none" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/confirmation code above locks these details/i)).toBeInTheDocument();
  });
});

describe("ApproveBlock — Shape B (high/critical)", () => {
  it("renders the statement-of-intent line on high risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="high" />);
    expect(screen.getByText(/I've checked the details above/i)).toBeInTheDocument();
  });

  it("renders ack checkbox on high risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="high" />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("CTA is disabled until checkbox ticked", () => {
    render(<ApproveBlock {...baseProps} riskCategory="critical" />);
    const cta = screen.getByRole("button", { name: /approve.*sign/i });
    expect(cta).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta).not.toBeDisabled();
  });

  it("CTA carries native disabled + aria-disabled when checkbox is unticked", () => {
    render(<ApproveBlock {...baseProps} riskCategory="critical" />);
    const cta = screen.getByRole("button", { name: /approve.*sign/i });
    expect(cta).toBeDisabled();
    expect(cta.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("ApproveBlock — quorum", () => {
  it("switches the sub-line to quorum copy when approvalsRequired > 1", () => {
    render(
      <ApproveBlock {...baseProps} approvalsRequired={3} signedSoFar={1} riskCategory="medium" />,
    );
    expect(
      screen.getByText(/Adds your signature to the quorum \(2 of 3 after this\)/i),
    ).toBeInTheDocument();
  });
});
