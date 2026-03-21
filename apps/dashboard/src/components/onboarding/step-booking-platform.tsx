"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Calendar, Clock, Link2 } from "lucide-react";

interface StepBookingPlatformProps {
  platform: string;
  onPlatformChange: (platform: string) => void;
  bookingUrl: string;
  onUrlChange: (url: string) => void;
}

const PLATFORMS = [
  {
    id: "calendly",
    label: "Calendly",
    icon: Calendar,
    description: "Popular scheduling tool",
  },
  {
    id: "fresha",
    label: "Fresha",
    icon: Clock,
    description: "For beauty & wellness",
  },
  {
    id: "custom",
    label: "Other / Custom",
    icon: Link2,
    description: "Any booking link",
  },
];

export function StepBookingPlatform({
  platform,
  onPlatformChange,
  bookingUrl,
  onUrlChange,
}: StepBookingPlatformProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Which booking platform do you use?</Label>
        <div className="grid grid-cols-1 gap-3">
          {PLATFORMS.map((p) => {
            const Icon = p.icon;
            const isSelected = platform === p.id;
            return (
              <Card
                key={p.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "hover:border-primary/30",
                )}
                onClick={() => onPlatformChange(p.id)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div
                    className={cn(
                      "flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0",
                      isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                  </div>
                  {isSelected && (
                    <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="booking-url">Booking link</Label>
        <Input
          id="booking-url"
          type="url"
          placeholder="https://calendly.com/your-link"
          value={bookingUrl}
          onChange={(e) => onUrlChange(e.target.value)}
        />
        <p className="text-[12px] text-muted-foreground">
          AI agents will share this link with qualified leads
        </p>
      </div>
    </div>
  );
}
