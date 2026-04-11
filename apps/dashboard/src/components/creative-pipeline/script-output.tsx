"use client";

import { ScriptWriterOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";

const SECTION_COLORS: Record<string, string> = {
  hook: "border-l-red-500",
  problem: "border-l-orange-500",
  solution: "border-l-green-500",
  proof: "border-l-blue-500",
  cta: "border-l-purple-500",
};

interface ScriptOutputProps {
  output: unknown;
}

export function ScriptOutput({ output }: ScriptOutputProps) {
  const parsed = ScriptWriterOutput.safeParse(output);
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
      {data.scripts.map((script, i) => (
        <div key={i} className="rounded-lg border border-border/50 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {script.format.replace(/_/g, " ")}
            </Badge>
            <Badge variant="secondary" className="text-[11px] capitalize">
              {script.platform}
            </Badge>
          </div>
          <p className="text-[13px] whitespace-pre-wrap">{script.fullScript}</p>
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-muted-foreground">Timing</p>
            {script.timing.map((t, j) => (
              <div
                key={j}
                className={`border-l-2 pl-3 py-1 ${SECTION_COLORS[t.section] ?? "border-l-border"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium capitalize">{t.section}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t.startSec}s - {t.endSec}s
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground">{t.content}</p>
              </div>
            ))}
          </div>
          {script.productionNotes && (
            <div>
              <p className="text-[12px] font-medium text-muted-foreground mb-1">Production Notes</p>
              <p className="text-[12px] text-muted-foreground">{script.productionNotes}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
