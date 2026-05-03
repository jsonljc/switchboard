"use client";

import type { RichText } from "../console-data";

export function RichTextSpan({ value }: { value: RichText }) {
  return (
    <>
      {value.map((seg, i) => {
        if (typeof seg === "string") return <span key={i}>{seg}</span>;
        if ("bold" in seg) return <b key={i}>{seg.bold}</b>;
        return (
          <em key={i} style={{ fontStyle: "normal" }}>
            {seg.coral}
          </em>
        );
      })}
    </>
  );
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
