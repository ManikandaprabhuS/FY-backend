import { AppointmentLocation, AppointmentStatus } from "@prisma/client";
import { z } from "zod";

import { appointmentFrameTypes } from "./appointment.types";

const cleanText = (maximum: number) =>
  z.string().trim().max(maximum).transform((value) => value.replace(/<[^>]*>/g, "").trim());

const futureDate = z.coerce.date().refine(
  (value) => value.getTime() > Date.now(),
  "Booking date must be in the future",
);

const indianPhone = z.string().trim().transform((value) => value.replace(/[\s()-]/g, "")).refine(
  (value) => /^(?:\+91|91)?[6-9]\d{9}$/.test(value),
  "Please enter a valid Indian phone number",
);

export const createAppointmentSchema = z.object({
  firstName: z.string().trim().min(2).max(50),
  email: z.string().trim().toLowerCase().email().max(320),
  phoneNumber: indianPhone,
  bookingDate: futureDate,
  location: z.nativeEnum(AppointmentLocation),
  frameTypes: z.array(z.enum(appointmentFrameTypes)).min(1, "Select at least one frame requirement"),
  otherFrameType: cleanText(250).optional(),
}).strict().superRefine((input, context) => {
  if (input.frameTypes.includes("OTHERS") && !input.otherFrameType) {
    context.addIssue({
      code: "custom",
      path: ["otherFrameType"],
      message: "Other frame requirement is required when Others is selected",
    });
  }
});

const reason = cleanText(500).optional();

export const updateAppointmentStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal(AppointmentStatus.CONFIRMED) }).strict(),
  z.object({
    status: z.literal(AppointmentStatus.RESCHEDULED),
    bookingDate: futureDate,
    rescheduleReason: reason,
  }).strict(),
  z.object({
    status: z.literal(AppointmentStatus.CANCELLED),
    cancellationReason: reason,
  }).strict(),
  z.object({ status: z.literal(AppointmentStatus.COMPLETED) }).strict(),
]);

export const appointmentIdSchema = z.string().uuid();

export const appointmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  location: z.nativeEnum(AppointmentLocation).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
