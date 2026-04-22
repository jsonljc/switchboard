import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SettingsPage from "../(auth)/settings/page";

describe("SettingsPage", () => {
  it("renders a desktop landing state with settings shortcuts", () => {
    render(<SettingsPage />);

    expect(screen.getByText(/choose what you want to tune/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /your playbook/i })).toHaveAttribute(
      "href",
      "/settings/playbook",
    );
    expect(screen.getByRole("link", { name: /team/i })).toHaveAttribute("href", "/settings/team");
  });
});
