import type { SparkPoint } from "@/lib/agent-home/types";

export function Sparkline({ data }: { data: readonly SparkPoint[] }) {
  if (data.length === 0) return null;

  const W = 640;
  const H = 80;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const span = max - min || 1;

  const pts = data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * W;
    const y = H - ((d.value - min) / span) * (H - 14) - 7;
    return { x, y };
  });

  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="sparkline"
    >
      <path
        d={path}
        stroke="hsl(20 10% 12%)"
        strokeWidth={1}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={3.5}
        fill="hsl(20 90% 55%)"
      />
    </svg>
  );
}
