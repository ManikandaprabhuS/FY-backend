import { Router } from "express";
import multer from "multer";

import { authenticate, staffOnly } from "../../middleware/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { getHeroVideo, removeHeroVideo, replaceHeroVideo } from "./site-media.service";

export const siteMediaRouter = Router();

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype !== "video/mp4") {
      callback(new ApiError(415, "The homepage video must be an MP4 file", "UNSUPPORTED_FILE_TYPE"));
      return;
    }
    callback(null, true);
  },
});

/** Public: the video for the homepage hero, or null when none is set. */
siteMediaRouter.get("/hero-video", async (_request, response) => {
  const video = await getHeroVideo();
  response.set("Cache-Control", "public, max-age=60");
  response.json({ success: true, data: { video } });
});

/** Staff: upload a new hero video, replacing the current one. */
siteMediaRouter.put("/hero-video", authenticate, staffOnly, videoUpload.single("video"), async (request, response) => {
  const video = await replaceHeroVideo(request.file);
  response.json({ success: true, message: "Homepage video updated", data: { video } });
});

/** Staff: remove the hero video; the homepage then shows only the frames slide. */
siteMediaRouter.delete("/hero-video", authenticate, staffOnly, async (_request, response) => {
  await removeHeroVideo();
  response.json({ success: true, message: "Homepage video removed", data: { video: null } });
});
