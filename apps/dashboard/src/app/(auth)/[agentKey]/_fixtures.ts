// apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts
import type { AgentKey } from "@switchboard/schemas";
import type { GreetingViewModel } from "@/lib/agent-home/types";

const NOW_ISO = "2026-05-04T08:00:00.000Z";

const greetings: Record<"alex" | "riley", GreetingViewModel> = {
  alex: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Three leads are waiting on you. " },
      { kind: "accent", text: "Maya" },
      { kind: "text", text: " is the one I'd answer first — she's been ready for " },
      { kind: "accent", text: "two days" },
      { kind: "text", text: "." },
    ],
    signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
  riley: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Two ad sets need your eye. " },
      { kind: "accent", text: "Whitening" },
      { kind: "text", text: " is bleeding budget faster than the others — start there." },
    ],
    signal: { inboxCount: 2, oldestOpenItemAgeHours: 6, hoursSinceLastOperatorAction: 18 },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
};

export function getFixtureGreeting(agentKey: AgentKey): GreetingViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return greetings[agentKey];
}
