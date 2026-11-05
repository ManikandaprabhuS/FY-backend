import type { RequestHandler } from "express";

import { userIdSchema } from "./users.schemas";
import type { z } from "zod";
import type { adminUpdateUserSchema } from "./users.schemas";
import * as usersService from "./users.service";

type UpdateUserBody = z.infer<typeof adminUpdateUserSchema>;

const idFrom = (value: unknown) => userIdSchema.parse(value);

export const listCustomers: RequestHandler = async (request, response) => {
  const data = await usersService.listCustomers(request.query);
  response.status(200).json({ success: true, data });
};

export const getCustomer: RequestHandler = async (request, response) => {
  const user = await usersService.getCustomer(idFrom(request.params.id));
  response.status(200).json({ success: true, data: { user } });
};

export const updateCustomer: RequestHandler = async (request, response) => {
  const user = await usersService.updateCustomer(idFrom(request.params.id), request.body as UpdateUserBody);
  response.status(200).json({ success: true, data: { user } });
};
