import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { MulterError } from "multer";

import { logger } from "../config/logger";
import { ApiError } from "../utils/api-error";

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  if (response.headersSent) { _next(error); return; }
  let apiError: ApiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = new ApiError(400, "Request validation failed", "VALIDATION_ERROR", error.flatten());
  } else if (error instanceof MulterError) {
    apiError = error.code === "LIMIT_FILE_SIZE"
      ? new ApiError(413, "Each uploaded file must be 10 MB or smaller", "FILE_TOO_LARGE")
      : new ApiError(400, "Upload at most 10 files using the images field", "INVALID_UPLOAD");
  } else if (error instanceof Error && "type" in error && error.type === "entity.parse.failed") {
    apiError = new ApiError(400, "Request body must contain valid JSON", "INVALID_JSON");
  } else if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
    apiError = new ApiError(413, "Request body is too large", "REQUEST_TOO_LARGE");
  } else if (error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code))) {
    apiError = new ApiError(503, "Database service is temporarily unavailable. Please try again later", "DATABASE_UNAVAILABLE");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    apiError = new ApiError(409, "A record with these details already exists", "DUPLICATE_RECORD");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    apiError = new ApiError(404, "Requested record was not found", "RECORD_NOT_FOUND");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    apiError = new ApiError(409, "This record is in use and cannot be deleted", "RECORD_IN_USE");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    apiError = new ApiError(409, "The request conflicted with another update; please retry", "CONCURRENT_UPDATE");
  } else {
    apiError = new ApiError(500, "An unexpected error occurred", "INTERNAL_SERVER_ERROR");
  }

  if (apiError.statusCode >= 500) {
    logger.error({ err: error, requestId: request.requestId }, "Request failed");
  }

  response.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    },
    requestId: request.requestId,
  });
};
