// apps/dashboard/src/components/dev/__tests__/dev-panel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DevPanel } from "../dev-panel";

const sessionRef: { current: { user?: { id?: string } } | null } = { current: null };
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sessionRef.current }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
}));

beforeEach(() => {
  sessionRef.current = { user: { id: "dev-user" } };
});

describe("DevPanel — dataModeControlsAllowed gate", () => {
  it("renders when dataModeControlsAllowed=true and session is dev-user", () => {
    render(<DevPanel dataModeControlsAllowed={true} />);
    expect(screen.getByRole("button", { name: /dev/i })).toBeInTheDocument();
  });

  it("hides when dataModeControlsAllowed=false even with dev-user session", () => {
    const { container } = render(<DevPanel dataModeControlsAllowed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides when session is not dev-user even with dataModeControlsAllowed=true", () => {
    sessionRef.current = { user: { id: "real-user" } };
    const { container } = render(<DevPanel dataModeControlsAllowed={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides when both gates fail", () => {
    sessionRef.current = null;
    const { container } = render(<DevPanel dataModeControlsAllowed={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
