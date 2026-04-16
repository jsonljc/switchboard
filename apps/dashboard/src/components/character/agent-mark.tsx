import { cn } from "@/lib/utils";

export type AgentId = "alex" | "riley" | "jordan";
export type AgentMarkSize = "xs" | "sm" | "md" | "lg" | "xl";

export const SLUG_TO_AGENT: Record<string, AgentId> = {
  "speed-to-lead": "alex",
  "sales-closer": "riley",
  "nurture-specialist": "jordan",
};

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  alex: "Alex",
  riley: "Riley",
  jordan: "Jordan",
};

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

// ── Alex — Lead Qualifier ──
// Visual: alert, scanning. Motif: signal / radar lines.
// Form: angular trapezoid body (wider at shoulders), head slightly left of center.
function AlexMark() {
  return (
    <>
      {/* Head */}
      <circle cx="28" cy="18" r="10" fill="currentColor" />
      {/* Body — angular trapezoid, wider at top, alert stance */}
      <path d="M 17 31 L 40 31 L 37 57 L 20 57 Z" fill="currentColor" />
      {/* Signal rays — 3 lines radiating upper-right, suggesting scan/detection */}
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

// ── Riley — Sales Follow-Up ──
// Visual: grounded, forward-moving. Motif: arrow / momentum.
// Form: balanced rectangular body, centered. Right-pointing chevron.
function RileyMark() {
  return (
    <>
      {/* Head */}
      <circle cx="32" cy="18" r="10" fill="currentColor" />
      {/* Body — balanced rectangle, slight rounding */}
      <rect x="22" y="31" width="20" height="26" rx="2" fill="currentColor" />
      {/* Arrow — right-pointing chevron, right of body, suggesting momentum */}
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

// ── Jordan — Nurture Specialist ──
// Visual: calm, open, patient. Motif: wave / loop / return.
// Form: wider body with soft curved sides, wave integrated into bottom edge.
function JordanMark() {
  return (
    <>
      {/* Head — slightly larger, more open presence */}
      <circle cx="32" cy="17" r="11" fill="currentColor" />
      {/* Body — wider, curved sides, wave bottom suggesting loop/return */}
      <path
        d="M 18 31 C 14 39 15 51 20 56 Q 26 60 32 57 Q 38 60 44 56 C 49 51 50 39 46 31 Z"
        fill="currentColor"
      />
    </>
  );
}

export function AgentMark({ agent, size = "md", className, monochrome = false }: AgentMarkProps) {
  const px = SIZE_PX[size];
  const Mark = agent === "alex" ? AlexMark : agent === "riley" ? RileyMark : JordanMark;

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
