import type { ActivityRow } from "@/components/cockpit/types";

export function coldStateActivityRows(): ActivityRow[] {
  return [
    {
      time: "—",
      kind: "alert",
      head: "Connect Meta Ads to begin",
      body: "Riley needs your Meta Ads account to start scoring campaigns.",
    },
    {
      time: "—",
      kind: "alert",
      head: "Set average lead value",
      body: "Riley uses this to compute ROAS and recommend scale/pause actions.",
    },
    {
      time: "—",
      kind: "started",
      head: "Standing rules loaded",
      body: "Riley will run a daily scan once Meta Ads is connected.",
    },
  ];
}
