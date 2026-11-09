import { prisma } from "../../prisma/client";
import { exportAmount, exportDate } from "../../utils/csv-export";
import { parsePagination } from "../../utils/pagination";
import { buildCustomerWhere } from "./users.filters";

export const customerExportHeaders = ["Customer ID", "Name", "Email", "Phone", "Full address", "All saved addresses", "Registered date", "Account status", "Total orders", "Total amount spent", "Last order date", "Wishlist count"];
const address = (value: { addressLine: string | null; city: string | null; state: string | null; country: string | null; postalCode: string | null }) => [value.addressLine, value.city, value.state, value.country, value.postalCode].filter(Boolean).join(", ");
export async function* customerExportRows(rawQuery: unknown) {
  const where = await buildCustomerWhere(parsePagination(rawQuery));
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.user.findMany({
      where, take: 250, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, name: true, email: true, phoneNumber: true, addressLine: true, city: true, state: true, country: true, postalCode: true, createdAt: true, isActive: true, addresses: { select: { addressLine: true, city: true, state: true, country: true, postalCode: true } }, _count: { select: { wishlistItems: true } } },
    });
    const stats = batch.length ? await prisma.order.groupBy({ by: ["userId"], where: { userId: { in: batch.map(u => u.id) } }, _count: { _all: true }, _sum: { totalPrice: true }, _max: { createdAt: true } }) : [];
    const byUser = new Map(stats.map(s => [s.userId, s]));
    for (const user of batch) {
      const totals = byUser.get(user.id);
      yield [user.id, user.name, user.email, user.phoneNumber ?? "-", address(user) || "-", user.addresses.map(address).join(" | ") || "-", exportDate(user.createdAt), user.isActive ? "Active" : "Inactive", totals?._count._all ?? 0, exportAmount(totals?._sum.totalPrice ?? 0), exportDate(totals?._max.createdAt), user._count.wishlistItems];
    }
    if (batch.length < 250) break;
    cursor = batch[batch.length - 1]!.id;
  }
}
