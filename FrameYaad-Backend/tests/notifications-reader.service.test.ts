import { NotificationType, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("../src/prisma/client", () => ({
  prisma: {
    notification: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import * as service from "../src/modules/notifications/notifications.service";

const notificationId = "55555555-eeee-4555-8555-555555555555";
const employeeId = "66666666-ffff-4666-8666-666666666666";
const unreadNotification = {
  id: notificationId,
  title: "New order placed",
  message: "A customer placed an order.",
  type: NotificationType.ORDER_PLACED,
  read: false,
  readById: null,
  readBy: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(unreadNotification);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUniqueOrThrow.mockResolvedValue({
    ...unreadNotification,
    read: true,
    readById: employeeId,
    readBy: {
      id: employeeId,
      name: "Employee Reader",
      email: "reader@example.com",
      role: UserRole.EMPLOYEE,
    },
  });
});

describe("shared notification reader tracking", () => {
  it("records and returns the employee who first reads a staff notification", async () => {
    const notification = await service.markRead(
      notificationId,
      employeeId,
      UserRole.EMPLOYEE,
    );

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: notificationId, userId: null },
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId: null, read: false },
      data: { read: true, readById: employeeId },
    });
    expect(notification.readBy).toEqual({
      id: employeeId,
      name: "Employee Reader",
      email: "reader@example.com",
      role: UserRole.EMPLOYEE,
    });
  });

  it("does not replace the first reader when another employee opens an already-read item", async () => {
    mocks.findFirst.mockResolvedValue({
      ...unreadNotification,
      read: true,
      readById: "77777777-aaaa-4777-8777-777777777777",
      readBy: {
        id: "77777777-aaaa-4777-8777-777777777777",
        name: "First Reader",
        email: "first@example.com",
        role: UserRole.EMPLOYEE,
      },
    });

    const notification = await service.markRead(
      notificationId,
      employeeId,
      UserRole.EMPLOYEE,
    );

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(notification.readBy?.name).toBe("First Reader");
  });
});
