import type { RequestHandler } from "express";

import { env } from "../config/env";
import { ApiError } from "../utils/api-error";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const requireTrustedOrigin: RequestHandler = (request, _response, next) => {
  const origin = request.header("origin");

  if (!safeMethods.has(request.method) && origin && origin !== env.FRONTEND_URL) {
    next(new ApiError(403, "Request origin is not allowed", "UNTRUSTED_ORIGIN"));
    return;
  }

  next();
};
