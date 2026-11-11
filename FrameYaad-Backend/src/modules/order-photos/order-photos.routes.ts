import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { PHOTO_MAX_BYTES } from "./photo-file";
import { clearTempPhoto, getTempPhoto, uploadPhoto } from "./order-photos.service";
export const orderPhotosRouter = Router();
const hits = new Map<string, { count: number; until: number }>();
export const photoRateLimit: RequestHandler = (req, _res, next) => {
  const now = Date.now();
  if (hits.size > 10000) for (const [key, entry] of hits) if (entry.until <= now) hits.delete(key);
  for (const key of ["user:" + req.auth!.user.id, "ip:" + req.ip]) {
    const entry = hits.get(key);
    const value = !entry || entry.until <= now ? { count: 0, until: now + 600000 } : entry;
    value.count++; hits.set(key, value);
    if (value.count > (key.startsWith("ip:") ? 30 : 10)) { next(new ApiError(429, "Too many photo requests. Please try again shortly.", "PHOTO_RATE_LIMIT")); return; }
  }
  next();
};
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES + 1, files: 1, fields: 0, parts: 2 } }).single("photo");
const parsePhoto: RequestHandler = (req, res, next) => parser(req, res, error => {
  if (error instanceof multer.MulterError) next(new ApiError(error.code === "LIMIT_FILE_SIZE" ? 413 : 400, error.code === "LIMIT_FILE_SIZE" ? "Photo must be 4 MB or smaller" : "Upload one photo using the photo field.", "INVALID_PHOTO_UPLOAD"));
  else next(error as unknown);
});
orderPhotosRouter.use(authenticate, authorize(UserRole.CUSTOMER), (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
orderPhotosRouter.get("/temp", async (req, res) => {
  const photo = await getTempPhoto(req.auth!.user.id);
  res.json({ success: true, data: photo ? { imageId: photo.id, fileName: photo.fileName, sizeBytes: photo.sizeBytes } : null });
});
orderPhotosRouter.post("/", photoRateLimit, parsePhoto, async (req, res) => res.status(201).json({ success: true, data: await uploadPhoto(req.auth!.user.id, req.file) }));
orderPhotosRouter.delete("/:imageId", photoRateLimit, async (req, res) => {
  await clearTempPhoto(req.auth!.user.id, z.string().uuid().parse(req.params.imageId));
  res.json({ success: true, data: null });
});
