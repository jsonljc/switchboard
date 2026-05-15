import type { ParsedAction } from "@/components/cockpit/types";

export interface ToastPayload {
  title: string;
  description?: string;
}

export function toastVoice(action: ParsedAction): ToastPayload {
  switch (action.kind) {
    case "pause":
      return { title: "Paused — standing by.", description: action.detail };
    case "resume":
      return { title: "Resumed — picking up where I left off." };
    case "halt":
      return { title: "Halted — stopped everything." };
    case "brief":
      return {
        title: "Noted — brief stub.",
        description: "I'll surface this when scheduled briefs ship.",
      };
    case "rule":
      return { title: "Opening rules.", description: action.detail };
    case "handoff": {
      const name = action.label.replace(/^handoff · /, "");
      return { title: `Handing ${name} to you.` };
    }
    case "context": {
      const name = action.label.replace(/^context · /, "");
      return { title: `Got context on ${name}.` };
    }
    case "followup":
      return {
        title: "Noted — followup stub.",
        description: "I'll surface this when scheduled followups ship.",
      };
    case "instruction":
      return { title: "Got it.", description: `Acting on "${action.detail}".` };
    case "command":
      return { title: `On it — ${action.label}.` };
  }
}
