import { describe, expect, it } from "vitest";
import {
  composeActivityVoice,
  KNOWN_ACTIVITY_KINDS,
} from "@/components/agent-panel/lib/activity-voice";

describe("composeActivityVoice", () => {
  it("replied with who", () => {
    expect(
      composeActivityVoice({
        time: "",
        kind: "replied",
        head: "about Botox pricing",
        who: "Maya R.",
      }),
    ).toBe("I replied to Maya R. about Botox pricing");
  });
  it("booked with who", () => {
    expect(
      composeActivityVoice({ time: "", kind: "booked", head: "for Thu 2pm", who: "Jen T." }),
    ).toBe("I booked Jen T.'s consult for Thu 2pm");
  });
  it("unknown kind falls back to the head verbatim (no crash)", () => {
    expect(
      composeActivityVoice({ time: "", kind: "observed", head: "a spend anomaly" } as any),
    ).toBe("I noted a spend anomaly");
  });
  it("every known ActivityKind returns a non-empty sentence (no silent gaps)", () => {
    for (const kind of KNOWN_ACTIVITY_KINDS) {
      expect(
        composeActivityVoice({ time: "", kind, head: "the thing", who: "X" }).length,
      ).toBeGreaterThan(0);
    }
  });
});
