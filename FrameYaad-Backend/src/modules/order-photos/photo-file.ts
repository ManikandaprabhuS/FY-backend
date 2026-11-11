import { ApiError } from "../../utils/api-error";
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const sanitizePhotoPart = (value: string, limit: number, fallback: string): string =>
  value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, limit) || fallback;

export function verifiedPhotoType(bytes: Buffer): { mimeType: string; ext: string } {
  if (!bytes.length) throw new ApiError(400, "Please choose a non-empty photo.", "PHOTO_EMPTY");
  if (bytes.length > PHOTO_MAX_BYTES) throw new ApiError(413, "Photo must be 4 MB or smaller", "PHOTO_TOO_LARGE");
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let offset = 8, header = false, data = false, end = false;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset), kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (size > bytes.length - offset - 12) break;
      if (kind === "IHDR" && size === 13 && !header) {
        const w = bytes.readUInt32BE(offset + 8), h = bytes.readUInt32BE(offset + 12);
        if (!w || !h || w > 30000 || h > 30000) break;
        header = true;
      }
      if (kind === "IDAT" && size > 0) data = true;
      if (kind === "IEND" && size === 0) { end = true; break; }
      offset += size + 12;
    }
    if (header && data && end) return { mimeType: "image/png", ext: "png" };
    throw new ApiError(400, "This PNG photo is damaged. Please choose another photo.", "PHOTO_CORRUPTED");
  }
  if (bytes.length > 20 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    // Check structural markers, a frame header and a scan; reject truncated/renamed content.
    let offset = 2, frame = false, scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217) break;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) frame = length >= 8;
      if (marker === 218) { scan = true; break; }
      offset += length;
    }
    let eoi = false;
    for (let i = offset; i + 1 < bytes.length; i++) if (bytes[i] === 255 && bytes[i+1] === 217) { eoi = true; break; }
    if (frame && scan && eoi) return { mimeType: "image/jpeg", ext: "jpg" };
    throw new ApiError(400, "This JPEG photo is damaged. Please choose another photo.", "PHOTO_CORRUPTED");
  }
  if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const size = bytes.readUInt32LE(4) + 8;
    if (size > bytes.length || size < 20) throw new ApiError(400, "This WebP photo is damaged.", "PHOTO_CORRUPTED");
    let offset = 12, image = false;
    while (offset + 8 <= size) {
      const kind = bytes.toString("ascii", offset, offset+4), length = bytes.readUInt32LE(offset+4);
      if (offset + 8 + length > size) break;
      if (["VP8 ", "VP8L"].includes(kind) && length >= 5) image = true;
      offset += 8 + length + (length % 2);
    }
    if (image && offset === size) return { mimeType: "image/webp", ext: "webp" };
    throw new ApiError(400, "This WebP photo is damaged.", "PHOTO_CORRUPTED");
  }
  throw new ApiError(415, "Please choose a JPG, PNG or WebP photo.", "PHOTO_UNSUPPORTED");
}
export function photoFileName(customer: string, original: string, ext: string, suffix = 1): string {
  const basename = original.replace(/\.[^.]*$/, "");
  return "FY-" + sanitizePhotoPart(customer, 30, "Customer") + "-" +
    sanitizePhotoPart(basename, 50, "photo") + (suffix > 1 ? "-" + suffix : "") + "." + ext;
}
