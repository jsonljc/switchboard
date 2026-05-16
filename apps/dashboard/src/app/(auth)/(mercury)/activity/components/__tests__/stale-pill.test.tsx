import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { StalePill } from "../stale-pill";

const NOW = new Date("2026-05-14T12:00:00.000Z").getTime();

describe("StalePill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when fetchedAt === 0 (no successful fetch yet)", () => {
    const { container } = render(
      <StalePill fetchedAt={0} isFetching={false} onRefetch={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'just now' when fetchedAt is within 60s of wall clock", () => {
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={false} onRefetch={() => {}} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
  });

  it("shows 'Nm ago' once at least 60s have elapsed", () => {
    render(<StalePill fetchedAt={NOW - 125_000} isFetching={false} onRefetch={() => {}} />);
    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });

  it("refresh button invokes onRefetch", () => {
    const onRefetch = vi.fn();
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={false} onRefetch={onRefetch} />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders 'fetching…' label when isFetching=true", () => {
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={true} onRefetch={() => {}} />);
    expect(screen.getByRole("button", { name: /fetching…/i })).toBeInTheDocument();
  });

  it("carries role='status' on the wrapper and aria-live='polite' on the age", () => {
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={false} onRefetch={() => {}} />);
    const wrapper = screen.getByRole("status");
    expect(wrapper).toBeInTheDocument();
    const age = wrapper.querySelector("[aria-live='polite']");
    expect(age).not.toBeNull();
  });

  it("re-renders the Nm value after the 15s ticker advances", () => {
    render(<StalePill fetchedAt={NOW - 30_000} isFetching={false} onRefetch={() => {}} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
    act(() => {
      vi.setSystemTime(NOW + 90_000);
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });
});
