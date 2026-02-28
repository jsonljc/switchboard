"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

interface IntegrationStep {
  title: string;
  description: string;
  code?: string;
  language?: string;
}

interface IntegrationGuide {
  runtimeType: string;
  title: string;
  description: string;
  steps: IntegrationStep[];
}

interface StepIntegrationProps {
  guide: IntegrationGuide | null;
  isLoading?: boolean;
  runtimeType: string;
  onRuntimeChange?: (type: string) => void;
}

const runtimeTabs = [
  { value: "openclaw", label: "OpenClaw" },
  { value: "mcp", label: "MCP (Claude/Cursor)" },
  { value: "http", label: "HTTP API" },
];

export function StepIntegration({ guide, isLoading, runtimeType, onRuntimeChange }: StepIntegrationProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onRuntimeChange && (
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {runtimeTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onRuntimeChange(tab.value)}
              className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                runtimeType === tab.value
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {guide && (
        <>
          <p className="text-sm text-muted-foreground">{guide.description}</p>
          <div className="space-y-4">
            {guide.steps.map((step, i) => (
              <Card key={i} className="border-muted">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                      {i + 1}
                    </span>
                    {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                  {step.code && (
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto max-h-64">
                        <code>{step.code}</code>
                      </pre>
                      <Button
                        variant="outline"
                        size="sm"
                        className="absolute top-2 right-2 h-7 text-xs"
                        onClick={() => handleCopy(step.code!, i)}
                      >
                        {copiedIndex === i ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Copied
                          </span>
                        ) : (
                          "Copy"
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
