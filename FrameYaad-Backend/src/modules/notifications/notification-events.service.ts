import { NotificationType, Prisma } from "@prisma/client";

type NotificationDb = Prisma.TransactionClient;

export const createCustomerRegistrationNotifications = async (
  database: NotificationDb,
  customer: { id: string; name: string; email: string },
): Promise<void> => {
  await database.notification.create({
    data: {
      userId: customer.id,
      title: "Welcome to FrameYaad",
      message: "Your customer account has been created successfully.",
      type: NotificationType.ACCOUNT_CREATED,
    },
  });

  await database.notification.create({
    data: {
      userId: null,
      title: "New customer account",
      message: `${customer.name} (${customer.email}) created a customer account.`,
      type: NotificationType.ACCOUNT_CREATED,
    },
  });
};

export const createOrderPlacedNotifications = async (
  database: NotificationDb,
  order: { orderNumber: string; totalPrice: Prisma.Decimal; user: { id: string; name: string } },
): Promise<void> => {
  await database.notification.create({
    data: {
      userId: order.user.id,
      title: "Order placed",
      message: `Your order ${order.orderNumber} has been placed successfully.`,
      type: NotificationType.ORDER_PLACED,
    },
  });

  await database.notification.create({
    data: {
      userId: null,
      title: "New order placed",
      message: `${order.user.name} placed order ${order.orderNumber} for ${order.totalPrice.toFixed(2)}.`,
      type: NotificationType.ORDER_PLACED,
    },
  });
};
