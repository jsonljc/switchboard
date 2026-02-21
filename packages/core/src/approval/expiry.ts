import type { ApprovalState } from "./state-machine.js";

export function checkExpiry(state: ApprovalState, now: Date = new Date()): boolean {
  return state.status === "pending" && now > state.expiresAt;
}

export function getExpiryMs(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, expiresAt.getTime() - now.getTime());
}
