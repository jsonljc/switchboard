"use client";

import { useId, useMemo } from "react";
import styles from "../activity.module.css";

export interface EntitySelectorValue {
  entityType: string | null;
  entityId: string | null;
}

export interface EntitySelectorProps {
  entityType: string | null;
  entityId: string | null;
  /** Distinct entity types from the loaded page; component sorts internally. */
  types: ReadonlyArray<string>;
  onChange: (next: EntitySelectorValue) => void;
}

/**
 * Entity selector — type `<select>` (populated from the loaded page's distinct
 * entityTypes, sorted) + freeform id `<input>`. The server accepts each
 * independently; we don't gate either on the other.
 */
export function EntitySelector({ entityType, entityId, types, onChange }: EntitySelectorProps) {
  const typeId = useId();
  const idId = useId();
  const sortedTypes = useMemo(() => [...types].sort(), [types]);
  return (
    <>
      <span className={styles.filterStripEyebrow}>entity</span>
      <div className={styles.entityPick}>
        <label htmlFor={typeId} className="sr-only">
          entity type
        </label>
        <select
          id={typeId}
          className={styles.entityPickSelect}
          value={entityType ?? ""}
          onChange={(e) => onChange({ entityType: e.target.value || null, entityId })}
        >
          <option value="">any entity type</option>
          {sortedTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label htmlFor={idId} className="sr-only">
          entity id
        </label>
        <input
          id={idId}
          className={styles.entityPickInput}
          placeholder="entityId…"
          value={entityId ?? ""}
          spellCheck={false}
          onChange={(e) => onChange({ entityType, entityId: e.target.value || null })}
        />
      </div>
    </>
  );
}
