"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emptyIntervalDraft, intervalDraftError, type IntervalDraft } from "./form-model";

interface IntervalListEditorProps {
  idPrefix: string;
  confirmLabel: string;
  noneNotice: string;
  addLabel: string;
  confirmed: boolean;
  drafts: IntervalDraft[];
  onChange: (confirmed: boolean, drafts: IntervalDraft[]) => void;
}

/**
 * Confirm-toggled interval list. Unchecked = the operator is NOT confirming
 * this dimension (absent from the payload); checked with zero rows = an
 * explicit "none active" ([]); checked with rows = the windows, entered as
 * inclusive local dates.
 */
export function IntervalListEditor({
  idPrefix,
  confirmLabel,
  noneNotice,
  addLabel,
  confirmed,
  drafts,
  onChange,
}: IntervalListEditorProps) {
  const updateDraft = (index: number, patch: Partial<IntervalDraft>) => {
    onChange(
      confirmed,
      drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idPrefix}-confirm`}
          checked={confirmed}
          onCheckedChange={(checked) => onChange(checked === true, drafts)}
        />
        <Label htmlFor={`${idPrefix}-confirm`}>{confirmLabel}</Label>
      </div>

      {confirmed && drafts.length === 0 && (
        <p className="text-[13px] text-muted-foreground">{noneNotice}</p>
      )}

      {confirmed &&
        drafts.map((draft, index) => {
          const error = intervalDraftError(draft);
          return (
            <div key={index} className="rounded-md border border-border p-3 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-${index}-start`}>Start date</Label>
                  <Input
                    id={`${idPrefix}-${index}-start`}
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => updateDraft(index, { startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-${index}-end`}>End date</Label>
                  <Input
                    id={`${idPrefix}-${index}-end`}
                    type="date"
                    value={draft.endDate}
                    disabled={draft.openEnded}
                    onChange={(e) => updateDraft(index, { endDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${idPrefix}-${index}-open-ended`}
                  checked={draft.openEnded}
                  onCheckedChange={(checked) => updateDraft(index, { openEnded: checked === true })}
                />
                <Label htmlFor={`${idPrefix}-${index}-open-ended`}>
                  Open-ended (until further notice)
                </Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idPrefix}-${index}-label`}>Label</Label>
                <Input
                  id={`${idPrefix}-${index}-label`}
                  placeholder="e.g. june glow promo"
                  value={draft.label}
                  onChange={(e) => updateDraft(index, { label: e.target.value })}
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(
                    confirmed,
                    drafts.filter((_, i) => i !== index),
                  )
                }
              >
                Remove
              </Button>
            </div>
          );
        })}

      {confirmed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(confirmed, [...drafts, emptyIntervalDraft()])}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}
