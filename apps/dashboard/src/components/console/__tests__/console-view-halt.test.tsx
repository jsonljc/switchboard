import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsoleView } from "../console-view";
import { consoleFixture } from "../console-data";

describe("ConsoleView Halt button (DC-41 ship-with deferral)", () => {
  it("does not render the Halt button at v1 launch", () => {
    const { queryByText } = render(<ConsoleView data={consoleFixture} />);
    expect(queryByText(/^Halt$/)).not.toBeInTheDocument();
  });
});
