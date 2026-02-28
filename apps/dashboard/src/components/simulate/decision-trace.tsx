"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Check,
  Minus,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Gauge,
} from "lucide-react";
import type { SimulateResult } from "@/lib/api-client";

interface DecisionTraceProps {
  result: SimulateResult;
}

const decisionConfig = {
  allow: { label: "Allowed", variant: "default" as const, Icon: ShieldCheck, className: "bg-green-600 hover:bg-green-700" },
  deny: { label: "Denied", variant: "destructive" as const, Icon: ShieldAlert, className: "" },
  modify: { label: "Modified", variant: "secondary" as const, Icon: ShieldQuestion, className: "bg-yellow-600 hover:bg-yellow-700" },
};

const effectColors: Record<string, string> = {
  allow: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  deny: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  modify: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  skip: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  escalate: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const riskCategoryColors: Record<string, string> = {
  none: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function DecisionTrace({ result }: DecisionTraceProps) {
  const { decisionTrace, explanation, approvalRequired } = result;
  const { finalDecision, computedRiskScore, checks } = decisionTrace;

  const config = decisionConfig[finalDecision as keyof typeof decisionConfig] ?? decisionConfig.modify;
  const DecisionIcon = config.Icon;

  return (
    <div className="space-y-4">
      {/* Decision banner */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <DecisionIcon className="h-6 w-6 mt-0.5 shrink-0" />
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={config.className} variant={config.variant}>
                  {config.label}
                </Badge>
                {approvalRequired !== "none" && (
                  <Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-300">
                    Approval: {approvalRequired}
                  </Badge>
                )}
                {result.wouldExecute && (
                  <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-300">
                    Would Execute
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{explanation}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk score */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Risk Score
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge className={riskCategoryColors[computedRiskScore.category] ?? ""}>
              {computedRiskScore.category}
            </Badge>
            <span className="text-sm font-mono">
              {Math.round(computedRiskScore.rawScore)}%
            </span>
          </div>
          {computedRiskScore.factors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Factors</p>
              {computedRiskScore.factors.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span>{f.detail || f.factor}</span>
                  <span className="font-mono text-muted-foreground">
                    +{f.contribution.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Checks list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Evaluation Checks ({checks.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {checks.map((check, i) => (
            <CheckRow key={i} check={check} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CheckRow({
  check,
}: {
  check: SimulateResult["decisionTrace"]["checks"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasData = Object.keys(check.checkData).length > 0;

  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-start gap-2">
        {check.matched ? (
          <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
        ) : (
          <Minus className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm">{check.humanDetail}</span>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${effectColors[check.effect] ?? ""}`}
            >
              {check.effect}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {check.checkCode}
          </p>
        </div>
        {hasData && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
      {expanded && hasData && (
        <pre className="mt-2 rounded bg-muted p-2 text-xs overflow-x-auto font-mono">
          {JSON.stringify(check.checkData, null, 2)}
        </pre>
      )}
    </div>
  );
}
