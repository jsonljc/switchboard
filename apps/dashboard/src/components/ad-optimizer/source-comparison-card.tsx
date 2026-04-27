"use client";

export interface SourceComparisonRow {
  source: string;
  cpl: number | null;
  costPerQualified: number | null;
  costPerBooked: number | null;
  closeRate: number | null;
  trueRoas: number | null;
}

interface SourceComparisonCardProps {
  rows: SourceComparisonRow[];
}

const SOURCE_LABELS: Record<string, string> = {
  ctwa: "CTWA",
  instant_form: "Instant Form",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatRoas(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}×`;
}

export function SourceComparisonCard({ rows }: SourceComparisonCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-4">
        <p className="section-label">Source comparison</p>
        <h3 className="font-display text-2xl">Where leads convert best</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-normal">Source</th>
              <th className="py-2 pr-4 font-normal">CPL</th>
              <th className="py-2 pr-4 font-normal">Cost / Qualified</th>
              <th className="py-2 pr-4 font-normal">Cost / Booked</th>
              <th className="py-2 pr-4 font-normal">Close Rate</th>
              <th className="py-2 font-normal">True ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.source} className="border-b border-border/50 last:border-0">
                <td className="py-3 pr-4 font-medium">{sourceLabel(row.source)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatCurrency(row.cpl)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatCurrency(row.costPerQualified)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatCurrency(row.costPerBooked)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatPercent(row.closeRate)}</td>
                <td className="py-3 tabular-nums">{formatRoas(row.trueRoas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
