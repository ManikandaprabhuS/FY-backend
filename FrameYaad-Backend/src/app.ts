import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { env } from "./config/env";
import { logger } from "./config/logger";
import { notificationLogLevel } from './modules/notifications/notification-logging';
import {resendWebhook} from './services/delivery/resend-webhook';
import { errorHandler } from "./middleware/error.middleware";
import { notFound } from "./middleware/not-found.middleware";
import { requestId } from "./middleware/request-id.middleware";
import { requireTrustedOrigin } from "./middleware/trusted-origin.middleware";
import { apiRouter } from "./routes";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(pinoHttp({ logger, customLogLevel: (request, response, error) => notificationLogLevel(request.method, request.url, response.statusCode, error) }));
  app.use(helmet());
  const publicCatalogPath = `${env.API_PREFIX}/products/public`;
  // Compress public catalog JSON only; never compress tokens, OTPs or account data.
  app.use(compression({
    level: 4,
    threshold: 1024,
    filter: (request, response) => {
      // Mounted routers temporarily strip prefixes from request.path at write time.
      const path = request.originalUrl.split("?")[0] ?? "";
      return request.method === "GET"
        && (path === publicCatalogPath || path.startsWith(`${publicCatalogPath}/`))
        && response.statusCode === 200
        && compression.filter(request, response);
    },
  }));
  app.use(cors({ origin: process.env.FRONTEND_URL,
  credentials: true,}));
  app.post(`${env.API_PREFIX}/webhooks/resend`,express.raw({type:'application/json',limit:'256kb'}),resendWebhook);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requireTrustedOrigin);
  app.use(env.API_PREFIX, apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

export const app = createApp();
