"use client";

import { useCartridges } from "@/hooks/use-cartridges";

interface StepCartridgeProps {
  selected: string;
  onChange: (value: string) => void;
}

export function StepCartridge({ selected, onChange }: StepCartridgeProps) {
  const { data, isLoading } = useCartridges();
  const cartridges = data?.cartridges ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (cartridges.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No cartridges available. Cartridges define the actions your AI agent can take.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        Choose a domain cartridge that defines what actions your AI agent can perform.
      </p>
      {cartridges.map((cart) => (
        <button
          key={cart.id}
          onClick={() => onChange(cart.id)}
          className={`w-full text-left p-4 rounded-lg border transition-colors ${
            selected === cart.id
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">{cart.name}</span>
            <span className="text-xs text-muted-foreground">v{cart.version}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {cart.description}
          </p>
          {cart.actions && (
            <p className="text-xs text-muted-foreground mt-1">
              {cart.actions.length} action{cart.actions.length === 1 ? "" : "s"} available
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
