-- Backfill legacy per-deployment AgentDeployment.inputConfig.businessFacts into the
-- canonical per-org BusinessConfig.config. Idempotent + guarded:
--   * insert when the org has no BusinessConfig row
--   * fill only when the canonical row is NULL or '{}'
--   * never overwrite a non-empty canonical row
--   * raise a notice when BOTH sources are non-empty and differ (reconcile manually)
-- No schema change. Safe to run multiple times.

DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM "AgentDeployment" d
  JOIN "BusinessConfig" b ON b."organizationId" = d."organizationId"
  WHERE d."inputConfig" -> 'businessFacts' IS NOT NULL
    AND d."inputConfig" -> 'businessFacts' <> '{}'::jsonb
    AND b."config" IS NOT NULL
    AND b."config" <> '{}'::jsonb
    AND b."config" <> (d."inputConfig" -> 'businessFacts');
  IF conflict_count > 0 THEN
    RAISE NOTICE 'business-facts backfill: % org(s) have BOTH legacy inputConfig.businessFacts AND a different non-empty BusinessConfig.config; left untouched — reconcile manually', conflict_count;
  END IF;

  -- Insert for orgs that have legacy facts but no canonical row (latest deployment wins).
  INSERT INTO "BusinessConfig" ("id", "organizationId", "config", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, d."organizationId", d."inputConfig" -> 'businessFacts', now(), now()
  FROM (
    SELECT DISTINCT ON ("organizationId") "organizationId", "inputConfig"
    FROM "AgentDeployment"
    WHERE "inputConfig" -> 'businessFacts' IS NOT NULL
      AND "inputConfig" -> 'businessFacts' <> '{}'::jsonb
    ORDER BY "organizationId", "updatedAt" DESC
  ) d
  WHERE NOT EXISTS (SELECT 1 FROM "BusinessConfig" b WHERE b."organizationId" = d."organizationId");

  -- Fill canonical rows that exist but are empty.
  UPDATE "BusinessConfig" b
  SET "config" = d."inputConfig" -> 'businessFacts', "updatedAt" = now()
  FROM (
    SELECT DISTINCT ON ("organizationId") "organizationId", "inputConfig"
    FROM "AgentDeployment"
    WHERE "inputConfig" -> 'businessFacts' IS NOT NULL
      AND "inputConfig" -> 'businessFacts' <> '{}'::jsonb
    ORDER BY "organizationId", "updatedAt" DESC
  ) d
  WHERE b."organizationId" = d."organizationId"
    AND (b."config" IS NULL OR b."config" = '{}'::jsonb);
END $$;
