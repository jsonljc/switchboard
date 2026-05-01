import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsoleView } from "../console-view";
import { consoleFixture } from "../console-data";

describe("ConsoleView", () => {
  it("renders all four zones with fixture data", () => {
    render(<ConsoleView data={consoleFixture} />);
    expect(screen.getByText(/Switchboard/)).toBeInTheDocument();
    expect(screen.getByText(/Aurora Dental/)).toBeInTheDocument();
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
  });

  it("renders 5 number cells", () => {
    const { container } = render(<ConsoleView data={consoleFixture} />);
    expect(container.querySelectorAll(".num-cell")).toHaveLength(5);
  });

  it("renders a placeholder cell when data.numbers has placeholder=true", () => {
    const data = {
      ...consoleFixture,
      numbers: {
        cells: [
          ...consoleFixture.numbers.cells.slice(0, 4),
          {
            label: "Reply time",
            value: "—",
            delta: ["pending"],
            placeholder: true,
          },
        ],
      },
    };
    const { container } = render(<ConsoleView data={data} />);
    const placeholder = container.querySelector(".num-cell.placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("—");
  });
});
