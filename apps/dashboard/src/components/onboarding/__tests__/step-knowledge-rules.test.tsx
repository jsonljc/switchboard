import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepKnowledgeRules } from "../step-knowledge-rules";
import type { BehavioralRule } from "@/app/(auth)/onboarding/page";

describe("StepKnowledgeRules", () => {
  const defaultProps = {
    knowledgeText: "",
    onKnowledgeChange: vi.fn(),
    rules: [] as BehavioralRule[],
    onRulesChange: vi.fn(),
  };

  it("renders knowledge textarea", () => {
    render(<StepKnowledgeRules {...defaultProps} />);
    expect(screen.getByPlaceholderText(/paste your FAQ/i)).toBeTruthy();
  });

  it("renders rule template buttons", () => {
    render(<StepKnowledgeRules {...defaultProps} />);
    expect(screen.getByText(/Max discount/i)).toBeTruthy();
    expect(screen.getByText(/Always escalate/i)).toBeTruthy();
    expect(screen.getByText(/Never discuss/i)).toBeTruthy();
    expect(screen.getByText(/Custom rule/i)).toBeTruthy();
  });

  it("adds a rule when template is clicked", () => {
    const onRulesChange = vi.fn();
    render(<StepKnowledgeRules {...defaultProps} onRulesChange={onRulesChange} />);
    fireEvent.click(screen.getByText(/Max discount/i));
    expect(onRulesChange).toHaveBeenCalledWith([
      expect.objectContaining({ type: "max-discount", value: "" }),
    ]);
  });

  it("shows added rules with input fields", () => {
    render(
      <StepKnowledgeRules
        {...defaultProps}
        rules={[{ id: "r1", type: "max-discount", value: "15" }]}
      />,
    );
    const input = screen.getByDisplayValue("15");
    expect(input).toBeTruthy();
  });

  it("removes a rule when delete is clicked", () => {
    const onRulesChange = vi.fn();
    render(
      <StepKnowledgeRules
        {...defaultProps}
        rules={[{ id: "r1", type: "max-discount", value: "15" }]}
        onRulesChange={onRulesChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove rule"));
    expect(onRulesChange).toHaveBeenCalledWith([]);
  });
});
