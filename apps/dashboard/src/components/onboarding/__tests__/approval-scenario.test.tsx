import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalScenario } from "../approval-scenario";

describe("ApprovalScenario", () => {
  it("renders scenario question and options", () => {
    render(
      <ApprovalScenario
        question="A customer wants to book Thursday 2pm."
        prompt="What should Alex do?"
        options={[
          { label: "Alex books it, then notifies me", value: "book_then_notify" },
          { label: "Alex asks me before booking", value: "ask_before_booking" },
        ]}
        selected={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("A customer wants to book Thursday 2pm.")).toBeTruthy();
    expect(screen.getByText("Alex books it, then notifies me")).toBeTruthy();
  });

  it("calls onChange when an option is clicked", () => {
    const onChange = vi.fn();
    render(
      <ApprovalScenario
        question="Test"
        prompt="Test"
        options={[
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ]}
        selected={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Option A"));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
