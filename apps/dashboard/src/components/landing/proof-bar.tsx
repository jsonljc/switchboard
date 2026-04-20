import { FadeIn } from "@/components/ui/fade-in";

const PROOF_POINTS = [
  {
    metric: "Seconds",
    label: "Designed for instant first response",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#A07850" strokeWidth="1.5" />
        <line
          x1="10"
          y1="5"
          x2="10"
          y2="10"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="10"
          y1="10"
          x2="14"
          y2="12"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    metric: "24/7",
    label: "Lead coverage across your channels",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="4" fill="#A07850" opacity="0.3" />
        <circle cx="10" cy="10" r="8" stroke="#A07850" strokeWidth="1.5" opacity="0.6" />
        <circle cx="10" cy="10" r="4" stroke="#A07850" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    metric: "Approval-first",
    label: "Every action can start supervised",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 2L12.5 7H17.5L13.5 10.5L15 16L10 12.5L5 16L6.5 10.5L2.5 7H7.5L10 2Z"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M7 10l2 2 4-4"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    metric: "WhatsApp · Telegram · Web",
    label: "Deploy where leads already come in",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="#A07850" strokeWidth="1.5" />
        <path d="M3 8h14" stroke="#A07850" strokeWidth="1.5" />
      </svg>
    ),
  },
];

export function ProofBar() {
  return (
    <FadeIn>
      <div
        className="grid grid-cols-2 md:grid-cols-4"
        style={{ gap: "1.5rem", paddingTop: "3rem", paddingBottom: "3rem" }}
      >
        {PROOF_POINTS.map(({ metric, label, icon }) => (
          <div key={metric} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <div
              style={{
                width: "2.5rem",
                height: "2.5rem",
                borderRadius: "0.75rem",
                background: "rgba(160,120,80,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1A1714" }}>{metric}</p>
              <p style={{ fontSize: "0.75rem", color: "#6B6560", lineHeight: 1.45 }}>{label}</p>
            </div>
          </div>
        ))}
      </div>
    </FadeIn>
  );
}
