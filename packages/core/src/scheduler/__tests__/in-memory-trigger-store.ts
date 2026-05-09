import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";
import type { TriggerStore } from "../trigger-store.js";

/**
 * Test-only in-memory implementation of `TriggerStore`. Lives next to the
 * test files that use it so the helper stays colocated with its consumers
 * (`scheduler-service.test.ts`, and the upcoming `list-triggers.test.ts`).
 *
 * Production code uses `PrismaTriggerStore` from `@switchboard/db`.
 */
export class InMemoryTriggerStore implements TriggerStore {
  private readonly triggers = new Map<string, ScheduledTrigger>();

  async save(trigger: ScheduledTrigger): Promise<void> {
    this.triggers.set(trigger.id, { ...trigger });
  }

  async findById(id: string): Promise<ScheduledTrigger | null> {
    return this.triggers.get(id) ?? null;
  }

  async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    let result = Array.from(this.triggers.values());
    if (filters.organizationId) {
      result = result.filter((t) => t.organizationId === filters.organizationId);
    }
    if (filters.status) {
      result = result.filter((t) => t.status === filters.status);
    }
    if (filters.type) {
      result = result.filter((t) => t.type === filters.type);
    }
    if (filters.sourceWorkflowId) {
      result = result.filter((t) => t.sourceWorkflowId === filters.sourceWorkflowId);
    }
    return result;
  }

  async updateStatus(id: string, status: TriggerStatus): Promise<void> {
    const trigger = this.triggers.get(id);
    if (trigger) {
      this.triggers.set(id, { ...trigger, status });
    }
  }

  async deleteExpired(before: Date): Promise<number> {
    let count = 0;
    for (const [id, trigger] of this.triggers) {
      if (
        trigger.expiresAt &&
        trigger.expiresAt < before &&
        ["fired", "cancelled", "expired"].includes(trigger.status)
      ) {
        this.triggers.delete(id);
        count++;
      }
    }
    return count;
  }

  async expireOverdue(now: Date): Promise<number> {
    let count = 0;
    for (const [id, trigger] of this.triggers) {
      if (trigger.status === "active" && trigger.expiresAt && trigger.expiresAt < now) {
        this.triggers.set(id, { ...trigger, status: "expired" });
        count++;
      }
    }
    return count;
  }

  /**
   * Test-only: snapshot of all triggers. Used by list-triggers tests that
   * need to seed and inspect at once. Not part of `TriggerStore`.
   */
  _all(): ScheduledTrigger[] {
    return Array.from(this.triggers.values()).map((t) => ({ ...t }));
  }
}
