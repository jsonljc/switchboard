import type { Command } from "@/components/cockpit/types";

export const ALEX_COMPOSER_PLACEHOLDER =
  'Tell Alex what to do — "pause an hour", "follow up with Maya tonight"…';

export const ALEX_COMMANDS: readonly Command[] = [
  { id: "pause-1h", label: "Pause Alex for 1 hour", group: "control" },
  { id: "pause-3pm", label: "Pause until 3 PM", group: "control" },
  { id: "resume", label: "Resume Alex", group: "control" },
  { id: "halt", label: "Halt — stop everything", group: "control" },
  { id: "brief-noon", label: "Brief me at noon", group: "control" },
  { id: "brief-eod", label: "Brief me at end of day", group: "control" },
  { id: "fu-named", label: "Follow up with {contact} tonight", group: "thread" },
  { id: "reply-named", label: "Reply to {contact} myself", group: "thread" },
  { id: "hold-named", label: "Hold {contact}, don't send anything", group: "thread" },
  { id: "stop-founder", label: "Stop offering the founder rate", group: "rules" },
  { id: "raise-rule", label: "Raise approval threshold to $99", group: "rules" },
  { id: "open-settings", label: "Open settings", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "nav" },
  { id: "open-meta", label: "Open Meta Ads campaigns", group: "nav" },
];
