import { randomUUID } from "node:crypto";
import {getPhotoMaxBytes,photoSizeError,PHOTO_MB_BYTES} from "../../utils/photo-limits";
import {resolvePhotoContext} from "./photo-context";
import {cleanupPhotoOrphans} from "./photo-orphans";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { supabaseAdmin } from "../../config/supabase";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { ApiError } from "../../utils/api-error";
import { photoFileName, verifiedPhotoType } from "./photo-file";
const bucket = () => supabaseAdmin.storage.from(env.SUPABASE_PHOTO_BUCKET);
export const photoInfoSelect = { id: true, fileName: true, sizeBytes: true } as const;
const unavailable = () => new ApiError(503, "Photo storage is temporarily unavailable. Please try again.", "PHOTO_STORAGE_UNAVAILABLE");
function check(error: unknown): void { if (error) throw unavailable(); }
async function removeQuietly(storagePath: string) {
  try { const result = await bucket().remove([storagePath]); if (!result.error) return; } catch { /* A maintenance sweep retries this removal. */ }
  logger.warn({ event: "photo_cleanup_pending" }, "Private photo cleanup will retry");
}
export async function lockCustomerPhotos(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text", "photo:" + userId);
}
export async function getTempPhoto(userId: string) {
  return prisma.orderPhoto.findFirst({ where: { userId, status: "TEMP", orderId: null }, select: photoInfoSelect });
}
export async function uploadPhoto(userId: string, file?: Express.Multer.File, context?:unknown) {
  if (!file) throw new ApiError(400, "Please choose a photo.", "PHOTO_REQUIRED");
  const limits = await resolvePhotoContext(prisma,userId,context);
  if(file.buffer.length>limits.maxBytes)throw new ApiError(413,photoSizeError(file.buffer.length,limits.maxBytes),"PHOTO_TOO_LARGE",{maxAllowedMB:limits.maxAllowedMB});
  const type = verifiedPhotoType(file.buffer);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  let uploadedPath: string | undefined;
  let committed = false;
  try {
    const result = await prisma.$transaction(async tx => {
      await lockCustomerPhotos(tx, userId);
      const old = await tx.orderPhoto.findFirst({ where: { userId, status: "TEMP", orderId: null } });
      let suffix = old && old.fileName === photoFileName(user.name, file.originalname, type.ext) ? 2 : 1;
      let fileName = photoFileName(user.name, file.originalname, type.ext, suffix);
      let storagePath = userId + "/temp/" + fileName;
      for (;;) {
        const { error } = await bucket().upload(storagePath, file.buffer, { contentType: type.mimeType, upsert: false, cacheControl: "0" });
        if (!error) { uploadedPath = storagePath; break; }
        if ("statusCode" in error && Number(error.statusCode) === 409 && suffix < 1000) {
          fileName = photoFileName(user.name, file.originalname, type.ext, ++suffix);
          storagePath = userId + "/temp/" + fileName;
        } else throw unavailable();
      }
      // Persist replacement before deleting the old object, so failed DB writes preserve the old photo.
      if (old) await tx.orderPhoto.delete({ where: { id: old.id } });
      const created = await tx.orderPhoto.create({ data: { id: randomUUID(), userId, fileName, storagePath, mimeType: type.mimeType, sizeBytes: file.size, maxAllowedMB:limits.maxAllowedMB, status: "TEMP" }, select: photoInfoSelect });
      return { created, oldPath: old?.storagePath };
    }, { timeout: 30000, maxWait: 10000 });
    committed = true;
    if (result.oldPath) await removeQuietly(result.oldPath);
    return { imageId: result.created.id, fileName: result.created.fileName, sizeBytes: result.created.sizeBytes };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // A database failure may include query values; never pass it to HTTP error logging.
    throw new ApiError(503, "Your photo could not be saved. Please try again.", "PHOTO_SERVICE_UNAVAILABLE");
  } finally {
    if (uploadedPath && !committed) {
      await removeQuietly(uploadedPath);
    }
  }
}
export async function clearTempPhoto(userId: string, id: string) {
  const storagePath = await prisma.$transaction(async tx => {
    await lockCustomerPhotos(tx, userId);
    const photo = await tx.orderPhoto.findFirst({ where: { id, userId } });
    if (!photo || photo.status !== "TEMP" || photo.orderId) throw new ApiError(404, "Temporary photo not found.", "PHOTO_NOT_FOUND");
    await tx.orderPhoto.delete({ where: { id } });
    return photo.storagePath;
  }, { timeout: 15000 });
  // Commit first: a failed DB commit must never leave a valid record pointing at a deleted file.
  // Unreferenced objects are swept after 24 hours if this compensating removal is interrupted.
  await removeQuietly(storagePath);
}
export async function reserveOrderPhoto(tx: Prisma.TransactionClient, userId: string, photoId?: string, variants:ReadonlyArray<{maxPhotoSizeMB?:number|null}>=[]) {
  if (!photoId) return null;
  await lockCustomerPhotos(tx, userId);
  const photo = await tx.orderPhoto.findFirst({ where: { id: photoId, userId, status: "TEMP", orderId: null } });
  if (!photo) throw new ApiError(400, "Please upload your photo again or remove it before placing this order.", "INVALID_ORDER_PHOTO");
  const maxBytes=getPhotoMaxBytes(variants);
  if(photo.sizeBytes>maxBytes)throw new ApiError(400,photoSizeError(photo.sizeBytes,maxBytes)+" Please clear or replace your photo.","PHOTO_LIMIT_CHANGED",{maxAllowedMB:Number((maxBytes/PHOTO_MB_BYTES).toFixed(1))});
  return {...photo,maxAllowedMB:Number((maxBytes/PHOTO_MB_BYTES).toFixed(1))};
}
export async function finishPhotoAttachment(orderId: string) {
  const owner = await prisma.orderPhoto.findUnique({ where: { orderId } });
  if(!owner||owner.status!=="ATTACHED")return;
  await prisma.$transaction(async tx=>{
  await lockCustomerPhotos(tx,owner.userId);
  const photo=await tx.orderPhoto.findFirst({where:{orderId,status:"ATTACHED"}});
  if (!photo || photo.status!=="ATTACHED" || !photo.storagePath) return;
  const destination = photo.userId + "/" + orderId + "/" + photo.fileName;
  if (destination === photo.storagePath) return;
  const copied = await bucket().copy(photo.storagePath, destination);
  if (copied.error) {
    const { data, error } = await bucket().list(photo.userId + "/" + orderId, { search: photo.fileName, limit: 100 });
    if (error || !data.some(item => item.name === photo.fileName)) throw unavailable();
  }
  await tx.orderPhoto.update({ where: { id: photo.id }, data: { storagePath: destination } });
  const removed = await bucket().remove([photo.storagePath]); check(removed.error);
  },{timeout:30000,maxWait:10000});
}
export function enqueuePhotoAttachment(orderId: string) {
  void finishPhotoAttachment(orderId).catch(() => logger.warn({ event: "photo_attachment_pending" }, "Order saved; private photo attachment will retry"));
}
export async function downloadPhoto(orderId: string, actor: { id: string; role: string }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true, customerPhoto: true } });
  if (!order || (actor.role === "CUSTOMER" && order.userId !== actor.id) || !["CUSTOMER", "ADMIN", "EMPLOYEE"].includes(actor.role)) throw new ApiError(404, "Order photo not found.", "PHOTO_NOT_FOUND");
  if(order.customerPhoto?.status==="DELETED")throw new ApiError(410,"Photo removed after order completion.","PHOTO_DELETED");
  if (!order.customerPhoto) throw new ApiError(404, "No photo was uploaded for this order.", "PHOTO_NOT_FOUND");
  try {
    const { data, error } = await bucket().createSignedUrl(order.customerPhoto.storagePath, 60, { download: order.customerPhoto.fileName });
    check(error);
    if (!data) throw unavailable();
    return { url: data.signedUrl, fileName: order.customerPhoto.fileName, expiresIn: 60 };
  } catch { throw unavailable(); }
}
let running = false;
export async function cleanupAndRetryPhotos() {
  if (running) return;
  running = true;
  let deleted = 0, retried = 0;
  try {
    const old = await prisma.orderPhoto.findMany({ where: { status: "TEMP", createdAt: { lt: new Date(Date.now() - 86400000) } }, take: 200 });
    for (const photo of old) {
      await prisma.$transaction(async tx => {
        await lockCustomerPhotos(tx, photo.userId);
        const current = await tx.orderPhoto.findFirst({ where: { id: photo.id, status: "TEMP", orderId: null } });
        if (!current) return;
        const { error } = await bucket().remove([current.storagePath]); check(error);
        await tx.orderPhoto.delete({ where: { id: current.id } }); deleted++;
      }, { timeout: 15000 });
    }
    const pending = await prisma.orderPhoto.findMany({ where: { status: "ATTACHED", storagePath: { contains: "/temp/" } }, take: 100, select: { orderId: true } });
    for (const photo of pending) if (photo.orderId) { await finishPhotoAttachment(photo.orderId); retried++; }
    const orphaned = await cleanupPhotoOrphans();
    logger.info({ deleted, retried, orphaned }, "Private photo maintenance completed");
  } finally { running = false; }
}
export function startPhotoMaintenance() {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    if (ticks % 60 === 1) void cleanupAndRetryPhotos().catch(() => logger.warn({ event: "photo_maintenance_retry" }, "Photo maintenance will retry"));
    else void prisma.orderPhoto.findMany({ where: { status: "ATTACHED", storagePath: { contains: "/temp/" } }, take: 20, select: { orderId: true } }).then(rows => { rows.forEach(row => { if (row.orderId) enqueuePhotoAttachment(row.orderId); }); }).catch(() => undefined);
  }, 60000);
  timer.unref();
}
