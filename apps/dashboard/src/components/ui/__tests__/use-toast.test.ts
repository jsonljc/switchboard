import { describe, it, expect } from "vitest";
import { reducer } from "../use-toast";

type ReducerState = Parameters<typeof reducer>[0];

function add(state: ReducerState, id: string): ReducerState {
  return reducer(state, { type: "ADD_TOAST", toast: { id, open: true } });
}

describe("use-toast reducer", () => {
  it("queues multiple toasts instead of evicting the prior one", () => {
    // The safety-net bug: at TOAST_LIMIT=1 each new approval evicted the prior
    // Undo toast, destroying undo for every item but the last in a queue-clearing run.
    let s: ReducerState = { toasts: [] };
    s = add(s, "1");
    s = add(s, "2");
    s = add(s, "3");
    expect(s.toasts.map((t) => t.id)).toEqual(["3", "2", "1"]);
  });

  it("caps the queue at the limit (most-recent-first)", () => {
    let s: ReducerState = { toasts: [] };
    for (const id of ["1", "2", "3", "4", "5"]) s = add(s, id);
    expect(s.toasts).toHaveLength(3);
    expect(s.toasts.map((t) => t.id)).toEqual(["5", "4", "3"]);
  });
});
