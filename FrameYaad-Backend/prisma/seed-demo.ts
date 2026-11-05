import { randomBytes } from "node:crypto";

import { NotificationType, OrderStatus, Prisma, UserRole } from "@prisma/client";

import { supabaseAdmin } from "../src/config/supabase";
import { prisma } from "../src/prisma/client";

const DEMO_DOMAIN = "frameyaad.demo";

const ensureUser = async (
  input: { name: string; email: string; phoneNumber: string; role: UserRole },
  createdById?: string,
) => {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        phoneNumber: input.phoneNumber,
        role: input.role,
        isActive: true,
        isEmailVerified: true,
        createdById,
      },
    });
  }

  const password = `FY-${randomBytes(18).toString("base64url")}a1!`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    app_metadata: { role: input.role },
    user_metadata: { name: input.name, demo: true },
  });
  if (error || !data.user) {
    throw new Error(`Unable to create demo auth user ${input.email}: ${error?.message ?? "unknown error"}`);
  }

  try {
    return await prisma.user.create({
      data: {
        id: data.user.id,
        name: input.name,
        email: input.email,
        phoneNumber: input.phoneNumber,
        role: input.role,
        isActive: true,
        isEmailVerified: true,
        createdById,
        addressLine: input.role === UserRole.CUSTOMER ? "Demo address" : null,
        postalCode: input.role === UserRole.CUSTOMER ? "560001" : null,
        city: input.role === UserRole.CUSTOMER ? "Bengaluru" : null,
        state: input.role === UserRole.CUSTOMER ? "Karnataka" : null,
        country: input.role === UserRole.CUSTOMER ? "India" : null,
      },
    });
  } catch (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    throw profileError;
  }
};

const ensureAddress = async (
  userId: string,
  input: {
    addressLine: string;
    postalCode: string;
    city: string;
    state: string;
    country: string;
    contactPerson: string;
    contactNumber: string;
  },
) => {
  const existing = await prisma.userAddress.findFirst({
    where: { userId, addressLine: input.addressLine, contactNumber: input.contactNumber },
  });
  return existing ?? prisma.userAddress.create({ data: { userId, ...input } });
};

const ensureProduct = async (
  input: {
    identifier: string;
    name: string;
    materialName: string;
    brandName: string;
    material: string;
    colors: string[];
    color: string;
    frameSize: string;
    mountType: string;
    mrp: string;
    price: string;
    imageUrl: string;
  },
  createdById?: string,
) => {
  const mrp = new Prisma.Decimal(input.mrp);
  const price = new Prisma.Decimal(input.price);
  const material = await prisma.material.upsert({
    where: { brandName_name: { brandName: input.brandName, name: input.materialName } },
    update: { material: input.material, availableColors: input.colors, isActive: true },
    create: {
      name: input.materialName,
      description: `${input.materialName} demo material for admin testing`,
      brandName: input.brandName,
      material: input.material,
      availableColors: input.colors,
      isActive: true,
      createdById,
    },
  });
  const variant = await prisma.variant.upsert({
    where: {
      color_frameSize_mountType_mrp_price: {
        color: input.color,
        frameSize: input.frameSize,
        mountType: input.mountType,
        mrp,
        price,
      },
    },
    update: { isActive: true },
    create: {
      color: input.color,
      frameSize: input.frameSize,
      mountType: input.mountType,
      mrp,
      price,
      isActive: true,
      createdById,
    },
  });
  const product = await prisma.product.upsert({
    where: { productIdentifier: input.identifier },
    update: { productName: input.name, materialId: material.id, variantId: variant.id },
    create: {
      productIdentifier: input.identifier,
      productName: input.name,
      materialId: material.id,
      variantId: variant.id,
      createdById,
    },
  });
  const image = await prisma.productImage.findFirst({
    where: { productIdentifier: input.identifier, imageUrl: input.imageUrl },
  });
  if (!image) {
    await prisma.productImage.create({
      data: {
        productIdentifier: input.identifier,
        imageUrl: input.imageUrl,
        isPrimary: true,
      },
    });
  }
  return product;
};

const ensureOrder = async (
  input: {
    orderNumber: string;
    userId: string;
    userAddressId: string;
    productIdentifier: string;
    price: string;
    quantity: number;
    status: OrderStatus;
    remark: string;
  },
) => prisma.$transaction(async (transaction) => {
  const price = new Prisma.Decimal(input.price);
  const subtotal = price.mul(input.quantity);
  const existing = await transaction.order.findUnique({ where: { orderNumber: input.orderNumber } });
  if (existing) {
    await transaction.orderItem.deleteMany({ where: { orderId: existing.id } });
    return transaction.order.update({
      where: { id: existing.id },
      data: {
        userId: input.userId,
        userAddressId: input.userAddressId,
        totalPrice: subtotal,
        status: input.status,
        remark: input.remark,
        items: {
          create: {
            productIdentifier: input.productIdentifier,
            quantity: input.quantity,
            price,
            subtotal,
          },
        },
      },
    });
  }
  return transaction.order.create({
    data: {
      orderNumber: input.orderNumber,
      userId: input.userId,
      userAddressId: input.userAddressId,
      totalPrice: subtotal,
      status: input.status,
      remark: input.remark,
      items: {
        create: {
          productIdentifier: input.productIdentifier,
          quantity: input.quantity,
          price,
          subtotal,
        },
      },
    },
  });
});

