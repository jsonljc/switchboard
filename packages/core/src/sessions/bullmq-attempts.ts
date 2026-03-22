/**
 * BullMQ increments `attemptsMade` only after a failed attempt (see Job.moveToFailed).
 * While the processor runs, the current human-visible attempt index is `attemptsMade + 1`.
 * Use this to detect the final attempt before the job is permanently failed.
 */
export function isFinalBullMqJobAttempt(
  job: { attemptsMade: number; opts?: { attempts?: number } },
  maxAttemptsFallback = 3,
): boolean {
  const max = job.opts?.attempts ?? maxAttemptsFallback;
  return job.attemptsMade + 1 >= max;
}
