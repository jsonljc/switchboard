export class LifecyclePrecedenceViolation extends Error {
  constructor(
    public readonly fromState: string | null,
    public readonly toState: string,
  ) {
    super(`Cannot transition lifecycle state from ${fromState ?? "null"} to ${toState}`);
    this.name = "LifecyclePrecedenceViolation";
  }
}

export class LifecycleSnapshotMissing extends Error {
  constructor(public readonly conversationThreadId: string) {
    super(`Lifecycle snapshot missing for thread ${conversationThreadId}`);
    this.name = "LifecycleSnapshotMissing";
  }
}

export class LifecycleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleConfigError";
  }
}
