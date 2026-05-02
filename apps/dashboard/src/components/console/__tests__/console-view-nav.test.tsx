import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConsoleView } from "../console-view";
import { consoleFixture } from "../console-data";

describe("ConsoleView in-zone navigation (DC-40 part C)", () => {
  it("agent-strip 'view conversations' is a real link to /conversations", () => {
    const { getAllByRole } = render(<ConsoleView data={consoleFixture} />);
    const links = getAllByRole("link");
    const conversationsLink = links.find(
      (a) =>
        a.getAttribute("href") === "/conversations" &&
        /view conversations/i.test(a.textContent ?? ""),
    );
    expect(conversationsLink).toBeDefined();
  });

  it("queue zone heading links to /escalations", () => {
    const { getAllByRole } = render(<ConsoleView data={consoleFixture} />);
    const links = getAllByRole("link");
    const queueLink = links.find((a) => a.getAttribute("href") === "/escalations");
    expect(queueLink).toBeDefined();
  });

  it("activity rows without a CTA render an arrow link to /conversations", () => {
    const { container } = render(<ConsoleView data={consoleFixture} />);
    const arrowLinks = container.querySelectorAll("a.act-arrow");
    expect(arrowLinks.length).toBeGreaterThan(0);
    arrowLinks.forEach((a) => {
      expect(a.getAttribute("href")).toBe("/conversations");
    });
  });
});
