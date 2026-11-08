import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../prisma/client";
import { escapeOrderSearch, normalizePhoneSearch } from "../orders/orders.filters";
import { buildCustomerSearch } from "../users/customer-search";
export const adminSearchSchema = z.object({ q: z.string().trim().min(1).max(120) });
export async function searchAdmin(raw: unknown) {
  const { q } = adminSearchSchema.parse(raw);
  const numeric = /^\d+$/.test(q);
  const orderNumberWhere: Prisma.OrderWhereInput = { orderNumber: { contains: escapeOrderSearch(q), mode: "insensitive" } };
  const numericOrderMatch = numeric ? await prisma.order.count({ where: orderNumberWhere }) : 0;
  const digits = normalizePhoneSearch(q);
  const kind = /^FY-\d+$/i.test(q) || numericOrderMatch > 0 ? "order" : /^[\d\s()+-]+$/.test(q) && digits.length >= 7 && digits.length <= 15 ? "phone" : "text";
  const query = kind === "phone" ? digits : q;
  const orderWhere: Prisma.OrderWhereInput = kind === "order" ? orderNumberWhere : {
    OR: [orderNumberWhere, { user: { name: { contains: escapeOrderSearch(q), mode: "insensitive" } } }, { user: { email: { contains: escapeOrderSearch(q), mode: "insensitive" } } }],
  };
  const customerWhere: Prisma.UserWhereInput = { role: UserRole.CUSTOMER, ...(kind === "order" ? {} : await buildCustomerSearch(query)) };
  const [orders, orderCount, customers, customerCount] = await Promise.all([
    kind === "phone" ? [] : prisma.order.findMany({ where: orderWhere, take: 5, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, orderNumber: true, status: true, user: { select: { name: true } } } }),
    kind === "phone" ? 0 : kind === "order" && numeric ? numericOrderMatch : prisma.order.count({ where: orderWhere }),
    kind === "order" ? [] : prisma.user.findMany({ where: customerWhere, take: 5, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, name: true, email: true, phoneNumber: true } }),
    kind === "order" ? 0 : prisma.user.count({ where: customerWhere }),
  ]);
  return { query, kind, orders, customers, counts: { orders: orderCount, customers: customerCount } };
}
