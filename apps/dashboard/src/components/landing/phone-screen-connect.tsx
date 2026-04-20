export function PhoneScreenConnect() {
  const channels = [
    { name: "WhatsApp", connected: true },
    { name: "Telegram", connected: false },
    { name: "Web widget", connected: false },
  ];

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
        Connect a channel
      </p>
      {channels.map(({ name, connected }) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            background: connected ? "#F5F3F0" : "#F9F8F6",
            border: `1px solid ${connected ? "#A07850" : "#EDEAE5"}`,
            borderRadius: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#1A1714" }}>{name}</span>
          {connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "9999px",
                  background: "#4CAF50",
                }}
              />
              <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#4CAF50" }}>
                Connected
              </span>
            </div>
          ) : (
            <span style={{ fontSize: "0.6875rem", color: "#9C958F" }}>Connect →</span>
          )}
        </div>
      ))}
    </div>
  );
}
