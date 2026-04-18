-- Add unique constraint to prevent duplicate bookings
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_organizationId_contactId_service_startsAt_key" UNIQUE ("organizationId", "contactId", "service", "startsAt");
