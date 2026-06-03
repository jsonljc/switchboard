import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import HomeLoading from "../(home)/loading";
import InboxLoading from "../inbox/loading";
import ResultsLoading from "../results/loading";
import MiraLoading from "../mira/loading";

afterEach(cleanup);

describe("route-shell skeletons", () => {
  it.each([
    ["home", HomeLoading, /loading your briefing/i],
    ["inbox", InboxLoading, /loading your inbox/i],
    ["mira", MiraLoading, /loading mira/i],
  ])("%s shell renders a labelled loading status", (_name, Comp, label) => {
    render(<Comp />);
    expect(screen.getByRole("status", { name: label })).toBeInTheDocument();
  });

  it("results shell renders the ResultsSkeleton", () => {
    render(<ResultsLoading />);
    expect(screen.getByRole("status", { name: /loading results/i })).toBeInTheDocument();
  });
});
