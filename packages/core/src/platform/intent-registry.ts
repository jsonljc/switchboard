import type { IntentRegistration } from "./intent-registration.js";
import type { ExecutionModeName, Trigger } from "./types.js";

export class IntentRegistry {
  private registrations = new Map<string, IntentRegistration>();

  register(registration: IntentRegistration): void {
    if (this.registrations.has(registration.intent)) {
      throw new Error(`Intent already registered: ${registration.intent}`);
    }
    this.registrations.set(registration.intent, registration);
  }

  lookup(intent: string): IntentRegistration | undefined {
    return this.registrations.get(intent);
  }

  resolveMode(intent: string, suggestedMode?: ExecutionModeName): ExecutionModeName {
    const reg = this.registrations.get(intent);
    if (!reg) {
      throw new Error(`Intent not registered: ${intent}`);
    }
    if (suggestedMode && reg.allowedModes.includes(suggestedMode)) {
      return suggestedMode;
    }
    return reg.defaultMode;
  }

  validateTrigger(intent: string, trigger: Trigger): boolean {
    const reg = this.registrations.get(intent);
    if (!reg) return false;
    return reg.allowedTriggers.includes(trigger);
  }

  listIntents(): string[] {
    return [...this.registrations.keys()].sort();
  }

  get size(): number {
    return this.registrations.size;
  }
}
