import { NotificationType, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createCustomerRegistrationNotifications,
  createOrderPlacedNotifications,
} from "../src/modules/notifications/notification-events.service";

const eventDatabase = () => {
  const notificationCreate = vi.fn().mockResolvedValue({});
  const database = {
    notification: { create: notificationCreate },
  } as unknown as Prisma.TransactionClient;
  return { database, notificationCreate };
};

describe("notification event generation", () => {
  it("creates a private customer notice and one shared staff notice after registration", async () => {
    const mocks = eventDatabase();
    await createCustomerRegistrationNotifications(mocks.database, {
      id: "customer-1",
      name: "New Customer",
      email: "new@example.com",
    });

    const customerCall = mocks.notificationCreate.mock.calls[0]?.[0] as {
      data: { userId: string; type: NotificationType };
    };
    expect(customerCall.data).toMatchObject({
      userId: "customer-1",
      type: NotificationType.ACCOUNT_CREATED,
    });
    const staffCall = mocks.notificationCreate.mock.calls[1]?.[0] as {
      data: { userId: string | null; type: NotificationType };
    };
    expect(staffCall.data).toMatchObject({
      userId: null,
      type: NotificationType.ACCOUNT_CREATED,
    });
  });

  it("creates a private customer notice and one shared staff notice after checkout", async () => {
    const mocks = eventDatabase();
    await createOrderPlacedNotifications(mocks.database, {
      orderNumber: "FY-TEST-0001",
      totalPrice: new Prisma.Decimal("1499.00"),
      user: { id: "customer-1", name: "Order Customer" },
    });

    const customerCall = mocks.notificationCreate.mock.calls[0]?.[0] as {
      data: { userId: string; type: NotificationType };
    };
    expect(customerCall.data).toMatchObject({
      userId: "customer-1",
      type: NotificationType.ORDER_PLACED,
    });
    const staffCall = mocks.notificationCreate.mock.calls[1]?.[0] as {
      data: { userId: string | null; type: NotificationType };
    };
    expect(staffCall.data).toMatchObject({
      userId: null,
      type: NotificationType.ORDER_PLACED,
    });
  });
});
