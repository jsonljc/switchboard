import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));

import OwnerHomePage from "../page";

describe("Owner Home placeholder", () => {
  it("renders inside the EditorialAuthShell", async () => {
    render(await OwnerHomePage());
    expect(screen.getByTestId("shell")).toBeInTheDocument();
  });

  it("renders placeholder copy", async () => {
    render(await OwnerHomePage());
    expect(screen.getByText(/owner home/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
