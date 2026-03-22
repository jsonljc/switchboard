/**
 * One in-flight gateway invoke/resume per session. API cancel aborts the worker's fetch
 * so we do not wait for OPENCLAW_GATEWAY_FETCH_TIMEOUT_MS after cancellation.
 */
export class SessionGatewayInflightRegistry {
  private readonly bySession = new Map<string, AbortController>();

  /**
   * Abort any prior invocation for this session, then return a fresh controller for the new job.
   */
  beginInvocation(sessionId: string): AbortController {
    const prev = this.bySession.get(sessionId);
    if (prev) {
      prev.abort();
      this.bySession.delete(sessionId);
    }
    const ac = new AbortController();
    this.bySession.set(sessionId, ac);
    return ac;
  }

  endInvocation(sessionId: string, ac: AbortController): void {
    if (this.bySession.get(sessionId) === ac) {
      this.bySession.delete(sessionId);
    }
  }

  /** Used by cancel route before gateway /cancel — aborts the worker's active fetch if any. */
  abortInvocation(sessionId: string): void {
    const ac = this.bySession.get(sessionId);
    if (ac) {
      ac.abort();
      this.bySession.delete(sessionId);
    }
  }
}
