import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Permissions } from "../permissions";
import type { PermissionsModel } from "../types";

const model: PermissionsModel = {
  summary: "Without asking: Alex books & sends reminders · Riley moves up to $300/day.",
  adjustHref: "/settings",
};

describe("Permissions component", () => {
  describe("renders with a valid model", () => {
    it("renders the summary text", () => {
      render(<Permissions model={model} />);
      expect(
        screen.getByText(
          "Without asking: Alex books & sends reminders · Riley moves up to $300/day.",
        ),
      ).toBeInTheDocument();
    });

    it("renders an 'Adjust' link", () => {
      render(<Permissions model={model} />);
      const link = screen.getByRole("link", { name: /adjust/i });
      expect(link).toBeInTheDocument();
    });

    it("link href matches model.adjustHref", () => {
      render(<Permissions model={model} />);
      const link = screen.getByRole("link", { name: /adjust/i });
      expect(link).toHaveAttribute("href", "/settings");
    });

    it("arrow is aria-hidden", () => {
      const { container } = render(<Permissions model={model} />);
      const arrow = container.querySelector("[aria-hidden='true']");
      expect(arrow).toBeInTheDocument();
      expect(arrow?.textContent).toBe("→");
    });
  });

  describe("renders nothing when model is absent or summary is empty", () => {
    it("model undefined → renders nothing", () => {
      const { container } = render(<Permissions />);
      expect(container.firstChild).toBeNull();
    });

    it("empty summary → renders nothing", () => {
      const { container } = render(
        <Permissions model={{ summary: "", adjustHref: "/settings" }} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
