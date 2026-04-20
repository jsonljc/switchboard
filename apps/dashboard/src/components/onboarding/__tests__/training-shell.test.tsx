import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainingShell } from "../training-shell";
import { createEmptyPlaybook } from "@switchboard/schemas";

describe("TrainingShell", () => {
  it("renders chat and playbook panels", () => {
    render(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl={null}
        category={null}
      />,
    );
    expect(screen.getByText(/Alex's Playbook/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("Type a message...")).toBeTruthy();
  });

  it("shows readiness indicator", () => {
    render(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl={null}
        category={null}
      />,
    );
    expect(screen.getByText(/0 of 5 required sections ready/)).toBeTruthy();
  });
});
