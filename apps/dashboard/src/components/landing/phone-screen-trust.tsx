export function PhoneScreenTrust() {
  return (
    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      {/* Conversation context */}
      <div style={{ background: "#F5F3F0", borderRadius: "0.75rem", padding: "0.75rem" }}>
        <p style={{ fontSize: "0.6875rem", color: "#9C958F", marginBottom: "0.25rem" }}>
          Latest conversation
        </p>
        <p style={{ fontSize: "0.8125rem", color: "#1A1714", lineHeight: 1.45 }}>
          Sarah asked about availability. Alex qualified her and found a match on Thursday.
        </p>
      </div>

      {/* Approval prompt */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1.5px solid #DDD9D3",
          borderRadius: "0.75rem",
          padding: "1rem",
          boxShadow: "0 2px 8px rgba(26,23,20,0.06)",
        }}
      >
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#A07850",
            marginBottom: "0.5rem",
          }}
        >
          Approval required
        </p>
        <p style={{ fontSize: "0.8125rem", color: "#1A1714", lineHeight: 1.45 }}>
          Alex wants to book Sarah for Thursday 2pm.
        </p>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <div
            style={{
              flex: 1,
              padding: "0.5rem",
              background: "#1A1714",
              color: "#F5F3F0",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Approve
          </div>
          <div
            style={{
              flex: 1,
              padding: "0.5rem",
              background: "#F5F3F0",
              border: "1px solid #DDD9D3",
              color: "#1A1714",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Edit
          </div>
        </div>
      </div>
    </div>
  );
}
