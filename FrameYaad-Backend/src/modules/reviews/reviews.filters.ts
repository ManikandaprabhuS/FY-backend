import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { orderDateStart } from "../orders/orders.filters";
import { adminReviewQuery } from "./reviews.schemas";
export const buildReviewWhere = (query: z.infer<typeof adminReviewQuery>): Prisma.ReviewWhereInput => {
  const start = query.from ? orderDateStart("today", new Date(query.from + "T12:00:00Z")) : orderDateStart(query.dateFilter);
  const end = query.to ? orderDateStart("today", new Date(new Date(query.to + "T12:00:00Z").getTime() + 86400000)) : undefined;
  return { ...(query.id ? { id: query.id } : {}), ...(query.status ? { status: query.status } : {}),
    ...(query.productId ? { productId: query.productId } : {}), ...(query.rating ? { rating: query.rating } : {}),
    ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }, { product: { productName: { contains: query.search, mode: "insensitive" } } }] } : {}),
  };
};
