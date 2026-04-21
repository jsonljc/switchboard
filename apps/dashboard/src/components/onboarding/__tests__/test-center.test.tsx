import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestCenter } from "../test-center";

const mockPrompts = [
  {
    id: "p1",
    category: "BOOKING",
    text: "I'd like to book a teeth whitening session. Do you have anything this Saturday?",
    recommended: true,
  },
  {
    id: "p2",
    category: "PRICING",
    text: "How much is an Invisalign consultation?",
    recommended: false,
  },
];

describe("TestCenter", () => {
  it("renders page title and prompts", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onRerunPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText("Try Alex with real scenarios")).toBeTruthy();
    expect(screen.getByText(/teeth whitening/i)).toBeTruthy();
  });

  it("marks recommended prompt with Start here badge", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onRerunPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText("Start here")).toBeTruthy();
  });

  it("shows empty state before any prompt is sent", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onRerunPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText(/send a scenario/i)).toBeTruthy();
  });

  it("calls onSendPrompt when prompt card is clicked", () => {
    const onSend = vi.fn();
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={onSend}
        onRerunPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    fireEvent.click(screen.getByText(/teeth whitening/i));
    expect(onSend).toHaveBeenCalledWith(mockPrompts[0]);
  });

  it("shows re-run button after response with status 'fixed'", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onRerunPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[
          {
            promptId: "p1",
            userMessage: "test",
            alexMessage: "response",
            annotations: [],
            status: "fixed",
          },
        ]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText("Re-run")).toBeTruthy();
  });

  it("calls onRerunPrompt with promptId when re-run is clicked", () => {
    const onRerun = vi.fn();
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onRerunPrompt={onRerun}
        onAdvance={vi.fn()}
        responses={[
          {
            promptId: "p1",
            userMessage: "test",
            alexMessage: "response",
            annotations: [],
            status: "fixed",
          },
        ]}
        isSimulating={false}
      />,
    );
    fireEvent.click(screen.getByText("Re-run"));
    expect(onRerun).toHaveBeenCalledWith("p1");
  });

  it("shows zero-test confirmation when advancing with no tests", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onRerunPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    fireEvent.click(screen.getByText(/go live/i));
    expect(screen.getByText(/haven't tested/i)).toBeTruthy();
  });
});
