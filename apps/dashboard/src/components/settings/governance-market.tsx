"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Jurisdiction, ClinicType } from "@switchboard/schemas";

const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  SG: "Singapore (SG)",
  MY: "Malaysia (MY)",
};
const CLINIC_TYPE_LABELS: Record<ClinicType, string> = {
  medical: "Medical",
  nonMedical: "Non-medical",
};
/** Currency follows jurisdiction (the single source — see currencyForJurisdiction). */
const CURRENCY_FOR: Record<Jurisdiction, string> = { SG: "SGD", MY: "MYR" };

export function GovernanceMarket({
  current,
  pending,
  onSave,
}: {
  current: { jurisdiction: Jurisdiction | null; clinicType: ClinicType | null };
  pending: boolean;
  onSave: (jurisdiction: Jurisdiction, clinicType: ClinicType) => void;
}) {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(current.jurisdiction ?? "SG");
  const [clinicType, setClinicType] = useState<ClinicType>(current.clinicType ?? "medical");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Card data-testid="governance-market">
      <CardHeader>
        <CardTitle className="text-base">Market</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The clinic&apos;s market sets the currency Alex quotes and charges (
          {CURRENCY_FOR[jurisdiction]}) and the regulatory ruleset its safety gates apply.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1 space-y-1">
            <Label htmlFor="market-jurisdiction">Jurisdiction</Label>
            <Select value={jurisdiction} onValueChange={(v) => setJurisdiction(v as Jurisdiction)}>
              <SelectTrigger id="market-jurisdiction">
                <SelectValue placeholder="Select jurisdiction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SG">{JURISDICTION_LABELS.SG}</SelectItem>
                <SelectItem value="MY">{JURISDICTION_LABELS.MY}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="market-clinic-type">Clinic type</Label>
            <Select value={clinicType} onValueChange={(v) => setClinicType(v as ClinicType)}>
              <SelectTrigger id="market-clinic-type">
                <SelectValue placeholder="Select clinic type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="medical">{CLINIC_TYPE_LABELS.medical}</SelectItem>
                <SelectItem value="nonMedical">{CLINIC_TYPE_LABELS.nonMedical}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button disabled={pending} onClick={() => setConfirmOpen(true)}>
          Save market
        </Button>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Set market to {JURISDICTION_LABELS[jurisdiction]} / {CLINIC_TYPE_LABELS[clinicType]}?
            </DialogTitle>
            <DialogDescription>
              Alex will quote and charge in {CURRENCY_FOR[jurisdiction]} and apply the{" "}
              {JURISDICTION_LABELS[jurisdiction]} regulatory ruleset. This is reversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-market"
              onClick={() => {
                onSave(jurisdiction, clinicType);
                setConfirmOpen(false);
              }}
            >
              Set market
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
