import type { RequestHandler } from "express";

import type { CreateAppointmentInput, UpdateAppointmentStatusInput } from "./appointment.schemas";
import * as service from "./appointment.service";

export const create: RequestHandler = async (request, response) => {
  const appointment = await service.createAppointment(request.body as CreateAppointmentInput);
  response.status(201).json({
    success: true,
    message: "Your appointment request has been received",
    data: { appointment },
  });
};

export const list: RequestHandler = async (request, response) => {
  response.status(200).json({ success: true, data: await service.listAppointments(request.query) });
};

export const getById: RequestHandler = async (request, response) => {
  response.status(200).json({ success: true, data: { appointment: await service.getAppointment(request.params.id) } });
};

export const updateStatus: RequestHandler = async (request, response) => {
  const appointment = await service.updateAppointmentStatus(
    request.params.id,
    request.body as UpdateAppointmentStatusInput,
  );
  response.status(200).json({
    success: true,
    message: `Appointment marked as ${appointment.status.toLowerCase()}`,
    data: { appointment },
  });
};
