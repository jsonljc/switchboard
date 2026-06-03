import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InboxAgentAvatar } from "../inbox-agent-avatar";

describe("<InboxAgentAvatar>", () => {
  it("renders the pixel sprite SVG for an agent with a bundle (alex)", () => {
    const { container } = render(<InboxAgentAvatar agentKey="alex" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the pixel sprite SVG for riley", () => {
    const { container } = render(<InboxAgentAvatar agentKey="riley" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the pixel sprite SVG for mira", () => {
    const { container } = render(<InboxAgentAvatar agentKey="mira" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
