"use client";

interface CampaignRow {
  name: string;
  spend: number | null;
  leads: number;
  payingPatients: number;
  revenue: number;
  costPerPatient: number | null;
}

interface CampaignTableProps {
  campaigns: CampaignRow[];
  currency?: string;
}

function fmt(v: number | null, prefix = "$"): string {
  if (v == null) return "\u2014";
  return `${prefix}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function CampaignTable({ campaigns, currency = "$" }: CampaignTableProps) {
  if (campaigns.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground italic">
        Campaign revenue data will appear once payments are recorded.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border/40">
            <th className="text-left py-2 font-medium text-muted-foreground">Campaign</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Spend</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Leads</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Paid</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Revenue</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Cost/Patient</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.name} className="border-b border-border/20">
              <td className="py-3 text-foreground font-medium">{c.name}</td>
              <td className="py-3 text-right text-muted-foreground">{fmt(c.spend, currency)}</td>
              <td className="py-3 text-right text-muted-foreground">{c.leads}</td>
              <td className="py-3 text-right text-foreground font-medium">{c.payingPatients}</td>
              <td className="py-3 text-right text-positive-foreground font-medium">
                {fmt(c.revenue, currency)}
              </td>
              <td className="py-3 text-right text-muted-foreground">
                {fmt(c.costPerPatient, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
