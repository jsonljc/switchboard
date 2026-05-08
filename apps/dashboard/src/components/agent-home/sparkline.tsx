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
    return { x, y, isProjection: d.isProjection === true };
  });

  const lastIsProjection = pts[pts.length - 1]!.isProjection;
  const solidPts = lastIsProjection ? pts.slice(0, -1) : pts;
  const solidPath = solidPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const dashedPath = lastIsProjection
    ? `M${pts[pts.length - 2]!.x.toFixed(1)} ${pts[pts.length - 2]!.y.toFixed(1)} L${pts[pts.length - 1]!.x.toFixed(1)} ${pts[pts.length - 1]!.y.toFixed(1)}`
    : null;

  const last = pts[pts.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="sparkline"
    >
      <path
        d={solidPath}
        stroke="hsl(20 10% 12%)"
        strokeWidth={1}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {dashedPath ? (
        <path
          d={dashedPath}
          stroke="hsl(20 10% 12%)"
          strokeWidth={1}
          fill="none"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {last.isProjection ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={3.5}
          fill="none"
          stroke="hsl(20 90% 55%)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      ) : (
        <circle cx={last.x} cy={last.y} r={3.5} fill="hsl(20 90% 55%)" />
      )}
    </svg>
  );
}
