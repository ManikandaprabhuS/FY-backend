import {
  AppointmentEmailStatus,
  AppointmentStatus,
  Prisma,
} from "@prisma/client";

import { logger } from "../../config/logger";
import { prisma } from "../../prisma/client";
import {
  sendAppointmentCreatedEmails,
  sendAppointmentStatusEmail,
} from "../../services/appointment-email/appointment-email.service";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import {
  appointmentIdSchema,
  appointmentListQuerySchema,
  type CreateAppointmentInput,
  type UpdateAppointmentStatusInput,
} from "./appointment.schemas";

const appointmentSelect = {
  id: true,
  firstName: true,
  email: true,
  phoneNumber: true,
  originalBookingDate: true,
  bookingDate: true,
  location: true,
  frameTypes: true,
  otherFrameType: true,
  status: true,
  rescheduleReason: true,
  cancellationReason: true,
  emailStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppointmentSelect;

const allowedTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: [AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED, AppointmentStatus.CANCELLED],
  CONFIRMED: [AppointmentStatus.RESCHEDULED, AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED],
  RESCHEDULED: [AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED, AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED],
  CANCELLED: [],
  COMPLETED: [],
};

const emailStatus = (sent: boolean): AppointmentEmailStatus => sent
  ? AppointmentEmailStatus.SENT
  : AppointmentEmailStatus.FAILED;

export const createAppointment = async (input: CreateAppointmentInput) => {
  const appointment = await prisma.appointment.create({
    data: {
      firstName: input.firstName,
      email: input.email,
      phoneNumber: input.phoneNumber,
      originalBookingDate: input.bookingDate,
      bookingDate: input.bookingDate,
      location: input.location,
      frameTypes: input.frameTypes,
      otherFrameType: input.frameTypes.includes("OTHERS") ? input.otherFrameType : null,
      status: AppointmentStatus.PENDING,
      emailStatus: AppointmentEmailStatus.PENDING,
    },
    select: appointmentSelect,
  });
  logger.info({ appointmentId: appointment.id }, "Appointment created");

  const sent = await sendAppointmentCreatedEmails(appointment);
  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { emailStatus: emailStatus(sent) },
    select: appointmentSelect,
  });
  if (!sent) logger.warn({ appointmentId: appointment.id }, "Appointment saved but one or more emails failed");
  return updated;
};

const listWhere = (query: ReturnType<typeof appointmentListQuerySchema.parse>): Prisma.AppointmentWhereInput => {
  const dateStart = query.date ? new Date(`${query.date}T00:00:00.000Z`) : null;
  const dateEnd = dateStart ? new Date(dateStart.getTime() + 24 * 60 * 60 * 1_000) : null;
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.location ? { location: query.location } : {}),
    ...(dateStart && dateEnd ? { bookingDate: { gte: dateStart, lt: dateEnd } } : {}),
    ...(query.search ? {
      OR: [
        { firstName: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
        { phoneNumber: { contains: query.search } },
      ],
    } : {}),
  };
};

export const listAppointments = async (rawQuery: unknown) => {
  const query = appointmentListQuerySchema.parse(rawQuery);
  const where = listWhere(query);
  const [appointments, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      select: appointmentSelect,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.appointment.count({ where }),
  ]);
  return { appointments, pagination: paginationMeta(query.page, query.limit, total) };
};

export const getAppointment = async (rawId: unknown) => {
  const id = appointmentIdSchema.parse(rawId);
  const appointment = await prisma.appointment.findUnique({ where: { id }, select: appointmentSelect });
  if (!appointment) throw new ApiError(404, "Appointment was not found", "APPOINTMENT_NOT_FOUND");
  return appointment;
};

export const updateAppointmentStatus = async (rawId: unknown, input: UpdateAppointmentStatusInput) => {
  const current = await getAppointment(rawId);
  if (!allowedTransitions[current.status].includes(input.status)) {
    throw new ApiError(
      409,
      `Appointment cannot move from ${current.status} to ${input.status}`,
      "INVALID_APPOINTMENT_TRANSITION",
    );
  }
  if (input.status === AppointmentStatus.RESCHEDULED && input.bookingDate.getTime() === current.bookingDate.getTime()) {
    throw new ApiError(400, "New booking date must differ from the current booking date", "BOOKING_DATE_UNCHANGED");
  }

  const next = await prisma.appointment.update({
    where: { id: current.id },
    data: {
      status: input.status,
      ...(input.status === AppointmentStatus.RESCHEDULED ? {
        bookingDate: input.bookingDate,
        rescheduleReason: input.rescheduleReason || null,
      } : {}),
      ...(input.status === AppointmentStatus.CANCELLED ? {
        cancellationReason: input.cancellationReason || null,
      } : {}),
      ...(input.status === AppointmentStatus.COMPLETED ? {} : {
        emailStatus: AppointmentEmailStatus.PENDING,
      }),
    },
    select: appointmentSelect,
  });
  logger.info({ appointmentId: next.id, from: current.status, to: next.status }, "Appointment status updated");

  const sent = await sendAppointmentStatusEmail(next, current.bookingDate);
  if (sent === null) return next;
  const updated = await prisma.appointment.update({
    where: { id: next.id },
    data: { emailStatus: emailStatus(sent) },
    select: appointmentSelect,
  });
  if (!sent) logger.warn({ appointmentId: next.id, status: next.status }, "Appointment status saved but email failed");
  return updated;
};
