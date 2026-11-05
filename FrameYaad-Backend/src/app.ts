import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler } from "./middleware/error.middleware";
import { notFound } from "./middleware/not-found.middleware";
import { requestId } from "./middleware/request-id.middleware";
import { requireTrustedOrigin } from "./middleware/trusted-origin.middleware";
import { apiRouter } from "./routes";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL,
  credentials: true,}));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requireTrustedOrigin);
  app.use(env.API_PREFIX, apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

export const app = createApp();
