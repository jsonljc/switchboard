"use client";

import { useState } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BusinessFactsForm } from "./scaffold";

export function ContactPoliciesSection() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<BusinessFactsForm>();
  const [openPolicies, setOpenPolicies] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact &amp; escalation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="escalationContact.name">Contact name</Label>
          <Input
            id="escalationContact.name"
            placeholder="e.g. Front desk"
            {...register("escalationContact.name")}
          />
          {errors.escalationContact?.name && (
            <p className="text-xs text-destructive">{errors.escalationContact.name.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Preferred channel</Label>
          <Controller
            control={control}
            name="escalationContact.channel"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="escalationContact.address">Contact address</Label>
          <Input
            id="escalationContact.address"
            placeholder="Phone number, email, or username"
            {...register("escalationContact.address")}
          />
          {errors.escalationContact?.address && (
            <p className="text-xs text-destructive">{errors.escalationContact.address.message}</p>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => setOpenPolicies((prev) => !prev)}
        >
          {openPolicies ? "Hide booking policies" : "Booking policies"}
        </Button>

        {openPolicies && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="bookingPolicies.cancellationPolicy">Cancellation policy</Label>
              <Textarea
                id="bookingPolicies.cancellationPolicy"
                placeholder="e.g. 24-hour cancellation notice required"
                rows={2}
                {...register("bookingPolicies.cancellationPolicy")}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="bookingPolicies.reschedulePolicy">Reschedule policy</Label>
              <Textarea
                id="bookingPolicies.reschedulePolicy"
                placeholder="e.g. Reschedule up to 12 hours before"
                rows={2}
                {...register("bookingPolicies.reschedulePolicy")}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="bookingPolicies.noShowPolicy">No-show policy</Label>
              <Textarea
                id="bookingPolicies.noShowPolicy"
                placeholder="e.g. No-shows forfeit deposit"
                rows={2}
                {...register("bookingPolicies.noShowPolicy")}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="bookingPolicies.prepInstructions">Prep instructions</Label>
              <Textarea
                id="bookingPolicies.prepInstructions"
                placeholder="General prep instructions for all services"
                rows={2}
                {...register("bookingPolicies.prepInstructions")}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="bookingPolicies.advanceBookingDays">Advance booking (days)</Label>
              <Input
                id="bookingPolicies.advanceBookingDays"
                type="number"
                placeholder="e.g. 60"
                {...register("bookingPolicies.advanceBookingDays", {
                  setValueAs: (v) => {
                    const n = Number(v);
                    return v === "" || v === undefined || isNaN(n) ? undefined : n;
                  },
                })}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
