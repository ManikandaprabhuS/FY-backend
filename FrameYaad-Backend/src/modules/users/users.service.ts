import { Prisma, UserRole } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta, parsePagination } from "../../utils/pagination";
import { userViewSelect } from "../../utils/user-view";
import type { adminUpdateUserSchema } from "./users.schemas";

type UpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

const customerWhere = (id: string): Prisma.UserWhereUniqueInput & { role: UserRole } => ({
  id,
  role: UserRole.CUSTOMER,
});

export const listCustomers = async (rawQuery: unknown) => {
  const { page, limit, search, isActive } = parsePagination(rawQuery);
  const where: Prisma.UserWhereInput = {
    role: UserRole.CUSTOMER,
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
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userViewSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);
  const userIds = users.map((user) => user.id);
  const orderSummaries = userIds.length === 0 ? [] : await prisma.order.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true, orderNumber: true, status: true, totalPrice: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const summariesByUser = new Map<string, typeof orderSummaries>();
  for (const order of orderSummaries) {
    const existing = summariesByUser.get(order.userId) ?? [];
    existing.push(order);
    summariesByUser.set(order.userId, existing);
  }

  return {
    users: users.map((user) => ({ ...user, orderSummaries: summariesByUser.get(user.id) ?? [] })),
    pagination: paginationMeta(page, limit, total),
  };
};

export const getCustomer = async (id: string) => {
  const [user, totals] = await Promise.all([
    prisma.user.findFirst({ where: customerWhere(id), select: userViewSelect }),
    prisma.order.aggregate({ where: { userId: id }, _count: { _all: true }, _sum: { totalPrice: true }, _max: { createdAt: true } }),
  ]);
  if (!user) throw new ApiError(404, "Customer was not found", "CUSTOMER_NOT_FOUND");
  return { ...user, orderStats: { count: totals._count._all, totalSpent: Number(totals._sum.totalPrice ?? 0), lastOrderAt: totals._max.createdAt } };
};

export const lookupCustomerByPhone = async (phone: string) => {
  // The suffix comparison preserves local-number searches against country-code numbers.
  // Parameter binding prevents user input from becoming SQL syntax.
  const matches = await prisma.$queryRaw<Array<{ id: string; name: string; phoneNumber: string }>>(Prisma.sql`
    SELECT id, name, "phoneNumber" FROM public.users
    WHERE role = 'CUSTOMER' AND regexp_replace("phoneNumber", '[^0-9]', '', 'g') LIKE ${`%${phone}`}
    ORDER BY CASE WHEN regexp_replace("phoneNumber", '[^0-9]', '', 'g') = ${phone} THEN 0 ELSE 1 END, "createdAt" DESC, id
    LIMIT 1
  `);
  if (!matches[0]) throw new ApiError(404, "Customer was not found", "CUSTOMER_NOT_FOUND");
  return matches[0];
};

export const updateCustomer = async (id: string, input: UpdateUserInput) => {
  await getCustomer(id);
  return prisma.user.update({ where: { id }, data: input, select: userViewSelect });
};
