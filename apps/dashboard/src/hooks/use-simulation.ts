"use client";

import { useMutation } from "@tanstack/react-query";
import type { Playbook } from "@switchboard/schemas";

interface SimulateRequest {
  playbook: Playbook;
  userMessage: string;
}

interface SimulateResponse {
  alexMessage: string;
  annotations: string[];
}

async function simulateChat(req: SimulateRequest): Promise<SimulateResponse> {
  const res = await fetch("/api/dashboard/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Simulation failed");
  return res.json();
}

export function useSimulation() {
  return useMutation({ mutationFn: simulateChat });
}
