interface BreakdownRow {
  name: string;
  leads: number;
  qualified: number;
  booked: number;
  revenue: number;
  bookingRate: string;
}

interface BreakdownTableProps {
  rows: BreakdownRow[];
}

export function BreakdownTable({ rows }: BreakdownTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2 font-medium">Name</th>
          <th className="pb-2 text-right font-medium">Leads</th>
          <th className="pb-2 text-right font-medium">Qualified</th>
          <th className="pb-2 text-right font-medium">Booked</th>
          <th className="pb-2 text-right font-medium">Revenue</th>
          <th className="pb-2 text-right font-medium">Book Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="py-8 text-center text-muted-foreground">
              No data for this period
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.name} className="border-b">
              <td className="py-2 font-medium">{row.name}</td>
              <td className="py-2 text-right tabular-nums">{row.leads}</td>
              <td className="py-2 text-right tabular-nums">{row.qualified}</td>
              <td className="py-2 text-right tabular-nums">{row.booked}</td>
              <td className="py-2 text-right tabular-nums">${row.revenue.toLocaleString()}</td>
              <td className="py-2 text-right tabular-nums">{row.bookingRate}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
