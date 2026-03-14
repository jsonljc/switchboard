// ---------------------------------------------------------------------------
// Generic State Machine — Immutable transitions with async guards
// ---------------------------------------------------------------------------

import type { StateMachineConfig, Transition, TransitionResult, StateCallback } from "./types.js";

export class StateMachine<S extends string, E extends string, C> {
  private state: S;
  private readonly transitions: Transition<S, E, C>[];
  private readonly onEnter: Partial<Record<string, StateCallback<S, C>>>;
  private readonly onExit: Partial<Record<string, StateCallback<S, C>>>;

  constructor(config: StateMachineConfig<S, E, C>) {
    this.state = config.initialState;
    this.transitions = config.transitions;
    this.onEnter = (config.onEnter as Partial<Record<string, StateCallback<S, C>>>) ?? {};
    this.onExit = (config.onExit as Partial<Record<string, StateCallback<S, C>>>) ?? {};
  }

  get currentState(): S {
    return this.state;
  }

  /** Attempt a state transition. Returns the result without mutating if the transition is invalid. */
  async transition(event: E, context: C): Promise<TransitionResult<S>> {
    const applicable = this.transitions.filter((t) => t.from === this.state && t.event === event);

    for (const t of applicable) {
      if (t.guard) {
        const allowed = await t.guard(context);
        if (!allowed) continue;
      }

      const previousState = this.state;

      // Fire onExit for the current state
      const exitHandler = this.onExit[previousState];
      if (exitHandler) {
        await exitHandler(previousState, context);
      }

      this.state = t.to;

      // Fire onEnter for the new state
      const enterHandler = this.onEnter[this.state];
      if (enterHandler) {
        await enterHandler(this.state, context);
      }

      return { success: true, previousState, currentState: this.state };
    }

    return { success: false, previousState: this.state, currentState: this.state };
  }

  /** Get all valid events from the current state. */
  validEvents(): E[] {
    return [...new Set(this.transitions.filter((t) => t.from === this.state).map((t) => t.event))];
  }

  /** Reset the machine to a specific state (for hydration from persistence). */
  hydrate(state: S): void {
    this.state = state;
  }
}
