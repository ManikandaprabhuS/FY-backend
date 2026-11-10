import { Prisma } from "@prisma/client";
export const normalizeOfferEmail = (value: string) => value.trim().toLowerCase();
export const normalizeOfferPhone = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
};
export const offerTotals = (subtotal: Prisma.Decimal.Value, percent = 0) => {
  const amount = Prisma.Decimal.max(0, new Prisma.Decimal(subtotal)).toDecimalPlaces(2);
  const discount = Prisma.Decimal.min(amount, amount.mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
  return { subtotal: amount, discountAmount: discount, total: amount.sub(discount) };
};
