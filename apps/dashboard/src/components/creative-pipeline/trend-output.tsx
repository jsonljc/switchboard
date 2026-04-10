"use client";

import { TrendAnalysisOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";

interface TrendOutputProps {
  output: unknown;
}

export function TrendOutput({ output }: TrendOutputProps) {
  const parsed = TrendAnalysisOutput.safeParse(output);
  if (!parsed.success) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Unable to display formatted output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="space-y-6">
      {/* Angles */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Angles</h4>
        <div className="space-y-3">
          {data.angles.map((angle, i) => (
            <div key={i} className="rounded-lg border border-border/50 p-4 space-y-2">
              <p className="text-[14px] font-medium">{angle.theme}</p>
              <p className="text-[13px] text-muted-foreground">{angle.rationale}</p>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-[11px]">
                  {angle.motivator}
                </Badge>
                <Badge variant="secondary" className="text-[11px]">
                  {angle.platformFit}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audience Insights */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Audience Insights</h4>
        <div className="rounded-lg border border-border/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Awareness:</span>
            <Badge variant="outline" className="text-[11px] capitalize">
              {data.audienceInsights.awarenessLevel.replace(/_/g, " ")}
            </Badge>
          </div>
          <div>
            <p className="text-[13px] text-muted-foreground mb-1">Top Drivers</p>
            <ul className="list-disc list-inside text-[13px] space-y-0.5">
              {data.audienceInsights.topDrivers.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[13px] text-muted-foreground mb-1">Objections</p>
            <ul className="list-disc list-inside text-[13px] space-y-0.5">
              {data.audienceInsights.objections.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Trend Signals */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Trend Signals</h4>
        <div className="overflow-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-medium text-muted-foreground">Platform</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Trend</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Relevance</th>
              </tr>
            </thead>
            <tbody>
              {data.trendSignals.map((s, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 capitalize">{s.platform}</td>
                  <td className="py-2">{s.trend}</td>
                  <td className="py-2 text-muted-foreground">{s.relevance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
