import { Prisma, UserRole } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../prisma/client";
import type { orderListQuerySchema } from "./orders.schemas";

export const orderTimeZone = process.env.ORDER_TIME_ZONE || process.env.TZ || "Asia/Kolkata";
export const orderRangeLabels: Record<string, string> = { all: "All Time", today: "Today", "7": "Last 7 Days", "30": "Last 30 Days", "90": "Last 90 Days", "365": "Last 1 Year" };
export const escapeOrderSearch = (value: string) => value.trim().replace(/[\\%_]/g, "\\$&");
export const normalizePhoneSearch = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return (/^\s*\+91/.test(value) || (digits.length === 12 && digits.startsWith("91"))) ? digits.slice(2) : digits;
};
export function orderDateStart(range = "all", now = new Date(), timeZone = orderTimeZone): Date | undefined {
  if (range === "all") return undefined;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  const local = parts(now);
  const target = Date.UTC(local.year!, local.month! - 1, local.day! - (range === "today" ? 0 : Number(range)));
  let midnight = target;
  for (let pass = 0; pass < 3; pass++) {
    const rendered = parts(new Date(midnight));
    const wallTime = Date.UTC(rendered.year!, rendered.month! - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
    midnight = target - (wallTime - midnight);
  }
  return new Date(midnight);
}

export async function buildOrderWhere(query: z.infer<typeof orderListQuerySchema>, actorId: string, role: UserRole, now = new Date()): Promise<Prisma.OrderWhereInput> {
  const { status, userId, search, dateFilter } = query;
  const start = orderDateStart(dateFilter, now);
  const where: Prisma.OrderWhereInput = {
    ...(role === UserRole.CUSTOMER ? { userId: actorId } : userId ? { userId } : {}),
    ...(status ? { status } : {}),
    ...(start ? { createdAt: { gte: start } } : {}),
  };
  if (search) {
    const text = escapeOrderSearch(search);
    const choices: Prisma.OrderWhereInput[] = [
      { orderNumber: { contains: text, mode: "insensitive" } },
      { user: { name: { contains: text, mode: "insensitive" } } },
      { user: { email: { contains: text, mode: "insensitive" } } },
    ];
    if (/^[\d\s()+-]+$/.test(search)) {
      const digits = normalizePhoneSearch(search);
      if (digits) {
        // Parameterized SQL normalizes stored phone punctuation without changing data.
        const phones = await prisma.$queryRaw<Array<{ id: string; kind: string }>>(Prisma.sql`
          SELECT id, 'user' AS kind FROM users
          WHERE regexp_replace(COALESCE("phoneNumber", ''), '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}
          UNION ALL
          SELECT id, 'address' AS kind FROM user_address
          WHERE regexp_replace("contactNumber", '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}
        `);
        const userIds = phones.filter(row => row.kind === "user").map(row => row.id);
        const addressIds = phones.filter(row => row.kind === "address").map(row => row.id);
        if (userIds.length) choices.push({ userId: { in: userIds } });
        if (addressIds.length) choices.push({ userAddressId: { in: addressIds } });
      }
    }
    where.OR = choices;
  }
  return where;
}
