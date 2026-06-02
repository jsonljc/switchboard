"use client";

import { useState } from "react";
import {
  useFieldArray,
  useFormContext,
  Controller,
  type Control,
  type UseFormRegister,
} from "react-hook-form";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BusinessFactsForm, emptyService } from "./scaffold";

interface ServicesSectionProps {
  control: Control<BusinessFactsForm>;
  register: UseFormRegister<BusinessFactsForm>;
}

export function ServicesSection({ control, register }: ServicesSectionProps) {
  const {
    formState: { errors },
  } = useFormContext<BusinessFactsForm>();
  const { fields, append, remove } = useFieldArray({ control, name: "services" });
  const [openAdvanced, setOpenAdvanced] = useState<Record<number, boolean>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Services</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {fields.map((field, i) => (
          <div key={field.id} className="space-y-3 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Service {i + 1}</span>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  aria-label="Remove service"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`services.${i}.name`}>Name</Label>
              <Input
                id={`services.${i}.name`}
                placeholder="e.g. Botox treatment"
                {...register(`services.${i}.name`)}
              />
              {errors.services?.[i]?.name && (
                <p className="text-xs text-destructive">{errors.services[i]?.name?.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`services.${i}.description`}>Description</Label>
              <Textarea
                id={`services.${i}.description`}
                placeholder="What this service involves"
                rows={2}
                {...register(`services.${i}.description`)}
              />
              {errors.services?.[i]?.description && (
                <p className="text-xs text-destructive">
                  {errors.services[i]?.description?.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`services.${i}.price`}>Price</Label>
                <Input
                  id={`services.${i}.price`}
                  placeholder="e.g. from $18/unit"
                  {...register(`services.${i}.price`)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`services.${i}.currency`}>Currency</Label>
                <Input
                  id={`services.${i}.currency`}
                  placeholder="SGD"
                  {...register(`services.${i}.currency`)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`services.${i}.durationMinutes`}>Duration (minutes)</Label>
              <Input
                id={`services.${i}.durationMinutes`}
                type="number"
                placeholder="e.g. 60"
                {...register(`services.${i}.durationMinutes`, {
                  setValueAs: (v) => {
                    const n = Number(v);
                    return v === "" || v === undefined || isNaN(n) ? undefined : n;
                  },
                })}
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
                  <Label>Booking behaviour</Label>
                  <Controller
                    control={control}
                    name={`services.${i}.bookingBehavior`}
                    render={({ field }) => (
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select booking behaviour" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="book_directly">Book directly</SelectItem>
                          <SelectItem value="consultation_only">Consultation only</SelectItem>
                          <SelectItem value="ask_first">Ask first</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Label htmlFor={`services.${i}.consultationRequired`}>
                    Consultation required
                  </Label>
                  <Controller
                    control={control}
                    name={`services.${i}.consultationRequired`}
                    render={({ field }) => (
                      <Switch
                        id={`services.${i}.consultationRequired`}
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`services.${i}.prepInstructions`}>Prep instructions</Label>
                  <Textarea
                    id={`services.${i}.prepInstructions`}
                    placeholder="What clients should do before the appointment"
                    rows={2}
                    {...register(`services.${i}.prepInstructions`)}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`services.${i}.aftercareNotes`}>Aftercare notes</Label>
                  <Textarea
                    id={`services.${i}.aftercareNotes`}
                    placeholder="Post-treatment care instructions"
                    rows={2}
                    {...register(`services.${i}.aftercareNotes`)}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`services.${i}.idealFor`}>Ideal for</Label>
                  <Input
                    id={`services.${i}.idealFor`}
                    placeholder="e.g. First-time clients, anti-ageing focus"
                    {...register(`services.${i}.idealFor`)}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`services.${i}.notSuitableFor`}>Not suitable for</Label>
                  <Input
                    id={`services.${i}.notSuitableFor`}
                    placeholder="e.g. Pregnant women, those on blood thinners"
                    {...register(`services.${i}.notSuitableFor`)}
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
          onClick={() => append(emptyService())}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add service
        </Button>
      </CardContent>
    </Card>
  );
}
