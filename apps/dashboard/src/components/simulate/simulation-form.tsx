"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CartridgeManifest } from "@switchboard/schemas";

interface SimulationFormProps {
  cartridges: CartridgeManifest[];
  defaultPrincipalId: string;
  isLoading: boolean;
  onSubmit: (data: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
  }) => void;
}

export function SimulationForm({
  cartridges,
  defaultPrincipalId,
  isLoading,
  onSubmit,
}: SimulationFormProps) {
  const [actionType, setActionType] = useState("");
  const [parametersText, setParametersText] = useState("{}");
  const [principalId, setPrincipalId] = useState(defaultPrincipalId);
  const [cartridgeId, setCartridgeId] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  // When action type is selected, auto-fill cartridgeId and parameters template
  useEffect(() => {
    if (!actionType) return;

    for (const c of cartridges) {
      const action = c.actions.find((a) => a.actionType === actionType);
      if (action) {
        setCartridgeId(c.id);
        // Generate template from parametersSchema
        const schema = action.parametersSchema;
        if (schema && typeof schema === "object" && "properties" in schema) {
          const props = schema.properties as Record<string, { type?: string; default?: unknown }>;
          const template: Record<string, unknown> = {};
          for (const [key, def] of Object.entries(props)) {
            if (def.default !== undefined) {
              template[key] = def.default;
            } else if (def.type === "number") {
              template[key] = 0;
            } else if (def.type === "string") {
              template[key] = "";
            } else if (def.type === "boolean") {
              template[key] = false;
            } else {
              template[key] = null;
            }
          }
          setParametersText(JSON.stringify(template, null, 2));
        } else {
          setParametersText("{}");
        }
        break;
      }
    }
  }, [actionType, cartridges]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParseError(null);

    let parameters: Record<string, unknown>;
    try {
      parameters = JSON.parse(parametersText);
    } catch {
      setParseError("Invalid JSON in parameters field");
      return;
    }

    onSubmit({ actionType, parameters, principalId, cartridgeId });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="action-type">Action Type</Label>
        <Select value={actionType} onValueChange={setActionType}>
          <SelectTrigger id="action-type">
            <SelectValue placeholder="Select an action..." />
          </SelectTrigger>
          <SelectContent>
            {cartridges.map((c) => (
              <SelectGroup key={c.id}>
                <SelectLabel>{c.name}</SelectLabel>
                {c.actions.map((action) => (
                  <SelectItem key={action.actionType} value={action.actionType}>
                    {action.name}
                    <span className="ml-1 text-muted-foreground text-xs">
                      ({action.actionType})
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="parameters">Parameters (JSON)</Label>
        <textarea
          id="parameters"
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
          value={parametersText}
          onChange={(e) => {
            setParametersText(e.target.value);
            setParseError(null);
          }}
        />
        {parseError && (
          <p className="text-sm text-destructive">{parseError}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cartridge">Cartridge</Label>
        <Input
          id="cartridge"
          value={cartridgeId}
          readOnly
          className="bg-muted text-muted-foreground"
          placeholder="Auto-filled from action type"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="principal-id">Principal ID</Label>
        <Input
          id="principal-id"
          value={principalId}
          onChange={(e) => setPrincipalId(e.target.value)}
          placeholder="e.g. agent-001"
        />
      </div>

      <Button
        type="submit"
        disabled={isLoading || !actionType || !principalId}
        className="w-full"
      >
        {isLoading ? "Simulating..." : "Run Simulation"}
      </Button>
    </form>
  );
}
