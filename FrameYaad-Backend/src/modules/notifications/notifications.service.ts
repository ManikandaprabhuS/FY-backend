import { UserRole, type Prisma } from "@prisma/client";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { notificationListQuerySchema } from "./notifications.schemas";

const notificationSelect = {
  id: true,
  title: true,
  message: true,
  type: true,
  read: true,
  readById: true,
  readBy: {
    select: { id: true, name: true, email: true, role: true },
  },
  createdAt: true,
  updatedAt: true,
} as const;

const audienceWhere = (userId: string, role: UserRole): Prisma.NotificationWhereInput =>
  role === UserRole.CUSTOMER ? { userId } : { userId: null };

export const listNotifications = async (userId: string, role: UserRole, rawQuery: unknown) => {
  const { page, limit, read, type } = notificationListQuerySchema.parse(rawQuery);
  const where: Prisma.NotificationWhereInput = {
    ...audienceWhere(userId, role),
    ...(read === undefined ? {} : { read }),
    ...(type ? { type } : {}),
  };
  const [notifications, groups] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.groupBy({ by: ["read"], orderBy: { read: "asc" }, where: { ...audienceWhere(userId, role), ...(type ? { type } : {}) }, _count: { _all: true } }),
  ]);
  const counts = new Map(groups.map(group => [group.read, typeof group._count === "object" ? group._count._all ?? 0 : 0]));
  const unreadCount = counts.get(false) ?? 0;
  const readCount = counts.get(true) ?? 0;
  const total = read === undefined ? unreadCount + readCount : counts.get(read) ?? 0;
  return { notifications, pagination: paginationMeta(page, limit, total), summary: { totalCount: unreadCount + readCount, unreadCount, readCount } };
};

export const unreadCount = (userId: string, role: UserRole) =>
  prisma.notification.count({ where: { ...audienceWhere(userId, role), read: false } });

export const markRead = async (id: string, userId: string, role: UserRole) => {
  const audience = audienceWhere(userId, role);
  const existing = await prisma.notification.findFirst({
    where: { id, ...audience },
    select: notificationSelect,
  });
  if (!existing) {
    throw new ApiError(404, "Notification was not found", "NOTIFICATION_NOT_FOUND");
  }
  if (existing.read) return existing;

  await prisma.notification.updateMany({
    where: { id, ...audience, read: false },
    data: { read: true, readById: userId },
  });
  // Another staff member may have read the shared record concurrently. The
  // conditional update preserves the identity of the first reader.
  return prisma.notification.findUniqueOrThrow({ where: { id }, select: notificationSelect });
};

export const markAllRead = async (userId: string, role: UserRole) => {
  const result = await prisma.notification.updateMany({
    where: { ...audienceWhere(userId, role), read: false },
    data: { read: true, readById: userId },
  });
  return result.count;
};

export const deleteNotification = async (
  id: string,
  userId: string,
  role: UserRole,
): Promise<void> => {
  const result = await prisma.notification.deleteMany({
    where: { id, ...audienceWhere(userId, role) },
  });
  if (result.count === 0) {
    throw new ApiError(404, "Notification was not found", "NOTIFICATION_NOT_FOUND");
  }
};
