import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MiraBriefBox } from "../mira-brief-box";

const mutateAsync = vi.fn();
const state = { isPending: false, isError: false };
vi.mock("@/hooks/use-create-creative-draft-request", () => ({
  useCreateCreativeDraftRequest: () => ({ mutateAsync, ...state }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({ useHalt: () => ({ halted: false }) }));

function typeLine(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/summer botox special/i), { target: { value } });
}

describe("MiraBriefBox", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ jobId: "j" });
    state.isPending = false;
    state.isError = false;
  });

  it("shows the Intent Preview on submit and does NOT fire the mutation until [Make the draft] (HARD rule)", () => {
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /preview|make the draft/i }));
    expect(screen.getByText(/got it\. a draft ad/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled(); // cost-confirm: never before [Make the draft]
  });

  it("submits only after [Make the draft] is clicked", async () => {
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /make the draft/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        promoting: "Summer Botox special",
        goal: "more_bookings",
        vibe: "warm",
        mode: "polished",
      }),
    );
    expect(await screen.findByText(/mira is on it|started a draft/i)).toBeInTheDocument();
  });

  it("posts mode ugc when the Real-talk format chip is selected (slice-3 spec 3.4)", async () => {
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /real-talk/i }));
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /make the draft/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ mode: "ugc" })),
    );
  });

  it("redirects (never answers) and never submits when the line reads as an off-scope question", () => {
    render(<MiraBriefBox />);
    typeLine("When can I rebook my 3pm client?");
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    expect(screen.getByText(/front desk and reports handle those/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /make the draft/i })).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("disables Preview when the line is empty; an example chip fills it", () => {
    render(<MiraBriefBox />);
    expect(screen.getByRole("button", { name: /^preview/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /introduce our new lip filler/i }));
    expect(screen.getByRole("button", { name: /^preview/i })).not.toBeDisabled();
  });

  it("surfaces the error message and disables both confirm buttons while pending", () => {
    state.isError = true;
    state.isPending = true;
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    expect(screen.getByText(/couldn't start the draft/i)).toBeInTheDocument();
    // No double-submit / no stale-overwrite race: both buttons are disabled mid-flight.
    expect(screen.getByRole("button", { name: /make the draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^tweak/i })).toBeDisabled();
  });

  it("Tweak returns to the edit form (input preserved)", () => {
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /^tweak/i }));
    expect(screen.getByRole("button", { name: /^preview/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/summer botox special/i)).toHaveValue(
      "Summer Botox special",
    );
  });
});
