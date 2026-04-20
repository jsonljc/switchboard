import { AgentMark } from "@/components/character/agent-mark";

export function PhoneScreenChoose() {
  return (
    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#9C958F",
          marginBottom: "0.25rem",
        }}
      >
        Choose your agent
      </p>
      {/* Alex — selected */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#F5F3F0",
          border: "1.5px solid #A07850",
          borderRadius: "0.75rem",
        }}
      >
        <AgentMark agent="alex" size="sm" />
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1A1714" }}>Alex</p>
          <p style={{ fontSize: "0.6875rem", color: "#6B6560" }}>Lead qualification & booking</p>
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.625rem",
            fontWeight: 600,
            color: "#A07850",
            background: "rgba(160,120,80,0.1)",
            borderRadius: "9999px",
            padding: "0.2rem 0.5rem",
          }}
        >
          Selected
        </span>
      </div>
      {/* Riley — coming soon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#F9F8F6",
          border: "1px solid #EDEAE5",
          borderRadius: "0.75rem",
          opacity: 0.5,
        }}
      >
        <AgentMark agent="riley" size="sm" />
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1A1714" }}>Riley</p>
          <p style={{ fontSize: "0.6875rem", color: "#9C958F" }}>Coming soon</p>
        </div>
      </div>
      {/* Jordan — coming soon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#F9F8F6",
          border: "1px solid #EDEAE5",
          borderRadius: "0.75rem",
          opacity: 0.5,
        }}
      >
        <AgentMark agent="jordan" size="sm" />
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1A1714" }}>Jordan</p>
          <p style={{ fontSize: "0.6875rem", color: "#9C958F" }}>Coming soon</p>
        </div>
      </div>
    </div>
  );
}
