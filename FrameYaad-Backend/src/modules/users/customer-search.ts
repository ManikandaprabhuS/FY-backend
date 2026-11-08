import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { escapeOrderSearch, normalizePhoneSearch } from "../orders/orders.filters";
export async function buildCustomerSearch(search?: string): Promise<Prisma.UserWhereInput> {
  if (!search?.trim()) return {};
  const text = escapeOrderSearch(search);
  const OR: Prisma.UserWhereInput[] = [
    { name: { contains: text, mode: "insensitive" } },
    { email: { contains: text, mode: "insensitive" } },
    { phoneNumber: { contains: text } },
  ];
  if (/^[\d\s()+-]+$/.test(search.trim())) {
    const digits = normalizePhoneSearch(search);
    if (digits) {
      const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM public.users WHERE role = ${UserRole.CUSTOMER}::"UserRole"
        AND regexp_replace(COALESCE("phoneNumber", ''), '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}
      `);
      if (matches.length) OR.push({ id: { in: matches.map(value => value.id) } });
    }
  }
  return { OR };
}
