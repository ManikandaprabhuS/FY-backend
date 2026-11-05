import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { ApiError } from "../utils/api-error";

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  let apiError: ApiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = new ApiError(400, "Request validation failed", "VALIDATION_ERROR", error.flatten());
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
      ...(env.NODE_ENV === "development" && error instanceof Error ? { stack: error.stack } : {}),
    },
    requestId: request.requestId,
  });
};
