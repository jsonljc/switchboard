export interface StatusLineInput {
  oldestOpenItemAgeHours: number | null;
  fallingBehindHours: number;
  state: { lastActionAt: string | null } | null;
  nowMs: number;
}

export interface StatusLine {
  health: string | null;
  presence: string | null;
}

export function composeStatusLine(input: StatusLineInput): StatusLine {
  const { oldestOpenItemAgeHours: age, fallingBehindHours, state, nowMs } = input;

  let health: string | null = null;
  if (age != null) {
    health =
      age >= fallingBehindHours
        ? `Oldest lead has waited ${Math.round(age)}h`
        : "Nothing old is waiting";
  }

  let presence: string | null = null;
  const last = state?.lastActionAt ?? null;
  if (last) {
    const diffMin = Math.max(0, Math.round((nowMs - new Date(last).getTime()) / 60_000));
    if (diffMin < 1) {
      presence = "Last action just now";
    } else if (diffMin < 60) {
      presence = `Last action ${diffMin}m ago`;
    } else {
      const h = Math.round(diffMin / 60);
      if (h < 24) {
        presence = `Last action ${Math.max(1, h)}h ago`;
      } else {
        presence = `Last action ${Math.round(h / 24)}d ago`;
      }
    }
  } else {
    presence = "No recorded action in 24h";
  }

  return { health, presence };
}
