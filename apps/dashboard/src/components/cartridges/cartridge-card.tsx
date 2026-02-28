"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Undo2, ArrowRightLeft } from "lucide-react";
import type { CartridgeManifest } from "@switchboard/schemas";

interface CartridgeCardProps {
  cartridge: CartridgeManifest;
}

const riskCategoryColors: Record<string, string> = {
  none: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function CartridgeCard({ cartridge }: CartridgeCardProps) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-lg">{cartridge.name}</CardTitle>
          <Badge variant="outline" className="font-mono text-xs">
            v{cartridge.version}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{cartridge.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Actions */}
        <div>
          <h4 className="text-sm font-medium mb-2">
            Actions ({cartridge.actions.length})
          </h4>
          <div className="space-y-2">
            {cartridge.actions.map((action) => (
              <div
                key={action.actionType}
                className="rounded-md border p-3 space-y-1.5"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{action.name}</span>
                  <Badge
                    className={riskCategoryColors[action.baseRiskCategory] ?? ""}
                  >
                    {action.baseRiskCategory}
                  </Badge>
                  {action.reversible && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Undo2 className="h-3 w-3" />
                      reversible
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {action.description}
                </p>
                <div className="flex items-center gap-1">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {action.actionType}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => copyToClipboard(action.actionType)}
                    title="Copy action type"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Required connections */}
        {cartridge.requiredConnections.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Required Connections
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {cartridge.requiredConnections.map((conn) => (
                <Badge key={conn} variant="outline" className="text-xs">
                  {conn}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Default policies */}
        {cartridge.defaultPolicies.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1.5">Default Policies</h4>
            <div className="flex flex-wrap gap-1.5">
              {cartridge.defaultPolicies.map((policy) => (
                <Badge key={policy} variant="secondary" className="text-xs">
                  {policy}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
