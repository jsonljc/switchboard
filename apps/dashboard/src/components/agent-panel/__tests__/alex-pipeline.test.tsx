import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let data: unknown = undefined;
let isLoading = false;
let isError = false;
let error: unknown = null;
vi.mock("@/hooks/use-agent-pipeline", () => ({
  useAgentPipeline: () => ({ data, isLoading, isError, error }),
}));

import { AlexPipeline } from "../alex-pipeline";

function vm(
  tiles: Array<{ id: string; stage: "hot" | "warm" | "new"; name: string; ctx: string }>,
) {
  return {
    agentKey: "alex",
    pipelineKind: "leads",
    totalCount: tiles.length,
    countNoun: "people",
    tiles: tiles.map((t) => ({ ...t, link: { kind: "contact", id: t.id } })),
    setupLink: { kind: "agent-setup", agentKey: "alex" },
    freshness: { generatedAt: "x", window: "today", dataSource: "live" },
  };
}

describe("AlexPipeline", () => {
  beforeEach(() => {
    data = undefined;
    isLoading = false;
    isError = false;
    error = null;
  });

  it("loading → skeleton, no error/empty copy", () => {
    isLoading = true;
    const { container } = render(<AlexPipeline />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText("Couldn't load pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText("No active consultations")).not.toBeInTheDocument();
  });

  it("error → 'Couldn't load pipeline'", () => {
    isError = true;
    error = new Error("boom");
    render(<AlexPipeline />);
    expect(screen.getByText("Couldn't load pipeline")).toBeInTheDocument();
  });

  it("keys-pending (undefined, no error) → loading skeleton, not error", () => {
    const { container } = render(<AlexPipeline />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText("Couldn't load pipeline")).not.toBeInTheDocument();
  });

  it("empty → 'No active consultations'", () => {
    data = vm([]);
    render(<AlexPipeline />);
    expect(screen.getByText("No active consultations")).toBeInTheDocument();
  });

  it("renders the total count and tiles by stage", () => {
    data = vm([
      { id: "c1", stage: "hot", name: "Maya R.", ctx: "asked about Botox" },
      { id: "c2", stage: "new", name: "Jen T.", ctx: "new lead" },
    ]);
    render(<AlexPipeline />);
    expect(screen.getByText("2 people in pipeline")).toBeInTheDocument();
    expect(screen.getByText("Maya R. · asked about Botox")).toBeInTheDocument();
    expect(screen.getByText("Hot")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
