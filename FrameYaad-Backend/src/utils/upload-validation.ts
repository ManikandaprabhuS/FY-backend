import { ApiError } from "./api-error";

const signatures: Record<string, (data: Buffer) => boolean> = {
  "image/jpeg": data => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/png": data => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  "image/webp": data => data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP",
  "video/mp4": data => data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp",
};
export const validateUpload = (file: Pick<Express.Multer.File, "buffer" | "mimetype" | "size">) => {
  if (file.size > 10 * 1024 * 1024) throw new ApiError(413, "Each uploaded file must be 10 MB or smaller", "FILE_TOO_LARGE");
  if (!signatures[file.mimetype]?.(file.buffer)) throw new ApiError(415, "File content does not match a supported JPG, PNG, WebP or MP4 file", "INVALID_FILE_CONTENT");
};
