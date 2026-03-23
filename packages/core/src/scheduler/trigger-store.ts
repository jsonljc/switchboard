import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";

export interface TriggerStore {
  save(trigger: ScheduledTrigger): Promise<void>;
  findById(id: string): Promise<ScheduledTrigger | null>;
  findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]>;
  updateStatus(id: string, status: TriggerStatus): Promise<void>;
  deleteExpired(before: Date): Promise<number>;
  /** Mark active triggers whose expiresAt has passed as "expired". */
  expireOverdue(now: Date): Promise<number>;
}
