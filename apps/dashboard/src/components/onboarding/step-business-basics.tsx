"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SKIN_CATALOG } from "@/lib/skin-catalog";

interface StepBusinessBasicsProps {
  vertical: string;
  onVerticalChange: (v: string) => void;
  businessName: string;
  onNameChange: (name: string) => void;
  services: string;
  onServicesChange: (services: string) => void;
  targetCustomer: string;
  onTargetCustomerChange: (target: string) => void;
  pricingRange: string;
  onPricingRangeChange: (range: string) => void;
}

const VERTICAL_HINTS = {
  clinic: {
    services: "e.g. Botox, Fillers, Facials, Laser",
    target: "e.g. Women 25-45 interested in anti-aging",
    pricing: "e.g. $200 - $800 per treatment",
  },
  gym: {
    services: "e.g. Personal Training, Group Classes, Yoga",
    target: "e.g. Fitness enthusiasts ages 20-50",
    pricing: "e.g. $50 - $200/month membership",
  },
  commerce: {
    services: "e.g. Skincare, Supplements, Accessories",
    target: "e.g. Health-conscious consumers 25-45",
    pricing: "e.g. $20 - $150 per product",
  },
  generic: {
    services: "e.g. Consulting, Coaching, Design",
    target: "e.g. Small business owners",
    pricing: "e.g. $100 - $500 per session",
  },
};

export function StepBusinessBasics({
  vertical,
  onVerticalChange,
  businessName,
  onNameChange,
  services,
  onServicesChange,
  targetCustomer,
  onTargetCustomerChange,
  pricingRange,
  onPricingRangeChange,
}: StepBusinessBasicsProps) {
  const hints = VERTICAL_HINTS[vertical as keyof typeof VERTICAL_HINTS] || VERTICAL_HINTS.generic;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>What type of business do you run?</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SKIN_CATALOG.map((skin) => {
            const Icon = skin.icon;
            const isSelected = vertical === skin.id;
            return (
              <Card
                key={skin.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "hover:border-primary/30",
                )}
                onClick={() => onVerticalChange(skin.id)}
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

      <div className="space-y-2">
        <Label htmlFor="business-name">Business name</Label>
        <Input
          id="business-name"
          placeholder="e.g. Radiance Med Spa"
          value={businessName}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="services">Services or products you offer</Label>
        <Input
          id="services"
          placeholder={hints.services}
          value={services}
          onChange={(e) => onServicesChange(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="target-customer">Who are your ideal customers?</Label>
        <Input
          id="target-customer"
          placeholder={hints.target}
          value={targetCustomer}
          onChange={(e) => onTargetCustomerChange(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pricing-range">Typical pricing range</Label>
        <Input
          id="pricing-range"
          placeholder={hints.pricing}
          value={pricingRange}
          onChange={(e) => onPricingRangeChange(e.target.value)}
        />
      </div>
    </div>
  );
}
