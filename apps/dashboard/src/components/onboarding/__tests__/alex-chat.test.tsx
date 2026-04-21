import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlexChat } from "../alex-chat";

describe("AlexChat", () => {
  it("renders messages", () => {
    render(
      <AlexChat
        messages={[
          { id: "1", role: "alex", text: "Hello! Let's set up your playbook." },
          { id: "2", role: "user", text: "Sure, let's go." },
        ]}
        onSendMessage={vi.fn()}
        isTyping={false}
      />,
    );
    expect(screen.getByText("Hello! Let's set up your playbook.")).toBeTruthy();
    expect(screen.getByText("Sure, let's go.")).toBeTruthy();
  });

  it("shows typing indicator when isTyping is true", () => {
    render(<AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={true} />);
    expect(screen.getByTestId("typing-indicator")).toBeTruthy();
  });

  it("calls onSendMessage when user submits", () => {
    const onSend = vi.fn();
    render(<AlexChat messages={[]} onSendMessage={onSend} isTyping={false} />);
    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("clears input after sending", () => {
    render(<AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={false} />);
    const input = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
  });

  it("shows send button when input has text", () => {
    render(<AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={false} />);
    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.getByTestId("send-button")).toBeTruthy();
  });

  it("hides send button when input is empty", () => {
    render(<AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={false} />);
    expect(screen.queryByTestId("send-button")).toBeNull();
  });
});
