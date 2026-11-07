import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../utils/api-error";

export const notFound = (_request: Request, _response: Response, next: NextFunction): void => {
  next(new ApiError(404, "Requested API route was not found", "ROUTE_NOT_FOUND"));
};
