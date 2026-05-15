import type { ParsedAction } from "@/components/cockpit/types";

const PAUSE_FOR = /^pause\s+(?:for\s+)?(\d+)\s*(min|m|h|hour|hours)\b/i;
const PAUSE_WORD =
  /^pause\s+(?:for\s+)?(half\s+an?|an|one|two|three|four|five|six)\s+(hour|hours|min|minute|minutes)\b/i;
const PAUSE_UNTIL = /^pause\s+until\s+(.+)$/i;
const PAUSE_BARE = /^pause(?:\s+alex)?$/i;

const WORD_TO_NUM: Record<string, number> = {
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};
const RESUME = /^(resume|unpause|go)$/i;
const HALT = /^(halt|stop)$/i;
const FOLLOWUP =
  /^(?:fu|follow\s+up)\s+(?:with\s+)?([\w'.\- ]+?)(?:\s+(tonight|today|tomorrow|now|later))?$/i;
const BRIEF = /^brief(?:\s+me)?(?:\s+at\s+(.+))?$/i;
const RULE = /^(?:stop|don't|do not)\s+(?:offer(?:ing)?|send(?:ing)?)\s+(.+)$/i;
const HANDOFF = /^(?:reply to|i'?ll\s+reply\s+to|let\s+me\s+reply\s+to)\s+([\w'.\- ]+)$/i;
const CONTEXT = /^tell\s+alex\s+about\s+([\w'.\- ]+)$/i;

function firstNonEmptyLine(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function truncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function untilHourLabel(hours: number): string {
  // Wall-clock-aware "until HH:MM AM/PM" projection. Tests assert only
  // that the string starts with "until" so the projection can drift over
  // time without flaking.
  const target = new Date(Date.now() + hours * 60 * 60 * 1000);
  const h = target.getHours();
  const m = target.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  const mm = m.toString().padStart(2, "0");
  return `until ${h12}:${mm} ${period}`;
}

export function parseCommand(raw: string): ParsedAction {
  const original = raw;
  const text = firstNonEmptyLine(raw);

  let match = text.match(PAUSE_FOR);
  if (match) {
    const n = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    const isMinutes = unit.startsWith("m");
    // Sanity bounds: positive integer, ≤24h or ≤1440min. Out-of-range
    // input falls through to `instruction` so the operator sees an
    // explicit "Got it. Acting on '<raw>'." toast — better than a
    // nonsense projection like "pause · 100h · until 11:55 PM" with
    // no day indicator. Tested in parse-command.test.ts.
    const inRange = isMinutes ? n >= 1 && n <= 1440 : n >= 1 && n <= 24;
    if (inRange) {
      const hours = isMinutes ? n / 60 : n;
      return {
        kind: "pause",
        icon: "⏸",
        label: hours >= 1 ? `pause · ${hours}h` : `pause · ${n}m`,
        detail: untilHourLabel(hours),
        raw: original,
      };
    }
  }

  match = text.match(PAUSE_WORD);
  if (match) {
    const quantifierRaw = match[1]!.toLowerCase().trim();
    const unit = match[2]!.toLowerCase();
    let n: number;
    if (quantifierRaw.startsWith("half")) {
      n = 0.5;
    } else {
      n = WORD_TO_NUM[quantifierRaw] ?? 1;
    }
    const hours = unit.startsWith("m") ? n / 60 : n;
    return {
      kind: "pause",
      icon: "⏸",
      label: hours >= 1 ? `pause · ${hours}h` : `pause · ${Math.round(hours * 60)}m`,
      detail: untilHourLabel(hours),
      raw: original,
    };
  }

  match = text.match(PAUSE_UNTIL);
  if (match) {
    return {
      kind: "pause",
      icon: "⏸",
      label: "pause",
      detail: `until ${match[1]!.trim()}`,
      raw: original,
    };
  }

  if (PAUSE_BARE.test(text)) {
    return {
      kind: "pause",
      icon: "⏸",
      label: "pause",
      detail: "until you resume",
      raw: original,
    };
  }

  if (RESUME.test(text)) {
    return {
      kind: "resume",
      icon: "▶",
      label: "resume",
      detail: "pick up where I left off",
      raw: original,
    };
  }

  if (HALT.test(text)) {
    return {
      kind: "halt",
      icon: "⏹",
      label: "halt",
      detail: "stop everything now",
      raw: original,
    };
  }

  match = text.match(FOLLOWUP);
  if (match) {
    const name = match[1]!.trim();
    const when = (match[2] ?? "today").trim();
    return {
      kind: "followup",
      icon: "↻",
      label: `follow up · ${name}`,
      detail: when,
      raw: original,
    };
  }

  match = text.match(BRIEF);
  if (match) {
    const when = (match[1] ?? "noon").trim();
    return {
      kind: "brief",
      icon: "☼",
      label: "brief me",
      detail: `at ${when}`,
      raw: original,
    };
  }

  match = text.match(RULE);
  if (match) {
    return {
      kind: "rule",
      icon: "⊘",
      label: "rule change",
      detail: `stop offering ${match[1]!.trim()}`,
      raw: original,
    };
  }

  match = text.match(HANDOFF);
  if (match) {
    const name = match[1]!.trim();
    return {
      kind: "handoff",
      icon: "✎",
      label: `handoff · ${name}`,
      detail: "you take the thread",
      raw: original,
    };
  }

  match = text.match(CONTEXT);
  if (match) {
    const name = match[1]!.trim();
    return {
      kind: "context",
      icon: "ⓘ",
      label: `context · ${name}`,
      detail: "add a note to the thread",
      raw: original,
    };
  }

  return {
    kind: "instruction",
    icon: "→",
    label: "instruction",
    detail: truncate(text, 60),
    raw: original,
  };
}
