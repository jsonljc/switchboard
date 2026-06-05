import type { SpriteState } from "@/components/cockpit/sprite/types";
import type { DerivedAgentStateEntry } from "@/lib/api-client-types";

/**
 * Live activity status, DERIVED from the API type so the union cannot silently
 * drift if the backend adds a status. Returned by `useAgentState()` as
 * `DerivedAgentStateEntry.activityStatus` (a non-nullable union today; the
 * `NonNullable` is a no-op now and a guard so callers stay type-safe if the API
 * ever goes nullable). Any unknown future value falls through `agentVisualState`'s
 * `default` branch to a calm idle.
 */
export type AgentActivity = NonNullable<DerivedAgentStateEntry["activityStatus"]>;

/** Status pip color keys, mapping to globals.css `--agent-*` status tokens. */
export type StatusPip = "active" | "idle" | "attention" | "locked";

export interface AgentVisualState {
  /** Which sprite animation cycle to show. */
  spriteState: SpriteState;
  /** Status dot color key. */
  pip: StatusPip;
  /**
   * Whether the sprite should animate. Motion budget: only an actively working
   * agent breathes (animates); everything else holds a static frame.
   */
  playing: boolean;
}

/**
 * Pure mapping from live status to the avatar's visual state. `halted` (from the
 * workspace-level halt) wins over any activity. Identity-only: never affects an
 * action control.
 */
export function agentVisualState(status: AgentActivity, halted: boolean): AgentVisualState {
  if (halted) {
    return { spriteState: "sleep", pip: "locked", playing: false };
  }
  switch (status) {
    case "working":
    case "analyzing":
      return { spriteState: "draft", pip: "active", playing: true };
    case "waiting_approval":
    case "error":
      return { spriteState: "idle", pip: "attention", playing: false };
    case "idle":
      return { spriteState: "idle", pip: "idle", playing: false };
    default:
      // Unknown/future status: degrade gracefully to a calm idle.
      return { spriteState: "idle", pip: "idle", playing: false };
  }
}
