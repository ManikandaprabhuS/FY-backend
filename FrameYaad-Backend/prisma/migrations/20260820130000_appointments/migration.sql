CREATE TYPE "appointment_location" AS ENUM ('ODDANCHATRAM', 'COIMBATORE');
CREATE TYPE "appointment_status" AS ENUM ('PENDING', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "appointment_email_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "original_booking_date" TIMESTAMPTZ(6) NOT NULL,
    "booking_date" TIMESTAMPTZ(6) NOT NULL,
    "location" "appointment_location" NOT NULL,
    "frame_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "other_frame_type" VARCHAR(250),
    "status" "appointment_status" NOT NULL DEFAULT 'PENDING',
    "reschedule_reason" VARCHAR(500),
    "cancellation_reason" VARCHAR(500),
    "email_status" "appointment_email_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointments_status_booking_date_idx" ON "appointments"("status", "booking_date");
CREATE INDEX "appointments_location_booking_date_idx" ON "appointments"("location", "booking_date");
CREATE INDEX "appointments_created_at_idx" ON "appointments"("created_at");
CREATE INDEX "appointments_email_idx" ON "appointments"("email");
