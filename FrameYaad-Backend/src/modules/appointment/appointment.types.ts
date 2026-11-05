import type { AppointmentLocation, AppointmentStatus } from "@prisma/client";

export const appointmentFrameTypes = [
  "PHOTOGRAPHS",
  "ARTWORK_PHYSICAL_PHOTO",
  "DOCUMENT_PAPER",
  "JERSEY_TEXTILES",
  "OBJECTS_WITH_DEPTH",
  "GALLERY_WALLS",
  "OTHERS",
] as const;

export type AppointmentFrameType = (typeof appointmentFrameTypes)[number];

export type AppointmentEmailView = {
  id: string;
  firstName: string;
  email: string;
  phoneNumber: string;
  originalBookingDate: Date;
  bookingDate: Date;
  location: AppointmentLocation;
  frameTypes: string[];
  otherFrameType: string | null;
  status: AppointmentStatus;
  rescheduleReason: string | null;
  cancellationReason: string | null;
};
