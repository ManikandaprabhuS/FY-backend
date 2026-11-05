import { Prisma, UserRole } from "@prisma/client";
import type { z } from "zod";

import { supabaseAdmin } from "../../config/supabase";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta, parsePagination } from "../../utils/pagination";
import { userViewSelect } from "../../utils/user-view";
import { createEmployeeAccount } from "../auth/auth.service";
import type { adminUpdateEmployeeSchema, createEmployeeSchema } from "./employees.schemas";

type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
type UpdateEmployeeInput = z.infer<typeof adminUpdateEmployeeSchema>;

export const createEmployee = (input: CreateEmployeeInput, adminId: string) =>
  createEmployeeAccount(input, adminId);

export const listEmployees = async (rawQuery: unknown) => {
  const { page, limit, search, isActive } = parsePagination(rawQuery);
  const where: Prisma.UserWhereInput = {
    role: UserRole.EMPLOYEE,
    ...(isActive === undefined ? {} : { isActive }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: search } },
          ],
        }
      : {}),
  };
  const [employees, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: userViewSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);
  return { employees, pagination: paginationMeta(page, limit, total) };
};

export const getEmployee = async (id: string) => {
  const employee = await prisma.user.findFirst({
    where: { id, role: UserRole.EMPLOYEE },
    select: userViewSelect,
  });
  if (!employee) throw new ApiError(404, "Employee was not found", "EMPLOYEE_NOT_FOUND");
  return employee;
};

export const updateEmployee = async (id: string, input: UpdateEmployeeInput) => {
  await getEmployee(id);
  return prisma.user.update({ where: { id }, data: input, select: userViewSelect });
};

export const deleteEmployee = async (id: string): Promise<void> => {
  await getEmployee(id);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    throw new ApiError(502, "Employee authentication account could not be deleted", "EMPLOYEE_AUTH_DELETE_FAILED");
  }

  // Supabase may cascade auth-user deletion to the public profile. deleteMany
  // keeps cleanup successful whether that database cascade is enabled or not.
  await prisma.user.deleteMany({ where: { id } });
};
