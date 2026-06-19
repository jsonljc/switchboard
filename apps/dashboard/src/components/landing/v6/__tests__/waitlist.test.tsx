import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { V6Waitlist } from "../waitlist";

describe("V6Waitlist", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Default: signup closed -> the waitlist form shows.
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing when self-serve signup is open", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");

    const { container } = render(<V6Waitlist />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the email capture form when signup is closed", () => {
    render(<V6Waitlist />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join the waitlist/i })).toBeInTheDocument();
  });

  it("posts to /api/waitlist and confirms on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<V6Waitlist />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));

    await waitFor(() => expect(screen.getByText(/you are on the list/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/waitlist",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("treats a duplicate signup as a friendly confirmation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, duplicate: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<V6Waitlist />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));

    await waitFor(() => expect(screen.getByText(/already on the list/i)).toBeInTheDocument());
  });

  it("surfaces an error when the waitlist call fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Waitlist signup is temporarily unavailable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<V6Waitlist />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));

    await waitFor(() => expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument());
    // The confirmation must not appear on failure.
    expect(screen.queryByText(/you are on the list/i)).not.toBeInTheDocument();
  });
});
