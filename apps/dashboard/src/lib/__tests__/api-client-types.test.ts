import { describe, it, expect } from "vitest";
import type { DerivedAgentState } from "@switchboard/db";
import type { DerivedAgentStateEntry } from "../api-client-types";

/**
 * Contract test: `DerivedAgentStateEntry` (the client-side wire type consumed by
 * the agent panel) must mirror `DerivedAgentState` from `@switchboard/db` (the
 * server source of truth produced by `deriveAgentStates`), differing only in
 * `lastActionAt` — a `Date | null` server-side, serialized to an ISO string over
 * the wire.
 *
 * The real enforcement is the compile-time assertion below: if the db shape gains
 * or renames a field, `_AssertMirrors` collapses to `never` and `pnpm typecheck`
 * fails. The runtime `it` keeps the file in the vitest suite and documents the
 * field set explicitly.
 */

// Map every `Date | null` field to its JSON-serialized `string | null` wire form.
type WireOf<T> = {
  [K in keyof T]: [T[K]] extends [Date | null] ? string | null : T[K];
};

// Bidirectional assignability ⇒ structural equality.
type _AssertMirrors =
  WireOf<DerivedAgentState> extends DerivedAgentStateEntry
    ? DerivedAgentStateEntry extends WireOf<DerivedAgentState>
      ? true
      : never
    : never;

// If the shapes drift this line stops type-checking.
const _assertMirrors: _AssertMirrors = true;

describe("DerivedAgentStateEntry", () => {
  it("mirrors the db DerivedAgentState wire shape (compile-time enforced)", () => {
    expect(_assertMirrors).toBe(true);

    // A representative wire value type-checks against the client type.
    const sample: DerivedAgentStateEntry = {
      agentRole: "responder",
      activityStatus: "working",
      currentTask: null,
      lastActionAt: "2026-05-26T13:50:00Z",
      lastActionSummary: null,
      metrics: { actionsToday: 3 },
    };
    expect(sample.agentRole).toBe("responder");
    expect(sample.lastActionAt).toBe("2026-05-26T13:50:00Z");
  });
});
