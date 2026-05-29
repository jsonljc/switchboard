import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
let enabled: boolean | undefined = false;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/use-mira-enabled", () => ({
  useMiraEnabled: () => ({ enabled, isLoading: false }),
}));

import { MiraPanel } from "@/components/agent-panel/mira-panel";

describe("MiraPanel", () => {
  it("not enabled → honest 'not set up', no dead anchors", () => {
    enabled = false;
    const { container } = render(<MiraPanel />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    expect(container.querySelector('a[href^="#"]')).toBeNull();
  });

  it("enabled → drills into the workspace", () => {
    enabled = true;
    render(<MiraPanel />);
    fireEvent.click(screen.getByRole("button", { name: /open.*workspace|open mira/i }));
    expect(push).toHaveBeenCalledWith("/mira");
  });
});
