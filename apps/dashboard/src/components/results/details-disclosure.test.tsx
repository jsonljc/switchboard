import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailsDisclosure } from "./details-disclosure";

describe("DetailsDisclosure", () => {
  it("hides children until toggled open (uncontrolled)", () => {
    render(
      <DetailsDisclosure>
        <p>secret depth</p>
      </DetailsDisclosure>,
    );
    expect(screen.queryByText("secret depth")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /see the details/i }));
    expect(screen.getByText("secret depth")).toBeInTheDocument();
  });
  it("reflects the open prop and calls onToggle (controlled)", () => {
    let toggled = 0;
    const { rerender } = render(
      <DetailsDisclosure
        open={false}
        onToggle={() => {
          toggled++;
        }}
      >
        <p>depth</p>
      </DetailsDisclosure>,
    );
    expect(screen.queryByText("depth")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(toggled).toBe(1);
    rerender(
      <DetailsDisclosure
        open={true}
        onToggle={() => {
          toggled++;
        }}
      >
        <p>depth</p>
      </DetailsDisclosure>,
    );
    expect(screen.getByText("depth")).toBeInTheDocument();
  });
});
