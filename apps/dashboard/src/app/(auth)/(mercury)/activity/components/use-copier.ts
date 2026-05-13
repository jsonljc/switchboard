import { useCallback, useEffect, useState } from "react";

/**
 * useCopier — tracks which copy button was last clicked (`copied` key) and
 * clears it after 1.1s. Clipboard write is fire-and-forget — failures never
 * throw (H4 per spec §12), and the visual "copied" state flips regardless so
 * the user always sees acknowledgement.
 */
export function useCopier(): readonly [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (copied === null) return undefined;
    const t = setTimeout(() => setCopied(null), 1100);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = useCallback((key: string, text: string) => {
    // H4: never throw. Wrap the optional-chain in a try/catch in case the
    // browser's clipboard implementation throws synchronously.
    try {
      const write = navigator?.clipboard?.writeText?.(text);
      if (write && typeof write.catch === "function") {
        write.catch(() => {
          /* clipboard denied / unavailable */
        });
      }
    } catch {
      /* clipboard threw synchronously */
    }
    setCopied(key);
  }, []);

  return [copied, copy] as const;
}
