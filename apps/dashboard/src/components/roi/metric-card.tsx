interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
}

export function MetricCard({ label, value, subtext }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
    </div>
  );
}
