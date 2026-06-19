import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageTitle } from "../page-title";

describe("PageTitle", () => {
  it("renders the title as a level-1 heading", () => {
    render(<PageTitle>Choose what you want to tune</PageTitle>);
    expect(
      screen.getByRole("heading", { level: 1, name: /Choose what you want to tune/i }),
    ).toBeInTheDocument();
  });

  it("renders the eyebrow and supporting line when provided", () => {
    render(
      <PageTitle eyebrow="Settings" sub="Open a settings area.">
        Title
      </PageTitle>,
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Open a settings area.")).toBeInTheDocument();
  });

  it("omits the eyebrow and sub when not provided", () => {
    const { container } = render(<PageTitle>Only title</PageTitle>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Only title");
    // No eyebrow span and no supporting paragraph when those props are absent.
    expect(container.querySelector("span")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });
});
