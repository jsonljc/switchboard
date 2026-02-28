"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

const commonForbiddenBehaviors = [
  // Payments
  "Never issue refunds without approval",
  "Never charge more than $1,000 in one action",
  "Never cancel subscriptions without approval",
  "Never batch-invoice more than 20 customers",
  "Never apply credits over $500",
  // Ads
  "Never delete campaigns",
  "Never delete ad groups",
  "Never delete ads",
  "Never create campaigns without approval",
  "Never modify targeting to exclude protected categories",
  // Generic
  "Never spend over $500 in one action",
  "Never modify billing settings",
  "Never change account access",
];

interface ForbiddenListProps {
  currentForbidden: string[];
  onSave: (forbidden: string[]) => void;
  isLoading?: boolean;
}

export function ForbiddenList({ currentForbidden, onSave, isLoading }: ForbiddenListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentForbidden));
  const [customInput, setCustomInput] = useState("");

  const toggle = (behavior: string) => {
    const next = new Set(selected);
    if (next.has(behavior)) {
      next.delete(behavior);
    } else {
      next.add(behavior);
    }
    setSelected(next);
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (trimmed && !selected.has(trimmed)) {
      const next = new Set(selected);
      next.add(trimmed);
      setSelected(next);
      setCustomInput("");
    }
  };

  const removeCustom = (behavior: string) => {
    const next = new Set(selected);
    next.delete(behavior);
    setSelected(next);
  };

  const customItems = Array.from(selected).filter(
    (b) => !commonForbiddenBehaviors.includes(b)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Forbidden Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {commonForbiddenBehaviors.map((behavior) => (
            <div key={behavior} className="flex items-center gap-3">
              <Checkbox
                id={behavior}
                checked={selected.has(behavior)}
                onCheckedChange={() => toggle(behavior)}
              />
              <Label htmlFor={behavior} className="text-sm cursor-pointer">
                {behavior}
              </Label>
            </div>
          ))}
        </div>

        {customItems.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground">Custom rules:</p>
            {customItems.map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="text-sm flex-1">{item}</span>
                <button
                  onClick={() => removeCustom(item)}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="Add custom rule..."
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustom())}
          />
          <Button variant="outline" size="icon" onClick={addCustom} className="shrink-0">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <Button
          className="w-full min-h-[44px]"
          disabled={isLoading}
          onClick={() => onSave(Array.from(selected))}
        >
          {isLoading ? "Saving..." : "Save Forbidden Actions"}
        </Button>
      </CardContent>
    </Card>
  );
}
