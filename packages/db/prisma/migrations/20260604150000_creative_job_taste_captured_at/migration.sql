-- CreativeJob: slice-2 taste-sweep idempotency watermark. Stores the OBSERVED
-- reviewDecidedAt at capture time (never wall-clock now), so a re-decision
-- that lands during a sweep stays strictly newer than the watermark and is
-- re-observed on the next run (neither swallowed nor double-counted).
ALTER TABLE "CreativeJob" ADD COLUMN "tasteCapturedAt" TIMESTAMP(3);
