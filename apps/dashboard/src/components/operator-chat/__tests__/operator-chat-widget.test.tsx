import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperatorChatWidget } from "../operator-chat-widget";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("OperatorChatWidget", () => {
  beforeEach(() => {
    // The widget is off by default; enable it for the behavior tests below.
    vi.stubEnv("NEXT_PUBLIC_OPERATOR_CHAT_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("renders nothing unless explicitly enabled by the flag", () => {
    vi.stubEnv("NEXT_PUBLIC_OPERATOR_CHAT_ENABLED", "false");
    const { container } = render(<OperatorChatWidget />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /operator/i })).toBeNull();
  });

  it("renders the chat toggle button", () => {
    render(<OperatorChatWidget />);
    expect(screen.getByRole("button", { name: /operator/i })).toBeDefined();
  });

  it("opens the chat panel when clicked", async () => {
    render(<OperatorChatWidget />);
    fireEvent.click(screen.getByRole("button", { name: /operator/i }));
    expect(screen.getByPlaceholderText(/command/i)).toBeDefined();
  });

  it("sends a command and displays the response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          commandId: "cmd-1",
          status: "completed",
          message: "Done — pipeline summary.",
        }),
    });

    render(<OperatorChatWidget />);
    fireEvent.click(screen.getByRole("button", { name: /operator/i }));

    const input = screen.getByPlaceholderText(/command/i);
    fireEvent.change(input, { target: { value: "show pipeline" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/pipeline summary/)).toBeDefined();
    });
  });
});
