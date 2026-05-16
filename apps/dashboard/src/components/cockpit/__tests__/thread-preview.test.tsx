import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadPreview } from "../thread-preview";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
});

describe("<ThreadPreview>", () => {
  it("renders messages in order with from labels", () => {
    render(
      <ThreadPreview
        contactId="c1"
        who="Maya Lin"
        messages={[
          { from: "contact", text: "Can I tour first?" },
          { from: "alex", text: "Sat at 2pm works." },
        ]}
      />,
    );
    expect(screen.getByText("Can I tour first?")).toBeInTheDocument();
    expect(screen.getByText("Sat at 2pm works.")).toBeInTheDocument();
  });

  it("renders an inline reply input + two buttons", () => {
    render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[{ from: "contact", text: "hi" }]} />,
    );
    expect(screen.getByRole("textbox", { name: /reply to Maya Lin/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send as me/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask alex to draft/i })).toBeInTheDocument();
  });

  it("Send-as-me is disabled when text is empty (no fake-action click)", async () => {
    const user = userEvent.setup();
    render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[{ from: "contact", text: "hi" }]} />,
    );
    const send = screen.getByRole("button", { name: /send as me/i });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("Send-as-me with text routes to /contacts/[id] (no prefill — see comment in source)", async () => {
    // The contacts/[id] page does not (yet) read a `prefill` query param.
    // We deliberately do NOT forward the typed text to avoid silent data
    // loss. The button signals intent and lands the operator on the
    // takeover composer, which owns the actual reply UI.
    const user = userEvent.setup();
    render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[{ from: "contact", text: "hi" }]} />,
    );
    await user.type(screen.getByRole("textbox", { name: /reply to Maya Lin/i }), "see you sat");
    await user.click(screen.getByRole("button", { name: /send as me/i }));
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1");
  });

  it("Enter in the input also opens the thread when text is non-empty", async () => {
    const user = userEvent.setup();
    render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[{ from: "contact", text: "hi" }]} />,
    );
    await user.type(screen.getByRole("textbox", { name: /reply to Maya Lin/i }), "hey{Enter}");
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1");
  });

  it("Ask-Alex-to-draft routes to /contacts/[id] (the takeover composer is where drafting happens)", async () => {
    const user = userEvent.setup();
    render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[{ from: "contact", text: "hi" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /ask alex to draft/i }));
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1");
  });

  it("renders nothing when messages is empty", () => {
    const { container } = render(<ThreadPreview contactId="c1" who="Maya Lin" messages={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
