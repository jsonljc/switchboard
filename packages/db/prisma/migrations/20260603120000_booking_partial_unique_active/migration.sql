-- T0.8: a failed/cancelled booking must not occupy the (org,contact,service,startsAt)
-- tuple, or it permanently blocks re-booking the same slot. Replace the plain unique
-- with a PARTIAL unique that only counts LIVE bookings. Mirrors the CreatorIdentity
-- partial-index pattern (20260428082529); Prisma 6 cannot express this in-schema.
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_organizationId_contactId_service_startsAt_key";

CREATE UNIQUE INDEX "Booking_org_contact_service_start_active_key"
  ON "Booking" ("organizationId", "contactId", "service", "startsAt")
  WHERE "status" NOT IN ('failed', 'cancelled');
