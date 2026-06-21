import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const useSessionMock = vi.fn();
vi.mock("next-auth/react", () => ({ useSession: () => useSessionMock() }));

import { VerifyEmailBanner } from "../verify-email-banner";

describe("VerifyEmailBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing when unauthenticated", () => {
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" });
    const { container } = render(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the session is loading", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" });
    const { container } = render(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the email is already verified", () => {
    useSessionMock.mockReturnValue({
      data: { emailVerified: "2026-06-19T00:00:00.000Z" },
      status: "authenticated",
    });
    const { container } = render(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the resend affordance for an authenticated, unverified user", () => {
    useSessionMock.mockReturnValue({ data: { emailVerified: null }, status: "authenticated" });
    render(<VerifyEmailBanner />);
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend verification email/i })).toBeInTheDocument();
  });

  it("posts to the resend route and confirms on success", async () => {
    useSessionMock.mockReturnValue({ data: { emailVerified: null }, status: "authenticated" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sent: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => expect(screen.getByText(/sent\. check your inbox/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/auth/resend-verification",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the already-verified message when the server reports it", async () => {
    useSessionMock.mockReturnValue({ data: { emailVerified: null }, status: "authenticated" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ alreadyVerified: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => expect(screen.getByText(/already verified/i)).toBeInTheDocument());
  });

  it("surfaces a soft error when the server could not send (sent:false)", async () => {
    useSessionMock.mockReturnValue({ data: { emailVerified: null }, status: "authenticated" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sent: false }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() =>
      expect(screen.getByText(/could not send the email right now/i)).toBeInTheDocument(),
    );
  });

  it("surfaces an error when the resend call fails", async () => {
    useSessionMock.mockReturnValue({ data: { emailVerified: null }, status: "authenticated" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => expect(screen.getByText(/could not resend/i)).toBeInTheDocument());
  });

  it("renders on the caution tint, not raw amber (audit M1)", () => {
    useSessionMock.mockReturnValue({ data: { emailVerified: null }, status: "authenticated" });
    render(<VerifyEmailBanner />);
    const strip = screen.getByRole("status");
    expect(strip.className).toContain("bg-caution-subtle");
    expect(strip.className).not.toMatch(/amber/);
  });
});
