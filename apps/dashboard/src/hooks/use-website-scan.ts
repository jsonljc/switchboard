"use client";

import { useMutation } from "@tanstack/react-query";
import type { ScanResult } from "@switchboard/schemas";

interface ScanResponse {
  result: ScanResult;
  error?: string;
}

async function scanWebsite(url: string): Promise<ScanResponse> {
  const res = await fetch("/api/dashboard/website-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("Scan failed");
  return res.json();
}

export function useWebsiteScan() {
  return useMutation({ mutationFn: scanWebsite });
}
