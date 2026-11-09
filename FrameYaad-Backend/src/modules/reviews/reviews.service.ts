import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { buildReviewWhere } from "./reviews.filters";
import { adminReviewQuery, publicReviewQuery, type reviewInputSchema, type moderationSchema } from "./reviews.schemas";
import { reviewFingerprint } from "./reviews.rate-limit";
import { invalidateRatings, ratingSummaries } from "./reviews.ratings";
export const publicReviewSelect = { id: true, name: true, rating: true, title: true, comment: true, verifiedPurchase: true, createdAt: true } as const;
export const adminReviewSelect = { ...publicReviewSelect, email: true, status: true, productId: true, rejectionReason: true, reviewedAt: true, reviewedBy: { select: { id: true, name: true, role: true } }, product: { select: { id: true, productName: true } } } as const;
export const submitReview = async (productId: string, input: z.infer<typeof reviewInputSchema>, userId: string | null, ip: string) => {
  const email = input.email.trim().toLowerCase();
  const requestIpHash = reviewFingerprint("ip:" + ip);
  const commentHash = reviewFingerprint("comment:" + input.comment.toLowerCase().replace(/\s+/g, " "));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const product = await tx.product.findFirst({ where: { id: productId, material: { isActive: true }, variant: { isActive: true } }, select: { id: true } });
        if (!product) throw new ApiError(404, "Product was not found", "PRODUCT_NOT_FOUND");
        const existing = await tx.review.findUnique({ where: { productId_email: { productId, email } }, select: { id: true } });
        if (existing) throw new ApiError(409, "You have already reviewed this product.", "REVIEW_DUPLICATE");
        const hour = new Date(Date.now() - 3600000), day = new Date(Date.now() - 86400000);
        const [emailCount, ipCount, repeated] = await Promise.all([
          tx.review.count({ where: { email, createdAt: { gte: hour } } }),
          tx.review.count({ where: { requestIpHash, createdAt: { gte: hour } } }),
          tx.review.count({ where: { commentHash, createdAt: { gte: day }, OR: [{ email }, { requestIpHash }] } }),
        ]);
        if (emailCount >= 3 || ipCount >= 15 || repeated) throw new ApiError(429, repeated ? "Please write original feedback for this product." : "Too many reviews. Please try again later.", "REVIEW_RATE_LIMITED");
        return tx.review.create({ data: { productId, userId, email, name: input.name, rating: input.rating, title: input.title || null, comment: input.comment, requestIpHash, commentHash, status: "PENDING" }, select: { id: true, productId: true, status: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError(409, "You have already reviewed this product.", "REVIEW_DUPLICATE");
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError(503, "Please try submitting your review again.", "REVIEW_BUSY");
};
export const publicReviews = async (productId: string, raw: unknown) => {
  const query = publicReviewQuery.parse(raw);
  const product = await prisma.product.findFirst({ where: { id: productId, material: { isActive: true }, variant: { isActive: true } }, select: { id: true } });
  if (!product) throw new ApiError(404, "Product was not found", "PRODUCT_NOT_FOUND");
  const where = { productId, status: "APPROVED" };
  const [reviews, total, summaries] = await Promise.all([
    prisma.review.findMany({ where, select: publicReviewSelect, orderBy: query.sort === "newest" ? [{ createdAt: "desc" }, { id: "desc" }] : [{ rating: query.sort === "highest" ? "desc" : "asc" }, { createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.review.count({ where }), ratingSummaries([productId]),
  ]);
  return { reviews, pagination: paginationMeta(query.page, query.limit, total), summary: summaries[productId] };
};
export const listAdminReviews = async (raw: unknown) => {
  const query = adminReviewQuery.parse(raw), where = buildReviewWhere(query);
  const [reviews, groups] = await Promise.all([
    prisma.review.findMany({ where, select: adminReviewSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.review.groupBy({ by: ["status"], where, _count: { _all: true }, _avg: { rating: true } }),
  ]);
  const counts = Object.fromEntries(groups.map(group => [group.status, group._count._all]));
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  return { reviews, pagination: paginationMeta(query.page, query.limit, total), summary: { total, pending: counts.PENDING ?? 0, approved: counts.APPROVED ?? 0, rejected: counts.REJECTED ?? 0, average: Number((groups.find(group => group.status === "APPROVED")?._avg.rating ?? 0).toFixed(1)) } };
};
export const moderateReview = async (id: string, actorId: string, input: z.infer<typeof moderationSchema>) => {
  const existing = await prisma.review.findUnique({ where: { id }, select: { productId: true } });
  if (!existing) throw new ApiError(404, "Review was not found", "REVIEW_NOT_FOUND");
  const review = await prisma.review.update({ where: { id }, data: { status: input.status, rejectionReason: input.status === "REJECTED" ? input.reason || null : null, reviewedById: actorId, reviewedAt: new Date() }, select: adminReviewSelect });
  invalidateRatings(existing.productId);
  return review;
};
export const deleteReview = async (id: string) => {
  const existing = await prisma.review.findUnique({ where: { id }, select: { productId: true } });
  if (!existing) throw new ApiError(404, "Review was not found", "REVIEW_NOT_FOUND");
  await prisma.review.delete({ where: { id } }); invalidateRatings(existing.productId);
};
export const exportReviews = async (raw: unknown) => {
  const query = adminReviewQuery.parse(raw), where = buildReviewWhere(query);
  const reviews: Prisma.ReviewGetPayload<{ select: typeof adminReviewSelect }>[] = [];
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.review.findMany({ where, select: adminReviewSelect, take: 500, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    reviews.push(...batch); if (batch.length < 500) break; cursor = batch[batch.length - 1]!.id;
  }
  return { reviews, generatedAt: new Date().toISOString(), filters: { status: query.status ?? "All", rating: query.rating ?? "All", search: query.search ?? "", productId: query.productId ?? "All", dateFilter: query.dateFilter, from: query.from, to: query.to } };
};
