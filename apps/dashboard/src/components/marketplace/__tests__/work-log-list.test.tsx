import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkLogList } from "../work-log-list";

const mockTasks = [
  {
    id: "task-1",
    status: "approved",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    output: {
      summary: "Qualified lead — wedding cakes, $800 budget",
      outcome: "qualified",
      messages: [
        { role: "lead" as const, text: "I need a cake", timestamp: new Date().toISOString() },
        { role: "agent" as const, text: "I can help!", timestamp: new Date().toISOString() },
      ],
    },
  },
  {
    id: "task-2",
    status: "rejected",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    output: {
      summary: "Follow-up — lost lead",
      outcome: "disqualified",
      messages: [
        { role: "agent" as const, text: "Following up...", timestamp: new Date().toISOString() },
      ],
    },
  },
];

describe("WorkLogList", () => {
  it("renders task summaries", () => {
    render(<WorkLogList tasks={mockTasks} />);
    expect(screen.getByText(/wedding cakes/i)).toBeInTheDocument();
    expect(screen.getByText(/lost lead/i)).toBeInTheDocument();
  });

  it("expands transcript on click", async () => {
    const user = userEvent.setup();
    render(<WorkLogList tasks={mockTasks} />);

    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]);

    expect(screen.getByText("I need a cake")).toBeInTheDocument();
    expect(screen.getByText("I can help!")).toBeInTheDocument();
  });
});
