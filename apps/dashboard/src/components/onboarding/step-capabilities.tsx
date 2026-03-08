"use client";

import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Megaphone, MessageSquare, Users, Calendar, CreditCard, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface CapabilityItem {
  id: string;
  label: string;
  description: string;
  category: string;
}

interface CategoryMeta {
  label: string;
  icon: LucideIcon;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  ads: { label: "Ad Management", icon: Megaphone },
  engagement: { label: "Lead Response", icon: MessageSquare },
  crm: { label: "Customer Management", icon: Users },
  appointments: { label: "Appointments", icon: Calendar },
  payments: { label: "Payments", icon: CreditCard },
  analytics: { label: "Analytics", icon: BarChart3 },
};

const CARTRIDGE_CAPABILITIES: Record<string, CapabilityItem[]> = {
  "digital-ads": [
    {
      id: "campaign-management",
      label: "Campaign Management",
      description: "Create, pause, and adjust ad campaigns.",
      category: "ads",
    },
    {
      id: "budget-optimization",
      label: "Budget Optimization",
      description: "Automatically reallocate spend to top-performing ads.",
      category: "ads",
    },
    {
      id: "performance-monitoring",
      label: "Performance Monitoring",
      description: "Track metrics and alert you to anomalies.",
      category: "analytics",
    },
  ],
  "customer-engagement": [
    {
      id: "lead-response",
      label: "Lead Response",
      description: "Automatically reply to new leads on your channels.",
      category: "engagement",
    },
    {
      id: "lead-qualification",
      label: "Lead Qualification",
      description: "Score and qualify leads based on their responses.",
      category: "engagement",
    },
    {
      id: "follow-up",
      label: "Follow-up Sequences",
      description: "Send automated follow-up messages to nurture leads.",
      category: "engagement",
    },
  ],
  crm: [
    {
      id: "contact-management",
      label: "Contact Management",
      description: "Organize and track all your contacts in one place.",
      category: "crm",
    },
    {
      id: "deal-tracking",
      label: "Deal Tracking",
      description: "Track deals through your sales pipeline.",
      category: "crm",
    },
  ],
  payments: [
    {
      id: "payment-processing",
      label: "Payment Processing",
      description: "Accept and manage payments from customers.",
      category: "payments",
    },
    {
      id: "invoice-management",
      label: "Invoice Management",
      description: "Create and send invoices automatically.",
      category: "payments",
    },
  ],
};

interface StepCapabilitiesProps {
  requiredCartridges: string[];
  selectedCapabilities: string[];
  onCapabilitiesChange: (capabilities: string[]) => void;
}

export function StepCapabilities({
  requiredCartridges,
  selectedCapabilities,
  onCapabilitiesChange,
}: StepCapabilitiesProps) {
  // Gather capabilities from the skin's required cartridges
  const capabilities: CapabilityItem[] = [];
  for (const cartridgeId of requiredCartridges) {
    const items = CARTRIDGE_CAPABILITIES[cartridgeId];
    if (items) {
      capabilities.push(...items);
    }
  }

  // Group by category
  const grouped = new Map<string, CapabilityItem[]>();
  for (const cap of capabilities) {
    const group = grouped.get(cap.category) ?? [];
    group.push(cap);
    grouped.set(cap.category, group);
  }

  const handleToggle = (capId: string) => {
    if (selectedCapabilities.includes(capId)) {
      onCapabilitiesChange(selectedCapabilities.filter((id) => id !== capId));
    } else {
      onCapabilitiesChange([...selectedCapabilities, capId]);
    }
  };

  const handleSelectAll = () => {
    const allIds = capabilities.map((c) => c.id);
    if (selectedCapabilities.length === allIds.length) {
      onCapabilitiesChange([]);
    } else {
      onCapabilitiesChange(allIds);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>What should your AI team handle?</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Select the capabilities you want to enable. You can change these later.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-xs text-primary hover:underline"
        >
          {selectedCapabilities.length === capabilities.length ? "Deselect all" : "Select all"}
        </button>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([category, items]) => {
          const meta = CATEGORY_META[category];
          const Icon = meta?.icon ?? BarChart3;
          return (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{meta?.label ?? category}</span>
              </div>
              <div className="space-y-2">
                {items.map((cap) => {
                  const isSelected = selectedCapabilities.includes(cap.id);
                  return (
                    <Card
                      key={cap.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected ? "border-primary/50 bg-primary/5" : "hover:border-primary/20",
                      )}
                      onClick={() => handleToggle(cap.id)}
                    >
                      <CardContent className="p-3 flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggle(cap.id)}
                          className="mt-0.5"
                        />
                        <div>
                          <p className="text-sm font-medium">{cap.label}</p>
                          <p className="text-xs text-muted-foreground">{cap.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
