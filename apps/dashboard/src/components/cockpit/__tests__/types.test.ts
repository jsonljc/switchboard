import { describe, it, expect } from "vitest";
import type {
  CockpitStatus,
  ApprovalView,
  ActivityRow,
  ActivityKind,
  ThreadMessage,
  MissionViewModel,
} from "../types";

describe("cockpit types", () => {
  it("ApprovalView carries the shared base shape", () => {
    const sample: ApprovalView = {
      id: "appr_1",
      kind: "pricing",
      urgency: "this_week",
      askedAt: "4 min ago",
      title: "Send Jordan the founding-member rate?",
      presentation: { primaryLabel: "Accept & send", dismissLabel: "Decline" },
      primary: "Accept & send",
      secondary: "Decline",
      primaryAction: { kind: "respond", bindingHash: "abc", verdict: "accept" },
    };
    expect(sample.id).toBe("appr_1");
  });

  it("ActivityRow has time/kind/head plus optional body/preview", () => {
    const sample: ActivityRow = { time: "11:58", kind: "replied", head: "Devon K." };
    expect(sample.kind).toBe("replied");
  });

  it("ActivityKind includes all 9 Alex kinds", () => {
    const kinds: ActivityKind[] = [
      "booked",
      "qualified",
      "replied",
      "sent",
      "started",
      "connected",
      "waiting",
      "escalated",
      "passed",
    ];
    expect(kinds).toHaveLength(9);
  });

  it("CockpitStatus accepts the A.1 vocabulary values", () => {
    const statuses: CockpitStatus[] = ["IDLE", "WORKING", "WAITING", "HALTED"];
    expect(statuses).toContain("WORKING");
  });

  it("MissionViewModel rows tuple optionally carries a dot color", () => {
    const vm: MissionViewModel = {
      subtitle: "SDR · Tours pipeline · HotPod",
      title: "What is Alex configured for?",
      rows: [
        ["ROLE", "SDR · qualify inbound leads, book tours"],
        ["CHANNELS", "Meta Ads", "ok"],
      ],
    };
    expect(vm.rows).toHaveLength(2);
  });

  it("ThreadMessage has from + text", () => {
    const msg: ThreadMessage = { from: "Alex", text: "On it." };
    expect(msg.from).toBe("Alex");
  });
});
