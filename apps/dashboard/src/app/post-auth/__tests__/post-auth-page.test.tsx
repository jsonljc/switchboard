import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const useSessionMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
  // Real `SessionProvider` would try to fetch; stub to a passthrough.
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

import PostAuthPage from "../page";

describe("PostAuthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the signing-in placeholder while session is loading and does not redirect", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" });
    render(<PostAuthPage />);
    expect(screen.getByText(/signing you in/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to /console when the session is authenticated and onboarding is complete", () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: "u" }, organizationId: "org-1", onboardingComplete: true },
      status: "authenticated",
    });
    render(<PostAuthPage />);
    expect(replaceMock).toHaveBeenCalledWith("/console");
  });

  it("redirects to /onboarding when authenticated but onboarding is incomplete", () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: "u" }, organizationId: "org-1", onboardingComplete: false },
      status: "authenticated",
    });
    render(<PostAuthPage />);
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects to /onboarding when authenticated but session has no organizationId", () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: "u" } },
      status: "authenticated",
    });
    render(<PostAuthPage />);
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects to /login when status is unauthenticated", () => {
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" });
    render(<PostAuthPage />);
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
