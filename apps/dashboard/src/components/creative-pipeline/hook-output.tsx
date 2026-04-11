"use client";

import { HookGeneratorOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";

interface HookOutputProps {
  output: unknown;
}

export function HookOutput({ output }: HookOutputProps) {
  const parsed = HookGeneratorOutput.safeParse(output);
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
      <div>
        <h4 className="text-[14px] font-medium mb-3">Hooks</h4>
        <div className="space-y-3">
          {data.hooks.map((hook, i) => (
            <div key={i} className="rounded-lg border border-border/50 p-4 space-y-2">
              <p className="text-[14px]">&ldquo;{hook.text}&rdquo;</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] capitalize">
                  {hook.type.replace(/_/g, " ")}
                </Badge>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${hook.platformScore * 10}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{hook.platformScore}/10</span>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">{hook.rationale}</p>
            </div>
          ))}
        </div>
      </div>

      {data.topCombos.length > 0 && (
        <div>
          <h4 className="text-[14px] font-medium mb-3">Top Combos</h4>
          <div className="space-y-2">
            {data.topCombos.map((combo, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
              >
                <span className="text-[13px]">
                  Angle &ldquo;{combo.angleRef}&rdquo; + Hook &ldquo;{combo.hookRef}&rdquo;
                </span>
                <Badge variant="secondary" className="text-[11px]">
                  {combo.score}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
