import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WaitlistForm } from "../waitlist-form";

describe("WaitlistForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows success when the waitlist request succeeds", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<WaitlistForm />);
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join waitlist/i }));

    await waitFor(() => {
      expect(screen.getByText(/you’re on the list|you're on the list/i)).toBeInTheDocument();
    });
  });

  it("shows the API error message when signup is unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "Waitlist signup is temporarily unavailable" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    render(<WaitlistForm />);
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join waitlist/i }));

    await waitFor(() => {
      expect(screen.getByText(/waitlist signup is temporarily unavailable/i)).toBeInTheDocument();
    });
  });
});
