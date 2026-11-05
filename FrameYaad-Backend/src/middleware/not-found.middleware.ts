import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../utils/api-error";

export const notFound = (request: Request, _response: Response, next: NextFunction): void => {
  next(new ApiError(404, `Route ${request.method} ${request.originalUrl} not found`, "ROUTE_NOT_FOUND"));
};
