"use client";

import { useState } from "react";
import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { type BusinessFactsForm, emptyLocation } from "./scaffold";

interface LocationsSectionProps {
  control: Control<BusinessFactsForm>;
  register: UseFormRegister<BusinessFactsForm>;
  errors?: BusinessFactsForm["locations"];
}

export function LocationsSection({ control, register }: LocationsSectionProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "locations" });
  const [openAdvanced, setOpenAdvanced] = useState<Record<number, boolean>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Locations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {fields.map((field, i) => (
          <div key={field.id} className="space-y-3 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Location {i + 1}</span>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  aria-label="Remove location"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`locations.${i}.name`}>Name</Label>
              <Input
                id={`locations.${i}.name`}
                placeholder="e.g. Orchard Branch"
                {...register(`locations.${i}.name`)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`locations.${i}.address`}>Address</Label>
              <Textarea
                id={`locations.${i}.address`}
                placeholder="Full address"
                rows={2}
                {...register(`locations.${i}.address`)}
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setOpenAdvanced((prev) => ({ ...prev, [i]: !prev[i] }))}
            >
              {openAdvanced[i] ? "Hide details" : "More details"}
            </Button>

            {openAdvanced[i] && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor={`locations.${i}.parkingNotes`}>Parking notes</Label>
                  <Textarea
                    id={`locations.${i}.parkingNotes`}
                    placeholder="e.g. Free parking at basement"
                    rows={2}
                    {...register(`locations.${i}.parkingNotes`)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`locations.${i}.accessNotes`}>Access notes</Label>
                  <Textarea
                    id={`locations.${i}.accessNotes`}
                    placeholder="e.g. Enter via side entrance"
                    rows={2}
                    {...register(`locations.${i}.accessNotes`)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append(emptyLocation())}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add location
        </Button>
      </CardContent>
    </Card>
  );
}
