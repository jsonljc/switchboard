import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Topbar } from "../topbar";

const baseProps = {
  org: "Aurora Aesthetics",
  currentUser: { display: "Mei Lin Tan", initials: "MT" },
  liveMode: false,
};

describe("Topbar", () => {
  it("renders the brand breadcrumb", () => {
    render(<Topbar {...baseProps} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByText("Aurora Aesthetics")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
  });

  it("shows 'sample data' pip when liveMode is false", () => {
    render(<Topbar {...baseProps} liveMode={false} />);
    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });

  it("shows 'live data' pip when liveMode is true", () => {
    render(<Topbar {...baseProps} liveMode={true} />);
    expect(screen.getByText(/live data/i)).toBeInTheDocument();
  });

  it("renders user initials in the avatar", () => {
    render(<Topbar {...baseProps} />);
    expect(screen.getByText("MT")).toBeInTheDocument();
  });
});
