"use client";

import { useState } from "react";
import {
  INVENTORY_VALUES,
  OPERATING_STATUS_VALUES,
  STAFFING_VALUES,
  type OperationalState,
} from "@switchboard/schemas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  intervalDraftError,
  serializeOperationalStateForm,
  type OperationalStateFormModel,
} from "./form-model";
import { IntervalListEditor } from "./interval-list-editor";

/** Sentinel for the explicit "Not confirming" select item (Radix forbids empty-string values). */
const UNSET = "__not_confirming__";

const OPERATING_STATUS_LABELS: Record<(typeof OPERATING_STATUS_VALUES)[number], string> = {
  open: "Open",
  temporarily_closed: "Temporarily closed",
};
const STAFFING_LABELS: Record<(typeof STAFFING_VALUES)[number], string> = {
  normal: "Normal",
  shortfall: "Shortfall",
};
const INVENTORY_LABELS: Record<(typeof INVENTORY_VALUES)[number], string> = {
  normal: "Normal",
  outage: "Outage",
};

interface EnumDimensionProps<V extends string> {
  id: string;
  label: string;
  value: "" | V;
  values: readonly V[];
  labels: Record<V, string>;
  onChange: (value: "" | V) => void;
}

function EnumDimension<V extends string>({
  id,
  label,
  value,
  values,
  labels,
  onChange,
}: EnumDimensionProps<V>) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === "" ? undefined : value}
        onValueChange={(v) => onChange(v === UNSET ? "" : (v as V))}
      >
        <SelectTrigger id={id}>
          {/* HONESTY FLOOR: unset renders as "Not confirming", never a
              pre-checked "open"/"normal". */}
          <SelectValue placeholder="Not confirming" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>Not confirming</SelectItem>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {labels[v]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface OperationalStateFormProps {
  initial: OperationalStateFormModel;
  timezone: string;
  isSaving: boolean;
  onSubmit: (state: OperationalState) => void;
}

export function OperationalStateForm({
  initial,
  timezone,
  isSaving,
  onSubmit,
}: OperationalStateFormProps) {
  const [model, setModel] = useState<OperationalStateFormModel>(initial);

  const intervalsValid =
    (!model.confirmPromoWindows || model.promoWindows.every((d) => !intervalDraftError(d))) &&
    (!model.confirmClosures || model.closures.every((d) => !intervalDraftError(d)));
  const serialized = intervalsValid ? serializeOperationalStateForm(model, timezone) : null;
  const noteOnly = serialized === null && model.note.trim() !== "";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (serialized) onSubmit(serialized);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <EnumDimension
          id="operatingStatus"
          label="Operating status"
          value={model.operatingStatus}
          values={OPERATING_STATUS_VALUES}
          labels={OPERATING_STATUS_LABELS}
          onChange={(v) => setModel({ ...model, operatingStatus: v })}
        />
        <EnumDimension
          id="staffing"
          label="Staffing"
          value={model.staffing}
          values={STAFFING_VALUES}
          labels={STAFFING_LABELS}
          onChange={(v) => setModel({ ...model, staffing: v })}
        />
        <EnumDimension
          id="inventory"
          label="Inventory"
          value={model.inventory}
          values={INVENTORY_VALUES}
          labels={INVENTORY_LABELS}
          onChange={(v) => setModel({ ...model, inventory: v })}
        />
      </div>

      <IntervalListEditor
        idPrefix="promoWindows"
        confirmLabel="Confirm current promotions"
        noneNotice="You are confirming there are none active."
        addLabel="Add promotion"
        confirmed={model.confirmPromoWindows}
        drafts={model.promoWindows}
        onChange={(confirmed, drafts) =>
          setModel({ ...model, confirmPromoWindows: confirmed, promoWindows: drafts })
        }
      />

      <IntervalListEditor
        idPrefix="closures"
        confirmLabel="Confirm current closures"
        noneNotice="You are confirming there are none active."
        addLabel="Add closure"
        confirmed={model.confirmClosures}
        drafts={model.closures}
        onChange={(confirmed, drafts) =>
          setModel({ ...model, confirmClosures: confirmed, closures: drafts })
        }
      />

      <div className="space-y-1">
        <Label htmlFor="operational-note">Note (optional)</Label>
        <Textarea
          id="operational-note"
          placeholder="Context for this confirmation"
          value={model.note}
          onChange={(e) => setModel({ ...model, note: e.target.value })}
        />
        {noteOnly && (
          <p className="text-xs text-muted-foreground">
            A note alone is not a confirmation. Confirm at least one dimension above.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={serialized === null || isSaving}>
          Confirm operational state
        </Button>
      </div>
    </form>
  );
}
