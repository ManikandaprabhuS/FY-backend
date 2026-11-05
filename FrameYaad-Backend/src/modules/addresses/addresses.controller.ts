import type { RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { createAddressSchema, updateAddressSchema } from "./addresses.schemas";
import { addressIdSchema } from "./addresses.schemas";
import * as service from "./addresses.service";

type CreateAddressBody = z.infer<typeof createAddressSchema>;
type UpdateAddressBody = z.infer<typeof updateAddressSchema>;

const userIdFrom = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth.user.id;
};
const addressIdFrom = (value: unknown): string => addressIdSchema.parse(value);

export const list: RequestHandler = async (request, response) => {
  const addresses = await service.listAddresses(userIdFrom(request));
  response.status(200).json({ success: true, data: { addresses } });
};

export const get: RequestHandler = async (request, response) => {
  const address = await service.getAddress(addressIdFrom(request.params.id), userIdFrom(request));
  response.status(200).json({ success: true, data: { address } });
};

export const create: RequestHandler = async (request, response) => {
  const address = await service.createAddress(userIdFrom(request), request.body as CreateAddressBody);
  response.status(201).json({ success: true, data: { address } });
};

export const update: RequestHandler = async (request, response) => {
  const address = await service.updateAddress(
    addressIdFrom(request.params.id),
    userIdFrom(request),
    request.body as UpdateAddressBody,
  );
  response.status(200).json({ success: true, data: { address } });
};

export const remove: RequestHandler = async (request, response) => {
  await service.deleteAddress(addressIdFrom(request.params.id), userIdFrom(request));
  response.status(204).send();
};
