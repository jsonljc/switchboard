const block = "animate-pulse";
const blockStyle: React.CSSProperties = { background: "var(--canvas-3)", borderRadius: 10 };

/** Layout-matched skeleton for Mira's desk (hero CTA + in-production tray rows). Shared by the route shell. */
export function MiraDeskSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading Mira's desk"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}
    >
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 96 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 64 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 64 }} />
    </div>
  );
}
