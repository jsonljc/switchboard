import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const useSessionMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
  signIn: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/character/agent-mark", () => ({
  AgentMark: () => <div data-testid="agent-mark" />,
}));

import LoginPage from "../page";

describe("LoginPage account-prompt footer", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("offers Create one -> /register when self-serve signup is open", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");

    render(<LoginPage />);

    const link = screen.getByRole("link", { name: /create one/i });
    expect(link).toHaveAttribute("href", "/register");
  });

  it("offers the waitlist -> /welcome when signup is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");

    render(<LoginPage />);

    const link = screen.getByRole("link", { name: /join the waitlist/i });
    expect(link).toHaveAttribute("href", "/welcome");
    // The open-mode create link must not appear when closed.
    expect(screen.queryByRole("link", { name: /create one/i })).not.toBeInTheDocument();
  });
});
