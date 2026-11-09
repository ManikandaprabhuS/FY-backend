import { Router, type RequestHandler } from "express";
import { UserRole } from "@prisma/client";
import { authenticate, optionalAuthenticate, staffOnly } from "../../middleware/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { prisma } from "../../prisma/client";
import { adminReviewQuery, reviewIdSchema, reviewInputSchema, moderationSchema, summaryQuery, productLookupQuery } from "./reviews.schemas";
import { ratingSummaries } from "./reviews.ratings";
import { reviewRequestLimit } from "./reviews.rate-limit";
import { queueReviewEffects } from "./reviews.worker";
import * as service from "./reviews.service";
export const reviewsRouter = Router();
const optionalReviewSession: RequestHandler = async (req, res, next) => {
  const complete = (error?: unknown) => {
    if (error instanceof ApiError && [401,403].includes(error.statusCode)) { req.auth = undefined; next(); }
    else next(error);
  };
  try { await optionalAuthenticate(req, res, complete); } catch (error) { complete(error); }
};
reviewsRouter.get("/summary", async (req, res) => { const { ids } = summaryQuery.parse(req.query); res.setHeader("Cache-Control","no-store"); res.json({ success: true, data: { summaries: await ratingSummaries(ids) } }); });
reviewsRouter.get("/product/:id", async (req, res) => { const data = await service.publicReviews(reviewIdSchema.parse(req.params.id), req.query); res.setHeader("Cache-Control","no-store"); res.json({ success: true, data }); });
reviewsRouter.post("/product/:id", reviewRequestLimit, optionalReviewSession, async (req, res) => {
  const review = await service.submitReview(reviewIdSchema.parse(req.params.id), reviewInputSchema.parse(req.body), req.auth?.user.role === UserRole.CUSTOMER ? req.auth.user.id : null, req.ip || req.socket.remoteAddress || "unknown");
  res.status(201).json({ success: true, data: { review } }); queueReviewEffects(review.id);
});
reviewsRouter.use("/admin", authenticate, staffOnly);
reviewsRouter.get("/admin/products", async (req, res) => { const { search } = productLookupQuery.parse(req.query); const products = await prisma.product.findMany({ where: search ? { productName: { contains: search, mode: "insensitive" } } : {}, select: { id: true, productName: true }, orderBy: { productName: "asc" }, take: 50 }); res.json({ success: true, data: { products } }); });
reviewsRouter.get("/admin/export", async (req, res) => { res.setHeader("Cache-Control","no-store"); res.json({ success: true, data: await service.exportReviews(req.query) }); });
reviewsRouter.get("/admin", async (req, res) => { adminReviewQuery.parse(req.query); res.setHeader("Cache-Control","no-store"); res.json({ success: true, data: await service.listAdminReviews(req.query) }); });
reviewsRouter.patch("/admin/:id", async (req, res) => {
  if (!req.auth) throw new ApiError(401,"Authentication is required","AUTHENTICATION_REQUIRED");
  res.json({ success: true, data: { review: await service.moderateReview(reviewIdSchema.parse(req.params.id), req.auth.user.id, moderationSchema.parse(req.body)) } });
});
reviewsRouter.delete("/admin/:id", async (req, res) => { await service.deleteReview(reviewIdSchema.parse(req.params.id)); res.status(204).end(); });
