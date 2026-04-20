import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ConversationDemo } from "../conversation-demo";

vi.useFakeTimers();

describe("ConversationDemo", () => {
  it("renders the phone frame with header", () => {
    render(<ConversationDemo />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Speed-to-Lead")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows the initial customer message", () => {
    render(<ConversationDemo />);
    expect(screen.getByText(/I saw your ad for teeth whitening/i)).toBeInTheDocument();
  });

  it("shows text input with placeholder", () => {
    render(<ConversationDemo />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
  });

  it("auto-plays conversation after 3 seconds", async () => {
    render(<ConversationDemo />);
    expect(screen.queryByText(/Great timing/i)).not.toBeInTheDocument();

    // Advance auto-start timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Advance first message timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(screen.getByText(/Great timing/i)).toBeInTheDocument();
  });

  it("shows result line after conversation completes", async () => {
    render(<ConversationDemo />);

    // Manually advance through all timers
    // Auto-start: 3000ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // Step 1 (alex): 1200ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    // Step 2 (customer): 1500ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    // Step 3 (alex): 1000ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // Step 4 (customer): 1200ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    // Step 5 (alex): 800ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(screen.getByText(/This conversation took 47 seconds/i)).toBeInTheDocument();
  });
});
