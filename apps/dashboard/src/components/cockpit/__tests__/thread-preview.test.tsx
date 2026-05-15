import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadPreview } from "../thread-preview";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

  it("routes to /contacts/[id]?takeover=true on Send-as-me", async () => {
    const user = userEvent.setup();
    render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[{ from: "contact", text: "hi" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /send as me/i }));
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?takeover=true");
  });

  it("renders nothing when messages is empty", () => {
    const { container } = render(<ThreadPreview contactId="c1" who="Maya Lin" messages={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
