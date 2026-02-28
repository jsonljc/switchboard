"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Pencil, Trash2 } from "lucide-react";
import type { Policy } from "@switchboard/schemas";

interface PolicyCardProps {
  policy: Policy;
  onEdit: (policy: Policy) => void;
  onDelete: (policy: Policy) => void;
  onToggleActive: (policy: Policy) => void;
  disabled?: boolean;
}

const effectBadgeVariant = (effect: string) => {
  switch (effect) {
    case "deny":
      return "destructive" as const;
    case "require_approval":
      return "secondary" as const;
    case "modify":
      return "outline" as const;
    default:
      return "default" as const;
  }
};

export function PolicyCard({ policy, onEdit, onDelete, onToggleActive, disabled }: PolicyCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{policy.name}</p>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {policy.description}
            </p>
          </div>
          <Switch
            checked={policy.active}
            onCheckedChange={() => onToggleActive(policy)}
            disabled={disabled}
            aria-label={`Toggle ${policy.name} active`}
          />
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Badge variant={effectBadgeVariant(policy.effect)}>
            {policy.effect.replace("_", " ")}
          </Badge>
          <Badge variant="outline">priority {policy.priority}</Badge>
          {policy.cartridgeId && (
            <Badge variant="outline">{policy.cartridgeId}</Badge>
          )}
        </div>
        <div className="flex gap-2 mt-3 justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEdit(policy)}
            disabled={disabled}
            className="min-h-[44px]"
          >
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDelete(policy)}
            disabled={disabled}
            className="min-h-[44px] text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
