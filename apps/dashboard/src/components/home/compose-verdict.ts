import type { VerdictModel, VerdictSignals } from "./types";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatEyebrow(now: Date): string {
  const day = DAY_NAMES[now.getDay()];
  const month = MONTH_NAMES[now.getMonth()];
  const date = now.getDate();
  const hour = now.getHours();
  const h12 = ((hour + 11) % 12) + 1;
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${day}, ${month} ${date} · ${h12}:${mm} ${ampm}`;
}

function formatSalutation(hour: number, ownerName: string | undefined): string {
  const name = ownerName ?? "there";
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

function numberWord(n: number): string {
  if (n === 2) return "Two";
  return String(n);
}

function buildActiveProof(signals: VerdictSignals): string {
  const { openLeadCount, oldestWaitMin, workingCount, setUpCount } = signals;
  const base = `${openLeadCount} open leads`;
  const oldest = oldestWaitMin != null ? ` · oldest waiting ${oldestWaitMin} min` : "";
  const working = ` · ${workingCount} of ${setUpCount} working`;
  return `${base}${oldest}${working}`;
}

function buildCalmProof(signals: VerdictSignals): string {
  const { openLeadCount, oldestWaitMin, workingCount, setUpCount } = signals;
  const base = `${openLeadCount} open enquiries`;
  const oldest = oldestWaitMin != null ? ` · oldest waiting ${oldestWaitMin} min` : "";
  const working = ` · ${workingCount} of ${setUpCount} working`;
  return `${base}${oldest}${working}`;
}

/**
 * Pure function: composes a VerdictModel from VerdictSignals.
 * Inject `signals.now` for deterministic tests.
 * Never fabricates values — all numbers come from signals.
 */
export function composeVerdict(signals: VerdictSignals): VerdictModel {
  const now = signals.now ?? new Date();
  const hour = now.getHours();

  const eyebrow = formatEyebrow(now);
  const salutation = formatSalutation(hour, signals.ownerName);

  // FALLBACK — signals explicitly unavailable
  if (signals.unavailable) {
    return {
      shape: "fallback",
      eyebrow,
      salutation,
      line: "Your team is on shift.",
      proof: "We don't have a read on today yet.",
    };
  }

  const { decisionCount, topAgentName, topAgentKey } = signals;

  // ACTIVE — decisions are pending
  if (decisionCount > 0) {
    const hasName = Boolean(topAgentName);
    let pre: string;
    let em: string;
    let post: string;

    if (decisionCount === 1) {
      if (hasName) {
        pre = "One thing needs you. ";
        em = topAgentName!;
        post = " has it ready.";
      } else {
        pre = "One thing needs you.";
        em = "";
        post = ".";
      }
    } else {
      const word = numberWord(decisionCount);
      if (hasName) {
        pre = `${word} things need you — start with `;
        em = topAgentName!;
        post = ".";
      } else {
        pre = `${word} things need you.`;
        em = "";
        post = ".";
      }
    }

    return {
      shape: "active",
      eyebrow,
      salutation,
      line: { pre, em, post },
      proof: buildActiveProof(signals),
      accentAgent: topAgentKey,
    };
  }

  // CALM — all clear
  return {
    shape: "calm",
    eyebrow,
    salutation,
    line: { pre: "", em: "All caught up.", post: " Your team's running clean." },
    proof: buildCalmProof(signals),
  };
}
