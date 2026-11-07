import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { parsePagination, paginationMeta } from "../../utils/pagination";
import type { createAddressSchema, updateAddressSchema } from "./addresses.schemas";

type CreateAddressInput = z.infer<typeof createAddressSchema>;
type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const listAddresses = async (userId: string, rawQuery: unknown = {}) => {
  const { page, limit } = parsePagination(rawQuery);
  const [addresses, total] = await Promise.all([
    prisma.userAddress.findMany({ where: { userId }, orderBy: { id: "asc" }, skip: (page - 1) * limit, take: limit }),
    prisma.userAddress.count({ where: { userId } }),
  ]);
  return { addresses, pagination: paginationMeta(page, limit, total) };
};

export const getAddress = async (id: string, userId: string) => {
  const address = await prisma.userAddress.findFirst({ where: { id, userId } });
  if (!address) throw new ApiError(404, "Address was not found", "ADDRESS_NOT_FOUND");
  return address;
};

export const createAddress = (userId: string, input: CreateAddressInput) =>
  prisma.userAddress.create({ data: { ...input, userId } });

export const updateAddress = async (id: string, userId: string, input: UpdateAddressInput) => {
  await getAddress(id, userId);
  return prisma.userAddress.update({ where: { id }, data: input });
};

export const deleteAddress = async (id: string, userId: string): Promise<void> => {
  await getAddress(id, userId);
  await prisma.userAddress.delete({ where: { id } });
};
