import { cn } from "@/lib/utils";
import { type AgentKey, getAgent } from "@switchboard/schemas";

export type AgentId = AgentKey;
export type AgentMarkSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AgentMarkSize, number> = {
  xs: 24,
  sm: 40,
  md: 64,
  lg: 120,
  xl: 160,
};

interface AgentMarkProps {
  agent: AgentId;
  size?: AgentMarkSize;
  className?: string;
  monochrome?: boolean;
}

// Display name lookup helper for any caller that previously read AGENT_DISPLAY_NAMES.
export function agentDisplayName(key: AgentKey): string {
  return getAgent(key).displayName;
}

// ── Alex — Lead-to-Speed ──
// Visual: alert, scanning. Motif: signal / radar lines.
function AlexMark() {
  return (
    <>
      <circle cx="28" cy="18" r="10" fill="currentColor" />
      <path d="M 17 31 L 40 31 L 37 57 L 20 57 Z" fill="currentColor" />
      <line
        x1="40"
        y1="13"
        x2="47"
        y2="8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="42"
        y1="18"
        x2="50"
        y2="18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="40"
        y1="23"
        x2="47"
        y2="28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </>
  );
}

// ── Riley — Ad Optimizer ──
// Visual: grounded, forward-moving. Motif: arrow / momentum.
function RileyMark() {
  return (
    <>
      <circle cx="32" cy="18" r="10" fill="currentColor" />
      <rect x="22" y="31" width="20" height="26" rx="2" fill="currentColor" />
      <polyline
        points="46,46 54,51 46,56"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </>
  );
}

// ── Mira — Creative ──
// Visual: open, generative. Motif: orbit / loop.
// NOTE: Slice A keeps the existing wave-loop SVG body (was Jordan's). Slice B1
// will swap in the proper portrait per the agent-home brief §9 portrait spec.
function MiraMark() {
  return (
    <>
      <circle cx="32" cy="17" r="11" fill="currentColor" />
      <path
        d="M 18 31 C 14 39 15 51 20 56 Q 26 60 32 57 Q 38 60 44 56 C 49 51 50 39 46 31 Z"
        fill="currentColor"
      />
    </>
  );
}

export function AgentMark({ agent, size = "md", className, monochrome = false }: AgentMarkProps) {
  const px = SIZE_PX[size];
  const Mark = agent === "alex" ? AlexMark : agent === "riley" ? RileyMark : MiraMark;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
      style={{
        color: monochrome ? "#1A1714" : "var(--sw-text-secondary, #6B6560)",
        flexShrink: 0,
      }}
    >
      <Mark />
    </svg>
  );
}
