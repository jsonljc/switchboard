import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryStates } from "./query-states";

afterEach(cleanup);

const renderData = (data: string[]) => (
  <ul>
    {data.map((d) => (
      <li key={d}>{d}</li>
    ))}
  </ul>
);

describe("QueryStates", () => {
  it("renders data via render-prop", () => {
    render(<QueryStates query={{ data: ["a"], error: null }}>{renderData}</QueryStates>);
    expect(screen.getByText("a")).toBeInTheDocument();
  });
  it("keys-pending renders LOADING, never empty", () => {
    render(
      <QueryStates
        query={{ data: undefined, error: null }}
        loading={<div>shimmer</div>}
        empty={<div>all caught up</div>}
      >
        {renderData}
      </QueryStates>,
    );
    expect(screen.getByText("shimmer")).toBeInTheDocument();
    expect(screen.queryByText("all caught up")).toBeNull();
  });
  it("empty data renders empty slot", () => {
    render(
      <QueryStates
        query={{ data: [], error: null }}
        isEmpty={(d) => d.length === 0}
        empty={<div>all caught up</div>}
      >
        {renderData}
      </QueryStates>,
    );
    expect(screen.getByText("all caught up")).toBeInTheDocument();
  });
  it("error renders default ConnectionTrouble (never blank)", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    render(
      <QueryStates query={{ data: undefined, error: new Error("x") }}>{renderData}</QueryStates>,
    );
    expect(screen.getByText(/can't reach your team/i)).toBeInTheDocument();
  });
  it("wires onRetry into default error", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const onRetry = vi.fn();
    render(
      <QueryStates query={{ data: undefined, error: new Error("x") }} onRetry={onRetry}>
        {renderData}
      </QueryStates>,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it("function error slot receives the error", () => {
    render(
      <QueryStates
        query={{ data: undefined, error: new Error("nope") }}
        error={(e) => <div>err:{(e as Error).message}</div>}
      >
        {renderData}
      </QueryStates>,
    );
    expect(screen.getByText("err:nope")).toBeInTheDocument();
  });
});
