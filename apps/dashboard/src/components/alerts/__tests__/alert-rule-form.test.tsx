import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertRuleForm } from "@/components/alerts/alert-rule-form";

// Mock Radix select to render as a native select
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => (
    <div data-testid="select-wrapper">{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <div data-value={value}>{children}</div>,
}));

// Mock Radix dialog
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("AlertRuleForm", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    isLoading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the form when open", () => {
    render(<AlertRuleForm {...defaultProps} />);

    expect(screen.getByText("New Alert Rule")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Threshold")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<AlertRuleForm {...defaultProps} open={false} />);

    expect(screen.queryByText("New Alert Rule")).not.toBeInTheDocument();
  });

  it("calls onSubmit with form data when submitted", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(<AlertRuleForm {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Test Alert");
    await user.type(screen.getByLabelText("Threshold"), "100");

    await user.click(screen.getByText("Create Alert"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Alert",
        threshold: 100,
      }),
    );
  });

  it("disables submit button when loading", () => {
    render(<AlertRuleForm {...defaultProps} isLoading={true} />);

    expect(screen.getByText("Creating...")).toBeDisabled();
  });

  it("disables submit button when name is empty", () => {
    render(<AlertRuleForm {...defaultProps} />);

    // Submit button should be disabled because name and threshold are empty
    const submitBtn = screen.getByText("Create Alert");
    expect(submitBtn).toBeDisabled();
  });

  it("calls onClose when cancel is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<AlertRuleForm {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("parses notify channels from comma-separated input", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(<AlertRuleForm {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Channel Test");
    await user.type(screen.getByLabelText("Threshold"), "50");
    await user.type(screen.getByLabelText(/Notify Channels/), "slack, telegram");

    await user.click(screen.getByText("Create Alert"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyChannels: ["slack", "telegram"],
      }),
    );
  });
});
