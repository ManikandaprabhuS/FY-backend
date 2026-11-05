import type { RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { adminUpdateEmployeeSchema, createEmployeeSchema } from "./employees.schemas";
import { employeeIdSchema } from "./employees.schemas";
import * as employeesService from "./employees.service";

type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;
type UpdateEmployeeBody = z.infer<typeof adminUpdateEmployeeSchema>;

const idFrom = (value: unknown) => employeeIdSchema.parse(value);

const adminIdFrom = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth.user.id;
};

export const createEmployee: RequestHandler = async (request, response) => {
  const employee = await employeesService.createEmployee(
    request.body as CreateEmployeeBody,
    adminIdFrom(request),
  );
  response.status(201).json({ success: true, data: { employee } });
};

export const listEmployees: RequestHandler = async (request, response) => {
  const data = await employeesService.listEmployees(request.query);
  response.status(200).json({ success: true, data });
};

export const getEmployee: RequestHandler = async (request, response) => {
  const employee = await employeesService.getEmployee(idFrom(request.params.id));
  response.status(200).json({ success: true, data: { employee } });
};

export const updateEmployee: RequestHandler = async (request, response) => {
  const employee = await employeesService.updateEmployee(
    idFrom(request.params.id),
    request.body as UpdateEmployeeBody,
  );
  response.status(200).json({ success: true, data: { employee } });
};

export const deleteEmployee: RequestHandler = async (request, response) => {
  await employeesService.deleteEmployee(idFrom(request.params.id));
  response.status(204).send();
};
