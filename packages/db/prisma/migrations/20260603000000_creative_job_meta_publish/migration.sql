-- CreativeJob: Meta parked-draft publish fields (all nullable, no defaults).
-- Set by the governed creative.job.publish handler; durableAssetUrl is the PR A
-- contract (durable assembled-creative URL).
ALTER TABLE "CreativeJob" ADD COLUMN "metaVideoId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaCampaignId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaAdSetId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaCreativeId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaAdId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaPublishStatus" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "durableAssetUrl" TEXT;
