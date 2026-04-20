import { FadeIn } from "@/components/ui/fade-in";

function TimestampVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.6875rem", color: "#9C958F" }}>11:47 PM</span>
        <span style={{ fontSize: "0.8125rem", color: "#6B6560" }}>
          Customer: &ldquo;Hi, are you available?&rdquo;
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.6875rem", color: "#A07850", fontWeight: 600 }}>11:47 PM</span>
        <span style={{ fontSize: "0.8125rem", color: "#1A1714", fontWeight: 600 }}>
          Alex: &ldquo;Hi! Yes — let me check for you.&rdquo;
        </span>
      </div>
    </div>
  );
}

function TimelineVisual() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      {[
        { label: "Day 1", sublabel: "Quote sent", active: false },
        { label: "Day 3", sublabel: "Follow-up", active: false },
        { label: "Day 5", sublabel: "Booked", active: true },
      ].map(({ label, sublabel, active }, i) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", gap: "0.375rem", flex: 1 }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.125rem",
            }}
          >
            <div
              style={{
                width: "0.625rem",
                height: "0.625rem",
                borderRadius: "9999px",
                background: active ? "#A07850" : "#DDD9D3",
              }}
            />
            <span
              style={{
                fontSize: "0.5625rem",
                fontWeight: 600,
                color: active ? "#A07850" : "#9C958F",
              }}
            >
              {label}
            </span>
            <span style={{ fontSize: "0.5rem", color: "#9C958F" }}>{sublabel}</span>
          </div>
          {i < 2 && <div style={{ flex: 1, height: "1px", background: "#DDD9D3" }} />}
        </div>
      ))}
    </div>
  );
}

function ApprovalVisual() {
  return (
    <div
      style={{
        background: "#F5F3F0",
        borderRadius: "0.5rem",
        padding: "0.625rem 0.75rem",
        border: "1px solid #EDEAE5",
      }}
    >
      <p style={{ fontSize: "0.75rem", color: "#1A1714", marginBottom: "0.375rem" }}>
        Alex wants to send a booking confirmation to Sarah.
      </p>
      <div style={{ display: "flex", gap: "0.375rem" }}>
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            background: "#1A1714",
            color: "#F5F3F0",
            borderRadius: "0.25rem",
            padding: "0.2rem 0.5rem",
          }}
        >
          Approve
        </span>
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            border: "1px solid #DDD9D3",
            color: "#1A1714",
            borderRadius: "0.25rem",
            padding: "0.2rem 0.5rem",
          }}
        >
          Edit
        </span>
      </div>
    </div>
  );
}

const CARDS = [
  {
    title: "Answers when you can't",
    copy: "After hours, weekends, or during busy periods — Alex keeps leads from sitting unanswered.",
    visual: <TimestampVisual />,
  },
  {
    title: "Follows up without dropping the ball",
    copy: "Quotes, reminders, and re-engagement happen on time instead of getting lost in the day.",
    visual: <TimelineVisual />,
  },
  {
    title: "Keeps you in control",
    copy: "Alex can start by asking before it books, tags, or follows up. You review less only when you want to.",
    visual: <ApprovalVisual />,
  },
];

export function TrustCards() {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: "1rem" }}>
        {CARDS.map(({ title, copy, visual }, i) => (
          <FadeIn key={title} delay={i * 80}>
            <div
              style={{
                background: "#F9F8F6",
                border: "1px solid #DDD9D3",
                borderRadius: "1rem",
                padding: "1.5rem",
              }}
            >
              <div style={{ marginBottom: "1.25rem" }}>{visual}</div>
              <h3
                style={{
                  fontSize: "1.0625rem",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: "#1A1714",
                  marginBottom: "0.5rem",
                }}
              >
                {title}
              </h3>
              <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#6B6560" }}>{copy}</p>
            </div>
          </FadeIn>
        ))}
      </div>

      {/* Governance line */}
      <p
        style={{
          marginTop: "3rem",
          fontSize: "0.875rem",
          color: "#9C958F",
          textAlign: "center",
        }}
      >
        Built on governed AI. Every action audited. Every decision reviewable.
      </p>
    </div>
  );
}
