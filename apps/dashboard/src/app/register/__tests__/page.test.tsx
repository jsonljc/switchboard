import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import RegisterPage from "../page";

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Default: signup open. Individual tests override to "waitlist" for closed mode.
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a waitlist CTA and no signup form when signup is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");

    render(<RegisterPage />);

    const waitlistLink = screen.getByRole("link", { name: /join the waitlist/i });
    expect(waitlistLink).toHaveAttribute("href", "/welcome");
    // No registration form in closed mode.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create account/i })).not.toBeInTheDocument();
  });

  it("renders the email + password form when signup is open", () => {
    render(<RegisterPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("posts to /api/auth/register and shows the check-your-email screen on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "u1",
        email: "a@b.com",
        organizationId: "o1",
        verificationEmailSent: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an account-ready screen when no verification email was sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "u1",
        email: "a@b.com",
        organizationId: "o1",
        verificationEmailSent: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/account created/i)).toBeInTheDocument());
  });

  it("surfaces the server error message when registration fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "An account with this email already exists" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeInTheDocument());
    // Stays on the form: no success screen, and the submit control is still present.
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });
});
