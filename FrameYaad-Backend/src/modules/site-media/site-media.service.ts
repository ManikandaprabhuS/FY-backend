import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "../../config/supabase";
import { ApiError } from "../../utils/api-error";
import { validateUpload } from "../../utils/upload-validation";

/*
 * Homepage hero video. It lives in the same Supabase bucket as product media, in its own
 * folder; the newest file there is the one shown. Uploading a new video stores it under a
 * new name (so browsers and the CDN never serve a stale copy) and removes the old ones.
 * No database table is needed.
 */

const bucket = "product-images";
const folder = "site/hero-video";
const cacheTtlMs = 60_000;

export type HeroVideo = { url: string; updatedAt: string | null };

let cached: { value: HeroVideo | null; expiresAt: number } | null = null;

const publicUrl = (path: string) => supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;

/** Stored hero videos, newest first (file names start with the upload time). */
const listStoredVideos = async () => {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(folder, { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) throw new ApiError(502, "Unable to read the homepage video", "HERO_VIDEO_READ_FAILED");
  return (data ?? []).filter((object) => object.name.endsWith(".mp4"));
};

export const getHeroVideo = async (): Promise<HeroVideo | null> => {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [latest] = await listStoredVideos();
  const value = latest
    ? { url: publicUrl(`${folder}/${latest.name}`), updatedAt: latest.created_at ?? latest.updated_at ?? null }
    : null;
  cached = { value, expiresAt: Date.now() + cacheTtlMs };
  return value;
};

export const replaceHeroVideo = async (file: Express.Multer.File | undefined): Promise<HeroVideo> => {
  if (!file) throw new ApiError(400, "Choose an MP4 video to upload", "HERO_VIDEO_REQUIRED");
  if (file.mimetype !== "video/mp4") throw new ApiError(415, "The homepage video must be an MP4 file", "UNSUPPORTED_FILE_TYPE");
  validateUpload(file);

  const previous = await listStoredVideos();
  const objectPath = `${folder}/${Date.now()}-${randomUUID()}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, file.buffer, { contentType: "video/mp4", upsert: false, cacheControl: "31536000" });
  if (error) throw new ApiError(502, "Unable to store the homepage video", "HERO_VIDEO_UPLOAD_FAILED");

  // The new video is live; clearing out the old files is best effort.
  if (previous.length > 0) {
    await supabaseAdmin.storage.from(bucket).remove(previous.map((object) => `${folder}/${object.name}`));
  }

  const value = { url: publicUrl(objectPath), updatedAt: new Date().toISOString() };
  cached = { value, expiresAt: Date.now() + cacheTtlMs };
  return value;
};

export const removeHeroVideo = async (): Promise<void> => {
  const stored = await listStoredVideos();
  if (stored.length > 0) {
    const { error } = await supabaseAdmin.storage.from(bucket).remove(stored.map((object) => `${folder}/${object.name}`));
    if (error) throw new ApiError(502, "Unable to remove the homepage video", "HERO_VIDEO_DELETE_FAILED");
  }
  cached = { value: null, expiresAt: Date.now() + cacheTtlMs };
};

/** For tests. */
export const clearHeroVideoCache = () => {
  cached = null;
};
