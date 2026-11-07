// Read-only benchmark. Prints labels/timings only, never query parameters or records.
import { performance } from "node:perf_hooks";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/prisma/client";
import { listProducts } from "../src/modules/products/products.service";
import { listPublicCatalog } from "../src/modules/products/public-catalog.service";
import { listCustomers, getCustomer } from "../src/modules/users/users.service";
import { listEmployees } from "../src/modules/employees/employees.service";
import { listOrders } from "../src/modules/orders/orders.service";
import { listCoupons } from "../src/modules/coupon/coupon.service";
import { list as listDiscounts } from "../src/modules/product-discount/product-discount.service";
import { listNotifications } from "../src/modules/notifications/notifications.service";
import { listWishlist, getWishlistAnalytics } from "../src/modules/wishlist/wishlist.service";
import { listAppointments } from "../src/modules/appointment/appointment.service";
import { listSubscribers } from "../src/modules/newsletter/newsletter.service";
import { listAddresses } from "../src/modules/addresses/addresses.service";
import { userViewSelect } from "../src/utils/user-view";

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
async function measure(label: string, run: () => Promise<unknown>) {
  await run();
  const values: number[] = [];
  for (let i = 0; i < 5; i++) { const start = performance.now(); await run(); values.push(performance.now() - start); }
  console.log(JSON.stringify({ label, medianMs: Number(median(values).toFixed(2)), minMs: Number(Math.min(...values).toFixed(2)), maxMs: Number(Math.max(...values).toFixed(2)), samples: 5 }));
}
async function main() {
  const customer = await prisma.user.findFirst({ where: { role: UserRole.CUSTOMER }, select: { id: true } });
  const id = customer?.id ?? "00000000-0000-4000-8000-000000000000";
  const queries: Array<[string, () => Promise<unknown>]> = [
    ["Public catalog page", () => listPublicCatalog({ limit: 20 })],
    ["Admin products page", () => listProducts({ limit: 20 }, UserRole.ADMIN)],
    ["Customers page", () => listCustomers({ limit: 20 })],
    ["Employees page", () => listEmployees({ limit: 20 })],
    ["Orders page + summary", () => listOrders({ limit: 20 }, id, UserRole.ADMIN)],
    ["Coupons page", () => listCoupons({ limit: 20 })],
    ["Product discounts page", () => listDiscounts({ limit: 20 })],
    ["Notifications page + summary", () => listNotifications(id, UserRole.ADMIN, { limit: 20 })],
    ["Wishlist page", () => listWishlist(id, { limit: 20 })],
    ["Wishlist analytics page", () => getWishlistAnalytics({ limit: 20 })],
    ["Appointments page", () => listAppointments({ limit: 20 })],
    ["Newsletter page", () => listSubscribers({ limit: 20 })],
    ["Addresses page", () => listAddresses(id, { limit: 20 })],
    ["Cart read (no upsert)", () => prisma.cart.findUnique({ where: { userId: id }, select: { id: true, totalPrice: true, items: { select: { id: true, quantity: true, productIdentifier: true } } } })],
  ];
  if (customer) {
    queries.push(["Customer detail BEFORE sequential", async () => {
      await prisma.user.findFirst({ where: { id, role: UserRole.CUSTOMER }, select: userViewSelect });
      await prisma.order.aggregate({ where: { userId: id }, _count: { _all: true }, _sum: { totalPrice: true }, _max: { createdAt: true } });
    }], ["Customer detail AFTER parallel", () => getCustomer(id)]);
  }
  for (const [label, run] of queries) await measure(label, run);
  for (const [label, sql] of [
    ["Product date page", 'SELECT id FROM public."Product" ORDER BY "createdAt" DESC LIMIT 20'],
    ["Order date page", 'SELECT id FROM public."Order" ORDER BY "createdAt" DESC LIMIT 20'],
    ["Customer role page", 'SELECT id FROM public.users WHERE role = \'CUSTOMER\' ORDER BY "createdAt" DESC LIMIT 20'],
  ]) {
    const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": Array<{ "Execution Time": number }> }>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
    console.log(JSON.stringify({ label, databaseExecutionMs: plan[0]?.["QUERY PLAN"][0]?.["Execution Time"] }));
  }
}
void main().catch(() => { console.error("Read-only timing audit failed; inspect configuration/connectivity without logging credentials."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
