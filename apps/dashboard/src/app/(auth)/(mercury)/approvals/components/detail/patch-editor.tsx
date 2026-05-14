"use client";

import { useMemo, useState } from "react";
import detailStyles from "../../detail.module.css";
import { jsonDiff } from "../../json-diff";

export interface PatchEditorProps {
  snapshot: Record<string, unknown>;
  seed: Record<string, unknown> | null;
  onCancel: () => void;
  onSubmit: (patchValue: Record<string, unknown>) => void;
}

const MAX_BYTES = 100 * 1024;

export function PatchEditor({ snapshot, seed, onCancel, onSubmit }: PatchEditorProps) {
  const initial = useMemo(() => ({ ...snapshot, ...(seed ?? {}) }), [snapshot, seed]);
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(initial);
  const [parseError, setParseError] = useState<string | null>(null);

  function onChange(next: string) {
    setText(next);
    try {
      const obj = JSON.parse(next);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        setParsed(obj as Record<string, unknown>);
        setParseError(null);
      } else {
        setParseError("Must be a JSON object.");
        setParsed(null);
      }
    } catch (err) {
      setParseError((err as Error).message);
      setParsed(null);
    }
  }

  const bytes = new Blob([text]).size;
  const tooLarge = bytes > MAX_BYTES;
  const changedKeys = parsed ? jsonDiff(snapshot, parsed) : [];
  const canSubmit = !!parsed && !tooLarge && changedKeys.length > 0;

  return (
    <div className={detailStyles.patchEditor}>
      <div className={detailStyles.patchHead}>
        <span className={detailStyles.eyebrowPlain}>Edit details · advanced</span>
        <span className={detailStyles.patchHint}>
          Applies your changes then approves the modified version.
        </span>
      </div>
      <div className={detailStyles.patchDiff}>
        <div className={detailStyles.patchPane}>
          <span className={detailStyles.patchPaneLabel}>current</span>
          <pre className={detailStyles.patchSnapshot}>{JSON.stringify(snapshot, null, 2)}</pre>
        </div>
        <div className={detailStyles.patchPane}>
          <span className={`${detailStyles.patchPaneLabel} ${detailStyles.patchPaneLabelProposed}`}>
            proposed
          </span>
          <textarea
            className={`${detailStyles.patchTextarea} ${parseError ? detailStyles.patchTextareaInvalid : ""}`}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            aria-label="Patch JSON editor"
          />
          {parseError && <span className={detailStyles.patchError}>{parseError}</span>}
        </div>
      </div>
      <div className={detailStyles.patchFoot}>
        <div>
          <span className={detailStyles.patchFootLabel}>size</span>
          <b> {(bytes / 1024).toFixed(2)} KB</b> of 100 KB
          {changedKeys.length > 0 && (
            <>
              <span className={detailStyles.patchFootSep}>·</span>
              <span className={detailStyles.patchFootLabel}>changed</span>
              <b> {changedKeys.join(", ")}</b>
            </>
          )}
        </div>
        <div className={detailStyles.patchFootRight}>
          <button type="button" className={detailStyles.btnSm} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={detailStyles.btnPrimary}
            disabled={!canSubmit}
            onClick={() => parsed && onSubmit(parsed)}
          >
            Apply changes & approve
          </button>
        </div>
      </div>
    </div>
  );
}
