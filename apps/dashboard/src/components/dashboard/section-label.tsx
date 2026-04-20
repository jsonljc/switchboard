interface SectionLabelProps {
  children: React.ReactNode;
}

export function SectionLabel({ children }: SectionLabelProps) {
  return (
    <h2
      style={{
        fontSize: "13px",
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--sw-text-muted)",
        margin: 0,
      }}
    >
      {children}
    </h2>
  );
}