const ensureStaffNotification = async (
  input: { title: string; message: string; type: NotificationType },
) => {
  const existing = await prisma.notification.findFirst({
    where: { userId: null, title: input.title, message: input.message, type: input.type },
  });
  return existing ?? prisma.notification.create({ data: { userId: null, ...input } });
};

const seed = async () => {
  const admin = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const customers = await Promise.all([
    ensureUser({ name: "Aarav Sharma", email: `aarav@${DEMO_DOMAIN}`, phoneNumber: "+919810000001", role: UserRole.CUSTOMER }),
    ensureUser({ name: "Meera Iyer", email: `meera@${DEMO_DOMAIN}`, phoneNumber: "+919810000002", role: UserRole.CUSTOMER }),
  ]);
  const employees = await Promise.all([
    ensureUser({ name: "Rohan Das", email: `rohan@${DEMO_DOMAIN}`, phoneNumber: "+919820000001", role: UserRole.EMPLOYEE }, admin?.id),
    ensureUser({ name: "Nisha Patel", email: `nisha@${DEMO_DOMAIN}`, phoneNumber: "+919820000002", role: UserRole.EMPLOYEE }, admin?.id),
  ]);

  const addresses = await Promise.all([
    ensureAddress(customers[0].id, {
      addressLine: "14 Monochrome Avenue", postalCode: "110001", city: "New Delhi",
      state: "Delhi", country: "India", contactPerson: customers[0].name,
      contactNumber: customers[0].phoneNumber ?? "+919810000001",
    }),
    ensureAddress(customers[1].id, {
      addressLine: "22 Gallery Road", postalCode: "560001", city: "Bengaluru",
      state: "Karnataka", country: "India", contactPerson: customers[1].name,
      contactNumber: customers[1].phoneNumber ?? "+919810000002",
    }),
  ]);

  await Promise.all([
    prisma.user.update({
      where: { id: customers[0].id },
      data: {
        addressLine: addresses[0].addressLine,
        postalCode: addresses[0].postalCode,
        city: addresses[0].city,
        state: addresses[0].state,
        country: addresses[0].country,
      },
    }),
    prisma.user.update({
      where: { id: customers[1].id },
      data: {
        addressLine: addresses[1].addressLine,
        postalCode: addresses[1].postalCode,
        city: addresses[1].city,
        state: addresses[1].state,
        country: addresses[1].country,
      },
    }),
  ]);

  const products = await Promise.all([
    ensureProduct({
      identifier: "FY-DEMO-001", name: "Monochrome Classic Frame", materialName: "Classic Wood",
      brandName: "FrameYaad Studio", material: "Engineered Wood", colors: ["Black", "White"],
      color: "Black", frameSize: "8 x 10 in", mountType: "Wall Mount", mrp: "1499", price: "1199",
      imageUrl: "https://placehold.co/600x400/000000/FFFFFF?text=FrameYaad+Demo+1",
    }, admin?.id),
    ensureProduct({
      identifier: "FY-DEMO-002", name: "Gallery Edge Frame", materialName: "Gallery Aluminium",
      brandName: "FrameYaad Studio", material: "Aluminium", colors: ["White", "Black"],
      color: "White", frameSize: "12 x 16 in", mountType: "Table and Wall Mount", mrp: "2199", price: "1899",
      imageUrl: "https://placehold.co/600x400/FFFFFF/000000?text=FrameYaad+Demo+2",
    }, admin?.id),
  ]);

  const orders = await Promise.all([
    ensureOrder({
      orderNumber: "FY-1001", userId: customers[0].id, userAddressId: addresses[0].id,
      productIdentifier: products[0].productIdentifier, price: "1199", quantity: 2,
      status: OrderStatus.PLACED, remark: "Demo order for admin testing",
    }),
    ensureOrder({
      orderNumber: "FY-1002", userId: customers[1].id, userAddressId: addresses[1].id,
      productIdentifier: products[1].productIdentifier, price: "1899", quantity: 1,
      status: OrderStatus.CONFIRMED, remark: "Demo order ready for processing",
    }),
  ]);

  const notifications = await Promise.all([
    ensureStaffNotification({
      title: "Demo customer account created",
      message: `${customers[0].name} (${customers[0].email}) is available for admin testing.`,
      type: NotificationType.ACCOUNT_CREATED,
    }),
    ensureStaffNotification({
      title: "Demo order placed",
      message: `${customers[1].name} placed ${orders[1].orderNumber} for admin testing.`,
      type: NotificationType.ORDER_PLACED,
    }),
  ]);

  console.log("Supabase demo seed completed", {
    customers: customers.length,
    employees: employees.length,
    products: products.length,
    orders: orders.length,
    notifications: notifications.length,
  });
};

seed()
  .catch((error: unknown) => {
    console.error("Supabase demo seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
