// ---------------------------------------------------------------------------
// Generic State Machine — Types
// ---------------------------------------------------------------------------

/** Guard function that determines if a transition can proceed. */
export type TransitionGuard<C> = (context: C) => boolean | Promise<boolean>;

/** Callback invoked on state entry/exit. */
export type StateCallback<S, C> = (state: S, context: C) => void | Promise<void>;

/** A single transition definition. */
export interface Transition<S, E, C> {
  from: S;
  event: E;
  to: S;
  guard?: TransitionGuard<C>;
}

/** Configuration for the state machine. */
export interface StateMachineConfig<S, E, C> {
  initialState: S;
  transitions: Transition<S, E, C>[];
  onEnter?: Partial<Record<string & S, StateCallback<S, C>>>;
  onExit?: Partial<Record<string & S, StateCallback<S, C>>>;
}

/** Result of a state transition attempt. */
export interface TransitionResult<S> {
  success: boolean;
  previousState: S;
  currentState: S;
}
