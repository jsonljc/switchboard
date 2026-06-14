-- Booking.attendance: separate attendance axis (attended | no_show); null = unrecorded.
ALTER TABLE "Booking" ADD COLUMN "attendance" TEXT;
CREATE INDEX "Booking_organizationId_attendance_idx" ON "Booking"("organizationId", "attendance");
