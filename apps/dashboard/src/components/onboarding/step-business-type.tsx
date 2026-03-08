"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SKIN_CATALOG } from "@/lib/skin-catalog";

interface StepBusinessTypeProps {
  businessName: string;
  onNameChange: (name: string) => void;
  selectedSkin: string;
  onSkinChange: (skinId: string) => void;
}

export function StepBusinessType({
  businessName,
  onNameChange,
  selectedSkin,
  onSkinChange,
}: StepBusinessTypeProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="business-name">What&apos;s your business called?</Label>
        <Input
          id="business-name"
          placeholder="e.g. Bright Smile Dental"
          value={businessName}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label>What type of business do you run?</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SKIN_CATALOG.map((skin) => {
            const Icon = skin.icon;
            const isSelected = selectedSkin === skin.id;
            return (
              <Card
                key={skin.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "hover:border-primary/30",
                )}
                onClick={() => onSkinChange(skin.id)}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div
                    className={cn(
                      "flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0",
                      isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{skin.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{skin.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
