// apps/dashboard/src/components/cockpit/dot.tsx
import type { CSSProperties } from "react";

export interface DotProps {
  color: string;
  pulse?: boolean;
  size?: number;
}

export function Dot({ color, pulse, size = 7 }: DotProps) {
  const wrapStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    width: size,
    height: size,
  };
  const layerStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    background: color,
  };
  return (
    <span style={wrapStyle}>
      {pulse && <span style={{ ...layerStyle, animation: "ck-pulse 1.6s ease-out infinite" }} />}
      <span style={layerStyle} />
    </span>
  );
}
