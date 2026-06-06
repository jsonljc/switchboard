import { type CSSProperties } from "react";

const block = "animate-pulse";
const blockStyle: CSSProperties = { background: "var(--canvas-3)", borderRadius: 10 };

/** Layout-matched skeleton for Mira's desk: header band, brief box, hero CTA,
 *  in-production tray, kept shelf (the real module order). Shared by the route shell. */
export function MiraDeskSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading Mira's desk"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div
          data-skeleton-block
          className={block}
          style={{ ...blockStyle, width: 44, height: 44, borderRadius: 12 }}
        />
        <div data-skeleton-block className={block} style={{ ...blockStyle, height: 36, flex: 1 }} />
      </div>
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 150 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 120 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 64 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 110 }} />
    </div>
  );
}
